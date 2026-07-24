-- ATLITOS v2 — 0070_product_media_bucket.sql
-- Domain: shop (PRD-07 shopper / PRD-04 admin catalog). Epic AT-8 (Shop).
-- Consumed by packages/api/src/use-shop.ts resolveMediaUrls, which resolves
-- product_media.storage_path through getPublicUrl of the `product-media`
-- bucket, and by the Home Shop rail and category browse grid that render it.
--
-- The bucket was referenced by use-shop.ts from P4 ("provisioned alongside
-- PRD-04's admin catalog CRUD, AT-81") but AT-81's storage provisioning never
-- landed, so every product rendered the token-driven placeholder and
-- product_media stayed empty. This creates the bucket so seeded and
-- admin-uploaded product photos have somewhere to live.
--
-- Shape mirrors `venue-media` (0014): public read (gear photos render
-- unauthenticated in the guest-browsable shop, the same accepted "public
-- bucket" pattern as avatars/venue-media), admin-scoped write (the catalog is
-- admin-managed, there is no per-shopper ownership of a product image). Path
-- convention is `{product_id}/{filename}`.
insert into storage.buckets (id, name, public)
values ('product-media', 'product-media', true)
on conflict (id) do nothing;

create policy product_media_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-media');

create policy product_media_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-media' and public.has_role('admin'));

create policy product_media_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-media' and public.has_role('admin'))
  with check (bucket_id = 'product-media' and public.has_role('admin'));

create policy product_media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-media' and public.has_role('admin'));
