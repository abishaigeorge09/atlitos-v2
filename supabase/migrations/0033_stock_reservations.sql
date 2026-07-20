-- ATLITOS v2 — 0033_stock_reservations.sql
-- Domain: commerce. Epic P4, story AT-67.
-- Requirements: PRD-07 FR-9, FR-18, FR-20, FR-21.
-- Implements decision D2 in docs/phases/PHASE-4-STATUS.md.
--
-- ============================================================================
-- WHY THIS EXISTS AT ALL
--
-- An oversell is a money bug. Neither courts nor sessions had this problem: a
-- slot is protected by a partial unique index, which is a binary yes or no.
-- Stock is a COUNTER, and a counter has a window between "the shopper
-- committed" and "the money landed" during which a second shopper can spend
-- the same unit.
--
-- D2 rejected two simpler designs and the reasons are recorded there, not
-- re-argued here. Do not substitute a different approach without reopening D2.
--
-- ============================================================================
-- THE SHARED EXPRESSION, AND WHY THERE IS EXACTLY ONE OF IT
--
-- Available stock is:
--
--     product_variants.stock
--   - sum(stock_reservations.qty) where status = 'held' and expires_at > now()
--
-- That arithmetic is written ONCE, in the view `product_variant_availability`
-- below, and every other consumer reads THROUGH that view:
--
--   * the PDP, cart and checkout screens select from the view directly
--   * variant_available_stock(uuid) selects from the view
--   * add_to_cart / update_cart_item (0034) call variant_available_stock
--   * reserve_stock_for_checkout (below) selects from the view
--
-- Nothing re-derives it. This is deliberate and it is the point: if the PDP
-- and the checkout each carried their own copy of that subtraction, they would
-- drift, and the shopper-visible symptom of the drift would be a checkout that
-- fails on a line the product page said was in stock. If you need available
-- stock somewhere new, read the view. Do not paste the arithmetic.
--
-- ============================================================================
-- WHY THE VIEW IS SECURITY DEFINER, STATED PLAINLY FOR THE RLS ADVISOR DIFF
--
-- `stock_reservations` has RLS enabled and NO policies, and its DML and SELECT
-- grants are withdrawn from anon and authenticated entirely. That is correct:
-- the table records who is mid-checkout on which variant, which is other
-- shoppers' purchase activity and none of a browsing user's business.
--
-- A view defaults to security_invoker = false, so it runs as its owner and
-- reads the reservation rows the caller cannot. That is exactly what is wanted
-- here, and the alternative is worse in a way that is easy to miss: with
-- security_invoker = true, the caller's own RLS would apply to the join, the
-- reservation side would return zero rows for every client, held_qty would
-- silently compute as 0, and the view would report RAW stock while claiming to
-- report available. That failure is invisible and it oversells. The definer
-- view is the safe choice, not a shortcut.
--
-- The view reproduces the catalog's public predicate itself (`products.active`)
-- so that bypassing RLS does not widen what a browser can see beyond what
-- 0032's products_select_public already grants. A variant of a deactivated
-- product simply has no row here, which every consumer reads as zero
-- available. For a cart line that is the correct outcome (PRD-07 FR-12 blocks
-- Proceed To Buy), and for checkout it correctly refuses to sell a delisted
-- product.
--
-- This view is an intentional, documented entry in the RLS advisor diff at the
-- P4 gate. It is recorded in RLS.md in the same change.
-- ============================================================================

create type public.stock_reservation_status as enum (
  'held',
  'consumed',
  'released'
);

-- ============================================================================
-- THE TTL, AS A SINGLE NAMED CONSTANT
--
-- 15 minutes, chosen to exceed the Razorpay checkout sheet's practical
-- lifetime with margin. It is deliberately NOT a fee_config value: fee_config
-- holds prices, and versioned price history is meaningful there. This is an
-- operational timeout, it has no money meaning, and putting it in fee_config
-- would invite an admin to edit it from a pricing screen.
--
-- One function, referenced everywhere, so the value cannot be half-changed.
-- ============================================================================

create function public.stock_reservation_ttl()
returns interval
language sql
immutable
as $$
  select interval '15 minutes';
$$;

