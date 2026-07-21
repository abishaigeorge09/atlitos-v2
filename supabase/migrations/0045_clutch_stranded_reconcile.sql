-- ATLITOS v2 — 0045_clutch_stranded_reconcile.sql
-- Domain: clutch + platform hygiene. Epic AT-7, story AT-93.
-- Requirements: PRD-01 FR-44; VIDEO.md step 4.
--
-- The v1 form of VIDEO.md's `stream-reconcile` poll fallback. The dedicated
-- Cloudflare poller is DEFERRED (the Supabase Storage adapter has no remote
-- third-party webhook that can be lost; the finalizer is a synchronous
-- client-to-edge call, AT-95). What ships now, per PHASE-5-STATUS.md, is a
-- fourth arm on the EXISTING unified `expire_stale_holds()` pg_cron job, NOT a
-- new cron (trap 5). It reclaims clips stranded in `uploading`/`processing`
-- past a 30 minute TTL so no clip is stranded forever.
--
-- The seam is the same one 0038 established for commerce: extend the one sweep
-- rather than cut another. "Scheduled" means observed to have run
-- (cron.job_run_details), same as AT-26.

-- ============================================================================
-- reconcile_stranded_clips(). For each clip stuck in uploading/processing past
-- the TTL: if the storage object is present in the private `clips` bucket,
-- drive it forward to `ready` (through the legal edges); if absent, reject it.
-- Errors are swallowed PER ROW and counted, so one bad clip cannot stop the
-- sweep, matching expire_stale_holds' per-row discipline.
--
-- Object presence is read straight from storage.objects by the clip's
-- storage_path. A stranded `uploading` clip whose object IS present is one
-- whose upload finished but whose finalizer call never landed; a clip whose
-- object is absent past the TTL never completed its upload and is abandoned.
--
-- service_role only. Called by expire_stale_holds (itself service_role), never
-- by a client.
-- ============================================================================

create function public.reconcile_stranded_clips()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '30 minutes';
  v_readied int := 0;
  v_rejected int := 0;
  v_failed int := 0;
  r record;
  v_has_object boolean;
begin
  for r in
    select c.id, c.status, c.storage_path
    from public.clips c
    where c.status in ('uploading', 'processing')
      and c.created_at <= v_cutoff
  loop
    begin
      v_has_object := r.storage_path is not null and exists (
        select 1 from storage.objects o
        where o.bucket_id = 'clips' and o.name = r.storage_path
      );

      if v_has_object then
        -- Drive to ready through the legal chain. `uploading` needs the
        -- intermediate `processing` hop; `processing` goes straight to ready.
        if r.status = 'uploading' then
          perform public.clip_transition_internal(r.id, 'processing');
        end if;
        perform public.clip_transition_internal(r.id, 'ready');
        v_readied := v_readied + 1;
      else
        perform public.clip_transition_internal(r.id, 'rejected', 'Upload did not complete in time.');
        v_rejected := v_rejected + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'clips_readied', v_readied,
    'clips_rejected', v_rejected,
    'clips_failed', v_failed
  );
end;
$$;

revoke all on function public.reconcile_stranded_clips() from public;
revoke execute on function public.reconcile_stranded_clips() from anon, authenticated;
grant execute on function public.reconcile_stranded_clips() to service_role;

comment on function public.reconcile_stranded_clips() is
  'AT-93: the v1 stream-reconcile arm. Reclaims clips stranded in uploading/processing past 30 minutes to ready (object present) or rejected (object absent). Called from expire_stale_holds, not a separate cron.';

-- ============================================================================
-- Fold the arm into expire_stale_holds(). This is a create-or-replace that
-- keeps the three existing arms (courts, sessions, commerce, from 0038) exactly
-- as they were and adds the clip reconcile as the fourth, plus its counts in
-- the returned jsonb. The pg_cron schedule ('expire-stale-holds', */5) is
-- unchanged; replacing the function keeps the same job pointing at the same
-- name.
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
  v_clips jsonb;
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
    'clips_failed', v_clips -> 'clips_failed'
  );
end;
$$;

comment on function public.expire_stale_holds() is
  'AT-26 + AT-93: the unified expiry sweep across courts, sessions, commerce and clutch (stranded clip reconcile). Scheduled by pg_cron every 5 minutes. Returns a per domain count so a sweep that ran and did nothing is distinguishable from one that never ran.';
