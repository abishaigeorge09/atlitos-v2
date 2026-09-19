-- ATLITOS v2 — 0123_gear_ingest_health.sql
-- Domain: shop search, ingest and health (PRD-07 section 11, FR-44 to FR-52).
-- Phase S2, Track C. See docs/architecture/ADR-011-shop-search-ingest-health.md
-- D3 (ingest), D4 (health), D6 (RLS), D7 (this file's slot in the numbering
-- table). Extends 0086 (affiliate_products/product_offers) and 0120 (the
-- admin upsert RPCs) rather than replacing either.
--
-- New tables: `retailer_programmes` (operational config, admin-read only,
-- deliberately NOT public-browse like affiliate_products), `product_fetch_log`
-- (the health sweep's own record, admin-read only). New columns on
-- affiliate_products and product_offers per the ADR's data model deltas.
-- `admin_upsert_affiliate_product` and `admin_upsert_product_offer` gain
-- trailing, defaulted, backward-compatible parameters (dropped and recreated
-- under the same name so a call with the ORIGINAL argument count still
-- resolves to this one function via default-fill, per ADR-011 D3: "existing
-- call sites unchanged"). `system_auto_delist_affiliate_product` is the one
-- new RPC, service_role only, the 7-strike auto-delist door (D4, AC-11-4).

-- ---------------------------------------------------------------------------
-- retailer_programmes: which retailers gear-ingest/gear-recheck know how to
-- read, and how. Seeded with Amazon India, Flipkart, Decathlon India, tag
-- templates EMPTY per open question 11 (no affiliate programme approved yet):
-- offers store the bare canonical URL until a founder supplies real tags.
-- Admin-read only, deliberately NOT public-browse: this is operational
-- config, not shopper-facing content (ADR-011 D6).
-- ---------------------------------------------------------------------------
create table public.retailer_programmes (
  key text primary key,
  display_name text not null,
  url_patterns text[] not null default '{}',
  -- Empty until a real affiliate programme is approved (open question 11).
  -- gear-ingest/gear-recheck must treat a null template as "use the bare
  -- canonical URL", never fabricate a tag.
  affiliate_tag_template text,
  -- RetailerExtractorMap (see supabase/functions/_shared/extract-product.ts):
  -- a small map of field name to a CSS-selector-like string, the LAST resort
  -- extraction strategy after JSON-LD and Open Graph both miss. Null for a
  -- retailer whose pages are read entirely by the first two strategies.
  extractor jsonb,
  -- Rate limit the nightly sweep respects per retailer (ADR-011 D4).
  fetch_policy jsonb not null default '{"maxPerMinute": 10}'::jsonb,
  active boolean not null default true
);

comment on table public.retailer_programmes is
  'Retailer ingest/health config: which hosts are supported, their affiliate tag template (empty until approved), extraction selectors, and per-retailer fetch rate limit. Admin-read only, no client writes, no upsert RPC yet (service role / seed migration). See ADR-011 D3, D4, D6.';

alter table public.retailer_programmes enable row level security;

create policy retailer_programmes_select_admin on public.retailer_programmes
  for select to authenticated
  using (public.has_role('admin'));

revoke all on public.retailer_programmes from anon, authenticated;
grant select on public.retailer_programmes to authenticated;
grant all on public.retailer_programmes to service_role;

insert into public.retailer_programmes (key, display_name, url_patterns, affiliate_tag_template, extractor, fetch_policy, active)
values
  ('amazon_in', 'Amazon India', array['amazon.in'], null, null, '{"maxPerMinute": 10}'::jsonb, true),
  ('flipkart', 'Flipkart', array['flipkart.com'], null, null, '{"maxPerMinute": 10}'::jsonb, true),
  ('decathlon_in', 'Decathlon India', array['decathlon.in'], null, null, '{"maxPerMinute": 10}'::jsonb, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- affiliate_products, product_offers: new columns per ADR-011's data model
-- deltas. `embedding` (Phase S1) stays the only column excluded from the
-- client select grant; every column added here is public-safe the same way
-- title/brand/image_url already are (ADR-011 "Data model deltas": public
-- (active) minus embedding; admin all), so the column-level grant below
-- widens to include them rather than staying narrower than necessary.
-- ---------------------------------------------------------------------------
alter table public.affiliate_products
  add column source_image_url text,
  add column image_path text,
  add column health_status text,
  add column health_checked_at timestamptz,
  add column auto_delisted_at timestamptz;

comment on column public.affiliate_products.source_image_url is
  'The retailer''s own image URL, kept for re-fetch when the copy needs refreshing. Never rendered directly; image_url (via image_path) is what the app shows.';
comment on column public.affiliate_products.image_path is
  'Storage path of our own copy of the product image under the product-images bucket, product-images/<retailer_key>/<sha256-16>.<ext>. Written only by gear-ingest''s save action under the service role.';
comment on column public.affiliate_products.health_status is
  'Free-text summary the Catalog health page (FR-49) derives and displays (e.g. ok, attention, delisted). Written by gear-recheck under the service role; no CHECK constraint here so the health sweep''s own vocabulary is not locked into a schema change per new state.';
comment on column public.affiliate_products.health_checked_at is
  'When gear-recheck last evaluated this product''s overall health (distinct from a single offer''s last_checked_at).';
comment on column public.affiliate_products.auto_delisted_at is
  'Set by system_auto_delist_affiliate_product when every offer on this product has been gone/blocked for 7 consecutive nightly checks (FR-51, AC-11-4). Null for a product that was never auto-delisted, including one an admin delisted by hand (that stays on admin_set_affiliate_product_active''s own audit trail instead).';

alter table public.product_offers
  add column canonical_url text,
  add column retailer_key text references public.retailer_programmes(key) on delete set null,
  add column last_check_outcome text check (last_check_outcome in ('ok', 'price_changed', 'out_of_stock', 'gone', 'blocked')),
  add column consecutive_failures int not null default 0,
  add column last_price_change_at timestamptz;

comment on column public.product_offers.canonical_url is
  'The retailer''s canonical product URL (from JSON-LD/OG or <link rel=canonical>), distinct from affiliate_url which carries the (currently empty) affiliate tag. gear-ingest matches on this to decide create vs. update (FR-45).';
comment on column public.product_offers.retailer_key is
  'Which retailer_programmes row produced this offer. Null for a manually entered offer with no matching programme.';
comment on column public.product_offers.last_check_outcome is
  'The most recent gear-recheck outcome for this offer. Only gone/blocked increment consecutive_failures (ADR-011 D4): an out-of-stock page is a successful fetch, not a failure.';
comment on column public.product_offers.consecutive_failures is
  'Consecutive gone/blocked outcomes. Reset to 0 by any other outcome. 7 across every offer on a product triggers system_auto_delist_affiliate_product (AC-11-4, tested at 6 then one more check).';
comment on column public.product_offers.last_price_change_at is
  'When gear-recheck last observed a real price change on this offer (outcome = price_changed), for the health page''s freshness display.';

create index idx_product_offers_retailer_key on public.product_offers (retailer_key) where retailer_key is not null;

-- Column-level grant on affiliate_products (D6, AC-11-6/7): re-asserted here
-- rather than trusting the Phase S1 grant to already cover new columns,
-- because a column-level grant lists columns explicitly and does not
-- automatically pick up a later ALTER TABLE ADD COLUMN. `embedding` is the
-- only column deliberately left out.
revoke select on public.affiliate_products from anon, authenticated;
grant select (
  id, title, brand, sport, category_id, skill_level, age_range,
  description, image_url, active, created_at, updated_at,
  source_image_url, image_path, health_status, health_checked_at, auto_delisted_at
) on public.affiliate_products to anon, authenticated;

-- ---------------------------------------------------------------------------
-- product_fetch_log: one row per gear-recheck attempt on one offer. The
-- health page's per-offer history and FR-52's AI suggestion both live here.
-- Admin-read only (D6): this is an operational log, not shopper content.
-- Written only by gear-recheck under the service role.
-- ---------------------------------------------------------------------------
create table public.product_fetch_log (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.product_offers(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  outcome text not null check (outcome in ('ok', 'price_changed', 'out_of_stock', 'gone', 'blocked', 'unparsed')),
  http_status int,
  price_seen numeric(12, 2),
  in_stock_seen boolean,
  notes text,
  -- FR-52: Claude's read of a 200 that no extraction strategy could parse.
  -- Never applied automatically; the health page shows it as a suggestion.
  ai_suggestion jsonb
);

comment on table public.product_fetch_log is
  'One row per gear-recheck attempt on one offer: outcome, the HTTP status seen, price/stock observed, and (on an unparsed 200) an AI suggestion for an admin to review. Admin-read only, service-role write only. See ADR-011 D4.';

create index idx_product_fetch_log_offer_fetched_at on public.product_fetch_log (offer_id, fetched_at desc);

alter table public.product_fetch_log enable row level security;

create policy product_fetch_log_select_admin on public.product_fetch_log
  for select to authenticated
  using (public.has_role('admin'));

revoke all on public.product_fetch_log from anon, authenticated;
grant select on public.product_fetch_log to authenticated;
grant all on public.product_fetch_log to service_role;

-- ---------------------------------------------------------------------------
-- admin_upsert_affiliate_product: extended with two trailing, defaulted
-- params (p_image_path, p_source_image_url). Dropped and recreated under the
-- SAME name so a caller passing only the original 9 arguments still resolves
-- to this one function (defaults fill the rest), rather than silently
-- picking up a second, divergent overload.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text);

create or replace function public.admin_upsert_affiliate_product(
  p_id uuid,
  p_title text,
  p_brand text,
  p_sport public.sport,
  p_category_id uuid,
  p_skill_level text,
  p_age_range text,
  p_description text,
  p_image_url text,
  p_image_path text default null,
  p_source_image_url text default null
)
returns public.affiliate_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.affiliate_products;
  v_after public.affiliate_products;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'VALIDATION: a product title is required';
  end if;
  if p_category_id is not null and not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'VALIDATION: unknown category';
  end if;

  if p_id is null then
    insert into public.affiliate_products
      (title, brand, sport, category_id, skill_level, age_range, description, image_url, image_path, source_image_url)
    values (
      btrim(p_title),
      nullif(btrim(coalesce(p_brand, '')), ''),
      p_sport,
      p_category_id,
      nullif(btrim(coalesce(p_skill_level, '')), ''),
      nullif(btrim(coalesce(p_age_range, '')), ''),
      nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_image_url, '')), ''),
      nullif(btrim(coalesce(p_image_path, '')), ''),
      nullif(btrim(coalesce(p_source_image_url, '')), '')
    )
    returning * into v_after;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    values (auth.uid(), 'affiliate_product.create', 'affiliate_product', v_after.id, null, to_jsonb(v_after));
    return v_after;
  end if;

  select * into v_before from public.affiliate_products where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: product % does not exist', p_id;
  end if;

  update public.affiliate_products
  set title = btrim(p_title),
      brand = nullif(btrim(coalesce(p_brand, '')), ''),
      sport = p_sport,
      category_id = p_category_id,
      skill_level = nullif(btrim(coalesce(p_skill_level, '')), ''),
      age_range = nullif(btrim(coalesce(p_age_range, '')), ''),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      image_url = nullif(btrim(coalesce(p_image_url, '')), ''),
      image_path = coalesce(nullif(btrim(coalesce(p_image_path, '')), ''), image_path),
      source_image_url = coalesce(nullif(btrim(coalesce(p_source_image_url, '')), ''), source_image_url)
  where id = p_id
  returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'affiliate_product.update', 'affiliate_product', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end;
