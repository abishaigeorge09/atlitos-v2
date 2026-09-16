-- 0095_admin_order_refund: order refunds with partials. Splits refunds_one_per_entity (non-commerce one-per-entity + AT-73 one-per-intent preserved; commerce order one-pending). claim_order_refund + settle_refund partial arm. Service-role only. Proven on prod rolled-back: ledger nets zero, partials, state machine, session preserved.
drop index if exists public.refunds_one_per_entity;
create unique index refunds_one_per_entity_non_commerce on public.refunds (domain, entity_id) where domain <> 'commerce';
create unique index refunds_one_per_unfulfilled_capture on public.refunds (payment_intent_id) where domain = 'commerce' and entity_id = payment_intent_id;
create unique index refunds_one_pending_per_order on public.refunds (domain, entity_id) where domain = 'commerce' and status = 'pending' and entity_id <> payment_intent_id;

create or replace function public.claim_order_refund(p_order_id uuid, p_amount numeric)
returns public.refunds language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_intent public.payment_intents; v_already numeric(12,2); v_remaining numeric(12,2); v_refund public.refunds;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then raise exception 'NOT_FOUND: order % does not exist', p_order_id; end if;
  if v_order.payment_intent_id is null then raise exception 'INVALID_TRANSITION: order % has no payment to refund', p_order_id; end if;
  select * into v_intent from public.payment_intents where id = v_order.payment_intent_id for update;
  if v_intent.id is null then raise exception 'NOT_FOUND: payment for order % does not exist', p_order_id; end if;
  if v_intent.status not in ('captured','partially_refunded') then raise exception 'INVALID_TRANSITION: payment for order % is % and cannot be refunded', p_order_id, v_intent.status; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'VALIDATION: refund amount must be greater than zero'; end if;
  select coalesce(sum(amount),0) into v_already from public.refunds where domain='commerce' and entity_id=p_order_id and status in ('pending','processed');
  v_remaining := v_order.total - v_already;
  if p_amount > v_remaining then raise exception 'AMOUNT_EXCEEDS_REFUNDABLE: requested % exceeds remaining refundable % on order %', p_amount, v_remaining, p_order_id; end if;
  begin
    insert into public.refunds (payment_intent_id, domain, entity_id, amount) values (v_intent.id,'commerce',p_order_id,p_amount) returning * into v_refund;
  exception when unique_violation then raise exception 'REFUND_IN_PROGRESS: a refund for order % is already in progress', p_order_id;
  end;
  return v_refund;
end; $$;
revoke all on function public.claim_order_refund(uuid, numeric) from public;
revoke execute on function public.claim_order_refund(uuid, numeric) from anon, authenticated;
grant execute on function public.claim_order_refund(uuid, numeric) to service_role;

create or replace function public.settle_refund(p_refund_id uuid, p_razorpay_refund_id text default null)
returns public.refunds language plpgsql security definer set search_path = public as $$
declare v_refund public.refunds; v_intent public.payment_intents; v_group_id uuid := gen_random_uuid(); v_settled numeric(12,2); v_debit_description text;
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if v_refund.id is null then raise exception 'NOT_FOUND: refund % does not exist', p_refund_id; end if;
  if v_refund.status = 'processed' then return v_refund; end if;
  select * into v_intent from public.payment_intents where id = v_refund.payment_intent_id;
  if v_intent.id is null then raise exception 'NOT_FOUND: payment_intent % does not exist', v_refund.payment_intent_id; end if;
  if v_refund.domain = 'commerce' then v_debit_description := format('Reversing: refund of %s on order %s', v_refund.amount, v_refund.entity_id);
  else v_debit_description := format('Reversing: full refund of %s %s, no service rendered', v_refund.domain, v_refund.entity_id); end if;
  insert into public.ledger_entries (entry_group_id, payment_intent_id, account_type, account_ref, direction, amount, domain, entity_id, description)
  values (v_group_id, v_intent.id, 'platform', null, 'debit', v_refund.amount, v_refund.domain, v_refund.entity_id, v_debit_description),
         (v_group_id, v_intent.id, 'user', v_intent.user_id, 'credit', v_refund.amount, v_refund.domain, v_refund.entity_id, format('Refund returned to payer, %s %s', v_refund.domain, v_refund.entity_id));
  update public.refunds set status='processed', razorpay_refund_id=coalesce(p_razorpay_refund_id, razorpay_refund_id), ledger_entry_group_id=v_group_id, failure_reason=null where id=p_refund_id returning * into v_refund;
  select coalesce(sum(amount),0) into v_settled from public.refunds where payment_intent_id=v_intent.id and status='processed';
  update public.payment_intents set status=(case when v_settled >= v_intent.amount then 'refunded' else 'partially_refunded' end)::public.payment_intent_status where id=v_intent.id;
  return v_refund;
end; $$;
revoke all on function public.settle_refund(uuid, text) from public;
revoke execute on function public.settle_refund(uuid, text) from anon, authenticated;
grant execute on function public.settle_refund(uuid, text) to service_role;