comment on function public.stock_reservation_ttl() is
  'PHASE-4-STATUS.md D2: the single definition of the stock reservation TTL. Change it here or nowhere.';

-- ============================================================================
-- stock_reservations
--
-- One row per (payment intent, variant). Written by reserve_stock_for_checkout
-- inside the `checkout` edge function BEFORE Razorpay is called, so the units
-- are held while the shopper is looking at the payment sheet.
--
-- Note what this table does NOT do: it never touches product_variants.stock.
-- Raw stock stays truthful for every admin readout in PRD-04 FR-13 and FR-17
-- throughout the hold. Stock moves exactly once, at capture, in
-- consume_reservation.
-- ============================================================================

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  product_variant_id uuid not null references public.product_variants (id),
  qty int not null check (qty > 0),
  status public.stock_reservation_status not null default 'held',
  expires_at timestamptz not null,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_intent_id, product_variant_id)
);

-- The hot path is "sum the held, unexpired qty for this variant", which is the
-- view's lateral subquery on every catalog read. This partial index is what
-- keeps that from scanning the whole table as order volume accumulates:
-- consumed and released rows are history and are never summed.
create index idx_stock_reservations_held_by_variant
  on public.stock_reservations (product_variant_id, expires_at)
  where status = 'held';

-- The sweep (AT-26) and the three exits all resolve by payment intent.
create index idx_stock_reservations_payment_intent
  on public.stock_reservations (payment_intent_id);

create trigger stock_reservations_set_updated_at
  before update on public.stock_reservations
  for each row execute function public.set_updated_at();

-- RLS on, no policies, and the grants withdrawn outright. service_role is the
-- only reader and the only writer, through the three RPCs below. This is the
-- same two-lock pattern 0010_payments_core.sql used for webhook_events.
alter table public.stock_reservations enable row level security;
revoke all on public.stock_reservations from anon, authenticated;

-- ============================================================================
-- product_variant_availability. THE shared expression. See the header.
-- ============================================================================

create view public.product_variant_availability as
select
  pv.id                                              as product_variant_id,
  pv.product_id                                      as product_id,
  pv.sku                                             as sku,
  pv.size                                            as size,
  pv.color                                           as color,
  coalesce(pv.price_override, p.base_price)          as effective_price,
  pv.stock                                           as stock,
  coalesce(h.held_qty, 0)                            as held_qty,
  greatest(0, pv.stock - coalesce(h.held_qty, 0))    as available_stock
from public.product_variants pv
join public.products p
  on p.id = pv.product_id
 and p.active
left join lateral (
  select coalesce(sum(sr.qty), 0)::int as held_qty
  from public.stock_reservations sr
  where sr.product_variant_id = pv.id
    and sr.status = 'held'
    and sr.expires_at > now()
) h on true;

comment on view public.product_variant_availability is
  'PHASE-4-STATUS.md D2: the ONE definition of available stock (raw stock minus held, unexpired reservations). Every shopper-facing stock read and every reservation RPC goes through this view. Do not re-derive the arithmetic anywhere else. Intentionally security definer so the reservation join is not silently zeroed by RLS; see 0033 header.';

grant select on public.product_variant_availability to anon, authenticated, service_role;

-- ============================================================================
-- variant_available_stock: the scalar form of the same view, for the RPCs and
-- for any single-variant check. It SELECTS FROM THE VIEW rather than repeating
-- the subtraction, which is the whole discipline of this file.
-- ============================================================================

create function public.variant_available_stock(p_variant_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select a.available_stock
      from public.product_variant_availability a
      where a.product_variant_id = p_variant_id
    ),
    0
  );
$$;

revoke all on function public.variant_available_stock(uuid) from public;
grant execute on function public.variant_available_stock(uuid) to anon, authenticated, service_role;

