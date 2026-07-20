-- ATLITOS v2 — 0039_admin_commerce_rpcs.sql
-- Domain: commerce (extends 0031/0032/0033). Epic P4, story AT-81.
-- Requirements: PRD-04 FR-13 to FR-19, and FR-53's "exactly one audit_log row
-- per action". Consumed by apps/admin's Catalog resource.
--
-- ============================================================================
-- WHY THESE ARE RPCs AND NOT DIRECT CLIENT WRITES
--
-- 0032 already gives an admin full DML on categories, products, product_media
-- and product_variants (`products_write_admin` and friends), so a plain
-- supabase-js `.insert()` / `.update()` from apps/admin WOULD pass RLS. It is
-- deliberately not used, for exactly the reason 0007_admin_verification_rpcs
-- and 0013_admin_courts_bookings already established:
--
--   `audit_log` carries ZERO authenticated or anon write policy and zero write
--   grant (0003_moderation_audit.sql, RLS.md). A client-side mutation would
--   therefore change the catalog and leave no audit trail, and PRD-04 FR-14
--   through FR-18 each require "one audit_log entry" as part of the action,
--   not as a best-effort follow up.
--
-- Wrapping each mutation in a SECURITY DEFINER function makes the row change
-- and its audit row ONE transaction, so they cannot diverge. Every function
-- below re-checks `has_role('admin')` itself rather than leaning on the RLS
-- policy, because a SECURITY DEFINER function bypasses RLS by construction.
--
-- These are catalog rows, not money rows: no function here touches `orders`,
-- `payment_intents`, `ledger_entries` or any status field on a money-bearing
-- row. Order advancement is a different mechanism entirely (0035's
-- `order_transition`, service_role only, driven by the `admin-order-advance`
-- edge function). CLAUDE.md's financial invariant is untouched by this file.
--
-- ============================================================================
-- STOCK: RAW IS THE ADMIN'S NUMBER, AND HELD IS SHOWN BESIDE IT
--
-- PHASE-4-STATUS.md D2 rejected overloading `product_variants.stock` precisely
-- so that "every admin stock readout in PRD-04 FR-13 and FR-17 stays truthful
-- during traffic". AT-81 says the same thing: the admin sees RAW stock, not
-- AT-67's available figure, because an admin needs real inventory rather than
-- inventory minus in-flight carts.
--
-- `admin_variant_stock` therefore returns raw, held and available as THREE
-- SEPARATE COLUMNS and lets the surface label all three, rather than
-- collapsing them into one number that would be a lie under either reading.
--
-- It deliberately does NOT read `product_variant_availability` (0033). That
-- view inner-joins `products` on `p.active`, so a deactivated product's
-- variants vanish from it entirely, and a hold placed just before an admin
-- deactivated a product would silently read as zero held. An admin looking at
-- a deactivated product must still see that units are held against it. The
-- subtraction is still the same one 0033 defines, and this is the only other
-- place in the codebase that states it; if 0033's definition of a live hold
-- ever changes, this function changes with it.
-- ============================================================================

