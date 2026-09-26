-- ATLITOS v2 — 0130_payout_methods_manual_payouts.sql
--
-- Manual payouts to coaches and venues, and the bank details they need.
-- docs/PLAN-PAYOUTS-CLICKS-SEARCH.md Track 1.
--
-- WHY THIS EXISTS. Razorpay Route is closed to ELSHEPH until it shows about
-- Rs 40L of taxable turnover on GST-3B returns (RBI rule, September 2025;
-- Razorpay ticket #21108352). Route was the only path from a coach's ledger
-- balance to their bank, so without it nobody can be paid. The ledger is
-- unaffected and still correct: it knows what everyone is owed. What is
-- missing is (a) where to send it and (b) a way to record that a human sent
-- it. This migration adds both and changes nothing about how money is
-- EARNED.
--
-- THE THREE RULES THIS FILE ENFORCES
--
-- 1. Bank details are treated harder than money rows. Whoever controls a
--    payout method controls where money goes, so `payout_methods` has RLS on,
--    ZERO policies, and no grant to anon or authenticated. Every read and
--    write is a security definer function that re-derives ownership from
--    auth.uid(). An owner only ever sees the last four digits. An admin sees
--    the full number only through `admin_reveal_payout_method`, and every
--    reveal writes an audit_log row. Full account numbers are NEVER written
--    to audit_log.
--
-- 2. A changed payout method is an unverified payout method. Any change moves
--    the payout account back to `pending`, and `record_transfer` has always
--    refused anything that is not `active`. So an attacker who takes over a
--    coach's account and swaps the bank number cannot be paid until an admin
--    verifies the new one. The existing gate gains a second meaning (Route KYC
--    done OR bank details verified), it does not gain a sibling.
--
-- 3. One implementation of "money left". `record_transfer` (Route) and
--    `admin_record_manual_payout` share `_record_payout_core`: the same row
--    lock on the payout account, the same balance re-derivation inside that
--    lock, the same balanced ledger group. A second copy of that logic is how
--    the two paths would drift, and a drift here is a double payment.
--
-- THE HOLD. Manual payouts may only draw on the ELIGIBLE balance, which holds
-- back recent credits so a complaint can land before the money has gone:
--   - sessions, memberships and everything else: credited >= 24 hours ago;
--   - courts: the booked slot ENDED >= 24 hours ago (IST). Venues are credited
--     at booking time, not after play, so without this a venue could be paid
--     for a slot that is later cancelled.
-- Debits always count immediately. Route's `record_transfer` keeps its
-- original behaviour (full balance, no hold) so this migration cannot change
-- what an existing caller is allowed to do.
--
-- MANUAL PAYOUT LIFECYCLE. NEFT can bounce after the sender has a reference
-- number, so a manual payout is recorded as `processing` and then settled or
-- failed, exactly like a Route transfer. Settling reuses `settle_transfer`,
-- failing reuses `fail_transfer` and its reversing ledger group.
--
-- NOT COLUMN-ENCRYPTED. Values rely on Supabase's encryption at rest plus the
-- access rules above. Column-level encryption is recorded in docs/DEBT.md.

-- --------------------------------------------------------------------------
-- transfers: how the money moved, and the human-entered reference
-- --------------------------------------------------------------------------

alter table public.transfers
  add column if not exists method text not null default 'route'
    check (method in ('route', 'razorpayx', 'manual')),
  -- UTR or bank reference for a manual payout. Unique per method, so the same
  -- NEFT can never be recorded as two payouts.
  add column if not exists external_reference text,
  add column if not exists created_by uuid references public.users (id) on delete set null;

create unique index if not exists transfers_method_external_reference_key
  on public.transfers (method, external_reference)
  where external_reference is not null;

-- --------------------------------------------------------------------------
-- payout_methods
-- --------------------------------------------------------------------------

create table public.payout_methods (
  id uuid primary key default gen_random_uuid(),
  payout_account_id uuid not null unique
    references public.payout_accounts (id) on delete cascade,
  method_type text not null check (method_type in ('bank_account', 'upi')),
  account_holder_name text not null
    check (char_length(btrim(account_holder_name)) between 2 and 100),
  account_number text,
  ifsc text,
  vpa text,
  -- Optional until the CA settles TDS (docs/DEBT.md). Shown to admin as
  -- present or absent before a payout is made.
  pan text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected')),
  verification_note text,
  verified_by uuid references public.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (method_type = 'bank_account' and account_number is not null and ifsc is not null and vpa is null)
    or
    (method_type = 'upi' and vpa is not null and account_number is null and ifsc is null)
  )
);

