-- ATLITOS v2 — 0006_storage_buckets.sql
-- Creates the two Storage buckets Phase 1 mobile onboarding needs
-- (RLS.md "Storage" table): `avatars` (public read, owner-only write, path
-- {owner_id}/...) and `coach-certificates` (owner + admin read only, never
-- public, owner-only insert, path {coach_id}/...). Every other bucket in
-- RLS.md's Storage table (venue-photos, upa-evidence, clutch-video,
-- product-media, upa-photos, gratitude-photos) belongs to a later domain
-- migration, not Phase 1 auth/onboarding.

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('coach-certificates', 'coach-certificates', false)
on conflict (id) do nothing;

-- avatars: public read; owner-only write, path prefix {owner_id}/...
create policy avatars_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

create policy avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- coach-certificates: owner + admin read only, never public; owner-only
-- insert, path prefix {coach_id}/...
create policy coach_certificates_bucket_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'coach-certificates'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role('admin'))
  );

create policy coach_certificates_bucket_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'coach-certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_role('coach')
  );

create policy coach_certificates_bucket_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'coach-certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