create function public.admin_variant_stock(p_product_id uuid default null)
returns table (
  product_variant_id uuid,
  product_id uuid,
  sku text,
  size text,
  color text,
  price_override numeric,
  raw_stock int,
  held_qty int,
  available_stock int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  return query
  select
    pv.id,
    pv.product_id,
    pv.sku,
    pv.size,
    pv.color,
    pv.price_override,
    pv.stock,
    coalesce(h.held_qty, 0),
    greatest(0, pv.stock - coalesce(h.held_qty, 0))
  from public.product_variants pv
  left join lateral (
    -- The same "live hold" predicate 0033's view uses: held, and not expired.
    select coalesce(sum(sr.qty), 0)::int as held_qty
    from public.stock_reservations sr
    where sr.product_variant_id = pv.id
      and sr.status = 'held'
      and sr.expires_at > now()
  ) h on true
  where p_product_id is null or pv.product_id = p_product_id
  order by pv.sku;
end;
$$;

comment on function public.admin_variant_stock(uuid) is
  'PRD-04 FR-13/FR-17 admin inventory readout. Returns raw stock, held reservations and available as three distinct columns so an admin surface can label them separately. Raw stock is the admin figure; available is shown for context only. Not for shopper-facing reads, which use product_variant_availability (0033).';

revoke all on function public.admin_variant_stock(uuid) from public;
revoke execute on function public.admin_variant_stock(uuid) from anon;
grant execute on function public.admin_variant_stock(uuid) to authenticated, service_role;

-- ============================================================================
-- Internal helper: the changed-fields diff PRD-04 FR-15 asks for ("capturing
-- the changed fields with before and after values"). Returns two objects
-- containing ONLY the keys whose values actually differ, so an audit row for a
-- title-only edit does not restate the whole product and bury the change.
-- ============================================================================

create function public.audit_changed_fields(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'before', coalesce(jsonb_object_agg(k, p_before -> k), '{}'::jsonb),
    'after',  coalesce(jsonb_object_agg(k, p_after  -> k), '{}'::jsonb)
  )
  from jsonb_object_keys(p_after) k
  where p_before -> k is distinct from p_after -> k;
$$;

comment on function public.audit_changed_fields(jsonb, jsonb) is
  'PRD-04 FR-15: reduces a before/after pair to only the keys that actually changed, for audit_log.before / audit_log.after.';

-- ============================================================================
-- PRODUCTS
-- ============================================================================

-- FR-14. Creation requires name, description, category, base price, AND at
-- least one media image. The media requirement is enforced HERE and not only
-- in the form, because "the save is blocked" (PRD-04 AC) has to be true of the
-- API and not merely of the button. The product row and its media rows are
-- inserted in one transaction, so a product can never exist imageless.
create function public.admin_create_product(
  p_title text,
  p_description text,
  p_category_id uuid,
  p_base_price numeric,
  p_media jsonb,
  p_sport public.sport default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
  v_media_count int;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'VALIDATION: a product title is required';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'VALIDATION: a product description is required';
  end if;

  if p_category_id is null then
    raise exception 'VALIDATION: a category is required';
  end if;

  if p_base_price is null or p_base_price < 0 then
    raise exception 'VALIDATION: a non negative base price is required';
  end if;

  v_media_count := coalesce(jsonb_array_length(p_media), 0);
  if v_media_count = 0 then
    raise exception 'MEDIA_REQUIRED: at least one product image is required';
  end if;

  insert into public.products (title, description, category_id, sport, base_price)
  values (btrim(p_title), btrim(p_description), p_category_id, p_sport, p_base_price)
  returning * into v_product;

  -- First image is primary unless the payload names one explicitly.
  insert into public.product_media (product_id, storage_path, position, is_primary)
  select
    v_product.id,
    m.value ->> 'storage_path',
    coalesce((m.value ->> 'position')::smallint, (m.ordinality - 1)::smallint),
    coalesce((m.value ->> 'is_primary')::boolean, false)
  from jsonb_array_elements(p_media) with ordinality as m(value, ordinality);

  if not exists (
    select 1 from public.product_media where product_id = v_product.id and is_primary
  ) then
    update public.product_media
    set is_primary = true
    where id = (
      select id from public.product_media
      where product_id = v_product.id
      order by position, id
      limit 1
    );
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    'product.create',
    'product',
    v_product.id,
    null,
    jsonb_build_object(
      'title', v_product.title,
      'description', v_product.description,
      'category_id', v_product.category_id,
      'sport', v_product.sport,
      'base_price', v_product.base_price,
      'active', v_product.active,
      'media_count', v_media_count
    )
  );

  return v_product;
end;
$$;

revoke all on function public.admin_create_product(text, text, uuid, numeric, jsonb, public.sport) from public;
revoke execute on function public.admin_create_product(text, text, uuid, numeric, jsonb, public.sport) from anon;
grant execute on function public.admin_create_product(text, text, uuid, numeric, jsonb, public.sport) to authenticated;

-- FR-15. Full-replace semantics: the form submits every editable field and the
-- audit row records only what actually moved.
create function public.admin_update_product(
  p_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_base_price numeric,
  p_sport public.sport default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.products;
  v_after public.products;
  v_diff jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select * into v_before from public.products where id = p_id for update;
  if v_before.id is null then
    raise exception 'NOT_FOUND: product % does not exist', p_id;
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'VALIDATION: a product title is required';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'VALIDATION: a product description is required';
  end if;

  if p_category_id is null then
    raise exception 'VALIDATION: a category is required';
  end if;

  if p_base_price is null or p_base_price < 0 then
    raise exception 'VALIDATION: a non negative base price is required';
  end if;

  update public.products
  set title = btrim(p_title),
      description = btrim(p_description),
      category_id = p_category_id,
      base_price = p_base_price,
      sport = p_sport
  where id = p_id
  returning * into v_after;

  v_diff := public.audit_changed_fields(
    jsonb_build_object(
      'title', v_before.title, 'description', v_before.description,
      'category_id', v_before.category_id, 'base_price', v_before.base_price,
      'sport', v_before.sport
    ),
    jsonb_build_object(
      'title', v_after.title, 'description', v_after.description,
      'category_id', v_after.category_id, 'base_price', v_after.base_price,
      'sport', v_after.sport
    )
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'product.update', 'product', p_id, v_diff -> 'before', v_diff -> 'after');

  return v_after;
end;
$$;

revoke all on function public.admin_update_product(uuid, text, text, uuid, numeric, public.sport) from public;
revoke execute on function public.admin_update_product(uuid, text, text, uuid, numeric, public.sport) from anon;
grant execute on function public.admin_update_product(uuid, text, text, uuid, numeric, public.sport) to authenticated;

-- FR-18. Deactivation is a flag flip, never a delete: 0032's
-- products_select_public gates the shopper catalog on `active = true`, so
-- clearing the flag hides the product and every one of its variants and images
-- while leaving all of it intact for reactivation and for order history.
create function public.admin_set_product_active(p_id uuid, p_active boolean)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.products;
  v_after public.products;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_active is null then
    raise exception 'VALIDATION: an active flag is required';
  end if;

  select * into v_before from public.products where id = p_id for update;
  if v_before.id is null then
    raise exception 'NOT_FOUND: product % does not exist', p_id;
  end if;

  update public.products set active = p_active where id = p_id returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    case when p_active then 'product.activate' else 'product.deactivate' end,
    'product',
    p_id,
    jsonb_build_object('active', v_before.active),
    jsonb_build_object('active', v_after.active)
  );

  return v_after;
end;
$$;

revoke all on function public.admin_set_product_active(uuid, boolean) from public;
revoke execute on function public.admin_set_product_active(uuid, boolean) from anon;
grant execute on function public.admin_set_product_active(uuid, boolean) to authenticated;

-- ============================================================================
-- VARIANTS
--
-- Note what these do NOT do: `admin_update_variant` cannot change `stock`.
-- Inventory moves only through `admin_adjust_variant_stock`, which requires a
-- reason (FR-17). If an ordinary variant edit could also set stock, the
-- reason requirement would be trivially bypassable by editing the variant
-- instead of adjusting it, and FR-17's audit trail would have holes in it.
-- ============================================================================

create function public.admin_create_variant(
  p_product_id uuid,
  p_sku text,
  p_size text default null,
  p_color text default null,
  p_price_override numeric default null,
  p_stock int default 0
)
returns public.product_variants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_variant public.product_variants;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_sku is null or btrim(p_sku) = '' then
    raise exception 'VALIDATION: a sku is required';
  end if;

  if p_stock is null or p_stock < 0 then
    raise exception 'VALIDATION: a non negative stock count is required';
  end if;

  if p_price_override is not null and p_price_override < 0 then
    raise exception 'VALIDATION: a price override cannot be negative';
  end if;

  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'NOT_FOUND: product % does not exist', p_product_id;
  end if;

  if exists (select 1 from public.product_variants where sku = btrim(p_sku)) then
    raise exception 'SKU_TAKEN: sku % is already in use', btrim(p_sku);
  end if;

  insert into public.product_variants (product_id, sku, size, color, price_override, stock)
  values (p_product_id, btrim(p_sku), nullif(btrim(coalesce(p_size, '')), ''),
          nullif(btrim(coalesce(p_color, '')), ''), p_price_override, p_stock)
  returning * into v_variant;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    'product_variant.create',
    'product_variant',
    v_variant.id,
    null,
    jsonb_build_object(
      'product_id', v_variant.product_id, 'sku', v_variant.sku,
      'size', v_variant.size, 'color', v_variant.color,
      'price_override', v_variant.price_override, 'stock', v_variant.stock
    )
  );

  return v_variant;
end;
$$;

revoke all on function public.admin_create_variant(uuid, text, text, text, numeric, int) from public;
revoke execute on function public.admin_create_variant(uuid, text, text, text, numeric, int) from anon;
grant execute on function public.admin_create_variant(uuid, text, text, text, numeric, int) to authenticated;

create function public.admin_update_variant(
  p_id uuid,
  p_sku text,
  p_size text default null,
  p_color text default null,
  p_price_override numeric default null
)
returns public.product_variants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.product_variants;
  v_after public.product_variants;
  v_diff jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select * into v_before from public.product_variants where id = p_id for update;
  if v_before.id is null then
    raise exception 'NOT_FOUND: variant % does not exist', p_id;
  end if;

  if p_sku is null or btrim(p_sku) = '' then
    raise exception 'VALIDATION: a sku is required';
  end if;

  if p_price_override is not null and p_price_override < 0 then
    raise exception 'VALIDATION: a price override cannot be negative';
  end if;

  if exists (select 1 from public.product_variants where sku = btrim(p_sku) and id <> p_id) then
    raise exception 'SKU_TAKEN: sku % is already in use', btrim(p_sku);
  end if;

  update public.product_variants
  set sku = btrim(p_sku),
      size = nullif(btrim(coalesce(p_size, '')), ''),
      color = nullif(btrim(coalesce(p_color, '')), ''),
      price_override = p_price_override
  where id = p_id
  returning * into v_after;

  v_diff := public.audit_changed_fields(
    jsonb_build_object('sku', v_before.sku, 'size', v_before.size,
                       'color', v_before.color, 'price_override', v_before.price_override),
    jsonb_build_object('sku', v_after.sku, 'size', v_after.size,
                       'color', v_after.color, 'price_override', v_after.price_override)
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'product_variant.update', 'product_variant', p_id,
          v_diff -> 'before', v_diff -> 'after');

  return v_after;
end;
$$;

revoke all on function public.admin_update_variant(uuid, text, text, text, numeric) from public;
revoke execute on function public.admin_update_variant(uuid, text, text, text, numeric) from anon;
grant execute on function public.admin_update_variant(uuid, text, text, text, numeric) to authenticated;

-- Removing a variant. `order_items.product_variant_id` is ON DELETE RESTRICT
-- by design (0031), so an ordered variant cannot be deleted out from under
-- order history. That is surfaced as VARIANT_IN_USE rather than a raw foreign
-- key error, the same courtesy 0036 gives ADDRESS_IN_USE. A live hold also
-- blocks the delete: removing a variant a shopper is mid-checkout on would
-- strand their reservation.
create function public.admin_delete_variant(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.product_variants;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select * into v_before from public.product_variants where id = p_id for update;
  if v_before.id is null then
    raise exception 'NOT_FOUND: variant % does not exist', p_id;
  end if;

  if exists (select 1 from public.order_items where product_variant_id = p_id) then
    raise exception 'VARIANT_IN_USE: this variant appears on a past order and cannot be removed';
  end if;

  if exists (
    select 1 from public.stock_reservations
    where product_variant_id = p_id and status = 'held' and expires_at > now()
  ) then
    raise exception 'VARIANT_IN_USE: units of this variant are held by a checkout in progress';
  end if;

  delete from public.product_variants where id = p_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    'product_variant.delete',
    'product_variant',
    p_id,
    jsonb_build_object(
      'product_id', v_before.product_id, 'sku', v_before.sku,
      'size', v_before.size, 'color', v_before.color,
      'price_override', v_before.price_override, 'stock', v_before.stock
    ),
    null
  );
end;
$$;

revoke all on function public.admin_delete_variant(uuid) from public;
revoke execute on function public.admin_delete_variant(uuid) from anon;
grant execute on function public.admin_delete_variant(uuid) to authenticated;

-- FR-17. The reason is mandatory and the audit row records prior count, new
-- count and reason, which is the whole point of routing stock through its own
-- function. Note it sets an ABSOLUTE new count rather than a delta: the admin
-- form is a stock take ("what is actually on the shelf"), and a delta would
-- silently compound if the form were submitted twice.
create function public.admin_adjust_variant_stock(
  p_id uuid,
  p_new_stock int,
  p_reason text
)
returns public.product_variants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.product_variants;
  v_after public.product_variants;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: a reason is required for a stock adjustment';
  end if;

  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'VALIDATION: a non negative stock count is required';
  end if;

  select * into v_before from public.product_variants where id = p_id for update;
  if v_before.id is null then
    raise exception 'NOT_FOUND: variant % does not exist', p_id;
  end if;

  update public.product_variants set stock = p_new_stock where id = p_id returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'product_variant.stock_adjust',
    'product_variant',
    p_id,
    jsonb_build_object('stock', v_before.stock),
    jsonb_build_object('stock', v_after.stock),
    btrim(p_reason)
  );

  return v_after;
