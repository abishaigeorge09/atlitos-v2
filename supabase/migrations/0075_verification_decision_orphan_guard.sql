-- 0075: verification decisions must not fail on orphaned applicants.
--
-- Live incident (2026-07-25, admin portal): approving/rejecting a
-- verification_request whose applicant account had been deleted threw
-- `insert or update on table "notifications" violates foreign key
-- constraint "notifications_user_id_fkey"`, wedging the admin queue.
-- verification_requests.applicant_id has no FK to users (the request row
-- legitimately outlives account deletion for audit), but the decision
-- functions unconditionally insert a notification for the applicant, and
-- notifications.user_id -> users(id) is enforced.
--
-- Fix: guard the notification insert in both decision functions. The
-- decision itself (status transition, coach_profiles update, audit_log)
-- still proceeds so admins can clear orphaned requests from the queue;
-- only the ghost notification is skipped. Bodies otherwise identical to
-- the previous definitions.

create or replace function public.admin_approve_verification_request(p_request_id uuid)
returns verification_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    'verification.approve',
    'verification_requests',
    v_request.id,
    jsonb_build_object('status', 'pending_review'),
    jsonb_build_object('status', 'approved')
  );

  -- Orphan guard: the applicant may have deleted their account since
  -- applying; notifications.user_id FK would reject the insert.
  if exists (select 1 from public.users where id = v_request.applicant_id) then
    insert into public.notifications (user_id, type, title, body, deep_link)
    values (
      v_request.applicant_id,
      'verification',
      'You are verified',
      'Your verification was approved. Your profile is now live.',
      '/profile'
    );
  end if;

  return v_request;
end;
$function$;

create or replace function public.admin_reject_verification_request(p_request_id uuid, p_reason text)
returns verification_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Orphan guard, same reasoning as approve.
  if exists (select 1 from public.users where id = v_request.applicant_id) then
    insert into public.notifications (user_id, type, title, body, deep_link)
    values (
      v_request.applicant_id,
      'verification',
      'Verification not approved',
      p_reason,
      '/profile'
    );
  end if;

  return v_request;
end;
$function$;
