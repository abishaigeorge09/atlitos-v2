-- ATLITOS v2 — 0034_cart_wishlist_rpcs.sql
-- Domain: commerce. Epic P4, story AT-68.
-- Requirements: PRD-07 FR-6, FR-9, FR-10, FR-29.
--
-- The only write paths into `cart_items`. 0032 withdrew INSERT and UPDATE from
-- anon and authenticated on that table and created no policy for either verb,
-- so a PostgREST upsert cannot reach it; these two functions are it. That is
-- what makes PRD-07 FR-9's stock revalidation load bearing rather than a UI
-- courtesy. Cart line REMOVAL stays a direct own-row DELETE (FR-10), because
-- removing stock pressure needs no stock check.
--
-- ============================================================================
-- AVAILABLE, NOT RAW. Every check in this file goes through
-- variant_available_stock(), which reads the shared availability view from
-- 0033. It must never read product_variants.stock directly: raw stock ignores
-- the units other shoppers are currently holding at the payment sheet, so a
-- cart validated against it would pass here and then fail at checkout, which
-- is precisely the experience FR-9 exists to prevent.
--
-- ============================================================================
-- WHY THESE CAP INSTEAD OF RAISING, which looks like it contradicts FR-9
--
-- FR-9 says a request exceeding available stock "returns OUT_OF_STOCK and the
-- cart line is capped to available stock, never silently rounded up". Those
-- two halves cannot both happen through an exception: raising rolls the
-- transaction back, so the cap would never persist.
--
-- So the outcome is returned, not raised. The function writes the capped line
-- and returns `capped = true` alongside the requested and available figures,
-- and the client renders the FR-9 notice and blocks Proceed To Buy per FR-12.
-- An exception is reserved for the case where there is nothing to cap TO:
-- available is zero, no line can exist, and OUT_OF_STOCK is raised properly.
--
-- "Never silently rounded up" is the binding half and it is honoured either
-- way: the stored qty is never greater than what was available at write time.
-- ============================================================================

create type public.cart_mutation_result as (
  cart_item_id uuid,
  product_variant_id uuid,
  qty int,
  requested_qty int,
  available_stock int,
  capped boolean
);

-- ============================================================================
-- add_to_cart. Additive: a second add of the same variant increases the line
-- rather than replacing it, which is what "Add to Cart" means on a PDP the
-- shopper may return to. Move to Cart from the wishlist (FR-29) calls this at
-- qty 1 and inherits every check below unchanged.
-- ============================================================================

create function public.add_to_cart(
  p_variant_id uuid,
  p_qty int default 1
)
returns public.cart_mutation_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_available int;
  v_existing int;
  v_requested int;
  v_final int;
  v_result public.cart_mutation_result;
begin
  -- FR-7's guest gate. The client intercepts this and renders LoginGateSheet.
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in to add items to your cart';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'VALIDATION: qty must be greater than zero';
  end if;

  -- A variant of an inactive product has no availability row at all, so this
  -- correctly refuses to cart a delisted product rather than reporting it as
  -- merely out of stock.
  if not exists (
    select 1 from public.product_variant_availability a
    where a.product_variant_id = p_variant_id
  ) then
    raise exception 'NOT_FOUND: variant % is not available for purchase', p_variant_id;
  end if;

  v_available := public.variant_available_stock(p_variant_id);

  select qty into v_existing
  from public.cart_items
  where user_id = v_user_id and product_variant_id = p_variant_id;

  v_existing := coalesce(v_existing, 0);
  v_requested := v_existing + p_qty;

  if v_available <= 0 then
    raise exception 'OUT_OF_STOCK: variant % has no available stock', p_variant_id;
  end if;

  v_final := least(v_requested, v_available);

  insert into public.cart_items (user_id, product_variant_id, qty)
  values (v_user_id, p_variant_id, v_final)
  on conflict (user_id, product_variant_id)
  do update set qty = excluded.qty
  returning id, product_variant_id, qty
  into v_result.cart_item_id, v_result.product_variant_id, v_result.qty;

  v_result.requested_qty := v_requested;
  v_result.available_stock := v_available;
  v_result.capped := v_final < v_requested;

  return v_result;
end;
$$;

revoke all on function public.add_to_cart(uuid, int) from public;
revoke execute on function public.add_to_cart(uuid, int) from anon;
grant execute on function public.add_to_cart(uuid, int) to authenticated;

-- ============================================================================
-- update_cart_item. Absolute: sets the line to p_qty, capped to available.
-- This is the qty stepper on the cart screen (PRD-07 FR-9, AC-C2). Setting a
-- line to zero is a removal and belongs to the direct DELETE path (FR-10), so
-- it is refused here rather than quietly reinterpreted.
-- ============================================================================

create function public.update_cart_item(
  p_variant_id uuid,
  p_qty int
)
returns public.cart_mutation_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_available int;
  v_final int;
  v_result public.cart_mutation_result;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in to change your cart';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'VALIDATION: qty must be greater than zero; remove the line instead';
  end if;

  if not exists (
    select 1 from public.cart_items
    where user_id = v_user_id and product_variant_id = p_variant_id
  ) then
    raise exception 'NOT_FOUND: no cart line for variant %', p_variant_id;
  end if;

  v_available := public.variant_available_stock(p_variant_id);

  if v_available <= 0 then
    raise exception 'OUT_OF_STOCK: variant % has no available stock', p_variant_id;
  end if;

  v_final := least(p_qty, v_available);

  update public.cart_items
  set qty = v_final
  where user_id = v_user_id and product_variant_id = p_variant_id
  returning id, product_variant_id, qty
  into v_result.cart_item_id, v_result.product_variant_id, v_result.qty;

  v_result.requested_qty := p_qty;
  v_result.available_stock := v_available;
  v_result.capped := v_final < p_qty;

  return v_result;
end;
$$;

revoke all on function public.update_cart_item(uuid, int) from public;
revoke execute on function public.update_cart_item(uuid, int) from anon;
grant execute on function public.update_cart_item(uuid, int) to authenticated;

-- ============================================================================
-- toggle_product_wishlist (PRD-07 FR-6)
--
-- Insert-or-delete in ONE statement. The obvious client implementation is
-- "read whether it is wishlisted, then write the opposite", which is a
-- read-then-write race: two fast taps, or the same account on two devices, can
-- both read `absent` and both insert, and the second gets a unique violation
-- the user sees as a failed tap. Doing both branches in a single CTE statement
-- means the toggle is decided against one snapshot inside one statement.
--
-- Returns true if the product is now wishlisted, false if it was removed, so
-- the heart can render from the return value rather than re-fetching.
-- ============================================================================

create function public.toggle_product_wishlist(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now_wishlisted boolean;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in to save items to your wishlist';
  end if;

  -- Guests wishlist client side (FR-7), so an authenticated toggle should only
  -- ever name a product the catalog actually shows.
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.active
  ) then
    raise exception 'NOT_FOUND: product % is not available', p_product_id;
  end if;

  with deleted as (
    delete from public.product_wishlist_items
    where user_id = v_user_id and product_id = p_product_id
    returning 1
  ),
  inserted as (
    insert into public.product_wishlist_items (user_id, product_id)
    select v_user_id, p_product_id
    where not exists (select 1 from deleted)
    returning 1
  )
  select exists (select 1 from inserted) into v_now_wishlisted;

  return v_now_wishlisted;
end;
$$;

revoke all on function public.toggle_product_wishlist(uuid) from public;
revoke execute on function public.toggle_product_wishlist(uuid) from anon;
grant execute on function public.toggle_product_wishlist(uuid) to authenticated;
