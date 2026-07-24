-- ATLITOS v2 — 0071_promo_banners.sql
-- Domain: home (PRD-01 athlete). Backs the Home tab's promo carousel section
-- (PRD-01 3.2), rebuilt in Track B of this phase.
--
-- Reference content, no per-user data: same class as `categories` (0031/0032)
-- and `drills`/`roadmap_stages` per RLS.md's guest read surface, so the
-- browse policy is a plain public select gated only by `active`. Consumed by
-- packages/api/src/use-home.ts `listPromoBanners`, which resolves
-- `image_path` through the public `product-media` bucket's `getPublicUrl`
-- (the same bucket and resolver pattern use-shop.ts's `resolveMediaUrls`
-- already uses, rather than provisioning a second public bucket for a
-- handful of banner images).
--
-- Admin write access (creating/editing banners) is out of scope for this
-- phase, ships later alongside PRD-04's admin catalog CRUD. There is
-- deliberately no client write policy here, not even an admin one yet: writes
-- land via the service role (Studio / a future admin RPC) until that phase.
create table public.promo_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  cta_label text,
  cta_route text,
  image_path text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.promo_banners enable row level security;

create policy promo_banners_select_public on public.promo_banners
  for select to anon, authenticated
  using (active = true);

-- No insert/update/delete policy: every DML statement is denied for anon and
-- authenticated regardless of role, per RLS default-deny. Writes are service
-- role only until an admin CRUD surface lands.
revoke all on public.promo_banners from anon, authenticated;
grant select on public.promo_banners to anon, authenticated;
