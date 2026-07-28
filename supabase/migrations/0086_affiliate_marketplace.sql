-- ATLITOS v2 — 0086_affiliate_marketplace.sql
-- Domain: commerce (PRD-07 shopper). Phase 9 WS4: the affiliate marketplace pivot.
--
-- The v1 shop is an OWNED-inventory shop: Atlitos is the seller of record, holds
-- stock, and fulfils delivery (products/product_variants/orders, 0031). WS4 adds
-- a SECOND, additive product model alongside it, it does not replace it: an
-- external catalog of gear sourced from retailers (Amazon, Tennis Hub, and
-- others), where Atlitos earns affiliate commission on a click-out rather than
-- selling the item itself. The two coexist behind a product `source`: owned
-- products keep their cart/checkout/delivery path untouched; affiliate products
-- are browse + compare-prices + click-out only, with no cart, no stock, and no
-- in-app payment. See docs/prd/PRD-07-shopper.md section 10 (Affiliate model).
--
-- Two tables:
--   affiliate_products — one row per external product (the canonical item), with
--     the brand / skill_level / age_range attributes WS3 AI search needs to
--     answer precise brand+price queries ("Babolat under 2000").
--   product_offers     — one row per retailer offer on that product, carrying
--     the retailer's price + affiliate_url. A product with three offers is the
--     same racket sold on three sites at three prices; the compare view lists
--     them cheapest-first and the click-out opens the chosen affiliate_url.
--
-- The FK is named `affiliate_product_id`, not `product_id`, deliberately: the
-- owned catalog already owns `products`, and an unqualified `product_id` next to
-- it would read ambiguously. It points only at `affiliate_products`.
--
-- RLS (CLAUDE.md: "RLS is a floor, not scoping"). Both tables are PUBLIC BROWSE
-- reference content, the same class as `promo_banners` and `categories`: no
-- per-user rows, so there is no owner to scope by. Reads are gated on `active`
-- (products) and are otherwise open to anon + authenticated. Prices and offers
-- are INGESTED (a future price-refresh worker, or an admin), never user-set:
-- there is no client write policy on either table, exactly like promo_banners.
-- A client that could write `product_offers.price` could rewrite the price it is
-- about to be shown, and the "cheapest retailer" claim would be untrustworthy.

-- ---------------------------------------------------------------------------
-- affiliate_products: the external product (canonical attributes)
-- ---------------------------------------------------------------------------
create table public.affiliate_products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Brand as a first-class column (not buried in the title), because WS3 AI
  -- search treats brand as a HARD constraint: "Babolat under 2000" must match on
  -- brand, not on a substring of a description. Nullable for unbranded gear.
  brand text,
  sport sport,
  category_id uuid references public.categories(id),
  -- skill_level / age_range are free text, mirroring `athlete_sports.skill_level`
  -- (a text column, not the `drill_difficulty` enum), so a retailer feed's own
  -- vocabulary ("beginner", "10 to 14 years", "adult") maps in without a schema
  -- change per new source. WS3 reads both to refine intent.
  skill_level text,
  age_range text,
  description text,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.affiliate_products is
  'External (affiliate) product catalog. One row per canonical item sourced from a retailer feed. Priced per-retailer via product_offers, not here. Public browse, no client writes (ingested).';

create index idx_affiliate_products_sport on public.affiliate_products (sport);
-- The brand+price index WS3 leans on: a lowercased brand match is the hot path
-- for "Babolat ..." style queries.
create index idx_affiliate_products_brand_lower on public.affiliate_products (lower(brand));
create index idx_affiliate_products_active on public.affiliate_products (active);

create trigger affiliate_products_set_updated_at
  before update on public.affiliate_products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- product_offers: one retailer offer per row (the price-comparison rows)
-- ---------------------------------------------------------------------------
create table public.product_offers (
  id uuid primary key default gen_random_uuid(),
  affiliate_product_id uuid not null references public.affiliate_products(id) on delete cascade,
  -- The retailer / source the offer is on ("Amazon", "Tennis Hub", "Decathlon").
  retailer text not null,
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'INR',
  -- The commission-bearing outbound link. Opening this is the monetised action:
  -- the shopper leaves to the retailer, Atlitos is credited the affiliate
  -- commission, and the purchase completes on the retailer's own site.
  affiliate_url text not null,
  in_stock boolean not null default true,
  -- When the ingest worker last re-checked this offer's price/stock. Surfaced as
  -- a freshness hint ("checked N ago") and used by a future refresh sweep.
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_offers is
  'One retailer offer (price + affiliate_url) per row on an affiliate_products item. The price-comparison view lists these cheapest-first. Public browse, no client writes: prices are ingested, not user-set.';

-- One offer per retailer per product: a product cannot list two conflicting
-- Amazon prices at once. A refresh updates the existing row in place.
create unique index uq_product_offers_product_retailer
  on public.product_offers (affiliate_product_id, retailer);
create index idx_product_offers_product on public.product_offers (affiliate_product_id);
-- The compare view's cheapest-in-stock read.
create index idx_product_offers_product_price on public.product_offers (affiliate_product_id, price)
  where in_stock;

create trigger product_offers_set_updated_at
  before update on public.product_offers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: public browse, service-role-only writes (promo_banners pattern, 0071)
-- ---------------------------------------------------------------------------
alter table public.affiliate_products enable row level security;
alter table public.product_offers enable row level security;

-- affiliate_products: browse only the active catalog. Same public-reference
-- shape as promo_banners; no owner column, so nothing to owner-scope.
create policy affiliate_products_select_public on public.affiliate_products
  for select to anon, authenticated
  using (active = true);

-- product_offers: an offer is readable when its product is browsable. The
-- policy re-derives the product's `active` itself rather than trusting a join,
-- so a delisted product's offers never leak.
create policy product_offers_select_public on public.product_offers
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.affiliate_products ap
      where ap.id = product_offers.affiliate_product_id
        and ap.active = true
    )
  );

-- No insert/update/delete policy on either table: DML is denied for anon and
-- authenticated by RLS default-deny. Writes are service-role only (an ingest
-- worker or Studio) until a formal price-refresh pipeline lands.
revoke all on public.affiliate_products from anon, authenticated;
revoke all on public.product_offers from anon, authenticated;
grant select on public.affiliate_products to anon, authenticated;
grant select on public.product_offers to anon, authenticated;
