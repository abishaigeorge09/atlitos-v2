-- ATLITOS v2 — 0108_courts_arm_captured_payment_guard.sql
-- Domain: courts, the expiry sweep.
--
-- WRITTEN, NOT APPLIED. The DB write gate forbids applying it.
--
-- ============================================================================
-- THE DEFECT
-- ============================================================================
--
-- The courts arm of expire_stale_holds() has no captured-payment guard, and
-- its siblings do. The asymmetry, read from the live pg_get_functiondef and
-- confirmed against the repo's own DDL:
--
--   sessions arm  (0094:311)  candidate query carries
--                             `and not exists (... pi.status = 'captured')`,
--                             and session_abandon_unpaid (0024:74) re-checks
--                             it under `for update` and raises
--                             INVALID_TRANSITION.
--   membership    (0079:165)  membership_abandon_unpaid raises
--                             'INVALID_TRANSITION: membership % has a
--                             captured payment'. Two layers, same shape.
--   courts arm    (0094:283)  candidate query is only
--                             `where b.status = 'pending_payment'
--                                and b.created_at <= v_cutoff`,
--                             and court_booking_expire_payment (0012:93)
--                             never reads payment_intents at all. ZERO layers.
--
-- The window is not microseconds. `unpaid_hold_ttl()` is 15 minutes and UPI
-- collect routinely exceeds it. A payment landing at 15:01 is flipped to
-- `captured` by the shared gate, then court_booking_confirm_payment raises
-- INVALID_TRANSITION because the sweep already expired the booking,
-- finalize-court-booking-payment.ts:73 throws, and razorpay-webhook logs it
-- and returns 200 so Razorpay never redelivers. End state: intent captured,
-- booking expired, zero ledger entries, zero refunds, slot resold, athlete
-- charged.
--
-- ============================================================================
-- THE FIX: both layers the siblings have, not one
-- ============================================================================
--
-- Layer 1, the candidate query, so a paid booking is never selected.
-- Layer 2, inside court_booking_expire_payment under the row lock, so the
-- guard holds against a capture that lands between the SELECT and the UPDATE.
--
-- Layer 1 alone would be exactly the race it is meant to close. That is why
-- the sessions arm has both, and the finding was that courts had neither.
--
-- ============================================================================
-- THE CLASS SWEEP, all four arms, stated in full
-- ============================================================================
--
--   courts     had no guard. FIXED here, both layers.
--   sessions   has both layers. Verified, unchanged.
--   commerce   release_expired_stock_reservations releases a stock HOLD, not
--              money. consume_reservation is the money step and it runs
--              inside the capture path, so an expired reservation whose
--              payment later captures raises OUT_OF_STOCK and is refunded by
--              finalize-order-payment (PAYMENTS.md:101). Different mechanism,
--              correctly guarded, nothing to add.
--   clutch     reconcile_stranded_clips touches no money table. Not in class.
--
-- NOT DONE, and it is a real gap: expire_stale_holds has no MEMBERSHIP arm at
-- all. membership_abandon_unpaid exists and is correctly guarded, and nothing
-- calls it, so an abandoned pending membership holds a group seat forever
-- (VERIFICATION-WAVE-1 P1-3). Adding that arm is a product behaviour change
-- (it starts releasing seats), not a guard, so it is deliberately left for the
-- decision that owns P1-3 rather than smuggled into a guard migration.

-- ============================================================================
-- Layer 2. court_booking_expire_payment gains the guard its two siblings have.
-- create or replace preserves the service_role-only grant from 0012.
-- ============================================================================

create or replace function public.court_booking_expire_payment(p_booking_id uuid)
returns public.court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.court_bookings;
  v_captured int;
