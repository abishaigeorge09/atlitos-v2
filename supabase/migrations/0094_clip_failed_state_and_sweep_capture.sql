-- ATLITOS v2 — 0094_clip_failed_state_and_sweep_capture.sql
-- Domain: clutch + platform hygiene (LAUNCH Phase 3). Item P1-6; CT-6, CT-7.
-- Track A (Database).
--
-- CT-6: a real `failed` clip state (not a client-side timeout heuristic).
--   * clip_status enum gains 'failed'; clips.failure_reason text added.
--   * State machine (0043) gains: uploading -> failed, processing -> failed,
--     failed -> uploading (retry). Repurposing 'rejected' was rejected upstream:
--     that state means moderation; conflating corrupts the moderation queue.
--   * The clutch arm of expire_stale_holds() (0045) now marks a clip stranded in
--     uploading/processing past 30 min WITH NO STORAGE OBJECT as 'failed' with a
--     reason (previously 'rejected'), so the owner sees a Retry affordance
--     instead of a silent dead clip. A stranded clip whose object IS present is
--     still driven forward to ready (a finalizer that never landed, recoverable).
--   * public.retry_failed_clip(clip_id): owner-scoped SECURITY DEFINER retry that
--     moves failed -> uploading. The fresh stream-upload-url mint is Track C/B.
--
-- CT-7: each arm of expire_stale_holds() wraps in an exception handler that
--   captures the failure into public.sweep_failures instead of aborting sibling
--   arms. The per-domain counts stay in the returned jsonb so a partial sweep is
--   observable (Phase 2 alert channel adds sweep_failures to its watch query;
--   DEBT.md records the wiring if that channel is not yet merged).
--
-- APPLY NOTE (read before proving): `alter type ... add value` cannot be both
-- ADDED and USED inside one transaction. So the enum add below cannot be
-- exercised inside a single BEGIN/ROLLBACK: prove the machine either after the
-- enum value is committed, or against a schema where it already exists. Adding
-- the value is additive and harmless even if the rest of a trial rolls back
-- (enum values are not dropped). The orchestrator applies this file whole
-- post-approval.

-- ============================================================================
-- Enum + column
-- ============================================================================

alter type public.clip_status add value if not exists 'failed';

alter table public.clips
  add column if not exists failure_reason text;

comment on column public.clips.failure_reason is
  'CT-6: why a clip is in the failed state (technical upload failure, not moderation). Shown to the owner alongside the Retry action. NULL unless status = failed.';

-- ============================================================================
-- clip_transition_internal: add the failed edges.
--
-- create or replace preserves the existing service_role-only grants (0043). The
-- machine is otherwise unchanged. failure_reason is set when moving TO failed
-- (a reason is required, same discipline as rejected) and cleared when moving
-- OFF failed (failed -> uploading retry), so a retried clip carries no stale
-- reason. rejection_reason handling is untouched.
--
--   uploading  -> processing | rejected | failed
--   processing -> ready | rejected | failed
--   ready      -> published | rejected
--   published  -> removed
--   failed     -> uploading            (retry)
--   rejected   -> (terminal)
--   removed    -> (terminal)
-- ============================================================================

create or replace function public.clip_transition_internal(
  p_clip_id uuid,
  p_to_status public.clip_status,
  p_reason text default null
)
returns public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
  v_allowed public.clip_status[];
begin
  if p_clip_id is null or p_to_status is null then
    raise exception 'VALIDATION: clip id and target status are both required';
  end if;

  select * into v_clip from public.clips where id = p_clip_id for update;

  if v_clip.id is null then
    raise exception 'NOT_FOUND: clip % does not exist', p_clip_id;
  end if;

  v_allowed := case v_clip.status
    when 'uploading'  then array['processing', 'rejected', 'failed']::public.clip_status[]
    when 'processing' then array['ready', 'rejected', 'failed']::public.clip_status[]
    when 'ready'      then array['published', 'rejected']::public.clip_status[]
    when 'published'  then array['removed']::public.clip_status[]
    when 'failed'     then array['uploading']::public.clip_status[]
    when 'rejected'   then array[]::public.clip_status[]
    when 'removed'    then array[]::public.clip_status[]
  end;

  if not (p_to_status = any (v_allowed)) then
    raise exception 'INVALID_TRANSITION: clip % cannot move from % to %',
      p_clip_id, v_clip.status, p_to_status;
  end if;

  if p_to_status = 'rejected' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'VALIDATION: a reason is required to reject a clip';
  end if;

  if p_to_status = 'failed' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'VALIDATION: a reason is required to fail a clip';
  end if;

  update public.clips
  set status = p_to_status,
      rejection_reason = case when p_to_status = 'rejected' then btrim(p_reason)
                              else rejection_reason end,
      failure_reason = case
        when p_to_status = 'failed' then btrim(p_reason)
        -- Clear on retry (failed -> uploading) so a re-minted upload starts clean.
        when v_clip.status = 'failed' then null
        else failure_reason
      end
  where id = p_clip_id
  returning * into v_clip;

  return v_clip;
