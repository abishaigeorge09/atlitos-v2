-- ATLITOS v2 — 0007_admin_verification_rpcs.sql
--
-- Renamed from 0004_admin_verification_rpcs.sql during the Phase 1
-- integration pass: it collided with 0004_player_and_coach_setup_rpc.sql's
-- version prefix, only the latter was ever pushed to the remote database,
-- so these two RPCs silently never existed remotely even though
-- apps/admin already called them. Re-applied directly via the Supabase MCP
-- under this new version number with the anon-execute grant closed inline
-- (the gap 0005_tighten_rpc_grants.sql already had to fix for the sibling
-- RPCs). See docs/phases/PHASE-1-STATUS.md.
-- Domain: moderation/audit RPCs consumed by apps/admin (PRD-04 FR-9, FR-10,
-- FR-11, FR-53; epic AT-10).
--
-- audit_log carries zero authenticated/anon write policy (see
-- 0003_moderation_audit.sql's audit_log_select_admin comment: "only
-- service_role INSERT... no INSERT/UPDATE/DELETE policy exists for
-- anon/authenticated at all", matching RLS.md). apps/admin runs on the
-- anon/authenticated Supabase client only (PRD-04 FR-2: no service role key
-- in client bundle), so an admin approving or rejecting a
-- verification_requests row cannot write audit_log with a direct client
-- update. These two SECURITY DEFINER RPCs are the only path: each re-checks
-- the caller holds admin/moderator via has_role() (the same check
-- verification_requests_update_admin already enforces at the RLS layer),
-- performs the verification_requests update plus the underlying entity
-- status update in one transaction, and appends exactly one audit_log row,
-- satisfying FR-53's "exactly one audit_log row per action".
--
-- venue/upa applicant_type branches are deliberately no-ops here: public.
-- venues and public.upa_applications do not exist yet as of this migration
-- (see PRD-04 section 9 open question 7, "reconciled once SCHEMA.md
-- lands"). Their entity-status mirroring is added alongside the courts/
-- empower domain migrations that create those tables; verification_requests
-- itself is still approved/rejected correctly for every applicant_type in
-- the meantime.
--
-- Applicant notification on reject (FR-10, "the reason is delivered to the
-- applicant via notification") is out of scope for this migration: the
-- notification dispatch pipeline (notify-dispatch edge function,
-- SCHEMA.md "Domain: notifications") is not built yet. audit_log still
-- records the reason so it is not lost.

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
  -- 'venue' / 'upa': no-op until public.venues / public.upa_applications exist, see header note.

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
  end if;
  -- 'venue' / 'upa': no-op until public.venues / public.upa_applications exist, see header note.

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

revoke execute on function public.admin_approve_verification_request(uuid) from public;
revoke execute on function public.admin_reject_verification_request(uuid, text) from public;
revoke execute on function public.admin_approve_verification_request(uuid) from anon;
revoke execute on function public.admin_reject_verification_request(uuid, text) from anon;
grant execute on function public.admin_approve_verification_request(uuid) to authenticated;
grant execute on function public.admin_reject_verification_request(uuid, text) to authenticated;
