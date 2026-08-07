-- ATLITOS v2 — 0095_admin_order_refund.sql
-- Domain: commerce + payments. Phase 4 (LAUNCH), Track A.
-- Requirements: PRD-04 FR-24, FR-25, FR-53; PAYMENTS.md `admin-order-refund`
--               design (Refunds section); CLAUDE.md financial invariant.
--
-- This migration is the money half of admin order refunds. It does three
-- things, and every one of them is written to PRESERVE the session-refund
-- machinery (AT-60 cancel-session-refund, CO-04 decline-session-refund) exactly
-- while ADDING the partial, accumulating semantics an order refund needs:
--
--   1. Rework the `refunds` idempotency indexes so a commerce order can carry
--      several settled partial refunds plus one in-flight pending refund, while
--      every OTHER domain (session, court, donation, membership, payout) keeps
--      the old "one refund per entity, ever" guarantee bit-for-bit.
--   2. `claim_order_refund(p_order_id, p_amount)`: the service-role RPC that
--      enforces the state machine (`INVALID_TRANSITION` unless the charge is
--      `captured` or `partially_refunded`) and the remaining-refundable ceiling
--      (`AMOUNT_EXCEEDS_REFUNDABLE`) inside one atomic, intent-locked claim,
--      then inserts the pending `refunds` row. The edge function calls Razorpay
--      and settles through the existing `settle_refund` convergence point.
--   3. `settle_refund` gains a partial arm: after writing the reversing ledger
--      group it flips the charge to `refunded` when cumulative settled refunds
--      reach the captured amount, else `partially_refunded`. A FULL refund still
--      lands on `refunded`, so session and AT-73 behavior is unchanged.
--
-- ============================================================================
-- CRITICAL NAMING CORRECTION vs the plan (PHASE-4-STATUS.md decision 1)
-- ============================================================================
--
-- The plan text says the order-refund index predicate is `domain = 'order'`.
-- There is NO `'order'` value in `public.payment_domain`; the enum is
-- (session, court, commerce, donation, payout, membership) (0010, 0028, 0076).
-- The money system's name for the orders domain is `'commerce'`: the order
-- capture group is written with `domain = 'commerce', entity_id = orders.id`
-- (finalize-order-payment.ts), and payment_intents for an order carry
-- `domain = 'commerce'`. So every refund row, index predicate, and ledger check
-- in this file uses `'commerce'`, not `'order'`. Using `'order'` would have
-- failed the enum check on the very first insert. Flagged loudly for the
-- integrator folding SCHEMA.md / PAYMENTS.md.
--
-- ============================================================================
-- WHY FOUR COMMERCE-AWARE PREDICATES, NOT THE PLAN'S TWO
-- ============================================================================
--
-- The old single index was:
--     create unique index refunds_one_per_entity on refunds (domain, entity_id);
-- which covered EVERY domain, including the AT-73 unfulfillable-capture refund
-- (finalize-order-payment.ts), whose row is `domain='commerce'` with
-- `entity_id = payment_intent_id` because no order row exists for that case.
--
-- The plan's two predicates (session one-per-entity + commerce-pending) would
-- have folded AT-73's rows into the commerce-pending index, relaxing AT-73 from
-- "one refund ever" to "one pending at a time". That is a silent weakening of a
-- money path this track was told not to touch. So this migration keeps AT-73
-- bit-for-bit by partitioning the commerce rows on the one fact that separates
-- them: an AT-73 refund has `entity_id = payment_intent_id`, an admin order
-- refund has `entity_id = orders.id <> payment_intent_id` (an order id and an
-- intent id are distinct gen_random_uuid values and never collide). Both are
-- immutable per-row column comparisons, which Postgres allows in a partial
-- index WHERE clause.

-- ============================================================================
-- 1. Refunds idempotency indexes
-- ============================================================================

drop index if exists public.refunds_one_per_entity;

-- (1a) Every NON-commerce domain: exactly one refund per entity, ever. This is
-- refunds_one_per_entity's original guarantee, unchanged, for session (AT-60,
-- CO-04), court, donation, membership, payout. None of them issues a partial
-- refund, so one row per (domain, entity_id) remains the whole idempotency
-- story and session-refund behavior is preserved bit-for-bit.
create unique index refunds_one_per_entity_non_commerce
  on public.refunds (domain, entity_id)
  where domain <> 'commerce';

