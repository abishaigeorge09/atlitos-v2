-- ATLITOS v2 — 0050_empower_state_machine.sql
-- Domain: empower. Epic AT-8, story AT-110.
-- Requirements: PRD-05 FR-5, FR-6, FR-9, FR-10, FR-14, FR-27; PRD-04 verification.
--
-- The empower state machines, the SAME shape orders (0035), sessions (0021) and
-- clips (0043) already have: ONE SECURITY DEFINER internal RPC owns each
-- machine and raises INVALID_TRANSITION on an illegal edge. Clients never set
-- upa_applications.status or upa_wishlist_items.status (0049 grants no such
-- write), so these RPCs, the admin verify branch, and Track B's donate finalize
-- handler are the ONLY things that can move an empower row's state at all.
--
-- Two machines:
--
--   upa_applications (SCHEMA.md upa_status, expanded with `deactivated`):
--     submitted    -> under_review | needs_info | verified | rejected
--     under_review -> needs_info | verified | rejected
--     needs_info   -> under_review | verified | rejected   (resubmit reopens)
--     verified     -> deactivated                          (owner self-withdraw)
--     rejected     -> (terminal; reapply creates a NEW row)
--     deactivated  -> (terminal)
--
--   upa_wishlist_items (SCHEMA.md upa_wishlist_item_status):
--     open -> funded -> delivered           (both server-only)
--     funded is reached by the donate finalize handler (Track B) when
--     funded_amount >= cost; delivered by the owning UPA marking fulfillment.
--
-- Error vocabulary raised here (for packages/api to map):
--   UNAUTHENTICATED / NOT_FOUND / FORBIDDEN / VALIDATION / INVALID_TRANSITION /
--   REASON_REQUIRED / ALREADY_APPLIED / COOLDOWN.

-- ============================================================================
-- upa_application_transition_internal: the low-level application machine.
-- service_role ONLY. Every caller is either a service context (Track B) or a
-- SECURITY DEFINER RPC below that calls this as its definer (the clutch /
-- orders precedent: moderate_clip -> clip_transition_internal). No client calls
-- it directly. Sets verified_at / needs_info_field / rejection_reason as the
-- target demands, so a caller cannot land a verified row without a timestamp or
-- a rejected row without a reason.
-- ============================================================================

create function public.upa_application_transition_internal(
  p_application_id uuid,
  p_to_status public.upa_status,
  p_needs_info_field text default null,
  p_rejection_reason text default null
)
returns public.upa_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.upa_applications;
  v_allowed public.upa_status[];
begin
  if p_application_id is null or p_to_status is null then
    raise exception 'VALIDATION: application id and target status are both required';
  end if;

  select * into v_app from public.upa_applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'NOT_FOUND: upa_application % does not exist', p_application_id;
  end if;

  v_allowed := case v_app.status
    when 'submitted'    then array['under_review','needs_info','verified','rejected']::public.upa_status[]
    when 'under_review' then array['needs_info','verified','rejected']::public.upa_status[]
    when 'needs_info'   then array['under_review','verified','rejected']::public.upa_status[]
    when 'verified'     then array['deactivated']::public.upa_status[]
    when 'rejected'     then array[]::public.upa_status[]
    when 'deactivated'  then array[]::public.upa_status[]
  end;

  if not (p_to_status = any (v_allowed)) then
    raise exception 'INVALID_TRANSITION: upa_application % cannot move from % to %',
      p_application_id, v_app.status, p_to_status;
  end if;

  if p_to_status = 'needs_info' and (p_needs_info_field is null or btrim(p_needs_info_field) = '') then
    raise exception 'VALIDATION: a flagged field is required to request more info';
  end if;
  if p_to_status = 'rejected' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'REASON_REQUIRED: a reason is required to reject an application';
  end if;

  update public.upa_applications
  set status = p_to_status,
      verified_at = case when p_to_status = 'verified' then now() else verified_at end,
      needs_info_field = case when p_to_status = 'needs_info' then btrim(p_needs_info_field)
                              when p_to_status = 'under_review' then null
                              else needs_info_field end,
      rejection_reason = case when p_to_status = 'rejected' then btrim(p_rejection_reason)
                              else rejection_reason end
  where id = p_application_id
  returning * into v_app;

  return v_app;
