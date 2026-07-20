-- ATLITOS v2 — 0035_order_state_machine.sql
-- Domain: commerce. Epic P4, story AT-69.
-- Requirements: PRD-07 FR-24; PRD-04 FR-22, FR-23 for the admin caller.
--
-- Orders get the same shape sessions and court bookings already have: ONE
-- SECURITY DEFINER RPC owns the whole machine and raises INVALID_TRANSITION on
-- an illegal edge. There is no client code anywhere that sets orders.status,
-- and 0032 granted no UPDATE on `orders` to anon or authenticated by policy or
-- by grant, so this function plus the finalize handler are the only things in
-- the system that can change an order row at all.
--
-- MACHINE (SCHEMA.md order_status, packages/types ORDER_TRANSITIONS, which is
-- the client-side mirror of exactly this and must stay in step):
--
--   placed     -> shipped | cancelled
--   shipped    -> in_transit
--   in_transit -> delivered
--   delivered  -> (terminal)
--   cancelled  -> (terminal)
--
-- Strictly forward, no skips. PHASE-4-STATUS.md gate clause 2 requires a skip
-- attempt to be REJECTED with INVALID_TRANSITION, so placed -> delivered is a
-- failure and not a convenience. `cancelled` is reachable only from `placed`,
-- matching the v1 state machine; there is deliberately no shopper initiated
-- cancel edge (PRD-07 open question 3, ASSUMED admin only in PHASE-4-STATUS).
--
-- ============================================================================
-- WHY THIS IS service_role ONLY, applying AT-61's rule from PAYMENTS.md
--
-- AT-61 established the general rule for every state machine RPC in this
-- codebase: IF A TRANSITION HAS A MONEY CONSEQUENCE THAT IS NOT WRITTEN INSIDE
-- THE SAME FUNCTION, THE TRANSITION DOES NOT BELONG TO `authenticated`. A
-- SECURITY DEFINER function that only moves a status is safe to grant broadly;
-- one whose money half lives in an edge function is not, because a client
-- calling it directly performs half a money event and drops the other half.
--
-- Both of this machine's meaningful callers are in that category:
--
--   * ADVANCEMENT is admin driven through the `admin-order-advance` edge
--     function, which must also write one `audit_log` row (PRD-04 FR-23,
--     gate clause 2). `audit_log` carries no authenticated write policy at
--     all, so a bare RPC call would advance the order and leave no audit
--     trail, which is the whole point of the admin action being audited.
--
--   * CANCELLATION is refund adjacent. A cancelled order that was paid for
--     owes the shopper their money back, and that refund is issued by
--     `admin-order-refund` through AT-60's `refunds` + settle_refund
--     machinery. A bare RPC call would cancel the order and never repay
--     anyone, which is the exact shape of the hole AT-61 closed for sessions.
--
-- The enforcement is a GRANT, not a check on request.jwt.claims. A SECURITY
-- DEFINER function is the wrong place to trust a GUC string; AT-61 says so and
-- this follows it. There is no `authenticated`-facing wrapper here at all,
-- because unlike sessions there is no non-money order transition a client
-- would legitimately call. The shopper app never writes a lifecycle
-- transition (PRD-07 FR-24); it only reads the timeline this function writes.
--
-- ============================================================================
-- THE TIMELINE ROW IS WRITTEN HERE, IN THE SAME TRANSACTION
--
-- One `order_timeline` row per accepted transition, inside the same statement
-- pair as the status change, so the timeline can never disagree with the order
-- it describes. If they were written by two separate calls, a failure between
-- them would leave PRD-07 FR-24's OrderTimeline lying to the shopper about
-- where their parcel is.
--
-- The initial `placed` row is NOT written here. It is written by the finalize
-- handler (AT-72) in the same transaction that creates the order, because at
-- that moment there is no transition, there is a creation.
--
-- NO LEDGER WRITE HERE, consistent with 0021's header note 1 and 0009's note
-- 7. CLAUDE.md is unambiguous that ledger writes happen only in edge functions
-- under the service role. This function moves status and writes a timeline row
-- and nothing else.
-- ============================================================================

create function public.order_transition(
  p_order_id uuid,
  p_to_status public.order_status,
  p_actor_id uuid default null,
  p_note text default null,
  p_location text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_allowed public.order_status[];
begin
  if p_order_id is null or p_to_status is null then
    raise exception 'VALIDATION: order id and target status are both required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'NOT_FOUND: order % does not exist', p_order_id;
  end if;

  -- The machine, in one place. Mirrors packages/types ORDER_TRANSITIONS.
  v_allowed := case v_order.status
    when 'placed'     then array['shipped', 'cancelled']::public.order_status[]
    when 'shipped'    then array['in_transit']::public.order_status[]
    when 'in_transit' then array['delivered']::public.order_status[]
    when 'delivered'  then array[]::public.order_status[]
    when 'cancelled'  then array[]::public.order_status[]
  end;

  if not (p_to_status = any (v_allowed)) then
    raise exception 'INVALID_TRANSITION: order % cannot move from % to %',
      p_order_id, v_order.status, p_to_status;
  end if;

  update public.orders
  set status = p_to_status
  where id = p_order_id
  returning * into v_order;

  insert into public.order_timeline (order_id, status, note, location, actor_id)
  values (p_order_id, p_to_status, p_note, p_location, p_actor_id);

  return v_order;
end;
$$;

revoke all on function public.order_transition(uuid, public.order_status, uuid, text, text) from public;
revoke execute on function public.order_transition(uuid, public.order_status, uuid, text, text) from anon, authenticated;
grant execute on function public.order_transition(uuid, public.order_status, uuid, text, text) to service_role;
