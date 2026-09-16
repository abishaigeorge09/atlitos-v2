-- 0108_courts_arm_captured_payment_guard
-- The courts arm of expire_stale_holds had no captured-payment guard while its
-- siblings had two layers each. The window is the full 15 minute unpaid hold
-- TTL, not a microsecond, so a captured booking could be expired and its slot
-- resold after the athlete was charged. Adds the candidate-query predicate and
-- the under-lock re-check, matching session_abandon_unpaid (0024) and
-- membership_abandon_unpaid (0079).

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
        -- 0108. A booking whose payment already captured is not a stale hold,
        -- it is a paid booking whose confirmation has not landed yet.
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
