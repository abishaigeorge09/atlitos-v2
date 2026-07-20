-- ATLITOS v2 — 0028_route_transfers.sql
-- Domain: payments / Route payouts. Epic AT-11, story AT-43.
-- Requirements: PRD-02 FR-27, FR-28, FR-29.
--
-- The write half of on-demand Route transfers. `razorpay-route-transfer`
-- (the edge function) owns talking to Razorpay; everything that touches
-- `ledger_entries` or `transfers` happens here, in service-role-only
-- `security definer` RPCs, because CLAUDE.md's financial invariant puts every
-- money write behind one and because the balance re-derivation and the debit
-- that consumes it MUST be one atomic, serialized step (FR-28).
--
-- Four functions, mirroring the shape AT-60 established for refunds
-- (`settle_refund`): one function per real economic event, each idempotent,
-- each callable from both the synchronous path and the webhook, so the two
-- converge on exactly one record and exactly one ledger group.
--
--   get_payout_account_balance()  the single definition of "what may move"
--   record_transfer()             money left: transfers row + debit group
--   settle_transfer()             transfer.processed: terminal `paid`
--   fail_transfer()               transfer.failed: reversing credit group
--
-- ============================================================================
-- Why `payout` joins the payment_domain enum
-- ============================================================================
--
-- `ledger_entries.domain` is not null and `entity_id` is not null, so every
-- ledger row must name the economic object it belongs to. A payout is not a
-- session, a court booking, an order, or a donation; it is the coach drawing
-- down accruals that came from many sessions at once, and there is no single
-- session id to point at. The three ways to model it, and why this one:
--
--   * Reuse `domain='session'` with the transfer id in `entity_id`. Rejected:
--     it makes `idx_ledger_entries_entity` lookups for "everything about
--     session X" structurally capable of returning payout rows, and it
--     records a false fact (this money did not move because of a session).
--   * Make `entity_id` nullable for payouts. Rejected: it weakens the
--     constraint for every domain to accommodate one, and every consumer
--     summing by entity then has to handle a null case forever.
--   * Add `payout` to the enum, with `entity_id = transfers.id`. Chosen. The
--     transfer IS the economic object, it already has a durable row and a
--     provider id, and `get_my_transactions` (0025) already labels a coach's
--     ledger debits as `payout` from the caller's point of view, so the
--     domain name and the existing feed vocabulary agree rather than
--     inventing a second word for the same thing.
--
-- `payment_intents.domain` shares the enum and is unaffected: no payout ever
-- creates a payment intent, and the ledger rows written here deliberately
-- leave `payment_intent_id` null, because a transfer is not attributable to
-- any single inbound charge.
--
-- ============================================================================
-- Why the balance is a function and not a query the caller writes
-- ============================================================================
--
-- FR-28 forbids trusting the client's amount, but the subtler failure is two
-- server-side definitions of "balance" drifting apart: the number the coach
-- was shown by `get_coach_wallet_balance()` (0025) and the number the
-- transfer validates against. `get_payout_account_balance` below is the same
-- expression, `sum(credits) - sum(debits)` over the owner's ledger account,
-- and `record_transfer` calls it rather than re-inlining the sum, so the
-- pre-flight check the edge function does before calling Razorpay and the
-- authoritative check inside the transaction cannot disagree.
--
-- The two-check structure is deliberate and is what makes FR-29 true:
--
--   1. Edge function pre-flight (account active, amount <= balance). Fails
--      here and NOTHING is written and Razorpay is never called.
--   2. Razorpay transfer call. Fails here (including "Route feature not
--      enabled for the merchant") and NOTHING is written: no transfers row,
--      no ledger row. This is the whole of FR-29's "do not write any ledger
--      row".
--   3. `record_transfer`, which re-runs check 1 under a row lock on the
--      payout account and only then writes. Two concurrent transfers that
--      each pass step 1 serialize here, and the second sees the first's
--      debit and is refused.
--
-- Step 3 failing after step 2 succeeded is the one residual gap (money moved
-- at Razorpay, no ledger row here). It is handled the way AT-60 handles the
-- same gap for refunds: the `transfer.processed` webhook resolves an unknown
-- `razorpay_transfer_id` by creating the record, so the books converge on the
-- provider's truth rather than silently losing the movement.

-- Applied to the remote project as TWO migration versions, deliberately.
-- `alter type ... add value` may not be followed, inside the same
-- transaction, by statements that USE the new value; splitting it off keeps
-- the rest of this file replayable as one transactional unit on a fresh
-- database. The file is kept whole because it is one logical change.
alter type public.payment_domain add value if not exists 'payout';

-- ============================================================================
-- 1. transfers gains what reconciliation needs
-- ============================================================================
--
-- 0010 created the table optimistically: id, payout_account_id, amount,
-- razorpay_transfer_id, status, ledger_entry_group_id, created_at. Three
-- things are missing once transfers can actually fail asynchronously.

alter table public.transfers
  -- Why `transfer.failed` said no. Surfaced to the coach on the Transfer
  -- screen and to admin; cleared if a later event settles the transfer.
  add column if not exists failure_reason text,
  -- The REVERSING group written when a transfer that was already debited
  -- fails. Kept distinct from `ledger_entry_group_id` (which still points at
  -- the original debit) because both groups are permanent facts:
  -- ledger_entries is insert-only, so a failure is never an erasure of the
  -- first group, it is a second, opposite group.
  add column if not exists reversal_ledger_entry_group_id uuid,
  add column if not exists updated_at timestamptz not null default now();

-- Razorpay's own transfer id is the key the webhook dedupes on. Partial,
-- because a row is written with one in the normal path but the reconciling
-- webhook path may briefly see rows without one.
create unique index if not exists transfers_razorpay_transfer_id_key
  on public.transfers (razorpay_transfer_id)
  where razorpay_transfer_id is not null;

-- Admin queue: transfers that have not reached a terminal state, oldest
-- first. Mirrors idx_refunds_status_created from 0026.
create index if not exists idx_transfers_status_created
  on public.transfers (status, created_at)
  where status = 'processing';

drop trigger if exists transfers_set_updated_at on public.transfers;
create trigger transfers_set_updated_at
  before update on public.transfers
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. get_payout_account_balance(payout_account_id)
-- ============================================================================
--
-- The single definition of a payout account owner's transferable balance.
-- Maps the payout account's `owner_type` onto the matching
-- `ledger_account_type` and sums that owner's entries: credits (accruals from
-- completed sessions or court bookings) minus debits (transfers already
-- taken). Identical in form to `get_coach_wallet_balance()` (0025); that one
-- is scoped by `auth.uid()` for the coach's own screen, this one is keyed by
-- payout account for the service-role transfer path, which runs with no
-- `auth.uid()` at all.