comment on table public.payout_methods is
  'Where a coach or venue is paid. RLS on with ZERO policies and no client grant: only the security definer functions in 0130 touch it. Owners see last four digits; admin reveals are audited.';

create trigger payout_methods_set_updated_at
  before update on public.payout_methods
  for each row execute function public.set_updated_at();

alter table public.payout_methods enable row level security;
revoke all on table public.payout_methods from public, anon, authenticated;
grant select, insert, update, delete on table public.payout_methods to service_role;

-- --------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------

create or replace function public._mask_tail(p_value text, p_keep int default 4)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_value is null then null
    when char_length(p_value) <= p_keep then repeat('*', char_length(p_value))
    else repeat('*', char_length(p_value) - p_keep) || right(p_value, p_keep)
  end;
$$;

-- Masked, JSON-shaped view of one payout method. Never includes the full
-- account number or PAN.
create or replace function public._payout_method_masked(p_method public.payout_methods)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case when p_method.id is null then null else jsonb_build_object(
    'method_type', p_method.method_type,
    'account_holder_name', p_method.account_holder_name,
    'account_number_last4', right(p_method.account_number, 4),
    'ifsc', p_method.ifsc,
    'vpa', p_method.vpa,
    'pan_last4', right(p_method.pan, 4),
    'has_pan', p_method.pan is not null,
    'verification_status', p_method.verification_status,
    'verification_note', p_method.verification_note,
    'verified_at', p_method.verified_at,
    'updated_at', p_method.updated_at
  ) end;
$$;

