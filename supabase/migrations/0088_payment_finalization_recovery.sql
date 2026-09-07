-- ATLITOS v2 — 0088_payment_finalization_recovery.sql
-- SEC-F2 (P0, docs/qa/atlitos-v2 security audit 2026-09-04): a captured
-- payment can become permanently incomplete after a downstream failure.
--
-- THE BUG. `_shared/finalize-payment.ts` flips payment_intents
-- `created -> captured` FIRST, then hands the intent to its domain handler.
-- The flip is the idempotency gate: `where status = 'created'`, so exactly one
-- caller wins. That is correct for concurrency and wrong for failure. If the
-- domain handler throws AFTER the flip (a transient PostgREST error, a ledger
-- constraint, an RPC timeout), the intent is already `captured`, and EVERY
-- later delivery of that capture -- Razorpay's webhook retries, the client's
-- verify-payment fallback -- matches zero rows and returns `already_processed`
-- without re-entering the handler. The charge is real, the downstream work is
-- missing, and nothing will ever retry it.
--
-- Worked example, courts: `court_booking_confirm_payment` succeeds (booking is
-- `confirmed`), then the `ledger_entries` insert fails. The partner is never
-- credited, the balanced group for that money never exists, and the sweep in
-- 0045 does not look at captured intents at all.
--
-- THE FIX, in two halves.
--
-- Half 1 (this migration): `finalized_at` is a durable marker meaning "the
-- domain handler for this charge ran to completion". `captured` now means only
-- "money moved"; `captured` + `finalized_at is null` means "money moved, work
-- owed". That distinction is what makes a retry actionable.
--
-- Half 2 (`_shared/finalize-payment.ts`): the gate re-enters the domain
-- handler for a `captured` intent whose `finalized_at` is null, and stamps
-- `finalized_at` only after the handler returns. `already_processed` is now
-- reserved for intents that are genuinely complete. Re-entry is safe because
-- every domain handler was already written to be idempotent: the domain RPCs
-- (`place_order_from_draft`, `record_donation_from_draft`,
-- `activate_group_membership_paid`, `court_booking_confirm_payment`) return the
-- existing row untouched on a repeat, and the order/donation/membership
-- handlers already guard their ledger write with an existence check. Courts was
-- the one handler missing that guard; it gains one in the same change.
--
-- WHY NO UNIQUE INDEX ON ledger_entries. The obvious backstop would be a unique
-- index over (payment_intent_id, account_type, direction, domain, entity_id) to
-- make a duplicate capture group impossible. It cannot be used: `settle_refund`
-- writes a REVERSING group against the same payment_intent_id, whose legs
-- deliberately collide with the capture group's on exactly those columns
-- (0026/0060). The capture group is always the FIRST ledger group an intent
-- ever has, so "any ledger row exists for this payment_intent_id" is the
-- correct and sufficient idempotency predicate, and that is what the handlers
-- use.

alter table public.payment_intents
  add column if not exists finalized_at timestamptz;

comment on column public.payment_intents.finalized_at is
  'SEC-F2. Set by the capture gate once the domain handler for this charge has completed (booking transitioned / order placed / donation recorded / membership activated, and the balanced ledger group written where the domain owes one). NULL on a captured row means the charge landed but its downstream work did not, and the next delivery of that capture must re-enter the domain handler rather than reporting already_processed. Never set by a client: payment_intents carries no client UPDATE grant.';

-- BACKFILL, and it is load-bearing. Without it every historical captured intent
-- reads as "work owed" the moment this ships, and the next webhook redelivery
-- for any of them would re-enter a domain handler for a charge that was
-- finalized months ago. Everything already at or past `captured` predates the
-- marker and is treated as complete; `updated_at` is when the gate last touched
-- the row, which is the closest honest timestamp available.
update public.payment_intents
set finalized_at = updated_at
where finalized_at is null
  and status in ('captured', 'refunded', 'partially_refunded');

-- The reconciliation backlog query. Partial so it stays tiny: in a healthy
-- system this index has zero rows in it.
create index if not exists idx_payment_intents_unfinalized
  on public.payment_intents (created_at)
  where status = 'captured' and finalized_at is null;