end;
$$;

revoke all on function public.upa_application_transition_internal(uuid, public.upa_status, text, text) from public;
revoke execute on function public.upa_application_transition_internal(uuid, public.upa_status, text, text) from anon, authenticated;
grant execute on function public.upa_application_transition_internal(uuid, public.upa_status, text, text) to service_role;

-- ============================================================================
-- submit_upa_application: the applicant creates their application + the linked
-- verification_requests row atomically, mirroring submit_coach_verification
-- (0004). applicant_user_id is forced to auth.uid() so no spoofing. The 0048
-- partial unique index caps one active application per user; a second submit
-- surfaces as ALREADY_APPLIED. Evidence rows are attached from the payload.
-- ============================================================================

create function public.submit_upa_application(p_payload jsonb)
returns public.upa_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.upa_applications;
  v_evidence jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_payload ->> 'storyHeadline' is null or p_payload ->> 'storyBody' is null
     or p_payload ->> 'sport' is null or p_payload ->> 'region' is null
     or p_payload ->> 'state' is null then
    raise exception 'VALIDATION: storyHeadline, storyBody, sport, region and state are required';
  end if;

  begin
    insert into public.upa_applications (
      applicant_user_id, story_headline, story_body, sport, region, state, photo_url, status
    )
    values (
      auth.uid(),
      p_payload ->> 'storyHeadline',
      p_payload ->> 'storyBody',
      (p_payload ->> 'sport')::public.sport,
      p_payload ->> 'region',
      p_payload ->> 'state',
      p_payload ->> 'photoUrl',
      'submitted'
    )
    returning * into v_app;
  exception when unique_violation then
    raise exception 'ALREADY_APPLIED: an active application already exists for this user';
  end;

  -- Attach evidence rows (certificate / id_proof / guardian_consent / video_link).
  for v_evidence in
    select * from jsonb_array_elements(coalesce(p_payload -> 'evidence', '[]'::jsonb))
  loop
    insert into public.upa_evidence (application_id, kind, storage_path, url)
    values (
      v_app.id,
      v_evidence ->> 'kind',
      v_evidence ->> 'storagePath',
      v_evidence ->> 'url'
    );
  end loop;

  -- The linked review queue item. applicant_id is the application id (SCHEMA.md).
  insert into public.verification_requests (applicant_type, applicant_id, status, payload)
  values ('upa', v_app.id, 'pending_review', p_payload);

  return v_app;
end;
$$;

revoke all on function public.submit_upa_application(jsonb) from public;
grant execute on function public.submit_upa_application(jsonb) to authenticated;

-- ============================================================================
-- resubmit_upa_application: the applicant answers a needs_info bounce. Owner
-- only, needs_info -> under_review, story fields updated, needs_info_field
-- cleared (by the internal transition). The single pending verification_request
-- stays open for the re-review.
-- ============================================================================

create function public.resubmit_upa_application(p_application_id uuid, p_payload jsonb)
returns public.upa_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.upa_applications;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_app from public.upa_applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'NOT_FOUND: upa_application % does not exist', p_application_id;
  end if;
  if v_app.applicant_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: not your application';
  end if;

  -- Update the story fields the applicant may revise, before the transition.
  update public.upa_applications
  set story_headline = coalesce(p_payload ->> 'storyHeadline', story_headline),
      story_body = coalesce(p_payload ->> 'storyBody', story_body),
      region = coalesce(p_payload ->> 'region', region),
      state = coalesce(p_payload ->> 'state', state),
      photo_url = coalesce(p_payload ->> 'photoUrl', photo_url)
  where id = p_application_id;

  -- needs_info -> under_review (raises INVALID_TRANSITION from any other state).
  v_app := public.upa_application_transition_internal(p_application_id, 'under_review');
  return v_app;
end;
$$;

revoke all on function public.resubmit_upa_application(uuid, jsonb) from public;
grant execute on function public.resubmit_upa_application(uuid, jsonb) to authenticated;

-- ============================================================================
-- reapply_upa_application: after a rejection, the applicant starts a NEW row
-- (never a resurrection). Blocked until reapply_after passes if the admin set a
-- cooldown on the rejected row (PRD-05 open question 2). The 0048 unique index
-- guarantees no active row already exists (else ALREADY_APPLIED).
-- ============================================================================

