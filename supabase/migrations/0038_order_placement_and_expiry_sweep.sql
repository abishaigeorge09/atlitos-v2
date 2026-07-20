-- ATLITOS v2 — 0038_order_placement_and_expiry_sweep.sql
-- Domain: commerce payments + platform hygiene. Epic P4, stories AT-71, AT-72,
-- AT-73, AT-26.
-- Requirements: PRD-07 FR-16, FR-17, FR-18, FR-21, FR-22, FR-25, FR-30.
-- Implements decisions D1, D2 and D3 in docs/phases/PHASE-4-STATUS.md, plus
-- the founder decisions recorded there on 2026-07-20 (roundup to the next
-- multiple of 10, flat per order delivery charge).
--
-- Five things, in this order:
--
--   1. The commerce fee_config rows. They did not exist; every price this
--      phase charges reads through them.
--   2. The orders address SNAPSHOT, which Track A flagged and could not take.
--   3. order_drafts: the priced bill, held between `checkout` and capture.
--   4. place_order_from_draft: consume the reservation, create the order, its
--      items and its first timeline row, in ONE transaction (FR-21).
--   5. expire_stale_holds() and its pg_cron schedule: AT-26, all three
--      domains, deferred twice already and not a third time.

-- ============================================================================
-- 1. COMMERCE fee_config
--
-- PAYMENTS.md's "fee_config in practice" query reads the newest row whose
-- effective_from has passed, so an admin edit is always a new row and never an
-- UPDATE. These are the first commerce rows to exist.
--
-- `commerce.donation_roundup_multiple` REPLACES the plan's assumed
-- `commerce.donation_roundup_flat`, per the founder decision of 2026-07-20:
-- the roundup is no longer a fixed figure, it is the distance from the
-- post-delivery, post-GST total up to the next multiple of this number. The
-- key is still config driven, which is what PRD-07 FR-16 actually asks for
-- ("config driven, not user typed"); only the arithmetic changed. `flat` is
-- the right value_type because 10 is a rupee quantum, not a percentage of
-- anything.
--
-- The multiple is deliberately NOT hardcoded in the checkout edge function.
-- Rounding to the next 50 later must be a fee_config insert, not a redeploy.
-- ============================================================================

insert into public.fee_config (domain, key, value, value_type, effective_from)
values
  ('commerce', 'gst_percent', 0.18, 'percentage', now()),
  ('commerce', 'delivery_flat', 50.00, 'flat', now()),
  ('commerce', 'donation_roundup_multiple', 10.00, 'flat', now());

-- ============================================================================
-- 2. THE ADDRESS SNAPSHOT ON orders
--
-- Track A's handoff note 1 in PHASE-4-STATUS.md, assigned to Track B because
-- Track B owns the order insert. The bug: `orders.address_id` was a live
-- foreign key, so a shopper editing a saved address retroactively rewrote
-- where a past order appears to have shipped. That is the SAME bug class the
-- plan's D4 principle already forbids for prices ("snapshot, do not
-- recompute"): order_items freezes the product title, the variant label and
-- the unit price precisely so a later admin edit cannot rewrite what a shopper
-- was charged, and the delivery address deserves exactly the same treatment.
-- PRD-07 FR-25's "recaps the BillSummary exactly as charged at checkout time"
-- and FR-30's address book cannot both hold without this.
--
-- Five columns, matching public.addresses' shape from 0001_identity.sql. They
-- are written by place_order_from_draft below and NEVER updated afterwards.
-- Order Detail reads THESE, not the join.
--
-- address_id survives, nullable now and ON DELETE SET NULL, as the pointer to
-- "which saved address was picked", useful for a Reorder affordance and for
-- support. It is no longer the source of truth for where the parcel went, and
-- nothing may render from it.
--
-- The table is empty (Track A removed every fixture), so NOT NULL lands
-- directly with no backfill. If this migration ever runs against rows, it will
-- fail loudly, which is correct: an order with no recorded delivery address is
-- not a row anyone should invent a value for.
-- ============================================================================

alter table public.orders
  add column ship_to_line1 text not null,
  add column ship_to_line2 text,
  add column ship_to_city text not null,
  add column ship_to_state text not null,
  add column ship_to_pincode text not null
    check (ship_to_pincode ~ '^[0-9]{6}$');

alter table public.orders
  alter column address_id drop not null;

alter table public.orders
  drop constraint orders_address_id_fkey;

alter table public.orders
  add constraint orders_address_id_fkey
    foreign key (address_id) references public.addresses (id) on delete set null;

comment on column public.orders.ship_to_line1 is
  'Address SNAPSHOT, frozen at order creation (AT-72). This, not the address_id join, is what Order Detail renders. See 0038 section 2.';
comment on column public.orders.address_id is
  'Which saved address was picked, for Reorder and support only. Nullable and ON DELETE SET NULL since 0038: the snapshot columns are the source of truth.';