-- (1b) Commerce, unfulfillable-capture refunds (AT-73): entity_id IS the
-- payment_intent, because no order row exists. One per intent, ever, exactly
-- what the old index gave this shape.
create unique index refunds_one_per_unfulfilled_capture
  on public.refunds (payment_intent_id)
  where domain = 'commerce' and entity_id = payment_intent_id;

-- (1c) Commerce, admin order refunds: entity_id is the ORDER (distinct from the
-- intent). Settled partials accumulate; only ONE pending (in-flight) refund per
-- order is allowed at a time. Two concurrent admin claims therefore converge on
-- a single pending row (the loser gets 23505), while a 100 + 150 sequence of
-- settled partials against a 250 order is permitted once each settles.
create unique index refunds_one_pending_per_order
  on public.refunds (domain, entity_id)
  where domain = 'commerce'
    and status = 'pending'
    and entity_id <> payment_intent_id;

-- ============================================================================
-- 2. claim_order_refund
--
-- The atomic claim. Enforces the state machine and the refundable ceiling
-- server side (never trusting the admin client's displayed number, PRD-04
-- FR-24) under a row lock on the payment intent, then inserts the pending
-- `refunds` row. Service role only: it is the first step of a money movement,
-- which no client may initiate directly (financial invariant).
--
-- Remaining refundable = orders.total - SUM(this order's refunds that are
-- pending or processed). Pending is included so an in-flight refund cannot be
-- double-counted by a second concurrent claim; the intent-row lock serializes
-- the read-compute-insert, and index (1c) is the hard backstop.
-- ============================================================================

create or replace function public.claim_order_refund(
  p_order_id uuid,
  p_amount numeric
)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_intent public.payment_intents;
  v_already numeric(12, 2);
  v_remaining numeric(12, 2);
  v_refund public.refunds;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'NOT_FOUND: order % does not exist', p_order_id;
  end if;

  if v_order.payment_intent_id is null then
    raise exception 'INVALID_TRANSITION: order % has no payment to refund', p_order_id;
  end if;

  -- Lock the charge. This serializes two concurrent claims for the same order:
  -- the second waits here until the first has inserted its pending row, so its
  -- remaining-refundable read already reflects the first claim.
  select * into v_intent
  from public.payment_intents
  where id = v_order.payment_intent_id
  for update;

  if v_intent.id is null then
    raise exception 'NOT_FOUND: payment for order % does not exist', p_order_id;
  end if;

  -- The state machine. Only a captured charge (or one already partially
  -- refunded) can be refunded; anything else (created, authorized, failed,
  -- already fully refunded) is refused with the same code the client-facing
  -- machines raise, so the edge function relays one vocabulary.
  if v_intent.status not in ('captured', 'partially_refunded') then
    raise exception
      'INVALID_TRANSITION: payment for order % is % and cannot be refunded',
      p_order_id, v_intent.status;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION: refund amount must be greater than zero';
  end if;

  select coalesce(sum(amount), 0) into v_already
  from public.refunds
  where domain = 'commerce'
    and entity_id = p_order_id
    and status in ('pending', 'processed');

  v_remaining := v_order.total - v_already;

  if p_amount > v_remaining then
    raise exception
      'AMOUNT_EXCEEDS_REFUNDABLE: requested % exceeds remaining refundable % on order %',
      p_amount, v_remaining, p_order_id;
  end if;

  begin
    insert into public.refunds (payment_intent_id, domain, entity_id, amount)
    values (v_intent.id, 'commerce', p_order_id, p_amount)
    returning * into v_refund;
  exception
    when unique_violation then
      -- Index (1c): a pending refund already exists for this order. The
      -- webhook (refund.processed) is the settle convergence path for it; the
      -- admin retries after it clears, or finds it in the refunds queue.
      raise exception
        'REFUND_IN_PROGRESS: a refund for order % is already in progress',
        p_order_id;
  end;

  return v_refund;
end;
$$;

revoke all on function public.claim_order_refund(uuid, numeric) from public;
revoke execute on function public.claim_order_refund(uuid, numeric) from anon, authenticated;
grant execute on function public.claim_order_refund(uuid, numeric) to service_role;