-- ============================================================================
-- payment_finalization_backlog(p_grace interval)
-- ============================================================================
--
-- Every captured charge whose downstream work is still owed and which is old
-- enough that an in-flight finalization is no longer a plausible explanation.
-- Read-only. This is the ops/alerting view and the sweep's input; it repairs
-- nothing, because the repair lives in the edge-function domain handlers (Deno,
-- Razorpay-aware, ledger-leg arithmetic) and duplicating that in SQL would mean
-- two implementations of the same money logic drifting apart.
--
-- ponytail: report-only arm. A row surfaces here and is repaired by the next
-- delivery of that capture (webhook retry or the client's verify-payment). If
-- an operator needs repair without waiting for a delivery, the upgrade path is
-- a scheduled worker that re-invokes verify-payment per row; add it when the
-- backlog is observed to be non-transient, not before.
create or replace function public.payment_finalization_backlog(
  p_grace interval default interval '15 minutes'
)
returns table (
  payment_intent_id uuid,
  domain public.payment_domain,
  entity_id uuid,
  amount numeric,
  razorpay_order_id text,
  razorpay_payment_id text,
  captured_at timestamptz,
  has_ledger_group boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pi.id,
    pi.domain,
    pi.entity_id,
    pi.amount,
    pi.razorpay_order_id,
    pi.razorpay_payment_id,
    pi.updated_at,
    exists (
      select 1 from public.ledger_entries le where le.payment_intent_id = pi.id
    )
  from public.payment_intents pi
  where pi.status = 'captured'
    and pi.finalized_at is null
    and pi.updated_at <= now() - p_grace
  order by pi.updated_at;
$$;

revoke all on function public.payment_finalization_backlog(interval) from public;
revoke execute on function public.payment_finalization_backlog(interval) from anon, authenticated;
grant execute on function public.payment_finalization_backlog(interval) to service_role;

comment on function public.payment_finalization_backlog(interval) is
  'SEC-F2. Captured payment_intents whose domain finalization never completed, older than p_grace. service_role only: it enumerates money that moved without its downstream work, which no client may read. Repair happens in the edge-function capture gate on the next delivery; this surfaces what is waiting.';

-- ============================================================================
-- expire_stale_holds(): the fifth arm
-- ============================================================================
--
-- 0045 established the shape: one scheduled sweep, one arm per domain, per-row
-- failures counted rather than fatal, and a per-domain count in the return so a
-- sweep that ran and did nothing is distinguishable from one that never ran.
-- The payments arm follows it, except that it COUNTS rather than repairs, for
-- the reason given on payment_finalization_backlog above. A non-zero
-- `payments_unfinalized` is the alert condition: real money is captured with
-- work owed.

create or replace function public.expire_stale_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - public.unpaid_hold_ttl();
  v_courts int := 0;
  v_court_failures int := 0;
  v_sessions int := 0;
  v_session_failures int := 0;
  v_reservations int := 0;
  v_clips jsonb;
  v_unfinalized int := 0;
  v_unfinalized_no_ledger int := 0;
  v_id uuid;
begin
  -- Courts.
  for v_id in
    select b.id
    from public.court_bookings b
    where b.status = 'pending_payment'
      and b.created_at <= v_cutoff
  loop
    begin
      perform public.court_booking_expire_payment(v_id);
      v_courts := v_courts + 1;
    exception when others then
      v_court_failures := v_court_failures + 1;
    end;
  end loop;

  -- Sessions. The payment intent, not the age of the session row, is what makes
  -- one stale (a paid session sits in `requested` legitimately for days).
  for v_id in
    select s.id
    from public.sessions s
    where s.status = 'requested'
      and exists (
        select 1 from public.payment_intents pi
        where pi.entity_id = s.id
          and pi.domain = 'session'
          and pi.status = 'created'
          and pi.created_at <= v_cutoff
      )
      and not exists (
        select 1 from public.payment_intents pi
        where pi.entity_id = s.id
          and pi.domain = 'session'
          and pi.status = 'captured'
      )
  loop
    begin
      perform public.session_abandon_unpaid(v_id);
      v_sessions := v_sessions + 1;
    exception when others then
      v_session_failures := v_session_failures + 1;
    end;
  end loop;

  -- Commerce. Set-based.
  v_reservations := public.release_expired_stock_reservations();

  -- Clutch. The fourth arm (AT-93): reclaim stranded clips. Its own 30 minute
  -- TTL is independent of the unpaid-hold TTL, so it is computed inside
  -- reconcile_stranded_clips rather than sharing v_cutoff.
  v_clips := public.reconcile_stranded_clips();

  -- Payments. The fifth arm (SEC-F2): captured money whose downstream work is
  -- still owed. Report-only, see payment_finalization_backlog.
  select count(*), count(*) filter (where not b.has_ledger_group)
    into v_unfinalized, v_unfinalized_no_ledger
  from public.payment_finalization_backlog() b;

  return jsonb_build_object(
    'ran_at', now(),
    'cutoff', v_cutoff,
    'court_bookings_expired', v_courts,
    'court_bookings_failed', v_court_failures,
    'sessions_abandoned', v_sessions,
    'sessions_failed', v_session_failures,
    'stock_reservations_released', v_reservations,
    'clips_readied', v_clips -> 'clips_readied',
    'clips_rejected', v_clips -> 'clips_rejected',
    'clips_failed', v_clips -> 'clips_failed',
    'payments_unfinalized', v_unfinalized,
    'payments_unfinalized_without_ledger', v_unfinalized_no_ledger
  );
end;
$$;

comment on function public.expire_stale_holds() is
  'AT-26 + AT-93 + SEC-F2: the unified expiry sweep across courts, sessions, commerce, clutch (stranded clip reconcile) and payments (captured-but-unfinalized backlog, report-only). Scheduled by pg_cron every 5 minutes. Returns a per domain count so a sweep that ran and did nothing is distinguishable from one that never ran. A non-zero payments_unfinalized is an alert condition, not a routine value.';