create function public.reapply_upa_application(p_payload jsonb)
returns public.upa_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.upa_applications;
  v_last public.upa_applications;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_last
  from public.upa_applications
  where applicant_user_id = auth.uid()
  order by created_at desc
  limit 1;

  if v_last.id is not null and v_last.status = 'rejected'
     and v_last.reapply_after is not null and v_last.reapply_after > current_date then
    raise exception 'COOLDOWN: you can reapply after %', v_last.reapply_after;
  end if;

  -- Reuse submit's create path (its unique-index guard yields ALREADY_APPLIED
  -- if an active row somehow exists).
  v_app := public.submit_upa_application(p_payload);
  return v_app;
end;
$$;

revoke all on function public.reapply_upa_application(jsonb) from public;
grant execute on function public.reapply_upa_application(jsonb) to authenticated;

-- ============================================================================
-- deactivate_upa_application: a verified UPA self-withdraws. Owner only,
-- verified -> deactivated (raises INVALID_TRANSITION otherwise). The public
-- browse policy (0049) filters status = 'verified', so a deactivated UPA
-- disappears from the consumer app without a delete.
-- ============================================================================

create function public.deactivate_upa_application(p_application_id uuid)
returns public.upa_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.upa_applications;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_app from public.upa_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'NOT_FOUND: upa_application % does not exist', p_application_id;
  end if;
  if v_app.applicant_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: not your application';
  end if;

  v_app := public.upa_application_transition_internal(p_application_id, 'deactivated');
  return v_app;
end;
$$;

revoke all on function public.deactivate_upa_application(uuid) from public;
grant execute on function public.deactivate_upa_application(uuid) to authenticated;

-- ============================================================================
-- admin_request_upa_info: the staff "needs more info" decision (PRD-05 FR-8).
-- admin/moderator only, submitted|under_review -> needs_info, records which
-- field was flagged, writes exactly one audit_log row, leaves the pending
-- verification_request open for the re-review. Same shape as moderate_clip.
-- ============================================================================

create function public.admin_request_upa_info(
  p_request_id uuid,
  p_needs_info_field text,
  p_note text default null
)
returns public.upa_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.verification_requests;
  v_before public.upa_applications;
  v_after public.upa_applications;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;
  if p_needs_info_field is null or btrim(p_needs_info_field) = '' then
    raise exception 'VALIDATION: a flagged field is required';
  end if;

  select * into v_request from public.verification_requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'NOT_FOUND: verification_request % does not exist', p_request_id;
  end if;
  if v_request.applicant_type <> 'upa' then
    raise exception 'VALIDATION: request % is not a upa applicant', p_request_id;
  end if;
  if v_request.status <> 'pending_review' then
    raise exception 'INVALID_TRANSITION: verification_request % is not pending_review', p_request_id;
  end if;

  select * into v_before from public.upa_applications where id = v_request.applicant_id;
  v_after := public.upa_application_transition_internal(v_request.applicant_id, 'needs_info', p_needs_info_field);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'verification.needs_info',
    'upa_application',
    v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'needs_info_field', v_after.needs_info_field),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return v_after;
end;
$$;

revoke all on function public.admin_request_upa_info(uuid, text, text) from public;
revoke execute on function public.admin_request_upa_info(uuid, text, text) from anon;
grant execute on function public.admin_request_upa_info(uuid, text, text) to authenticated, service_role;

-- ============================================================================
-- Extend the two admin verification RPCs for the 'upa' applicant_type, left as
-- no-ops in 0007/0009 until public.upa_applications existed. Coach and venue
-- branches are unchanged. Each writes exactly ONE audit_log row (the existing
-- body), so approving a UPA writes one audit row AND grants the upa role; the
-- INVALID_TRANSITION from the internal machine on an already-terminal
-- application propagates out and rolls the whole function back before that
-- audit insert (PHASE-6-STATUS.md gate clause 1).
-- ============================================================================

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
  elsif v_request.applicant_type = 'venue' then
    update public.venues set status = 'verified' where id = v_request.applicant_id;
  elsif v_request.applicant_type = 'upa' then
    -- submitted|under_review|needs_info -> verified (sets verified_at); an
    -- already-terminal application raises INVALID_TRANSITION and rolls back.
    perform public.upa_application_transition_internal(v_request.applicant_id, 'verified');
    -- Grant the upa role. It reaches the JWT on the applicant's next token
    -- refresh (RLS.md staleness note), which the Life portal forces on the
    -- realtime status flip.
    insert into public.user_roles (user_id, role)
    select applicant_user_id, 'upa'::public.app_role
    from public.upa_applications where id = v_request.applicant_id
    on conflict (user_id, role) do nothing;
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
  elsif v_request.applicant_type = 'venue' then
    update public.venues set status = 'rejected', rejection_reason = p_reason where id = v_request.applicant_id;
  elsif v_request.applicant_type = 'upa' then
    perform public.upa_application_transition_internal(v_request.applicant_id, 'rejected', null, p_reason);
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

  return v_request;