end;
$$;

-- ============================================================================
-- retry_failed_clip: the owner's Retry action (CT-6, Track C consumes).
--
-- Clients have no UPDATE grant on clips (0042), so retry cannot be a PATCH. This
-- SECURITY DEFINER RPC is the only client path from failed back to uploading. It
-- is owner-scoped (owner_id = auth.uid()) and refuses any clip that is not the
-- caller's own or not currently failed. The fresh upload URL is minted by
-- stream-upload-url afterwards (Track C calls it), not here.
-- ============================================================================

create or replace function public.retry_failed_clip(p_clip_id uuid)
returns public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
begin
  if p_clip_id is null then
    raise exception 'VALIDATION: clip id is required';
  end if;

  select * into v_clip from public.clips where id = p_clip_id for update;
  if v_clip.id is null then
    raise exception 'NOT_FOUND: clip % does not exist', p_clip_id;
  end if;

  -- Owner only. A non-owner (or guest) gets FORBIDDEN, never a silent no-op.
  if v_clip.owner_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the clip owner may retry it';
  end if;

  if v_clip.status <> 'failed' then
    raise exception 'INVALID_TRANSITION: clip % is % and cannot be retried', p_clip_id, v_clip.status;
  end if;

  v_clip := public.clip_transition_internal(p_clip_id, 'uploading');
  return v_clip;
end;
$$;

revoke all on function public.retry_failed_clip(uuid) from public;
revoke execute on function public.retry_failed_clip(uuid) from anon;
grant execute on function public.retry_failed_clip(uuid) to authenticated, service_role;

comment on function public.retry_failed_clip(uuid) is
  'CT-6: owner-scoped retry of a failed clip (failed -> uploading). Re-mint of the upload URL is stream-upload-url, called after this by the client.';

-- ============================================================================
-- CT-7: sweep_failures capture table
-- ============================================================================

create table if not exists public.sweep_failures (
  id uuid primary key default gen_random_uuid(),
  arm text not null,
  error text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sweep_failures_created_at on public.sweep_failures (created_at desc);

comment on table public.sweep_failures is
  'CT-7: per-arm capture of expire_stale_holds() failures. A failing arm records here and lets sibling arms run rather than aborting the whole sweep. service_role only; watched by the Phase 2 alert channel.';

alter table public.sweep_failures enable row level security;
revoke all on table public.sweep_failures from anon, authenticated;
grant select, insert, update, delete on table public.sweep_failures to service_role;

-- ============================================================================
-- reconcile_stranded_clips: object-absent stranded clips become 'failed', not
-- 'rejected' (CT-6). Object-present clips are still driven forward to ready.
-- create or replace preserves the service_role-only grant (0045).
-- ============================================================================

create or replace function public.reconcile_stranded_clips()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '30 minutes';
  v_readied int := 0;
  v_failed_clips int := 0;
  v_errors int := 0;
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
        -- Upload finished but the finalizer call never landed: recoverable.
        if r.status = 'uploading' then
          perform public.clip_transition_internal(r.id, 'processing');
        end if;
        perform public.clip_transition_internal(r.id, 'ready');
        v_readied := v_readied + 1;
      else
        -- No object past the TTL: the upload failed. Mark it failed (retryable
        -- by the owner via retry_failed_clip), NOT rejected (moderation).
        perform public.clip_transition_internal(
          r.id, 'failed', 'Upload did not complete. Tap Retry to upload again.'
        );
        v_failed_clips := v_failed_clips + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;

  return jsonb_build_object(
    'clips_readied', v_readied,
    'clips_failed', v_failed_clips,
    'clips_errored', v_errors
  );
end;
$$;

comment on function public.reconcile_stranded_clips() is
  'CT-6: reclaim clips stranded in uploading/processing past 30 minutes: object present -> ready, object absent -> failed (retryable). Called from expire_stale_holds.';

-- ============================================================================
-- expire_stale_holds: wrap each arm in a CT-7 exception handler.
--
-- Every arm now runs inside its own begin/exception block that records the arm
-- name and error into sweep_failures and lets the remaining arms proceed. The
-- per-row handlers inside courts/sessions stay; this adds an ARM-level guard so
-- a failure in the arm's setup (or in the set-based commerce/clutch arms) does
-- not abort the whole sweep. All four per-domain counts remain in the returned
-- jsonb, so a partial sweep is distinguishable from a clean one.
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
  'AT-26 + AT-93 + CT-6/CT-7: unified expiry sweep (courts, sessions, commerce, clutch). Each arm is guarded and records to sweep_failures on failure so siblings still run. Returns per-domain counts. Scheduled by pg_cron every 5 minutes.';
