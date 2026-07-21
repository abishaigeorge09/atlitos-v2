-- ATLITOS v2 — 0043_clutch_state_machine.sql
-- Domain: clutch. Epic AT-7, story AT-91.
-- Requirements: PRD-01 FR-44, FR-45; PRD-04 FR-29, FR-30, FR-32, FR-33, FR-53.
--
-- The clip state machine, the SAME shape orders (0035) and sessions (0021)
-- already have: ONE SECURITY DEFINER internal RPC owns the whole machine and
-- raises INVALID_TRANSITION on an illegal edge. Clients never set clips.status
-- (0042 grants no UPDATE to anon/authenticated), so this function, the
-- stream-webhook finalizer, and the moderation RPCs below are the only things
-- that can move a clip forward.
--
-- MACHINE (SCHEMA.md clip_status, mirror of the enum ordering in 0041):
--   uploading  -> processing | rejected
--   processing -> ready | rejected
--   ready      -> published | rejected
--   published  -> removed          (moderation takedown only)
--   rejected   -> (terminal)
--   removed    -> (terminal)
--
-- Strictly forward, no skips. PHASE-5-STATUS.md gate clause 4 requires an
-- illegal edge (uploading -> published) to be REJECTED with INVALID_TRANSITION
-- and to write zero rows. `uploading -> rejected` is the abandoned-upload edge
-- AT-93's reconcile needs (a clip stranded in uploading with no storage object
-- is rejected); it is an addition beyond SCHEMA.md's original list and is
-- recorded in the SCHEMA.md update.

-- ============================================================================
-- clip_transition_internal: the low-level machine. service_role ONLY.
--
-- Unlike order_transition there is no timeline table to write, so an accepted
-- transition only moves status (and rejection_reason when rejecting). The
-- audit_log row for a moderation action is written by moderate_clip /
-- resolve_report below, not here, because a system transition (upload finished,
-- transcode ready, reconcile) is not an audited admin action; only the human
-- moderation decisions are (PRD-04 FR-29). This mirrors order_transition owning
-- the machine while the admin edge owns the audit row.
--
-- service_role only, because every caller is a service context: the webhook
-- finalizer (AT-95), the reconcile arm (AT-93), and the moderation RPCs below
-- (which are themselves SECURITY DEFINER and call this as the definer). No
-- client ever calls it directly (PHASE-5-STATUS.md trap 3).
-- ============================================================================

create function public.clip_transition_internal(
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
    when 'uploading'  then array['processing', 'rejected']::public.clip_status[]
    when 'processing' then array['ready', 'rejected']::public.clip_status[]
    when 'ready'      then array['published', 'rejected']::public.clip_status[]
    when 'published'  then array['removed']::public.clip_status[]
    when 'rejected'   then array[]::public.clip_status[]
    when 'removed'    then array[]::public.clip_status[]
  end;

  if not (p_to_status = any (v_allowed)) then
    raise exception 'INVALID_TRANSITION: clip % cannot move from % to %',
      p_clip_id, v_clip.status, p_to_status;
  end if;

  -- A rejection must carry a reason (FR-30 for the moderator path; the reconcile
  -- and finalizer callers supply one too). The clip machine enforces it at the
  -- lowest level so no caller can reject silently.
  if p_to_status = 'rejected' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'VALIDATION: a reason is required to reject a clip';
  end if;

  update public.clips
  set status = p_to_status,
      rejection_reason = case when p_to_status = 'rejected' then btrim(p_reason)
                              else rejection_reason end
  where id = p_clip_id
  returning * into v_clip;

  return v_clip;
end;
$$;

revoke all on function public.clip_transition_internal(uuid, public.clip_status, text) from public;
revoke execute on function public.clip_transition_internal(uuid, public.clip_status, text) from anon, authenticated;
grant execute on function public.clip_transition_internal(uuid, public.clip_status, text) to service_role;

-- ============================================================================
-- moderate_clip: the admin/moderator decision (PRD-04 FR-29, FR-30, FR-53).
--
-- Same shape as every other admin RPC in this codebase (admin_create_product,
-- admin_approve_verification_request): granted to authenticated, gated by
-- has_role INSIDE, writes exactly one audit_log row per accepted transition,
-- and zero on a rejected transition (the INVALID_TRANSITION from the internal
-- call propagates out and rolls the whole function back before the audit
-- insert runs).
--
-- Actions:
--   approve  ready      -> published
--   reject   ready      -> rejected   (non-empty reason required, FR-30)
--   remove   published  -> removed    (takedown; non-empty reason required)
--
-- The takedown has real teeth precisely because playback is a fresh signed-URL
-- mint against the LIVE row (AT-96): the instant status is `removed`, the
-- public/owner mint refuses for everyone and any outstanding signed URL stops
-- resolving within its 300s TTL (PHASE-5-STATUS.md, verified in AT-107).
-- ============================================================================

create function public.moderate_clip(
  p_clip_id uuid,
  p_action text,
  p_reason text default null
)
returns public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.clips;
  v_after public.clips;
  v_to public.clip_status;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  select * into v_before from public.clips where id = p_clip_id;
  if v_before.id is null then
    raise exception 'NOT_FOUND: clip % does not exist', p_clip_id;
  end if;

  v_to := case p_action
    when 'approve' then 'published'
    when 'reject'  then 'rejected'
    when 'remove'  then 'removed'
    else null
  end::public.clip_status;

  if v_to is null then
    raise exception 'VALIDATION: unknown moderation action %', p_action;
  end if;

  -- FR-30 / FR-53: reject and remove both require a non-empty reason.
  if p_action in ('reject', 'remove') and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'VALIDATION: a reason is required to % a clip', p_action;
  end if;

  -- The machine call. An illegal edge (e.g. approve on a not-ready clip) raises
  -- INVALID_TRANSITION and rolls back before any audit/notification row.
  v_after := public.clip_transition_internal(p_clip_id, v_to, p_reason);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'clip.' || p_action,
    'clip',
    p_clip_id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status),
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  -- Tell the creator. Copy strings: no emoji, no hyphens, no em dashes.
  insert into public.notifications (user_id, type, title, body, deep_link)
  values (
    v_after.owner_id,
    'clip_moderation',
    case p_action
      when 'approve' then 'Your clip is live'
      when 'reject'  then 'Your clip was not approved'
      else 'Your clip was removed'
    end,
    case p_action
      when 'approve' then 'Your clip is now in the Clutch feed.'
      when 'reject'  then coalesce(nullif(btrim(p_reason), ''), 'Your clip did not meet our guidelines.')
      else coalesce(nullif(btrim(p_reason), ''), 'Your clip was removed after review.')
    end,
    '/clutch/clip/' || p_clip_id::text
  );

  return v_after;