-- ============================================================================
-- reserve_stock_for_checkout
--
-- Called by the `checkout` edge function (AT-71) BEFORE Razorpay is invoked.
-- All lines or none.
--
-- LOCK ORDER. Every product_variants row in the order is locked FOR UPDATE in
-- ascending product_variant_id order. Two overlapping carts therefore always
-- request the same rows in the same sequence, which makes a lock-order
-- deadlock impossible rather than merely unlikely. Do not "optimise" the
-- ORDER BY away.
--
-- WHY THE LOCK IS ON product_variants AND NOT ON stock_reservations. The row
-- being contended is the variant's stock. Locking the variant row first is
-- what serialises two concurrent reservations against the same variant: the
-- second waits, and when it proceeds it re-reads the view and sees the first
-- transaction's held row. This holds ONLY because every writer of
-- stock_reservations takes the variant lock first, and this function is the
-- only writer of `held` rows in the system. If a second reservation writer is
-- ever added, it must take the same lock in the same order or this guarantee
-- is gone.
--
-- Raises OUT_OF_STOCK naming EVERY offending line, not just the first, so the
-- client can flag them all at once when it routes the shopper back to cart
-- (PRD-07 FR-20, AC-D5).
-- ============================================================================

create function public.reserve_stock_for_checkout(
  p_payment_intent_id uuid,
  p_lines jsonb
)
returns setof public.stock_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offending text;
  v_line_count int;
  v_distinct_count int;
  v_expires_at timestamptz := now() + public.stock_reservation_ttl();
begin
  if p_payment_intent_id is null then
    raise exception 'VALIDATION: payment_intent_id is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VALIDATION: p_lines must be a non-empty json array of {product_variant_id, qty}';
  end if;

  -- The payload is parsed with jsonb_to_recordset in each statement below.
  -- That is a pure function of the argument, not duplicated logic, and it
  -- avoids creating a temp table per call on a pooled connection.

  select count(*), count(distinct product_variant_id)
    into v_line_count, v_distinct_count
  from jsonb_to_recordset(p_lines) as rl(product_variant_id uuid, qty int);

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as rl(product_variant_id uuid, qty int)
    where rl.product_variant_id is null or rl.qty is null or rl.qty <= 0
  ) then
    raise exception 'VALIDATION: every line needs a product_variant_id and a qty greater than zero';
  end if;

  if v_line_count <> v_distinct_count then
    raise exception 'VALIDATION: p_lines contains the same product_variant_id twice; merge the quantities first';
  end if;

  if exists (
    select 1 from public.stock_reservations
    where payment_intent_id = p_payment_intent_id
  ) then
    raise exception 'ALREADY_RESERVED: payment intent % already holds a reservation', p_payment_intent_id;
  end if;

  -- Serialisation point. Ascending id order, deliberately. See header.
  perform pv.id
  from public.product_variants pv
  where pv.id in (
    select rl.product_variant_id
    from jsonb_to_recordset(p_lines) as rl(product_variant_id uuid, qty int)
  )
  order by pv.id
  for update;

  -- Re-derive availability AFTER the lock, through the shared view.
  select string_agg(rl.product_variant_id::text, ', ' order by rl.product_variant_id)
    into v_offending
  from jsonb_to_recordset(p_lines) as rl(product_variant_id uuid, qty int)
  where public.variant_available_stock(rl.product_variant_id) < rl.qty;

  if v_offending is not null then
    raise exception 'OUT_OF_STOCK: insufficient available stock for variant(s) %', v_offending;
  end if;

  return query
  insert into public.stock_reservations (
    payment_intent_id, product_variant_id, qty, status, expires_at
  )
  select p_payment_intent_id, rl.product_variant_id, rl.qty, 'held', v_expires_at
  from jsonb_to_recordset(p_lines) as rl(product_variant_id uuid, qty int)
  returning *;
end;
$$;

revoke all on function public.reserve_stock_for_checkout(uuid, jsonb) from public;
revoke execute on function public.reserve_stock_for_checkout(uuid, jsonb) from anon, authenticated;
grant execute on function public.reserve_stock_for_checkout(uuid, jsonb) to service_role;