end;
$$;

revoke execute on function public.admin_approve_verification_request(uuid) from public, anon;
revoke execute on function public.admin_reject_verification_request(uuid, text) from public, anon;
grant execute on function public.admin_approve_verification_request(uuid) to authenticated, service_role;
grant execute on function public.admin_reject_verification_request(uuid, text) to authenticated, service_role;

-- ============================================================================
-- upa_wishlist_item_transition_internal: the low-level wishlist machine.
-- service_role ONLY. open -> funded -> delivered, strictly forward. Track B's
-- donate finalize handler calls open -> funded under the service role (in the
-- same transaction as the funded_amount write and the ledger credit);
-- mark_wishlist_item_delivered (below) calls funded -> delivered as the owning
-- UPA. An illegal edge (e.g. open -> delivered, or any move out of delivered)
-- raises INVALID_TRANSITION and writes zero rows.
-- ============================================================================

create function public.upa_wishlist_item_transition_internal(
  p_item_id uuid,
  p_to_status public.upa_wishlist_item_status
)
returns public.upa_wishlist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.upa_wishlist_items;
  v_allowed public.upa_wishlist_item_status[];
begin
  if p_item_id is null or p_to_status is null then
    raise exception 'VALIDATION: item id and target status are both required';
  end if;

  select * into v_item from public.upa_wishlist_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'NOT_FOUND: upa_wishlist_item % does not exist', p_item_id;
  end if;

  v_allowed := case v_item.status
    when 'open'      then array['funded']::public.upa_wishlist_item_status[]
    when 'funded'    then array['delivered']::public.upa_wishlist_item_status[]
    when 'delivered' then array[]::public.upa_wishlist_item_status[]
  end;

  if not (p_to_status = any (v_allowed)) then
    raise exception 'INVALID_TRANSITION: upa_wishlist_item % cannot move from % to %',
      p_item_id, v_item.status, p_to_status;
  end if;

  update public.upa_wishlist_items
  set status = p_to_status
  where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

revoke all on function public.upa_wishlist_item_transition_internal(uuid, public.upa_wishlist_item_status) from public;
revoke execute on function public.upa_wishlist_item_transition_internal(uuid, public.upa_wishlist_item_status) from anon, authenticated;
grant execute on function public.upa_wishlist_item_transition_internal(uuid, public.upa_wishlist_item_status) to service_role;

-- ============================================================================
-- mark_wishlist_item_delivered: the owning UPA marks a funded item fulfilled
-- (PRD-05 FR-14). Owner-gated, funded -> delivered via the internal machine, so
-- the status column stays non-client-writable (0049) while the UPA still has a
-- blessed path to advance it. INVALID_TRANSITION if the item is not funded.
-- ============================================================================

create function public.mark_wishlist_item_delivered(p_item_id uuid)
returns public.upa_wishlist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.upa_wishlist_items;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select i.* into v_item
  from public.upa_wishlist_items i
  join public.upa_applications a on a.id = i.upa_id
  where i.id = p_item_id and a.applicant_user_id = auth.uid();

  if v_item.id is null then
    raise exception 'FORBIDDEN: not your item or it does not exist';
  end if;

  v_item := public.upa_wishlist_item_transition_internal(p_item_id, 'delivered');
  return v_item;
end;
$$;

revoke all on function public.mark_wishlist_item_delivered(uuid) from public;
grant execute on function public.mark_wishlist_item_delivered(uuid) to authenticated;
