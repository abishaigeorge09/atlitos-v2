-- Shopper visible categories
--
-- Found 2026-07-20 during the P4 evidence pass: the `TrackB Verify` fixture
-- category rendered as a real shopper facing chip that led to an empty grid.
-- Track B's claim that its fixtures were invisible held for products, which
-- carry `active`, but categories have no such column and were listed raw.
--
-- Deleting the one fixture row would fix the sighting and leave the defect.
-- The real rule is that a category is only worth showing if a shopper can
-- actually buy something in it, which also covers a category whose last
-- product is deactivated later, and a category created ahead of its stock.
--
-- Purchasability is deliberately NOT part of this predicate: an out of stock
-- product still belongs in its category and the PDP has a real out of stock
-- state (PRD-07). Only `active` is considered, so the category list does not
-- flicker as stock moves.

create or replace view public.shopper_categories
with (security_invoker = true)
as
select c.id, c.name, c.slug, c.created_at
from public.categories c
where exists (
  select 1
  from public.products p
  where p.category_id = c.id
    and p.active
);

comment on view public.shopper_categories is
  'Categories that contain at least one active product. The shopper category '
  'list reads this, never `categories` directly, so empty and fixture only '
  'categories cannot surface. security_invoker so the caller''s RLS applies.';

grant select on public.shopper_categories to anon, authenticated;
