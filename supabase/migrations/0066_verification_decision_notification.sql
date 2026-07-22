-- ATLITOS v2 — 0066_verification_decision_notification.sql
--
-- AT-146. Wire the verification-decision notification that 0007's header
-- explicitly deferred: "Applicant notification on reject (FR-10) is out of
-- scope for this migration: the notification dispatch pipeline is not built
-- yet." notify-dispatch now exists (AT-146), so this source can pay the
-- notification it owes. PRD-04 FR-10 (reject reason delivered to applicant),
-- FR-9 (approval).
--
-- The row insert here IS the in-app delivery leg (SCHEMA.md "Domain:
-- notifications" + _shared/notify.ts): the applicant reads the notifications
-- table owner-scoped and over Realtime. Like moderate_clip (0043) and
-- record_donation_from_draft (0054), an in-database SECURITY DEFINER writer
-- inserts the notifications row directly rather than round-tripping through
-- the notify-dispatch edge function; that function's device-push leg is the
-- P9-stubbed extra, not required for the in-app notification. The insert runs
-- under the definer owner, which is the only writer of a notifications row
-- (0002 grants no authenticated INSERT), so the applicant cannot be spoofed a
-- notification by any client.
--
-- Only the notification insert is added; the approve/reject logic, grants,
-- and audit_log writes are unchanged from 0007. Copy strings carry no emoji,
-- no hyphens, no em dashes (CLAUDE.md house style).

create or replace function public.admin_approve_verification_request(p_request_id uuid)
returns public.verification_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.verification_requests;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  select * into v_request from public.verification_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'NOT_FOUND: verification_request % does not exist', p_request_id;
  end if;

  if v_request.status <> 'pending_review' then
    raise exception 'INVALID_TRANSITION: verification_request % is not pending_review', p_request_id;
  end if;

  update public.verification_requests
  set status = 'approved', reviewer_id = auth.uid(), reviewed_at = now()
  where id = p_request_id
  returning * into v_request;

  if v_request.applicant_type = 'coach' then
    update public.coach_profiles set status = 'verified' where user_id = v_request.applicant_id;
  end if;
  -- 'venue' / 'upa': no-op until public.venues / public.upa_applications exist, see 0007 header.

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    'verification.approve',
    'verification_requests',
    v_request.id,
    jsonb_build_object('status', 'pending_review'),
    jsonb_build_object('status', 'approved')
  );

  -- FR-9: tell the applicant their profile is verified. In-app delivery.
  insert into public.notifications (user_id, type, title, body, deep_link)
  values (
    v_request.applicant_id,
    'verification',
    'You are verified',
    'Your verification was approved. Your profile is now live.',
    '/profile'
  );

  return v_request;
end;
$$;

create or replace function public.admin_reject_verification_request(p_request_id uuid, p_reason text)
returns public.verification_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.verification_requests;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: a rejection reason is required';
  end if;

  select * into v_request from public.verification_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'NOT_FOUND: verification_request % does not exist', p_request_id;
  end if;

  if v_request.status <> 'pending_review' then
    raise exception 'INVALID_TRANSITION: verification_request % is not pending_review', p_request_id;
  end if;

  update public.verification_requests
  set status = 'rejected', reviewer_id = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id
  returning * into v_request;

  if v_request.applicant_type = 'coach' then
    update public.coach_profiles set status = 'rejected' where user_id = v_request.applicant_id;
  end if;
  -- 'venue' / 'upa': no-op until public.venues / public.upa_applications exist, see 0007 header.

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'verification.reject',
    'verification_requests',
    v_request.id,
    jsonb_build_object('status', 'pending_review'),
    jsonb_build_object('status', 'rejected'),
    p_reason
  );

  -- FR-10: deliver the rejection reason to the applicant. In-app delivery.
  insert into public.notifications (user_id, type, title, body, deep_link)
  values (
    v_request.applicant_id,
    'verification',
    'Verification not approved',
    p_reason,
    '/profile'
  );

  return v_request;
end;
$$;

-- Grants unchanged from 0007; re-asserted since create or replace preserves
-- them but being explicit keeps the access set self-documenting.
revoke execute on function public.admin_approve_verification_request(uuid) from public;
revoke execute on function public.admin_reject_verification_request(uuid, text) from public;
revoke execute on function public.admin_approve_verification_request(uuid) from anon;
revoke execute on function public.admin_reject_verification_request(uuid, text) from anon;
grant execute on function public.admin_approve_verification_request(uuid) to authenticated;
grant execute on function public.admin_reject_verification_request(uuid, text) to authenticated;
