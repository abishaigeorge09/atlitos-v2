-- ATLITOS v2 — 0014_venue_media_bucket.sql
-- Domain: courts (extends 0009_courts.sql). Epic AT-4 (Courts and Partner
-- Portal). Consumed by apps/portal-court's Venues page (PRD-03 FR-3: "a
-- partner can upload a minimum of 3 and maximum of 12 venue photos ...
-- stored in Supabase Storage").
--
-- Creates the `venue-media` bucket RLS.md's Storage table names for the
-- courts domain (0006_storage_buckets.sql only shipped `avatars` and
-- `coach-certificates`, Phase 1's own scope; every other bucket in that
-- table, including this one, is explicitly deferred to its owning domain
-- migration).
--
-- Shape mirrors `avatars` (0006): public read (venue photos render
-- unauthenticated in the consumer app's court listing, same "public bucket,
-- accepted risk" pattern already accepted for avatars per
-- PHASE-1-STATUS.md's Known debt), owner-scoped write. Path convention is
-- `{venue_id}/{filename}`, not `{owner_id}/...` like avatars, because
-- ownership here is indirect (a venue belongs to a partner_user_id, not the
-- uploading user directly) and `venue_photos.venue_id` is what every read
-- path already keys off; the insert/update/delete policies below resolve
-- ownership with an EXISTS against `public.venues`, the same join shape
-- `venue_photos_insert_own` (0009_courts.sql) already uses at the table
-- level, just re-expressed against `storage.foldername(name)[1]`.
insert into storage.buckets (id, name, public)
values ('venue-media', 'venue-media', true)
on conflict (id) do nothing;

create policy venue_media_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'venue-media');

create policy venue_media_partner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'venue-media'
    and public.has_role('court_partner')
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(name))[1]
        and v.partner_user_id = auth.uid()
    )
  );

create policy venue_media_partner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'venue-media'
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(name))[1]
        and v.partner_user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'venue-media'
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(name))[1]
        and v.partner_user_id = auth.uid()
    )
  );

create policy venue_media_partner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'venue-media'
    and exists (
      select 1 from public.venues v
      where v.id::text = (storage.foldername(name))[1]
        and v.partner_user_id = auth.uid()
    )
  );