$$;

comment on function public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text, text, text) is
  'Create or edit one gear item. Extended (Phase S2, ADR-011 D3) with trailing p_image_path/p_source_image_url; manual entry never passes them, gear-ingest''s save action always does. On update, a null/blank image_path or source_image_url leaves the existing value in place rather than clearing it, so manual edits to other fields never orphan an ingested image.';

revoke all on function public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text, text, text) from public;
revoke execute on function public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text, text, text) from anon;
grant execute on function public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_upsert_product_offer: extended with two trailing, defaulted params
-- (p_canonical_url, p_retailer_key). Same drop-and-recreate reasoning.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text);

create or replace function public.admin_upsert_product_offer(
  p_affiliate_product_id uuid,
  p_retailer text,
  p_price numeric,
  p_affiliate_url text,
  p_in_stock boolean default true,
  p_currency text default 'INR',
  p_canonical_url text default null,
  p_retailer_key text default null
)
returns public.product_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.product_offers;
  v_after public.product_offers;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if not exists (select 1 from public.affiliate_products where id = p_affiliate_product_id) then
    raise exception 'NOT_FOUND: product % does not exist', p_affiliate_product_id;
  end if;
  if p_retailer is null or btrim(p_retailer) = '' then
    raise exception 'VALIDATION: a retailer name is required';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'VALIDATION: price must be zero or more';
  end if;
  if p_affiliate_url is null or btrim(p_affiliate_url) !~ '^https?://' then
    raise exception 'VALIDATION: the affiliate link must start with http:// or https://';
  end if;
  if p_retailer_key is not null and btrim(p_retailer_key) <> ''
     and not exists (select 1 from public.retailer_programmes where key = btrim(p_retailer_key)) then
    raise exception 'VALIDATION: unknown retailer programme %', p_retailer_key;
  end if;

  select * into v_before
  from public.product_offers
  where affiliate_product_id = p_affiliate_product_id and retailer = btrim(p_retailer)
  for update;

  insert into public.product_offers
    (affiliate_product_id, retailer, price, currency, affiliate_url, in_stock, last_checked_at, canonical_url, retailer_key)
  values
    (p_affiliate_product_id, btrim(p_retailer), p_price, coalesce(nullif(btrim(p_currency), ''), 'INR'),
     btrim(p_affiliate_url), coalesce(p_in_stock, true), now(),
     nullif(btrim(coalesce(p_canonical_url, '')), ''), nullif(btrim(coalesce(p_retailer_key, '')), ''))
  on conflict (affiliate_product_id, retailer) do update
    set price = excluded.price,
        currency = excluded.currency,
        affiliate_url = excluded.affiliate_url,
        in_stock = excluded.in_stock,
        last_checked_at = now(),
        canonical_url = coalesce(excluded.canonical_url, product_offers.canonical_url),
        retailer_key = coalesce(excluded.retailer_key, product_offers.retailer_key)
  returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    case when v_before.id is null then 'product_offer.create' else 'product_offer.update' end,
    'product_offer', v_after.id,
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after)
  );
  return v_after;