create or replace function public.get_payout_account_balance(
  p_payout_account_id uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account public.payout_accounts;
  v_ledger_account public.ledger_account_type;
begin
  select * into v_account
  from public.payout_accounts
  where id = p_payout_account_id;

  if v_account.id is null then
    raise exception 'NOT_FOUND: payout account % does not exist', p_payout_account_id;
  end if;

  v_ledger_account := case v_account.owner_type
    when 'coach' then 'coach'::public.ledger_account_type
    when 'court_partner' then 'court_partner'::public.ledger_account_type
    else null
  end;

  if v_ledger_account is null then
    raise exception 'INTERNAL: payout account % has unmappable owner_type %',
      p_payout_account_id, v_account.owner_type;
  end if;

  return coalesce((
    select sum(case when le.direction = 'credit' then le.amount else -le.amount end)
    from public.ledger_entries le
    where le.account_type = v_ledger_account
      and le.account_ref = v_account.owner_id
  ), 0)::numeric(12, 2);
end;
$$;

revoke all on function public.get_payout_account_balance(uuid) from public;
revoke execute on function public.get_payout_account_balance(uuid) from anon, authenticated;
grant execute on function public.get_payout_account_balance(uuid) to service_role;

-- ============================================================================
-- 3. record_transfer(payout_account_id, amount, razorpay_transfer_id)
-- ============================================================================
--
-- Called ONLY after Razorpay has accepted the transfer. Writes the balancing
-- debit group and the `transfers` row in one transaction (FR-28: "writes a
-- transfers row and a corresponding debit ledger_entries row atomically").
--
-- The ledger group is two legs: debit the coach or partner (their claim on
-- the platform shrinks by what they just withdrew) and credit `platform`
-- (the platform's obligation discharges). It balances, which is what
-- `assert_ledger_group_balanced` (0010) enforces at end of transaction.
--
-- Idempotency: the unique index on `razorpay_transfer_id`. A retry carrying a
-- transfer id already recorded returns the existing row untouched rather than
-- debiting the coach twice for one movement of money.

create or replace function public.record_transfer(
  p_payout_account_id uuid,
  p_amount numeric,
  p_razorpay_transfer_id text
)
returns public.transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.payout_accounts;
  v_transfer public.transfers;
  v_ledger_account public.ledger_account_type;
  v_balance numeric(12, 2);
  v_group_id uuid := gen_random_uuid();
  v_amount numeric(12, 2) := round(p_amount, 2);
begin
  if p_razorpay_transfer_id is not null then
    select * into v_transfer
    from public.transfers
    where razorpay_transfer_id = p_razorpay_transfer_id;

    -- Already recorded. Return it unchanged: this movement of money has one
    -- ledger group and gets exactly one.
    if v_transfer.id is not null then
      return v_transfer;
    end if;
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'VALIDATION: transfer amount must be greater than zero';
  end if;

  -- Lock the payout account row. This is what serializes two concurrent
  -- transfers against one balance: the second waits here, then re-derives a
  -- balance that already reflects the first one's debit.
  select * into v_account
  from public.payout_accounts
  where id = p_payout_account_id
  for update;

  if v_account.id is null then
    raise exception 'NOT_FOUND: payout account % does not exist', p_payout_account_id;
  end if;

  -- FR-27: an inactive payout account may never be paid out to. Re-asserted
  -- here and not only in the edge function, because this is the last point
  -- before money is recorded as having left.
  if v_account.status <> 'active' then
    raise exception 'PAYOUT_ACCOUNT_NOT_ACTIVE: payout account is %, not active', v_account.status;
  end if;

  -- FR-28: the authoritative re-derivation, same expression the coach's own
  -- Earnings screen uses, evaluated inside the lock.
  v_balance := public.get_payout_account_balance(p_payout_account_id);

  if v_amount > v_balance then
    raise exception 'INSUFFICIENT_BALANCE: requested % exceeds available balance %',
      v_amount, v_balance;
  end if;

  v_ledger_account := case v_account.owner_type
    when 'coach' then 'coach'::public.ledger_account_type
    else 'court_partner'::public.ledger_account_type
  end;

  insert into public.transfers (
    payout_account_id, amount, razorpay_transfer_id, status, ledger_entry_group_id
  )
  values (
    p_payout_account_id, v_amount, p_razorpay_transfer_id, 'processing', v_group_id
  )
  returning * into v_transfer;

  -- One statement, one balanced group. `payment_intent_id` is deliberately
  -- null: a payout draws down many charges at once and belongs to none.
  insert into public.ledger_entries (
    entry_group_id, payment_intent_id, account_type, account_ref,
    direction, amount, domain, entity_id, description
  )
  values
    (
      v_group_id, null, v_ledger_account, v_account.owner_id,
      'debit', v_amount, 'payout', v_transfer.id,
      format('Payout to %s, transfer %s', v_account.owner_type, v_transfer.id)
    ),
    (
      v_group_id, null, 'platform', null,
      'credit', v_amount, 'payout', v_transfer.id,
      format('Payout obligation discharged, transfer %s', v_transfer.id)
    );

  return v_transfer;
end;
$$;

revoke all on function public.record_transfer(uuid, numeric, text) from public;
revoke execute on function public.record_transfer(uuid, numeric, text) from anon, authenticated;
grant execute on function public.record_transfer(uuid, numeric, text) to service_role;

-- ============================================================================
-- 4. settle_transfer(transfer_id, razorpay_transfer_id)
-- ============================================================================
--
-- `transfer.processed`. The money reached the linked account's settlement.
-- No ledger movement: the debit group was already written by
-- `record_transfer` when the money left, and Razorpay confirming settlement
-- does not move it a second time. This only advances the status.
--
-- Idempotent on the row lock, exactly like `settle_refund`: an already-`paid`
-- row returns unchanged, so a duplicate webhook delivery is a no-op even if
-- the `webhook_events` dedupe gate were somehow bypassed.

create or replace function public.settle_transfer(
  p_transfer_id uuid,
  p_razorpay_transfer_id text default null
)
returns public.transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.transfers;
begin
  select * into v_transfer from public.transfers where id = p_transfer_id for update;

  if v_transfer.id is null then
    raise exception 'NOT_FOUND: transfer % does not exist', p_transfer_id;
  end if;

  if v_transfer.status = 'paid' then
    return v_transfer;
  end if;

  update public.transfers
  set status = 'paid',
      razorpay_transfer_id = coalesce(p_razorpay_transfer_id, razorpay_transfer_id),
      failure_reason = null
  where id = p_transfer_id
  returning * into v_transfer;

  return v_transfer;
end;
$$;

revoke all on function public.settle_transfer(uuid, text) from public;
revoke execute on function public.settle_transfer(uuid, text) from anon, authenticated;
grant execute on function public.settle_transfer(uuid, text) to service_role;

-- ============================================================================
-- 5. fail_transfer(transfer_id, razorpay_transfer_id, reason)
-- ============================================================================
--
-- `transfer.failed`. This is the asymmetric one, and the asymmetry is the
-- point (PAYMENTS.md's Route section states it explicitly): a SYNCHRONOUS
-- rejection writes nothing at all, because nothing was written yet; an
-- ASYNCHRONOUS failure arrives after `record_transfer` already debited the
-- coach, so the money has to be given back, and `ledger_entries` being
-- insert-only means "given back" is a new reversing group, never a delete.
--
-- The reversal mirrors the original: credit the owner, debit `platform`.
-- Net effect across both groups is zero, which is exactly right, because
-- across both events no money actually left the platform.
--
-- Idempotent on the row lock plus the `reversal_ledger_entry_group_id` null
-- check, so a duplicate `transfer.failed` cannot credit the coach twice.

create or replace function public.fail_transfer(
  p_transfer_id uuid,
  p_razorpay_transfer_id text default null,
  p_reason text default null
)
returns public.transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.transfers;
  v_account public.payout_accounts;
  v_ledger_account public.ledger_account_type;
  v_group_id uuid := gen_random_uuid();
begin
  select * into v_transfer from public.transfers where id = p_transfer_id for update;

  if v_transfer.id is null then
    raise exception 'NOT_FOUND: transfer % does not exist', p_transfer_id;
  end if;

  -- Already reversed. Return unchanged rather than writing a second credit.
  if v_transfer.status = 'failed' and v_transfer.reversal_ledger_entry_group_id is not null then
    return v_transfer;
  end if;

  -- A transfer that already settled cannot then fail. Refuse loudly rather
  -- than crediting a coach for money that genuinely reached them.
  if v_transfer.status = 'paid' then
    raise exception 'INVALID_TRANSITION: transfer % already settled as paid', p_transfer_id;
  end if;

  select * into v_account
  from public.payout_accounts
  where id = v_transfer.payout_account_id;

  if v_account.id is null then
    raise exception 'NOT_FOUND: payout account % does not exist', v_transfer.payout_account_id;
  end if;

  v_ledger_account := case v_account.owner_type
    when 'coach' then 'coach'::public.ledger_account_type
    else 'court_partner'::public.ledger_account_type
  end;

  insert into public.ledger_entries (
    entry_group_id, payment_intent_id, account_type, account_ref,
    direction, amount, domain, entity_id, description
  )
  values
    (
      v_group_id, null, v_ledger_account, v_account.owner_id,
      'credit', v_transfer.amount, 'payout', v_transfer.id,
      format('Reversing: payout transfer %s failed at the provider', v_transfer.id)
    ),
    (
      v_group_id, null, 'platform', null,
      'debit', v_transfer.amount, 'payout', v_transfer.id,
      format('Reversing: payout obligation restored, transfer %s', v_transfer.id)
    );

  update public.transfers
  set status = 'failed',
      razorpay_transfer_id = coalesce(p_razorpay_transfer_id, razorpay_transfer_id),
      failure_reason = coalesce(p_reason, 'Transfer failed at the provider.'),
      reversal_ledger_entry_group_id = v_group_id
  where id = p_transfer_id
  returning * into v_transfer;

  return v_transfer;
end;
$$;

revoke all on function public.fail_transfer(uuid, text, text) from public;
revoke execute on function public.fail_transfer(uuid, text, text) from anon, authenticated;
grant execute on function public.fail_transfer(uuid, text, text) to service_role;