-- ============================================================================
-- consume_reservation
--
-- Exit 1 of 3: PAID. Called by finalize-order-payment.ts (AT-72) in the SAME
-- transaction as the `orders` and `order_items` inserts, which is PRD-07
-- FR-21's atomicity requirement. One plpgsql function, so it cannot be half
-- done: either the stock moved and the reservations are consumed, or the whole
-- transaction rolled back and nothing did.
--
-- ============================================================================
-- THE GUARDED DECREMENT, AND WHY IT IS SAFE UNDER CONCURRENCY
--
--   update product_variants pv
--   set stock = pv.stock - l.qty
--   from lines l
--   where pv.id = l.product_variant_id
--     and pv.stock >= l.qty        <-- the guard
--
-- Two simultaneous captures for the last unit CANNOT both succeed, and the
-- reason is Postgres' READ COMMITTED update semantics rather than anything
-- written here. When T2's UPDATE meets a row T1 has locked, T2 blocks. When T1
-- commits, T2 does not proceed on its stale snapshot: it re-fetches the
-- updated row and RE-EVALUATES the WHERE clause against the new version
-- (EvalPlanQual). With stock 1 and both wanting 1, T1 writes stock = 0, and
-- T2's re-evaluated guard reads 0 >= 1, which is false, so T2's row is simply
-- not updated. The row count check below turns that into OUT_OF_STOCK.
--
-- This is proven, not assumed: see the two-connection dblink probe recorded in
-- PHASE-4-STATUS.md, where the loser raised OUT_OF_STOCK and stock finished at
-- 0 rather than -1.
--
-- CHECK (stock >= 0) on product_variants sits underneath all of this as a last
-- resort. If it ever fires, the guard above failed and that is a FAILED gate,
-- not a passed one (PHASE-4-STATUS.md gate clause 4).
--
-- ============================================================================
-- IDEMPOTENCE, because webhooks are redelivered
--
-- If every reservation for the intent is already `consumed`, this returns
-- without touching stock a second time. razorpay-webhook can and does redeliver
-- `payment.captured`, and a double decrement would be an invisible inventory
-- loss rather than a loud failure.
--
-- ============================================================================
-- THE LATE CAPTURE, stated explicitly because it is the ugly case (D2)
--
-- A capture that arrives after the TTL finds its reservation expired, or
-- already swept to `released` by AT-26. The handler does NOT trust that row.
-- This function accepts `held` and `released` rows alike and re-attempts the
-- guarded decrement. If it succeeds, the order is created normally and the
-- reservation is marked consumed late. If it fails, the stock genuinely went
-- to someone else, OUT_OF_STOCK is raised, the caller's whole transaction
-- rolls back so NO order row is created, and the caller issues an automatic
-- full refund through AT-60's existing `refunds` + settle_refund machinery.
-- Do not invent a second refund path for this.
-- ============================================================================

create function public.consume_reservation(p_payment_intent_id uuid)
returns setof public.stock_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_consumed int;
  v_pending int;
  v_updated int;
