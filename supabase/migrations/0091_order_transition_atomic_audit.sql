-- ATLITOS v2 — 0091_order_transition_atomic_audit.sql
-- SEC-F5 (P1, security audit 2026-09-04): security and audit records can
-- diverge from the mutations they describe.
--
-- THE BUG, in `admin-order-advance`. Two round trips: `order_transition` moves
-- the order and writes its timeline row in one transaction, and THEN the edge
-- function inserts the audit_log row separately. If that second call fails, the
-- order is already advanced and committed; the function returns a 500 saying
-- "advanced but the audit row failed". The operator sees an error for an action
-- that happened, retries, and gets INVALID_TRANSITION because the order already
-- moved. The audit trail is missing the one row that would explain it.
--
-- A SECOND, QUIETER DEFECT in the same block, and the reason this is about
-- accuracy and not only atomicity. The edge function recorded
--
--   before: { status: toStatusPrevious(toStatus) }
--
-- deriving the previous status from the TARGET status through a lookup table,
-- because it had no access to the row as it was before the update. That is a
-- reconstruction, not an observation. It is correct only while the machine
-- stays a straight line, and PRD-04 FR-52..FR-54 wants a before/after diff an
-- auditor can trust. The RPC has `v_order` selected `for update` before the
-- write, so inside the transaction the real prior status is simply available.
--
-- THE FIX. Move the audit insert into `order_transition` itself, beside the
-- order_timeline insert it already owns. One transaction: the status change,
-- the timeline row and the audit row commit together or not at all, and the
-- before value is read rather than inferred. `admin-order-advance` drops its
-- separate insert in the same change.
--
-- Safe because `order_transition` has exactly one caller. It is granted to
-- `service_role` only (AT-61's rule) and `admin-order-advance` is the sole path
-- to it (0032, 0039, and apps/admin/src/pages/commerce/api.ts all say so, and
-- money/admin.spec.ts asserts an admin JWT cannot call it directly), so folding
-- the audit in cannot start writing audit rows for some other flow.
--
-- The function body below is 0035's, unchanged except for the audit insert and
-- the v_before capture. Signature, grants, machine and error strings are all
-- identical, so no caller and no test that keys on them changes.

create or replace function public.order_transition(
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
  v_before public.order_status;
begin
  if p_order_id is null or p_to_status is null then
    raise exception 'VALIDATION: order id and target status are both required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'NOT_FOUND: order % does not exist', p_order_id;
  end if;

  -- Observed, not reconstructed. This is the value SEC-F5 wanted in the audit
  -- row, and it is only knowable here, inside the transaction, before the
  -- update lands.
  v_before := v_order.status;

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

  -- SEC-F5. PRD-04 FR-23/FR-53's one audit row per accepted advance, written
  -- in the same transaction as the transition it describes. A rejected
  -- transition raised above and never reaches here, so a refused advance still
  -- leaves no audit row claiming something happened.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    p_actor_id,
    'order.advance',
    'order',
    p_order_id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', v_order.status),
    nullif(
      btrim(concat_ws(', ', nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))),
      ''
    )
  );

  return v_order;
end;
$$;

comment on function public.order_transition(uuid, public.order_status, uuid, text, text) is
  'AT-69 + SEC-F5. The whole order machine. Raises INVALID_TRANSITION on any skip or illegal edge, and writes the order_timeline row AND the audit_log row in the same transaction as the status change, so an operator can never see a moved order with no record of who moved it. service_role only; admin-order-advance is the sole caller.';
