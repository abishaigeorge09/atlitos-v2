-- ATLITOS v2 — 0036_address_delete_guard.sql
-- Domain: commerce / identity. Epic P4, story AT-70.
-- Requirements: PRD-07 FR-30, AC-F3.
--
-- RLS.md's `addresses` row has specified this trigger since 0001_identity.sql
-- and deferred it in the same breath: "DELETE blocked by a trigger if
-- referenced by a non-delivered/non-cancelled order; that trigger ships with
-- the commerce domain migration once `orders` exists, not in
-- 0001_identity.sql". `orders` exists as of 0031, so it ships here.
--
-- A trigger rather than a policy, deliberately: RLS decides WHETHER a row is
-- visible to a verb, and the answer here depends on other rows in a different
-- table and needs to produce a specific, explainable message. A USING clause
-- that silently matched zero rows would make the delete look like it
-- succeeded, which is worse than blocking it.
--
-- ============================================================================
-- A REAL GAP, RECORDED RATHER THAN PAPERED OVER
--
-- FR-30 blocks deleting an address referenced by an IN FLIGHT order, which
-- implies deletion should SUCCEED once every referencing order is delivered or
-- cancelled. It does not, and cannot as the schema currently stands:
-- `orders.address_id` is a NOT NULL foreign key with no ON DELETE action, so
-- the constraint blocks the delete regardless of order status. Without this
-- trigger a shopper deleting an address used by a delivered order would get a
-- raw foreign key violation from PostgREST.
--
-- So this trigger blocks BOTH cases and distinguishes them by error code:
--
--   ADDRESS_IN_USE       a non-delivered, non-cancelled order references it.
--                        This is FR-30 and AC-F3 exactly, and it is the case
--                        AT-78's Address Book must render inline.
--   ADDRESS_ON_PAST_ORDER  only delivered/cancelled orders reference it. Not
--                        specified by FR-30; blocked so the shopper sees an
--                        explanation instead of a Postgres error string.
--
-- THE PROPER FIX, for the founder to decide rather than for this migration to
-- assume: snapshot the shipping address onto the order at order time, the same
-- way order_items already snapshots the product title and unit price
-- (PHASE-4-STATUS.md trap 4). Then a historical order keeps the address it
-- actually shipped to, `orders.address_id` becomes nullable with ON DELETE SET
-- NULL, and deleting an address used only by past orders just works. That adds
-- columns SCHEMA.md does not currently have, which is a schema decision beyond
-- this ticket's PRD-07 FR-30 scope, so it is flagged in PHASE-4-STATUS.md's
-- handoff notes and not silently taken here.
--
-- Note that today this gap is not reachable in practice: nothing can delete an
-- address that has a delivered order against it and nothing needs to, because
-- the P4 gate never deletes an address at all. It becomes a real product wart
-- the first time a shopper tidies their Address Book after a completed order.
-- ============================================================================

create function public.block_delete_address_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in_flight int;
  v_historical int;
begin
  select
    count(*) filter (where o.status not in ('delivered', 'cancelled')),
    count(*) filter (where o.status in ('delivered', 'cancelled'))
  into v_in_flight, v_historical
  from public.orders o
  where o.address_id = old.id;

  if v_in_flight > 0 then
    raise exception 'ADDRESS_IN_USE: this address is on % order(s) still on the way, so it cannot be deleted yet', v_in_flight;
  end if;

  if v_historical > 0 then
    raise exception 'ADDRESS_ON_PAST_ORDER: this address is kept on % past order(s) and cannot be deleted', v_historical;
  end if;

  return old;
end;
$$;

create trigger addresses_block_delete_in_use
  before delete on public.addresses
  for each row execute function public.block_delete_address_in_use();
