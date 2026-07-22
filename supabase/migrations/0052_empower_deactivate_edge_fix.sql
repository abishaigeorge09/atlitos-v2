-- ATLITOS v2 — 0052_empower_deactivate_edge_fix.sql
-- Domain: empower. Epic AT-8, story AT-110 (correction).
--
-- AT-110 / PRD-05 FR-27 scope deactivate as withdrawing a PENDING application
-- ("only while submitted or under_review"), NOT a verified self-withdraw. 0050
-- placed the `deactivated` edge on `verified`; this corrects the machine so a
-- pending applicant can withdraw and a verified UPA cannot deactivate (verified
-- becomes terminal in the applicant machine; a verified UPA that wants off the
-- platform is an out-of-P6 admin action). `deactivated` stays terminal and, as
-- a non-verified status, stays filtered out of the public browse (0049).
--
-- Corrected machine:
--   submitted    -> under_review | needs_info | verified | rejected | deactivated
--   under_review -> needs_info | verified | rejected | deactivated
--   needs_info   -> under_review | verified | rejected
--   verified     -> (terminal)
--   rejected     -> (terminal)
--   deactivated  -> (terminal)

create or replace function public.upa_application_transition_internal(
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
    when 'submitted'    then array['under_review','needs_info','verified','rejected','deactivated']::public.upa_status[]
    when 'under_review' then array['needs_info','verified','rejected','deactivated']::public.upa_status[]
    when 'needs_info'   then array['under_review','verified','rejected']::public.upa_status[]
    when 'verified'     then array[]::public.upa_status[]
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
