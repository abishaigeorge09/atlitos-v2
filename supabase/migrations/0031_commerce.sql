-- ATLITOS v2 — 0031_commerce.sql
-- Domain: commerce. Epic P4, story AT-65.
-- Requirements: PRD-07 FR-1, FR-4, FR-8, FR-25, FR-27.
--
-- The commerce domain tables, exactly as docs/architecture/SCHEMA.md's
-- "Domain: commerce" section specifies them. SCHEMA.md is the column-name
-- source of truth per CLAUDE.md; nothing here renames or widens a column it
-- already fixes. RLS is enabled on every table in this file and NO policy is
-- created here: policies ship in 0032_commerce_rls.sql (AT-66). Until that
-- migration runs, every table below returns zero rows to anon and
-- authenticated, which is the correct fail-closed order to land these in.
--
-- ============================================================================
-- D1 FROM PHASE-4-STATUS.md, RECORDED HERE BECAUSE IT SHAPES orders' COLUMNS
--
-- Commerce is the THIRD pricing shape in this system and it is additive with
-- no seller split:
--
--   courts   additive:   subtotal + GST + PLATFORM FEE
--   sessions carve-out:  the platform fee comes OUT of the coach's price and
--                        no fee row is shown at all
--   commerce additive:   subtotal + delivery + GST + optional donation roundup
--                        and NO PLATFORM FEE ROW
--
-- There is no platform fee row on a commerce bill because Atlitos is the
-- SELLER OF RECORD for v1 gear. There is no counterparty to split with, so a
-- "platform fee" would be a fee the platform charges itself. That is why
-- `orders` carries exactly five money columns (subtotal, delivery_charges,
-- gst_and_others, donation_roundup, total) and no platform_fee column, unlike
-- sessions and court_bookings which both have one.
--
-- total = subtotal + delivery_charges + gst_and_others + donation_roundup,
-- enforced by a CHECK constraint below so a bad edge-function computation is a
-- write failure rather than a wrong number a shopper is charged. See
-- PHASE-4-STATUS.md D1 for the fee_config keys each row derives from
-- (commerce.delivery_flat, commerce.gst_percent,
-- commerce.donation_roundup_flat).
--
-- ============================================================================
-- SNAPSHOT, DO NOT RECOMPUTE (PRD-07 FR-25, PHASE-4-STATUS.md trap 4)
--
-- order_items freezes product_title_snapshot, variant_label_snapshot and
-- unit_price at order time, and `orders` stores its own money columns. Order
-- Detail's BillSummary recap reads those stored values and never re-derives
-- them against current catalog prices. A later admin price edit or product
-- rename must not rewrite what a shopper was charged, and with these columns
-- it structurally cannot.
--
-- ============================================================================
-- THE FINANCIAL INVARIANT, AS IT APPLIES TO THIS FILE
--
-- `orders.status` and every money column on `orders` are state-machine and
-- money surfaces. Per CLAUDE.md, no client ever writes them. 0032 grants
-- `authenticated` SELECT only on orders/order_items/order_timeline and no
-- write verb at all; the order row is created by the finalize handler under
-- service role, and status moves only through `order_transition` (AT-69,
-- 0035). Nothing in this migration grants a client write to any of it.
-- ============================================================================

-- ============================================================================
-- order_status. Machine (SCHEMA.md, PRD-07 FR-24, packages/types
-- ORDER_TRANSITIONS which already encodes this and is the client-side mirror):
--   placed -> shipped -> in_transit -> delivered   strictly forward
--   placed -> cancelled                            the only cancel edge
-- delivered and cancelled are terminal. Enforced by order_transition (0035),
-- never by client logic setting the column.
-- ============================================================================

create type public.order_status as enum (
  'placed',
  'shipped',
  'in_transit',
  'delivered',
  'cancelled'
);

-- ============================================================================
-- categories
--
-- SCHEMA.md gives categories three columns and NO `active` column. RLS.md's
-- commerce row and AT-66 both describe the public browse policy for the
-- catalog family as "active = true", which is well defined for products,
-- product_media and product_variants (all reachable from products.active) but
-- has no referent on categories. Categories are public reference content with
-- no per-user data, in the same class as `drills` and `roadmap_stages` in
-- RLS.md's guest read surface, so 0032 gives this table a plain public select.
-- Recorded here and in RLS.md rather than inventing an `active` column
-- SCHEMA.md does not have.
-- ============================================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- products
-- ============================================================================

create table public.products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid references public.categories (id) on delete set null,
  sport public.sport,
  base_price numeric(12, 2) not null check (base_price >= 0),
  active boolean not null default true,
  -- Heuristic v1 recommendation score, LLM-ready per PLAN.md's ai-search note
  -- and PRD-07 FR-2's "recommendation field on the product read".
  recommended_rank numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_products_category_active on public.products (category_id, active);
create index idx_products_sport on public.products (sport);

-- PRD-07 FR-3's search bar filters product title by query string. pg_trgm
-- gives that a real index instead of a sequential ILIKE scan once the catalog
-- grows. Installed into the `extensions` schema, matching 0009_courts.sql's
-- handling of btree_gist.
create extension if not exists pg_trgm with schema extensions;
create index idx_products_title_trgm on public.products using gin (title extensions.gin_trgm_ops);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ============================================================================
-- product_media
-- ============================================================================

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  position smallint not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_product_media_product_id on public.product_media (product_id);

-- At most one primary image per product (SCHEMA.md).
create unique index idx_product_media_one_primary
  on public.product_media (product_id)
  where is_primary;

