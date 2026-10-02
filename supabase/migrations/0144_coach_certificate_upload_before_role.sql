-- ATLITOS v2 — 0144_coach_certificate_upload_before_role.sql
--
-- Found on the device pass 2026-10-03: no new coach could upload a
-- certificate. The coach setup wizard uploads certificates on step 4, but
-- the `coach` role is only granted when the wizard is submitted (the coach
-- setup RPC, 0004), and 0006's insert policy on the `coach-certificates`
-- bucket required has_role('coach'). Submit in turn requires one uploaded
-- certificate, so the flow could never complete for anyone who was not
-- already a coach.
--
-- The insert policy now drops the role check and keeps the owner folder
-- check: any signed in user may write only under their own uid folder. The
-- bucket stays private; read remains owner or admin (0006), so an applicant's
-- files are visible to no one else. A stray upload by a user who never
-- submits is harmless, sits in their own folder, and is scrubbed with the
-- account on deletion like every other owner prefixed object.

drop policy if exists coach_certificates_bucket_owner_insert on storage.objects;

create policy coach_certificates_bucket_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'coach-certificates'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