begin
  if p_payment_intent_id is null then
    raise exception 'VALIDATION: payment_intent_id is required';
  end if;

  -- Lock the whole reservation group for this intent up front, so two
  -- concurrent deliveries of the same webhook serialise here rather than
  -- racing through the decrement below.
  --
  -- The lock is its own statement because Postgres refuses FOR UPDATE in a
  -- query carrying an aggregate ("FOR UPDATE is not allowed with aggregate
  -- functions"), so the count has to be taken separately, after the rows are
  -- locked. Ordered by id for the same lock-ordering reason as
  -- reserve_stock_for_checkout.
  perform 1
  from public.stock_reservations
  where payment_intent_id = p_payment_intent_id
  order by id
  for update;

  select
    count(*),
    count(*) filter (where status = 'consumed')
  into v_total, v_consumed
  from public.stock_reservations
  where payment_intent_id = p_payment_intent_id;

  if v_total = 0 then
    raise exception 'NO_RESERVATION: payment intent % holds no stock reservation', p_payment_intent_id;
  end if;

  if v_consumed = v_total then
    -- Already applied. Idempotent no-op for a redelivered capture.
    return query
      select * from public.stock_reservations
      where payment_intent_id = p_payment_intent_id;
    return;
  end if;

  if v_consumed > 0 then
    -- Unreachable by construction: every line is consumed in one statement
    -- inside one transaction. If it ever happens, something wrote this table
    -- outside these RPCs and the inventory is no longer trustworthy, so fail
    -- loudly rather than paper over half a consumption.
    raise exception 'PARTIAL_RESERVATION: payment intent % has % of % lines consumed',
      p_payment_intent_id, v_consumed, v_total;
  end if;

  v_pending := v_total;

  -- The guarded decrement. See the header block for the concurrency argument.
  with lines as (
    select product_variant_id, qty
    from public.stock_reservations
    where payment_intent_id = p_payment_intent_id
      and status <> 'consumed'
  ),
  upd as (
    update public.product_variants pv
    set stock = pv.stock - l.qty
    from lines l
    where pv.id = l.product_variant_id
      and pv.stock >= l.qty
    returning pv.id
  )
  select count(*) into v_updated from upd;

  if v_updated <> v_pending then
    raise exception 'OUT_OF_STOCK: stock moved before capture, % of % lines could not be decremented for payment intent %',
      v_pending - v_updated, v_pending, p_payment_intent_id;
  end if;

  return query
  update public.stock_reservations
  set status = 'consumed'
  where payment_intent_id = p_payment_intent_id
    and status <> 'consumed'
  returning *;
end;
$$;

revoke all on function public.consume_reservation(uuid) from public;
revoke execute on function public.consume_reservation(uuid) from anon, authenticated;
grant execute on function public.consume_reservation(uuid) to service_role;

-- ============================================================================
-- release_reservation
--
-- Exit 2 of 3: FAILED. Called on `payment.failed`, or when `checkout`'s own
-- Razorpay call throws (AT-73).
--
-- It flips `held` to `released` and touches product_variants NOT AT ALL,
-- because nothing was ever decremented. That asymmetry with consume is the
-- entire benefit of the reservation design: there is no "add it back" step to
-- get wrong, and a crashed edge function cannot lose the information needed to
-- undo a decrement, because no decrement happened.
--
-- Idempotent: releasing an already released or already consumed group is a
-- no-op. A consumed reservation is deliberately NOT reverted here; if a
-- captured payment later needs unwinding that is a refund, not a release.
-- ============================================================================

create function public.release_reservation(
  p_payment_intent_id uuid,
  p_reason text default null
)
returns setof public.stock_reservations
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_payment_intent_id is null then
    raise exception 'VALIDATION: payment_intent_id is required';
  end if;

  return query
  update public.stock_reservations
  set status = 'released',
      release_reason = coalesce(p_reason, release_reason)
  where payment_intent_id = p_payment_intent_id
    and status = 'held'
  returning *;
end;
$$;

revoke all on function public.release_reservation(uuid, text) from public;
revoke execute on function public.release_reservation(uuid, text) from anon, authenticated;
grant execute on function public.release_reservation(uuid, text) to service_role;

-- ============================================================================
-- release_expired_stock_reservations
--
-- Exit 3 of 3: ABANDONED. Nothing arrives at all, the TTL passes, and the held
-- units must return to the sellable pool.
--
-- This is the SEAM for AT-26 (Track B), which owns the unified pg_cron sweep
-- across courts, sessions and commerce. It is deliberately NOT scheduled here:
-- this migration provides the commerce arm as a callable set-based function,
-- and AT-26's expire_stale_holds() calls it alongside
-- court_booking_expire_payment and session_abandon_unpaid.
--
-- Note that the availability view already ignores expired holds via
-- `expires_at > now()`, so an unswept row does not oversell and does not
-- strand inventory in the shopper-visible sense. The sweep exists to keep the
-- table's status column honest, to keep the partial index small, and to give
-- the approver something countable. Correctness does not depend on the sweep's
-- latency, which is the property that makes this safe to hand to a cron job.
-- ============================================================================

create function public.release_expired_stock_reservations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released int;
begin
  with expired as (
    update public.stock_reservations
    set status = 'released',
        release_reason = coalesce(release_reason, 'expired: checkout abandoned past TTL')
    where status = 'held'
      and expires_at <= now()
    returning 1
  )
  select count(*) into v_released from expired;

  return v_released;
end;
$$;

revoke all on function public.release_expired_stock_reservations() from public;
revoke execute on function public.release_expired_stock_reservations() from anon, authenticated;
grant execute on function public.release_expired_stock_reservations() to service_role;
