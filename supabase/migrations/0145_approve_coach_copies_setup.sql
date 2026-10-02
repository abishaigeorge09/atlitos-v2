-- ATLITOS v2 — 0145_approve_coach_copies_setup.sql
--
-- Found on the device pass 2026-10-03: a coach approved today had zero
-- session_types and zero coach_availability_windows, so they were verified
-- but hidden from discovery (listCoaches drops unpriced coaches) and
-- unbookable. 0099 backfilled the payload once for coaches approved before
-- it, but admin_approve_verification_request was never changed, so every
-- coach approved since then has the same gap.
--
-- The approval now copies the wizard's payload
--   payload -> 'sessionTypes'        [{ name, durationMinutes, price }]
--   payload -> 'availabilityWindows' [{ dayOfWeek, from, to }]
-- into the live tables, inside the same transaction, using 0099's rules:
-- only when the coach has no rows of that kind yet (never overwrite what a
-- coach has since edited), and only rows that are well formed (positive
-- price and duration, day 0 to 6, from before to). Everything else in the
-- function is unchanged from production.

create or replace function public.admin_approve_verification_request(p_request_id uuid)
returns public.verification_requests
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

    if not exists (select 1 from public.session_types where coach_id = v_request.applicant_id) then
      insert into public.session_types (coach_id, name, duration_minutes, price, active)
      select v_request.applicant_id,
             btrim(t ->> 'name'),
             (t ->> 'durationMinutes')::int,
             (t ->> 'price')::numeric,
             true
        from jsonb_array_elements(coalesce(v_request.payload -> 'sessionTypes', '[]'::jsonb)) t
       where coalesce(btrim(t ->> 'name'), '') <> ''
         and (t ->> 'durationMinutes') ~ '^[0-9]+$' and (t ->> 'durationMinutes')::int > 0
         and (t ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$' and (t ->> 'price')::numeric > 0;
    end if;

    if not exists (select 1 from public.coach_availability_windows where coach_id = v_request.applicant_id) then
      insert into public.coach_availability_windows (coach_id, day_of_week, start_time, end_time)
      select v_request.applicant_id,
             (w ->> 'dayOfWeek')::smallint,
             (w ->> 'from')::time,
             (w ->> 'to')::time
        from jsonb_array_elements(coalesce(v_request.payload -> 'availabilityWindows', '[]'::jsonb)) w
       where (w ->> 'dayOfWeek') ~ '^[0-6]$'
         and (w ->> 'from') ~ '^[0-2][0-9]:[0-5][0-9]$'
         and (w ->> 'to') ~ '^[0-2][0-9]:[0-5][0-9]$'
         and (w ->> 'from')::time < (w ->> 'to')::time;
    end if;
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