end;
$$;

revoke all on function public.moderate_clip(uuid, text, text) from public;
revoke execute on function public.moderate_clip(uuid, text, text) from anon;
grant execute on function public.moderate_clip(uuid, text, text) to authenticated, service_role;

-- ============================================================================
-- resolve_report: the Reports Queue action (PRD-04 FR-31, FR-32, FR-33, FR-53).
--
-- A report against an already-published clip is resolved by takedown (remove)
-- or dismissal. Takedown reuses the moderate_clip 'remove' path so the clip
-- removal is audited and the creator notified exactly as a direct takedown
-- would be; dismissal leaves the clip untouched (VIDEO.md "resolving by
-- dismissal only updates the reports row"). Either way a non-empty reason is
-- required (FR-33) and exactly one report.resolve audit row is written.
--
-- A comment takedown deletes the reported comment (comments are immutable, so
-- there is no soft-delete state); the comment_count trigger (0041) keeps the
-- clip's count right.
-- ============================================================================

create function public.resolve_report(
  p_report_id uuid,
  p_action text,
  p_reason text default null
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
  v_new_status public.report_status;
  v_clip public.clips;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  if p_action not in ('remove', 'dismiss') then
    raise exception 'VALIDATION: unknown report action %', p_action;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION: a reason is required to resolve a report';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if v_report.id is null then
    raise exception 'NOT_FOUND: report % does not exist', p_report_id;
  end if;

  if v_report.status <> 'pending' then
    raise exception 'ALREADY_RESOLVED: report % is already %', p_report_id, v_report.status;
  end if;

  if p_action = 'remove' then
    if v_report.entity_type = 'clip' then
      select * into v_clip from public.clips where id = v_report.entity_id;
      -- Only take down a clip that is still published; if a prior action already
      -- removed it, the report is still resolved as actioned without erroring.
      if v_clip.id is not null and v_clip.status = 'published' then
        perform public.moderate_clip(v_report.entity_id, 'remove', p_reason);
      end if;
    elsif v_report.entity_type = 'comment' then
      delete from public.clip_comments where id = v_report.entity_id;
    end if;
    v_new_status := 'actioned';
  else
    v_new_status := 'dismissed';
  end if;

  update public.reports
  set status = v_new_status,
      resolved_by = auth.uid(),
      resolved_at = now()
  where id = p_report_id
  returning * into v_report;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'report.' || p_action,
    'report',
    p_report_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', v_new_status),
    btrim(p_reason)
  );

  return v_report;
end;
$$;

revoke all on function public.resolve_report(uuid, text, text) from public;
revoke execute on function public.resolve_report(uuid, text, text) from anon;
grant execute on function public.resolve_report(uuid, text, text) to authenticated, service_role;