-- ============================================================================
-- 3. settle_refund, with the partial arm
--
-- Recreated from 0026 with TWO differences and NOTHING else:
--
--   * The final payment_intents.status is computed from cumulative settled
--     refunds instead of hard-coded to `refunded`. A full refund (cumulative
--     settled >= captured amount) still lands on `refunded`, so a session
--     refund (single full refund) and an AT-73 full refund are byte-identical
--     in outcome to before. Only a genuine partial lands on
--     `partially_refunded` (an enum value that has existed since 0010).
--   * The debit leg's description is order-accurate for `domain='commerce'`.
--     The non-commerce description string is preserved CHARACTER FOR CHARACTER,
--     so nothing about a session refund's ledger rows changes.
--
-- The reversing group itself is UNCHANGED: two legs, debit platform / credit
-- the payer, balanced, so assert_ledger_group_balanced passes and the entity
-- nets to zero. See the 0026 header for why this is the correct reversal.
--
-- MODELING NOTE, flagged for the approver (checkout roundup, D1). An order that
-- carried a checkout roundup credited that roundup to the General Fund upa_fund
-- account at capture (finalize-order-payment.ts, AT-113). A refund returns
-- money to the buyer from the platform clearing account and does NOT claw the
-- General Fund donation back. Every group still balances and the order still
-- nets to zero; the platform absorbs the refunded portion of a donated roundup.
-- This matches the generic reversing-group convention every refund path uses.
-- Roundup clawback, if the founder wants it, is a follow-up, not a silent
-- proportional re-split invented here.
-- ============================================================================

create or replace function public.settle_refund(
  p_refund_id uuid,
  p_razorpay_refund_id text default null
)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refunds;
  v_intent public.payment_intents;
  v_group_id uuid := gen_random_uuid();
  v_settled numeric(12, 2);
  v_debit_description text;
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.id is null then
    raise exception 'NOT_FOUND: refund % does not exist', p_refund_id;
  end if;

  -- Already settled: return it untouched. This is the whole idempotency story
  -- for the duplicate-webhook case, and it is a single row lock rather than a
  -- check-then-act race.
  if v_refund.status = 'processed' then
    return v_refund;
  end if;

  select * into v_intent
  from public.payment_intents
  where id = v_refund.payment_intent_id;

  if v_intent.id is null then
    raise exception 'NOT_FOUND: payment_intent % does not exist', v_refund.payment_intent_id;
  end if;

  -- The debit leg's description. Non-commerce is preserved character-for-
  -- character from 0026 (session refunds unchanged); commerce is order-accurate
  -- and does not claim "full" or "no service rendered", which would be wrong on
  -- a partial return of a delivered order.
  if v_refund.domain = 'commerce' then
    v_debit_description := format(
      'Reversing: refund of %s on order %s', v_refund.amount, v_refund.entity_id
    );
  else
    v_debit_description := format(
      'Reversing: full refund of %s %s, no service rendered',
      v_refund.domain, v_refund.entity_id
    );
  end if;

  insert into public.ledger_entries (
    entry_group_id, payment_intent_id, account_type, account_ref,
    direction, amount, domain, entity_id, description
  )
  values
    (
      v_group_id, v_intent.id, 'platform', null,
      'debit', v_refund.amount, v_refund.domain, v_refund.entity_id,
      v_debit_description
    ),
    (
      v_group_id, v_intent.id, 'user', v_intent.user_id,
      'credit', v_refund.amount, v_refund.domain, v_refund.entity_id,
      format('Refund returned to payer, %s %s', v_refund.domain, v_refund.entity_id)
    );

  update public.refunds
  set status = 'processed',
      razorpay_refund_id = coalesce(p_razorpay_refund_id, razorpay_refund_id),
      ledger_entry_group_id = v_group_id,
      failure_reason = null
  where id = p_refund_id
  returning * into v_refund;

  -- The charge's own lifecycle. Cumulative settled refunds against this charge,
  -- INCLUDING the row just flipped to processed above. When they reach the
  -- captured amount the charge is fully `refunded`; short of it, it is
  -- `partially_refunded`. A single full refund (session, AT-73) reaches the
  -- captured amount in one step, so it still becomes `refunded`.
  select coalesce(sum(amount), 0) into v_settled
  from public.refunds
  where payment_intent_id = v_intent.id
    and status = 'processed';

  update public.payment_intents
  set status = (case
                 when v_settled >= v_intent.amount then 'refunded'
                 else 'partially_refunded'
               end)::public.payment_intent_status
  where id = v_intent.id;

  return v_refund;
end;
$$;

revoke all on function public.settle_refund(uuid, text) from public;
revoke execute on function public.settle_refund(uuid, text) from anon, authenticated;
grant execute on function public.settle_refund(uuid, text) to service_role;