begin
  select * into v_booking from public.court_bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'NOT_FOUND: court_booking % does not exist', p_booking_id;
  end if;

  if v_booking.status <> 'pending_payment' then
    raise exception 'INVALID_TRANSITION: court_booking % is not pending_payment', p_booking_id;
  end if;

  -- 0108. Never release a booking whose money actually moved. The capture gate
  -- in _shared/finalize-payment.ts and this function can race across the whole
  -- 15 minute hold TTL, not a microsecond: if the payment is captured, the
  -- athlete owns that slot and this call must fail loudly rather than silently
  -- free a paid one and resell it. Word for word the reasoning in
  -- session_abandon_unpaid (0024) and membership_abandon_unpaid (0079); courts
  -- was the arm that never got it.
  --
  -- Taken AFTER the `for update` on the booking, so the check and the UPDATE
  -- below are inside the same lock and a capture cannot land between them.
  select count(*) into v_captured
  from public.payment_intents pi
  where pi.entity_id = p_booking_id
    and pi.domain = 'court'
    and pi.status in ('captured', 'refunded');

  if v_captured > 0 then
    raise exception 'INVALID_TRANSITION: court_booking % has a captured payment', p_booking_id;
  end if;

  update public.court_bookings
  set status = 'expired'
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

comment on function public.court_booking_expire_payment(uuid) is
  '0012 + 0108: expire an unpaid court hold. Refuses with INVALID_TRANSITION if a captured or refunded payment_intent exists for the booking, checked under the same row lock as the UPDATE. service_role only.';

-- ============================================================================
-- Layer 1. The courts candidate query in expire_stale_holds.
--
-- This is a full create or replace of the 0094 body with one predicate added,
-- because Postgres has no way to patch a function body in place. Everything
-- else below is 0094 verbatim: the per-arm CT-7 exception handlers, the
-- per-row handlers inside courts and sessions, and all four per-domain counts
-- in the returned jsonb. Diff this against 0094:269 before believing it.
-- ============================================================================

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
  v_clips jsonb := jsonb_build_object('clips_readied', 0, 'clips_failed', 0, 'clips_errored', 0);
  v_arm_failures int := 0;
  v_id uuid;
begin
  -- Courts arm.
  begin
    for v_id in
      select b.id
      from public.court_bookings b
      where b.status = 'pending_payment'
        and b.created_at <= v_cutoff
        -- 0108. The guard the sessions arm has had since 0094 and this one
        -- never did. A booking whose payment already captured is not a stale
        -- hold, it is a paid booking whose confirmation has not landed yet,
        -- and expiring it resells a slot the athlete has been charged for.
        and not exists (
          select 1 from public.payment_intents pi
          where pi.entity_id = b.id
            and pi.domain = 'court'
            and pi.status in ('captured', 'refunded')
        )
    loop
      begin
        perform public.court_booking_expire_payment(v_id);
        v_courts := v_courts + 1;
      exception when others then
        v_court_failures := v_court_failures + 1;
      end;
    end loop;
  exception when others then
    insert into public.sweep_failures (arm, error) values ('courts', sqlerrm);
    v_arm_failures := v_arm_failures + 1;
  end;

  -- Sessions arm.
  begin
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
  exception when others then
    insert into public.sweep_failures (arm, error) values ('sessions', sqlerrm);
    v_arm_failures := v_arm_failures + 1;
  end;

  -- Commerce arm (set-based).
  begin
    v_reservations := public.release_expired_stock_reservations();
  exception when others then
    insert into public.sweep_failures (arm, error) values ('commerce', sqlerrm);
    v_arm_failures := v_arm_failures + 1;
  end;

  -- Clutch arm (stranded clip reconcile).
  begin
    v_clips := public.reconcile_stranded_clips();
  exception when others then
    insert into public.sweep_failures (arm, error) values ('clutch', sqlerrm);
    v_arm_failures := v_arm_failures + 1;
  end;

  return jsonb_build_object(
    'ran_at', now(),
    'cutoff', v_cutoff,
    'court_bookings_expired', v_courts,
    'court_bookings_failed', v_court_failures,
    'sessions_abandoned', v_sessions,
    'sessions_failed', v_session_failures,
    'stock_reservations_released', v_reservations,
    'clips_readied', v_clips -> 'clips_readied',
    'clips_failed', v_clips -> 'clips_failed',
    'clips_errored', v_clips -> 'clips_errored',
    'arm_failures', v_arm_failures
  );
end;
$$;

comment on function public.expire_stale_holds() is
  'AT-26 + AT-93 + CT-6/CT-7 + 0108: unified expiry sweep (courts, sessions, commerce, clutch). The courts and sessions arms both skip candidates with a captured payment, and both call a transition function that re-checks under the row lock. Each arm is guarded and records to sweep_failures on failure so siblings still run. Scheduled by pg_cron every 5 minutes.';