-- Balance that may be paid out now, for one ledger account. See THE HOLD.
create or replace function public._ledger_eligible_balance(
  p_account_type public.ledger_account_type,
  p_account_ref uuid,
  p_hold interval default interval '24 hours'
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with credits as (
    select coalesce(sum(le.amount), 0) as amt
    from public.ledger_entries le
    left join public.court_bookings b
      on le.domain = 'court' and b.id = le.entity_id
    where le.account_type = p_account_type
      and le.account_ref = p_account_ref
      and le.direction = 'credit'
      and case
        when le.domain = 'court' then
          b.id is not null
          and ((b.date + b.slot_end) at time zone 'Asia/Kolkata') <= now() - p_hold
        else le.created_at <= now() - p_hold
      end
  ),
  debits as (
    select coalesce(sum(le.amount), 0) as amt
    from public.ledger_entries le
    where le.account_type = p_account_type
      and le.account_ref = p_account_ref
      and le.direction = 'debit'
  )
  select greatest(0, credits.amt - debits.amt)::numeric(12, 2)
  from credits, debits;
$$;

create or replace function public.get_payout_eligible_balance(
  p_payout_account_id uuid,
  p_hold interval default interval '24 hours'
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account public.payout_accounts;
begin
  select * into v_account from public.payout_accounts where id = p_payout_account_id;
  if v_account.id is null then
    raise exception 'NOT_FOUND: payout account % does not exist', p_payout_account_id;
  end if;
  return public._ledger_eligible_balance(
    v_account.owner_type::public.ledger_account_type, v_account.owner_id, p_hold
  );
end;
$$;

-- Resolve (owner_type, venue) for the CALLER to a payout owner id, or raise.
-- A coach owns their own user id; a court partner owns a venue id, and only a
-- venue whose partner_user_id is the caller. Staff are refused, as in
-- razorpay-route-onboard: this binds where platform money is sent.
create or replace function public._resolve_my_payout_owner(p_owner_type text, p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in required';
  end if;

  if p_owner_type = 'coach' then
    if not exists (select 1 from public.coach_profiles where user_id = v_uid) then
      raise exception 'FORBIDDEN: a coach profile is required';
    end if;
    return v_uid;
  elsif p_owner_type = 'court_partner' then
    if p_venue_id is null then
      raise exception 'VALIDATION: venue_id is required for a court partner';
    end if;
    if not exists (
      select 1 from public.venues where id = p_venue_id and partner_user_id = v_uid
    ) then
      raise exception 'FORBIDDEN: you are not the partner on this venue';
    end if;
    return p_venue_id;
  end if;

  raise exception 'VALIDATION: owner_type must be coach or court_partner';
end;
$$;

-- --------------------------------------------------------------------------
-- The one implementation of "money left"
-- --------------------------------------------------------------------------

create or replace function public._record_payout_core(
  p_payout_account_id uuid,
  p_amount numeric,
  p_method text,
  p_razorpay_transfer_id text,
  p_external_reference text,
  p_enforce_hold boolean,
  p_actor uuid
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
  -- Idempotency, per method. Route dedupes on Razorpay's own id (unchanged
  -- from 0028). Manual dedupes on the bank reference, and a reused reference
  -- for a DIFFERENT payout is refused rather than silently returned, because
  -- that is a data-entry error that would otherwise hide a missing payment.
  if p_razorpay_transfer_id is not null then
    select * into v_transfer from public.transfers
    where razorpay_transfer_id = p_razorpay_transfer_id;
    if v_transfer.id is not null then
      return v_transfer;
    end if;
  end if;

  if p_external_reference is not null then
    select * into v_transfer from public.transfers
    where method = p_method and external_reference = p_external_reference;
    if v_transfer.id is not null then
      if v_transfer.payout_account_id = p_payout_account_id and v_transfer.amount = v_amount then
        return v_transfer;
      end if;
      raise exception 'DUPLICATE_REFERENCE: reference % is already recorded against another payout',
        p_external_reference;
    end if;
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'VALIDATION: transfer amount must be greater than zero';
  end if;

  -- Serializes every concurrent payout AND every concurrent payout-method
  -- change against this account (upsert_my_payout_method takes the same lock).
  select * into v_account from public.payout_accounts
  where id = p_payout_account_id
  for update;

  if v_account.id is null then
    raise exception 'NOT_FOUND: payout account % does not exist', p_payout_account_id;
  end if;

  if v_account.status <> 'active' then
    raise exception 'PAYOUT_ACCOUNT_NOT_ACTIVE: payout account is %, not active', v_account.status;
  end if;

  if p_method = 'manual' and not exists (
    select 1 from public.payout_methods
    where payout_account_id = p_payout_account_id and verification_status = 'verified'
  ) then
    raise exception 'PAYOUT_METHOD_NOT_VERIFIED: no verified payout method on this account';
  end if;

  v_balance := case when p_enforce_hold
    then public.get_payout_eligible_balance(p_payout_account_id)
    else public.get_payout_account_balance(p_payout_account_id)
  end;

  if v_amount > v_balance then
    raise exception 'INSUFFICIENT_BALANCE: requested % exceeds available balance %',
      v_amount, v_balance;
  end if;

  v_ledger_account := case v_account.owner_type
    when 'coach' then 'coach'::public.ledger_account_type
    else 'court_partner'::public.ledger_account_type
  end;

  insert into public.transfers (
    payout_account_id, amount, razorpay_transfer_id, status, ledger_entry_group_id,
    method, external_reference, created_by
  )
  values (
    p_payout_account_id, v_amount, p_razorpay_transfer_id, 'processing', v_group_id,
    p_method, p_external_reference, p_actor
  )
  returning * into v_transfer;

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

-- Route path, same signature and same behaviour as 0028 (full balance, no
-- hold, dedupe on Razorpay's transfer id), now delegating to the core.
create or replace function public.record_transfer(
  p_payout_account_id uuid,
  p_amount numeric,
  p_razorpay_transfer_id text
)
returns public.transfers
language sql
security definer
set search_path = public
as $$
  select public._record_payout_core(
    p_payout_account_id, p_amount, 'route', p_razorpay_transfer_id, null, false, null
  );
$$;

-- --------------------------------------------------------------------------
-- Owner functions
-- --------------------------------------------------------------------------

-- Optional parameters carry real defaults so callers omit them rather than
-- pass null, which is also how the generated TypeScript types learn they
-- are optional. Every caller uses named arguments.
create or replace function public.upsert_my_payout_method(
  p_owner_type text,
  p_method_type text,
  p_account_holder_name text,
  p_venue_id uuid default null,
  p_account_number text default null,
  p_ifsc text default null,
  p_vpa text default null,
  p_pan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public._resolve_my_payout_owner(p_owner_type, p_venue_id);
  v_account public.payout_accounts;
  v_before public.payout_methods;
  v_after public.payout_methods;
  v_holder text := btrim(coalesce(p_account_holder_name, ''));
  v_number text := nullif(regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g'), '');
  v_ifsc text := nullif(upper(btrim(coalesce(p_ifsc, ''))), '');
  v_vpa text := nullif(lower(btrim(coalesce(p_vpa, ''))), '');
  v_pan text := nullif(upper(btrim(coalesce(p_pan, ''))), '');
begin
  if p_method_type not in ('bank_account', 'upi') then
    raise exception 'VALIDATION: method_type must be bank_account or upi';
  end if;
  if char_length(v_holder) < 2 or char_length(v_holder) > 100 then
    raise exception 'VALIDATION: account holder name must be 2 to 100 characters';
  end if;
  if p_method_type = 'bank_account' then
    v_vpa := null;
    if v_number is null or v_number !~ '^[0-9]{9,18}$' then
      raise exception 'VALIDATION: account number must be 9 to 18 digits';
    end if;
    if v_ifsc is null or v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'VALIDATION: IFSC must look like HDFC0001234';
    end if;
  else
    v_number := null;
    v_ifsc := null;
    if v_vpa is null or v_vpa !~ '^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$' then
      raise exception 'VALIDATION: UPI ID must look like name@bank';
    end if;
  end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'VALIDATION: PAN must look like ABCDE1234F';
  end if;

  insert into public.payout_accounts (owner_type, owner_id, status)
  values (p_owner_type, v_owner_id, 'pending')
  on conflict (owner_type, owner_id) do nothing;

  select * into v_account from public.payout_accounts
  where owner_type = p_owner_type and owner_id = v_owner_id
  for update;

  select * into v_before from public.payout_methods where payout_account_id = v_account.id;

  -- A resubmission of identical details is not a change, and must not throw
  -- away a verification the admin already did.
  if v_before.id is not null
     and v_before.method_type = p_method_type
     and v_before.account_holder_name = v_holder
     and v_before.account_number is not distinct from v_number
     and v_before.ifsc is not distinct from v_ifsc
     and v_before.vpa is not distinct from v_vpa
     and v_before.pan is not distinct from v_pan then
    return jsonb_build_object(
      'payout_account_id', v_account.id,
      'payout_status', v_account.status,
      'method', public._payout_method_masked(v_before),
      'changed', false
    );
  end if;

  insert into public.payout_methods (
    payout_account_id, method_type, account_holder_name, account_number, ifsc, vpa, pan,
    verification_status, verification_note, verified_by, verified_at
  )
  values (
    v_account.id, p_method_type, v_holder, v_number, v_ifsc, v_vpa, v_pan,
    'unverified', null, null, null
  )
  on conflict (payout_account_id) do update set
    method_type = excluded.method_type,
    account_holder_name = excluded.account_holder_name,
    account_number = excluded.account_number,
    ifsc = excluded.ifsc,
    vpa = excluded.vpa,
    pan = excluded.pan,
    verification_status = 'unverified',
    verification_note = null,
    verified_by = null,
    verified_at = null
  returning * into v_after;

  -- Rule 2: changed details are unverified details.
  update public.payout_accounts set status = 'pending' where id = v_account.id
  returning * into v_account;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(), 'payout_method.update', 'payout_method', v_after.id,
    public._payout_method_masked(v_before), public._payout_method_masked(v_after),
    'Owner changed payout details; account returned to pending until an admin verifies'
  );

  return jsonb_build_object(
    'payout_account_id', v_account.id,
    'payout_status', v_account.status,
    'method', public._payout_method_masked(v_after),
    'changed', true
  );
end;
$$;

create or replace function public.get_my_payout_method(p_owner_type text, p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public._resolve_my_payout_owner(p_owner_type, p_venue_id);
  v_account public.payout_accounts;
  v_method public.payout_methods;
  v_ledger public.ledger_account_type := p_owner_type::public.ledger_account_type;
begin
  select * into v_account from public.payout_accounts
  where owner_type = p_owner_type and owner_id = v_owner_id;

  if v_account.id is not null then
    select * into v_method from public.payout_methods where payout_account_id = v_account.id;
  end if;

  return jsonb_build_object(
    'payout_account_id', v_account.id,
    'payout_status', coalesce(v_account.status::text, 'not_started'),
    'method', public._payout_method_masked(v_method),
    'balance', coalesce((
      select sum(case when direction = 'credit' then amount else -amount end)
      from public.ledger_entries where account_type = v_ledger and account_ref = v_owner_id
    ), 0)::numeric(12, 2),
    'eligible_balance', public._ledger_eligible_balance(v_ledger, v_owner_id)
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Admin functions (has_role('admin'), audited)
-- --------------------------------------------------------------------------

-- Everyone the ledger says is owed, including people who have never entered
-- bank details, so admin can chase them rather than never seeing them.
create or replace function public.admin_payouts_due(p_min_amount numeric default 1)
returns table (
  payout_account_id uuid,
  owner_type text,
  owner_id uuid,
  owner_name text,
  owner_phone text,
  payout_status text,
  method_type text,
  verification_status text,
  account_number_last4 text,
  ifsc text,
  vpa text,
  has_pan boolean,
  balance numeric,
  eligible_balance numeric,
  in_flight numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  return query
  with owed as (
    select le.account_type, le.account_ref,
           sum(case when le.direction = 'credit' then le.amount else -le.amount end) as bal
    from public.ledger_entries le
    where le.account_type in ('coach', 'court_partner') and le.account_ref is not null
    group by le.account_type, le.account_ref
  )
  select
    pa.id,
    o.account_type::text,
    o.account_ref,
    case when o.account_type = 'coach' then u.name else v.name end,
    case when o.account_type = 'coach' then u.phone else pu.phone end,
    coalesce(pa.status::text, 'not_started'),
    pm.method_type,
    coalesce(pm.verification_status, 'missing'),
    right(pm.account_number, 4),
    pm.ifsc,
    pm.vpa,
    pm.pan is not null,
    o.bal::numeric(12, 2),
    public._ledger_eligible_balance(o.account_type, o.account_ref),
    coalesce((
      select sum(t.amount) from public.transfers t
      where t.payout_account_id = pa.id and t.status = 'processing'
    ), 0)::numeric(12, 2)
  from owed o
  left join public.payout_accounts pa
    on pa.owner_type = o.account_type::text and pa.owner_id = o.account_ref
  left join public.payout_methods pm on pm.payout_account_id = pa.id
  left join public.users u on o.account_type = 'coach' and u.id = o.account_ref
  left join public.venues v on o.account_type = 'court_partner' and v.id = o.account_ref
  left join public.users pu on pu.id = v.partner_user_id
  where o.bal >= p_min_amount
  order by public._ledger_eligible_balance(o.account_type, o.account_ref) desc, o.bal desc;
end;
$$;

create or replace function public.admin_reveal_payout_method(p_payout_account_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method public.payout_methods;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'NOTE_REQUIRED: say why you are revealing these details';
  end if;

  select * into v_method from public.payout_methods where payout_account_id = p_payout_account_id;
  if v_method.id is null then
    raise exception 'NOT_FOUND: no payout method on this account';
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (auth.uid(), 'payout_method.reveal', 'payout_method', v_method.id, null, null, btrim(p_reason));

  return jsonb_build_object(
    'method_type', v_method.method_type,
    'account_holder_name', v_method.account_holder_name,
    'account_number', v_method.account_number,
    'ifsc', v_method.ifsc,
    'vpa', v_method.vpa,
    'pan', v_method.pan,
    'verification_status', v_method.verification_status
  );
end;
$$;

create or replace function public.admin_verify_payout_method(
  p_payout_account_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.payout_accounts;
  v_before public.payout_methods;
  v_after public.payout_methods;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_decision not in ('verify', 'reject') then
    raise exception 'VALIDATION: decision must be verify or reject';
  end if;
  if p_decision = 'reject' and (p_note is null or char_length(btrim(p_note)) < 3) then
    raise exception 'NOTE_REQUIRED: tell the owner what to fix';
  end if;

  select * into v_account from public.payout_accounts where id = p_payout_account_id for update;
  if v_account.id is null then
    raise exception 'NOT_FOUND: payout account % does not exist', p_payout_account_id;
  end if;

  select * into v_before from public.payout_methods where payout_account_id = v_account.id;
  if v_before.id is null then
    raise exception 'NOT_FOUND: no payout method on this account';
  end if;

  update public.payout_methods set
    verification_status = case when p_decision = 'verify' then 'verified' else 'rejected' end,
    verification_note = nullif(btrim(coalesce(p_note, '')), ''),
    verified_by = auth.uid(),
    verified_at = now()
  where id = v_before.id
  returning * into v_after;

  update public.payout_accounts
  set status = case when p_decision = 'verify' then 'active'::public.payout_account_status
                    else 'needs_attention'::public.payout_account_status end
  where id = v_account.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(), 'payout_method.' || p_decision, 'payout_method', v_after.id,
    public._payout_method_masked(v_before), public._payout_method_masked(v_after),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return public._payout_method_masked(v_after);
end;
$$;

create or replace function public.admin_record_manual_payout(
  p_payout_account_id uuid,
  p_amount numeric,
  p_reference text,
  p_note text default null
)
returns public.transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'));
  v_transfer public.transfers;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if v_ref !~ '^[A-Z0-9]{6,40}$' then
    raise exception 'VALIDATION: enter the bank reference (UTR), 6 to 40 letters or digits';
  end if;

  v_transfer := public._record_payout_core(
    p_payout_account_id, p_amount, 'manual', null, v_ref, true, auth.uid()
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(), 'payout.manual_record', 'transfer', v_transfer.id, null,
    jsonb_build_object('amount', v_transfer.amount, 'reference', v_ref, 'status', v_transfer.status),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return v_transfer;
end;
$$;

-- Settle (money arrived) or fail (bounced) a MANUAL payout. Delegates to the
-- 0028 functions so a bounce writes the same reversing group a failed Route
-- transfer writes.
create or replace function public.admin_resolve_manual_payout(
  p_transfer_id uuid,
  p_outcome text,
  p_note text default null
)
returns public.transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.transfers;
  v_after public.transfers;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_outcome not in ('paid', 'failed') then
    raise exception 'VALIDATION: outcome must be paid or failed';
  end if;

  select * into v_before from public.transfers where id = p_transfer_id;
  if v_before.id is null then
    raise exception 'NOT_FOUND: transfer % does not exist', p_transfer_id;
  end if;
  if v_before.method <> 'manual' then
    raise exception 'FORBIDDEN: only manual payouts are resolved by hand';
  end if;
  if p_outcome = 'failed' and (p_note is null or char_length(btrim(p_note)) < 3) then
    raise exception 'NOTE_REQUIRED: say why the payout bounced';
  end if;

  if p_outcome = 'paid' then
    v_after := public.settle_transfer(p_transfer_id, null);
  else
    v_after := public.fail_transfer(p_transfer_id, null, btrim(p_note));
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(), 'payout.manual_' || p_outcome, 'transfer', p_transfer_id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return v_after;
end;
$$;

-- --------------------------------------------------------------------------
-- Grants. Internal helpers are service_role only; owner and admin entry
-- points are granted to authenticated and authorise themselves.
-- --------------------------------------------------------------------------

revoke all on function public._mask_tail(text, int) from public, anon, authenticated;
revoke all on function public._payout_method_masked(public.payout_methods) from public, anon, authenticated;
revoke all on function public._ledger_eligible_balance(public.ledger_account_type, uuid, interval) from public, anon, authenticated;
revoke all on function public.get_payout_eligible_balance(uuid, interval) from public, anon, authenticated;
revoke all on function public._resolve_my_payout_owner(text, uuid) from public, anon, authenticated;
revoke all on function public._record_payout_core(uuid, numeric, text, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public._mask_tail(text, int) to service_role;
grant execute on function public._payout_method_masked(public.payout_methods) to service_role;
grant execute on function public._ledger_eligible_balance(public.ledger_account_type, uuid, interval) to service_role;
grant execute on function public.get_payout_eligible_balance(uuid, interval) to service_role;
grant execute on function public._resolve_my_payout_owner(text, uuid) to service_role;
grant execute on function public._record_payout_core(uuid, numeric, text, text, text, boolean, uuid) to service_role;

-- record_transfer keeps 0028's grants exactly.
revoke all on function public.record_transfer(uuid, numeric, text) from public;
revoke execute on function public.record_transfer(uuid, numeric, text) from anon, authenticated;
grant execute on function public.record_transfer(uuid, numeric, text) to service_role;

revoke all on function public.upsert_my_payout_method(text, text, text, uuid, text, text, text, text) from public, anon;
revoke all on function public.get_my_payout_method(text, uuid) from public, anon;
revoke all on function public.admin_payouts_due(numeric) from public, anon;
revoke all on function public.admin_reveal_payout_method(uuid, text) from public, anon;
revoke all on function public.admin_verify_payout_method(uuid, text, text) from public, anon;
revoke all on function public.admin_record_manual_payout(uuid, numeric, text, text) from public, anon;
revoke all on function public.admin_resolve_manual_payout(uuid, text, text) from public, anon;
grant execute on function public.upsert_my_payout_method(text, text, text, uuid, text, text, text, text) to authenticated;
grant execute on function public.get_my_payout_method(text, uuid) to authenticated;
grant execute on function public.admin_payouts_due(numeric) to authenticated;
grant execute on function public.admin_reveal_payout_method(uuid, text) to authenticated;
grant execute on function public.admin_verify_payout_method(uuid, text, text) to authenticated;
grant execute on function public.admin_record_manual_payout(uuid, numeric, text, text) to authenticated;
grant execute on function public.admin_resolve_manual_payout(uuid, text, text) to authenticated;