end;
$$;

revoke all on function public.admin_adjust_variant_stock(uuid, int, text) from public;
revoke execute on function public.admin_adjust_variant_stock(uuid, int, text) from anon;
grant execute on function public.admin_adjust_variant_stock(uuid, int, text) to authenticated;

-- ============================================================================
-- MEDIA (FR-19)
--
-- Set-the-whole-list semantics rather than per-image calls, because reordering
-- and re-designating a primary are inherently list operations: doing them one
-- row at a time would transiently violate idx_product_media_one_primary (the
-- partial unique index from 0031) between the two writes. Deleting the old set
-- and inserting the new one inside a single function keeps the index satisfied
-- at every commit boundary and keeps FR-19 to exactly one audit row.
-- ============================================================================

create function public.admin_set_product_media(p_product_id uuid, p_media jsonb)
returns setof public.product_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_primary_count int;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'NOT_FOUND: product % does not exist', p_product_id;
  end if;

  if coalesce(jsonb_array_length(p_media), 0) = 0 then
    raise exception 'MEDIA_REQUIRED: at least one product image is required';
  end if;

  select count(*) into v_primary_count
  from jsonb_array_elements(p_media) m
  where coalesce((m.value ->> 'is_primary')::boolean, false);

  if v_primary_count <> 1 then
    raise exception 'VALIDATION: exactly one image must be marked primary';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'storage_path', storage_path, 'position', position, 'is_primary', is_primary
         ) order by position), '[]'::jsonb)
  into v_before
  from public.product_media where product_id = p_product_id;

  delete from public.product_media where product_id = p_product_id;

  insert into public.product_media (product_id, storage_path, position, is_primary)
  select
    p_product_id,
    m.value ->> 'storage_path',
    coalesce((m.value ->> 'position')::smallint, (m.ordinality - 1)::smallint),
    coalesce((m.value ->> 'is_primary')::boolean, false)
  from jsonb_array_elements(p_media) with ordinality as m(value, ordinality);

  select coalesce(jsonb_agg(jsonb_build_object(
           'storage_path', storage_path, 'position', position, 'is_primary', is_primary
         ) order by position), '[]'::jsonb)
  into v_after
  from public.product_media where product_id = p_product_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'product_media.set', 'product', p_product_id,
          jsonb_build_object('media', v_before), jsonb_build_object('media', v_after));

  return query
    select * from public.product_media where product_id = p_product_id order by position;