end;
$$;

comment on function public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text, text, text) is
  'One retailer price + link on a gear item. Extended (Phase S2, ADR-011 D3) with trailing p_canonical_url/p_retailer_key; manual entry never passes them. A re-upsert with a null trailing value keeps the existing canonical_url/retailer_key rather than clearing it.';

revoke all on function public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text, text, text) from public;
revoke execute on function public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text, text, text) from anon;
grant execute on function public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- system_auto_delist_affiliate_product: the 7-strike door (FR-51, AC-11-4).
-- service_role only: gear-recheck calls this itself, no admin JWT path,
-- because there is no human decision here, only the counter's own state.
-- actor_id is HARD-CODED null (not auth.uid(), which would be null anyway
-- under a service-role call with no user JWT, but explicit is the point):
-- the standing invariant in security-invariants.sh checks that every
-- audit_log row whose action starts with affiliate_product.auto has
-- actor_id is null, and this is the only place that action is written.
-- ---------------------------------------------------------------------------
create or replace function public.system_auto_delist_affiliate_product(p_id uuid, p_reason text)
returns public.affiliate_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.affiliate_products;
  v_after public.affiliate_products;
begin
  select * into v_before from public.affiliate_products where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: product % does not exist', p_id;
  end if;

  update public.affiliate_products
  set active = false,
      auto_delisted_at = now()
  where id = p_id
  returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    null, 'affiliate_product.auto_delist', 'affiliate_product', p_id,
    jsonb_build_object('active', v_before.active),
    jsonb_build_object('active', v_after.active, 'auto_delisted_at', v_after.auto_delisted_at),
    p_reason
  );

  return v_after;
end;
$$;

comment on function public.system_auto_delist_affiliate_product(uuid, text) is
  'Delists a product whose every offer has been gone/blocked for 7 consecutive nightly checks (FR-51, AC-11-4). service_role only: gear-recheck is the only caller. actor_id is always null on the audit_log row, checked by the standing auto-delist-actor-null invariant. Never deletes anything.';

revoke all on function public.system_auto_delist_affiliate_product(uuid, text) from public;
revoke execute on function public.system_auto_delist_affiliate_product(uuid, text) from anon, authenticated;
grant execute on function public.system_auto_delist_affiliate_product(uuid, text) to service_role;