-- ============================================================================
-- product_variants
--
-- `stock` is the RAW inventory count and it means exactly that: units Atlitos
-- physically has. It is deliberately NOT decremented by an in-flight checkout.
-- What a shopper may buy right now is AVAILABLE stock, which is this column
-- minus the held, unexpired rows in `stock_reservations`, and that expression
-- lives in exactly one place (0033, AT-67). PHASE-4-STATUS.md D2 rejected
-- overloading this column precisely so that every admin stock readout in
-- PRD-04 FR-13 and FR-17 stays truthful during traffic.
--
-- CHECK (stock >= 0) is the last line of defence under the guarded decrement
-- in consume_reservation. If it ever fires, the guard above it failed and that
-- is a failed gate, not a passed one (PHASE-4-STATUS.md gate clause 4).
-- ============================================================================

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  size text,
  color text,
  sku text not null unique,
  price_override numeric(12, 2) check (price_override is null or price_override >= 0),
  stock int not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_product_variants_product_id on public.product_variants (product_id);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- ============================================================================
-- product_wishlist_items
--
-- Shopper gear wishlist. Distinct from `upa_wishlist_items` in the empower
-- domain, which is an UPA's funding wishlist; the two are unrelated tables
-- despite the similar name (SCHEMA.md says so explicitly, repeated here
-- because the next agent will meet both names in one repo).
-- ============================================================================

create table public.product_wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index idx_product_wishlist_user_id on public.product_wishlist_items (user_id);

-- ============================================================================
-- cart_items
--
-- A persisted cart table, not a draft order row. PRD-07 FR-8 leaves the choice
-- open ("`orders` in draft state or an equivalent cart table"); SCHEMA.md
-- resolves it to a dedicated table because it is simpler to RLS-scope and
-- needs none of the order lifecycle columns. It survives app restarts, which
-- is what FR-8 actually asks for.
-- ============================================================================

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  product_variant_id uuid not null references public.product_variants (id) on delete cascade,
  qty int not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_variant_id)
);

create index idx_cart_items_user_id on public.cart_items (user_id);

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ============================================================================
-- orders
--
-- order_number is the shopper-facing "#ATL39284" identifier from PRD-07's
-- Order Success screen. It is generated from a sequence rather than a random
-- id so it is short, sortable and readable aloud to support.
-- ============================================================================

create sequence public.order_number_seq;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique
    default '#ATL' || lpad(nextval('public.order_number_seq')::text, 5, '0'),
  user_id uuid not null references public.users (id),
  address_id uuid not null references public.addresses (id),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  delivery_charges numeric(12, 2) not null default 0 check (delivery_charges >= 0),
  gst_and_others numeric(12, 2) not null default 0 check (gst_and_others >= 0),
  donation_roundup numeric(12, 2) not null default 0 check (donation_roundup >= 0),
  total numeric(12, 2) not null check (total >= 0),
  status public.order_status not null default 'placed',
  payment_intent_id uuid references public.payment_intents (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- D1's bill shape, enforced rather than trusted. Note there is deliberately
  -- no platform fee term: see the D1 block at the top of this file.
  constraint orders_total_is_the_sum_of_its_rows check (
    total = subtotal + delivery_charges + gst_and_others + donation_roundup
  )
);

create index idx_orders_user_id on public.orders (user_id);
create index idx_orders_status on public.orders (status);

-- AT-70's delete guard (0036) asks "is this address referenced by an in-flight
-- order", which is an address_id lookup on every addresses DELETE.
create index idx_orders_address_id on public.orders (address_id);

-- The finalize handler resolves an order from its payment intent, and the
-- ledger verification in the P4 gate joins the same way.
create index idx_orders_payment_intent_id on public.orders (payment_intent_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ============================================================================
-- order_items
--
-- The snapshot columns are the whole point of this table's shape; see the
-- SNAPSHOT block at the top of this file. product_variant_id keeps a reference
-- for fulfilment and returns, but nothing a shopper is SHOWN is read through
-- it. Note it is ON DELETE RESTRICT by default: an ordered variant cannot be
-- deleted out from under order history.
-- ============================================================================

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_variant_id uuid not null references public.product_variants (id),
  product_title_snapshot text not null,
  variant_label_snapshot text not null,
  qty int not null check (qty > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create index idx_order_items_order_id on public.order_items (order_id);

-- ============================================================================
-- order_timeline
--
-- One row per accepted lifecycle transition, written by order_transition
-- (0035) inside the same transaction as the status change, so a timeline can
-- never disagree with the order it describes. PRD-07 FR-24's OrderTimeline
-- reads this table; AC-E2 wants the shipped entry to carry a date and a
-- location, which is what `location` is for.
-- ============================================================================

create table public.order_timeline (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status public.order_status not null,
  note text,
  location text,
  actor_id uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index idx_order_timeline_order_id on public.order_timeline (order_id);

-- ============================================================================
-- order_feedback
--
-- PRD-07 FR-26: available only once an order reaches `delivered`, and a one
-- time action per order. Both halves are enforced in the database, not in the
-- UI: UNIQUE(order_id) makes it once, and 0032's insert policy requires the
-- order's status to be `delivered`. AC-E4's read only view is then a
-- consequence of the row existing, not a separate rule.
-- ============================================================================

create table public.order_feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  remarks text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- RLS on, policies deliberately absent until 0032. Fail closed.
-- ============================================================================

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_media enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_wishlist_items enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_timeline enable row level security;
alter table public.order_feedback enable row level security;