end;
$$;

revoke all on function public.admin_set_product_media(uuid, jsonb) from public;
revoke execute on function public.admin_set_product_media(uuid, jsonb) from anon;
grant execute on function public.admin_set_product_media(uuid, jsonb) to authenticated;

-- ============================================================================
-- ORDERS: admin read scope (PRD-04 FR-20, FR-21) — ALREADY DONE BY 0032
--
-- Nothing is added here on purpose. 0032_commerce_rls.sql already ships
-- `orders_select_admin`, `order_items_select_admin` and
-- `order_timeline_select_admin`, all `using (has_role('admin'))`, so the admin
-- Order List and Order Detail can read every order without this migration
-- touching policy at all. An earlier draft of this file recreated them and
-- Postgres rejected it, which is how the duplication was caught.
--
-- Two consequences apps/admin must carry regardless, both recorded here
-- because this is the file a future agent will read when wiring another admin
-- commerce surface:
--
--   1. Those policies are PERMISSIVE and sit beside the owner policies, which
--      is exactly the permissive-OR shape CLAUDE.md warns about. `orders` DOES
--      return other people's rows to an admin session's unscoped select. That
--      is intended for the Order List, but any admin query wanting a subset
--      must filter explicitly rather than assume policy narrowed it, and the
--      shopper app keeps its own `.eq("user_id", user.id)` regardless.
--
--   2. They are SELECT only. There is no admin write policy on any order
--      table, so advancement stays behind 0035's service_role-only
--      `order_transition` via the `admin-order-advance` edge function, and
--      PRD-04 FR-26 holds by construction rather than by discipline.
-- ============================================================================
