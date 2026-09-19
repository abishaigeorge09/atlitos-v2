-- ATLITOS v2 — XXXX_product_images_bucket.sql
-- Domain: shop search, ingest (PRD-07 FR-46). Phase S2, Track C.
--
-- The `product-images` bucket holds Atlitos's OWN copy of a retailer's
-- product image, copied by gear-ingest's save action (never on fetch, FR-44)
-- so a listing survives the retailer changing or removing the original.
-- Path convention: `product-images/<retailer_key>/<sha256-16>.<ext>`
-- (ADR-011 D3), hash-deduped so the same image copied twice for two offers
-- of the same product is stored once.
--
-- Shape follows `product-media` (0070) and `venue-media` (0014): public read
-- (product photos render unauthenticated in the guest-browsable shop). Write
-- differs deliberately from `product-media`'s admin-scoped insert/update/
-- delete: nobody but the service role ever writes here. gear-ingest's image
-- copy runs under the service role even when the caller is an admin (ADR-011
-- D3: "Service role in gear-ingest is used only for the outbound retailer
-- fetch and the Storage write, never the catalogue DB write"), so there is no
-- admin-JWT write path to grant. The service role bypasses RLS by
-- construction; no insert/update/delete policy is added for anon or
-- authenticated, which is the default-deny floor.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy product_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

-- No insert/update/delete policy for anon or authenticated: RLS default-deny
-- refuses both, and the service role (the only writer) bypasses RLS
-- entirely, so it needs no policy of its own here.
