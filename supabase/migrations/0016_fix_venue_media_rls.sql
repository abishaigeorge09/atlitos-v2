-- ATLITOS v2 — 0016_fix_venue_media_rls.sql
-- Domain: courts (fixes 0014_venue_media_bucket.sql). Epic AT-4.
--
-- Bug: 0014's partner insert/update/delete policies wrote
-- `(storage.foldername(name))[1]` inside `exists (select 1 from
-- public.venues v where ...)`. In that scope the unqualified `name`
-- resolves to `v.name` (the venue's display name), not
-- `storage.objects.name` (the object path), so the ownership check
-- compared a venue uuid to the folder segment of a human-readable venue
-- name. It never matched: every partner photo upload to `venue-media` was
-- denied by RLS. Surfaced 2026-07-15 by scripts/seed-onboarding-demo.mjs,
-- the first thing to exercise the real upload path end to end (PRD-03
-- FR-3).
--
-- Fix: identical policies with the object path qualified as
-- `objects.name`. Public read policy from 0014 is correct and untouched.

drop policy if exists venue_media_partner_insert on storage.objects;
drop policy if exists venue_media_partner_update on storage.objects;
drop policy if exists venue_media_partner_delete on storage.objects;

create policy venue_media_partner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'venue-media'
    and public.has_role('court_partner')
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(objects.name))[1]
        and v.partner_user_id = auth.uid()
    )
  );

create policy venue_media_partner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'venue-media'
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(objects.name))[1]
        and v.partner_user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'venue-media'
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(objects.name))[1]
        and v.partner_user_id = auth.uid()
    )
  );

create policy venue_media_partner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'venue-media'
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(objects.name))[1]
        and v.partner_user_id = auth.uid()
    )
  );