-- The delete guard from 0036 can now stop blocking historical orders. With the
-- snapshot in place, deleting an address a DELIVERED or CANCELLED order used
-- loses nothing: the order still renders the address it actually shipped to.
-- ADDRESS_ON_PAST_ORDER therefore stops being raised, and FR-30's address book
-- delete finally works the way a shopper expects. ADDRESS_IN_USE stays exactly
-- as it was for orders still on the way, which is AC-F3 and is unaffected.
create or replace function public.block_delete_address_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in_flight int;
begin
  select count(*)
  into v_in_flight
  from public.orders o
  where o.address_id = old.id
    and o.status not in ('delivered', 'cancelled');

  if v_in_flight > 0 then
    raise exception 'ADDRESS_IN_USE: this address is on % order(s) still on the way, so it cannot be deleted yet', v_in_flight;
  end if;

  -- Delivered and cancelled orders no longer block. They keep their own
  -- ship_to_* snapshot (0038 section 2) and the FK nulls itself out.
  return old;
end;
$$;

-- ============================================================================
-- 3. order_drafts
--
-- The problem this solves. PAYMENTS.md is explicit that the `orders` row is
-- NOT created at checkout time, only after capture, "so `placed` never exists
-- without a paid intent behind it". But the bill is priced at checkout time,
-- by the server, and D4 forbids recomputing it later: a price edit between the
-- checkout sheet opening and the webhook arriving must not change what the
-- shopper is charged, and the roundup in particular is derived from a cart
-- that no longer exists by then.
--
-- So the priced bill has to be parked somewhere between the two moments. This
-- is that somewhere. It holds exactly what the future order row and its items
-- will contain, computed once, and the finalize handler copies rather than
-- re-derives.
--
-- Rejected: stashing the bill in payment_intents (it has one amount column and
-- no room for lines), and recomputing at capture (D4 forbids it, and it would
-- reintroduce PRICE_MISMATCH's whole failure mode after the money landed).
--
-- Not a money row in the ledger sense, but written and read by service_role
-- only, same two-lock pattern as stock_reservations: RLS on, no policies,
-- grants withdrawn. A draft is an intention, and a client that could edit one
-- could edit the price it is about to be charged.
-- ============================================================================

create table public.order_drafts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null unique
    references public.payment_intents (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  address_id uuid references public.addresses (id) on delete set null,
  ship_to_line1 text not null,
  ship_to_line2 text,
  ship_to_city text not null,
  ship_to_state text not null,
  ship_to_pincode text not null check (ship_to_pincode ~ '^[0-9]{6}$'),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  delivery_charges numeric(12, 2) not null default 0 check (delivery_charges >= 0),
  gst_and_others numeric(12, 2) not null default 0 check (gst_and_others >= 0),
  donation_roundup numeric(12, 2) not null default 0 check (donation_roundup >= 0),
  total numeric(12, 2) not null check (total >= 0),
  -- [{product_variant_id, qty, unit_price, product_title_snapshot,
  --   variant_label_snapshot}], already snapshotted at checkout time.
  lines jsonb not null,
  created_at timestamptz not null default now(),
  -- Same arithmetic constraint the orders table carries, enforced here too so
  -- a draft can never be the thing that makes an order violate it.
  constraint order_drafts_total_is_the_sum_of_its_rows check (
    total = subtotal + delivery_charges + gst_and_others + donation_roundup
  )
);

alter table public.order_drafts enable row level security;
revoke all on public.order_drafts from anon, authenticated;

comment on table public.order_drafts is
  'The server priced bill, parked between `checkout` and capture. PAYMENTS.md keeps the orders row until capture; D4 forbids recomputing the bill then. Written by the checkout edge function, read once by place_order_from_draft. service_role only.';

-- ============================================================================
-- 4. place_order_from_draft
--
-- AT-72. Called by _shared/finalize-order-payment.ts, which is the `commerce`
-- leg of the shared capture gate, and by nothing else.
--
-- ONE TRANSACTION, which is PRD-07 FR-21 stated literally: "stock decrement
-- for every purchased variant and order row creation happen in a single
-- transactional unit ... a payment success with a failed stock decrement is
-- not a reachable state". A PostgREST rpc call is one transaction, so putting
-- consume_reservation and both inserts inside one plpgsql function is what
-- makes that true rather than aspirational. Splitting them across two edge
-- function calls would make the unreachable state reachable.
--
-- IDEMPOTENT, because webhooks are redelivered and verify-payment races them.
-- The shared gate already guarantees only one caller reaches the handler per
-- charge, but this function does not lean on that alone: if an order already
-- exists for the intent it is returned untouched, no second decrement, no
-- second timeline row.
--
-- THE LATE CAPTURE, per D2. consume_reservation raises OUT_OF_STOCK if the
-- guarded decrement cannot be applied because stock genuinely went to someone
-- else after the TTL lapsed. That exception propagates out of here and rolls
-- back the WHOLE transaction, so no order row is created, which is exactly
-- what D2 requires ("keep the money nowhere"). The caller then issues the
-- automatic refund through AT-60's existing refunds + settle_refund machinery.
--
-- NO LEDGER WRITE HERE, deliberately, and this is the one place it is worth
-- spelling out. CLAUDE.md: "ledger writes happen only in edge functions
-- running under the service role." finalize-court-booking-payment.ts writes
-- its balanced group as a single multi-row INSERT from the edge function after
-- its RPC returns, and the commerce handler follows that same shape rather
-- than inventing a second one. One INSERT statement is one atomic write of the
-- whole group, and assert_ledger_group_balanced still checks it.
--
-- THE CART IS CLEARED HERE. The lines just became an order, so leaving them in
-- the cart would show the shopper a cart they have already paid for. It is
-- their own row, not a money row, and it belongs in the same transaction as
-- the order for the same reason the timeline row does.
-- ============================================================================

create function public.place_order_from_draft(p_payment_intent_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.order_drafts;
  v_order public.orders;
begin
  if p_payment_intent_id is null then
    raise exception 'VALIDATION: payment_intent_id is required';
  end if;

  -- Idempotency first, before anything is locked or decremented.
  select * into v_order
  from public.orders
  where payment_intent_id = p_payment_intent_id;

  if v_order.id is not null then
    return v_order;
  end if;

  select * into v_draft
  from public.order_drafts
  where payment_intent_id = p_payment_intent_id
  for update;

  if v_draft.id is null then
    raise exception 'NO_DRAFT: payment intent % has no order draft; it was not created by the checkout function', p_payment_intent_id;
  end if;

  -- Exit 1 of D2's three. Raises OUT_OF_STOCK on the late capture, which
  -- rolls this whole transaction back. See the header.
  perform public.consume_reservation(p_payment_intent_id);

  insert into public.orders (
    user_id, address_id,
    ship_to_line1, ship_to_line2, ship_to_city, ship_to_state, ship_to_pincode,
    subtotal, delivery_charges, gst_and_others, donation_roundup, total,
    status, payment_intent_id
  )
  values (
    v_draft.user_id, v_draft.address_id,
    v_draft.ship_to_line1, v_draft.ship_to_line2, v_draft.ship_to_city,
    v_draft.ship_to_state, v_draft.ship_to_pincode,
    v_draft.subtotal, v_draft.delivery_charges, v_draft.gst_and_others,
    v_draft.donation_roundup, v_draft.total,
    'placed', p_payment_intent_id
  )
  returning * into v_order;

  insert into public.order_items (
    order_id, product_variant_id, product_title_snapshot,
    variant_label_snapshot, qty, unit_price
  )
  select
    v_order.id, l.product_variant_id, l.product_title_snapshot,
    l.variant_label_snapshot, l.qty, l.unit_price
  from jsonb_to_recordset(v_draft.lines) as l(
    product_variant_id uuid,
    qty int,
    unit_price numeric(12, 2),
    product_title_snapshot text,
    variant_label_snapshot text
  );

  -- The first timeline row. 0035's header is explicit that order_transition
  -- does not write it, because at this moment there is no transition, there is
  -- a creation. actor_id is null: nobody advanced this order, a payment did.
  insert into public.order_timeline (order_id, status, note)
  values (v_order.id, 'placed', 'Order placed. Payment received.');

  delete from public.cart_items c
  where c.user_id = v_draft.user_id
    and c.product_variant_id in (
      select l.product_variant_id
      from jsonb_to_recordset(v_draft.lines) as l(product_variant_id uuid)
    );

  -- The intent pointed at nothing until now: commerce is the domain whose
  -- entity row is created BY the handler. Setting it here, inside the same
  -- transaction, is what lets the gate's already-processed branch and every
  -- later refund resolve this charge to its order.
  update public.payment_intents
  set entity_id = v_order.id
  where id = p_payment_intent_id;

  return v_order;
end;
$$;

revoke all on function public.place_order_from_draft(uuid) from public;
revoke execute on function public.place_order_from_draft(uuid) from anon, authenticated;
grant execute on function public.place_order_from_draft(uuid) to service_role;

-- ============================================================================
-- 5. AT-26. THE UNIFIED EXPIRY SWEEP.
--
-- Deferred by P2 and again by P3. D3 says not a third time, and gives the
-- reason that makes it structural rather than hygiene: a `held` stock
-- reservation with no release valve strands sellable inventory, so the sweep
-- is now part of the money design and not a tidiness job.
--
-- ONE function, THREE domains, matching D3 exactly:
--
--   courts    court_booking_expire_payment   pending_payment -> expired
--   sessions  session_abandon_unpaid         requested       -> cancelled
--   commerce  release_expired_stock_reservations  held       -> released
--
-- Track A left the commerce arm deliberately unscheduled in 0033 as the seam
-- this function plugs into. It is called set-based; the other two are per-row
-- RPCs and are called in a loop, because both of them enforce guards that must
-- run per row (a captured payment must never have its slot freed).
--
-- WHAT COUNTS AS STALE, and why it is not simply "old".
--
-- Courts: `pending_payment` is by construction a state no one lingers in; the
-- row exists only while a checkout sheet is open. Anything past the TTL is
-- abandoned.
--
-- Sessions: `requested` is NOT by itself stale. A paid session sits in
-- `requested` legitimately, sometimes for days, while it waits for the coach
-- to answer. The stale ones are those whose payment intent is still `created`
-- past the TTL, meaning the checkout sheet was opened and never completed.
-- Sweeping on age alone would cancel sessions athletes have paid for, which
-- would be the worst possible outcome of a hygiene job. session_abandon_unpaid
-- refuses a captured intent as a second line of defence, but the query must be
-- right on its own.
--
-- Commerce: `expires_at <= now()`, which the reservation carries itself.
--
-- ERRORS ARE SWALLOWED PER ROW, not per sweep. A single booking whose guard
-- refuses (the race where a capture landed between the SELECT and the RPC) must
-- not stop the other two domains from being swept. Each failure is counted and
-- returned so a silent no-op sweep is distinguishable from a working one.
--
-- The TTL is shared with commerce's, via one named function, so "how long is a
-- hold" has exactly one answer across all three domains.
-- ============================================================================

create function public.unpaid_hold_ttl()
returns interval
language sql
immutable
as $$
  select public.stock_reservation_ttl();
$$;

comment on function public.unpaid_hold_ttl() is
  'AT-26: how long an unpaid hold survives before the sweep releases it, across courts, sessions and commerce. Defined as the commerce reservation TTL so the three domains cannot drift apart.';

create function public.expire_stale_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - public.unpaid_hold_ttl();
  v_courts int := 0;
  v_court_failures int := 0;
  v_sessions int := 0;
  v_session_failures int := 0;
  v_reservations int := 0;
  v_id uuid;
begin
  -- Courts.
  for v_id in
    select b.id
    from public.court_bookings b
    where b.status = 'pending_payment'
      and b.created_at <= v_cutoff
  loop
    begin
      perform public.court_booking_expire_payment(v_id);
      v_courts := v_courts + 1;
    exception when others then
      v_court_failures := v_court_failures + 1;
    end;
  end loop;

  -- Sessions. See the header for why the payment intent, not the age of the
  -- session row, is what makes one stale.
  for v_id in
    select s.id
    from public.sessions s
    where s.status = 'requested'
      and exists (
        select 1 from public.payment_intents pi
        where pi.entity_id = s.id
          and pi.domain = 'session'
          and pi.status = 'created'
          and pi.created_at <= v_cutoff
      )
      and not exists (
        select 1 from public.payment_intents pi
        where pi.entity_id = s.id
          and pi.domain = 'session'
          and pi.status = 'captured'
      )
  loop
    begin
      perform public.session_abandon_unpaid(v_id);
      v_sessions := v_sessions + 1;
    exception when others then
      v_session_failures := v_session_failures + 1;
    end;
  end loop;

  -- Commerce. Set-based, Track A's seam.
  v_reservations := public.release_expired_stock_reservations();

  return jsonb_build_object(
    'ran_at', now(),
    'cutoff', v_cutoff,
    'court_bookings_expired', v_courts,
    'court_bookings_failed', v_court_failures,
    'sessions_abandoned', v_sessions,
    'sessions_failed', v_session_failures,
    'stock_reservations_released', v_reservations
  );
end;
$$;

revoke all on function public.expire_stale_holds() from public;
revoke execute on function public.expire_stale_holds() from anon, authenticated;
grant execute on function public.expire_stale_holds() to service_role;

comment on function public.expire_stale_holds() is
  'AT-26: the unified expiry sweep across courts, sessions and commerce. Scheduled by pg_cron every 5 minutes. Returns a per domain count so a sweep that ran and did nothing is distinguishable from one that never ran.';

-- ============================================================================
-- The schedule itself. D3: "scheduled has to mean observed to have run, not
-- the cron row exists." Every 5 minutes, comfortably under the 15 minute TTL,
-- so a hold is never stranded for more than a third of its own lifetime past
-- expiry.
--
-- cron.job_run_details is what proves it ran, and it is what the P4 gate is
-- checked against.
-- ============================================================================

create extension if not exists pg_cron;

select cron.schedule(
  'expire-stale-holds',
  '*/5 * * * *',
  $cron$ select public.expire_stale_holds(); $cron$
);
