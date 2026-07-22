-- ATLITOS v2 — 0054_record_donation_rpc.sql
-- Domain: empower / payments. Epic AT-8, story AT-112 (Track B, finalize donation).
-- Requirements: PRD-06 FR-5, FR-9, FR-17, FR-18; PAYMENTS.md line 167.
--
-- The atomic STATE half of finalize-donation-payment, the exact commerce
-- precedent (place_order_from_draft, 0038): one SECURITY DEFINER RPC owns every
-- state row that must move together, and the edge function writes the balanced
-- ledger group afterwards under the service role (CLAUDE.md forbids ledger
-- writes anywhere but an edge function; finalize-order-payment's header explains
-- why the group stays out of the RPC). PRD-06 FR-9's atomicity requirement, the
-- part that is race-critical, lives here: the donations row insert, the
-- funded_amount increment, and the open -> funded flip are one transaction.
--
-- Called ONLY by finalize-donation-payment under the service role, only with an
-- intent the shared gate just flipped to captured, so it runs at most once per
-- capture. It is additionally idempotent by inspection: if a donations row for
-- this payment_intent already exists, it returns that row and touches nothing,
-- so a re-entry (belt and suspenders behind the gate) never double-increments
-- funded_amount.
--
-- THE ITEM-FUNDED RACE, resolved per PHASE-6-STATUS.md line 42. The ITEM_FUNDED
-- guard lives at the `donate` REQUEST layer (funded_amount < cost AND status =
-- open, before any charge). By capture the money is real and must be recorded,
-- so this function never rejects a captured donation: it ALWAYS records the
-- donations row and ALWAYS increments funded_amount (under a row lock, so two
-- concurrent captures cannot lose an increment), and flips open -> funded only
-- while the item is still open. Two donors who both passed the request guard
-- before either captured both fund the item (funded_amount may exceed cost,
-- which the schema permits); neither loses money and the ledger stays balanced.

create function public.record_donation_from_draft(p_payment_intent_id uuid)
returns public.donations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.donation_drafts;
  v_donation public.donations;
  v_item public.upa_wishlist_items;
  v_new_funded numeric(12, 2);
  v_owner uuid;
  v_deep_link text;
begin
  if p_payment_intent_id is null then
    raise exception 'VALIDATION: payment_intent_id is required';
  end if;

  -- Idempotency: a donation already recorded for this intent means an earlier
  -- call did the work. Return it untouched (no second increment).
  select * into v_donation
  from public.donations
  where payment_intent_id = p_payment_intent_id
  limit 1;
  if v_donation.id is not null then
    return v_donation;
  end if;

  select * into v_draft
  from public.donation_drafts
  where payment_intent_id = p_payment_intent_id;
  if v_draft.payment_intent_id is null then
    raise exception 'NOT_FOUND: no donation_draft for payment_intent %', p_payment_intent_id;
  end if;

  -- The ledger-of-record row. method is always standalone here (the checkout
  -- roundup General Fund donation is written by finalize-order-payment, never
  -- through a draft). order_id null: a standalone donation belongs to no order.
  insert into public.donations (
    donor_id, upa_id, item_id, amount, method, order_id, payment_intent_id
  )
  values (
    v_draft.donor_id, v_draft.upa_id, v_draft.item_id, v_draft.amount,
    'standalone', null, p_payment_intent_id
  )
  returning * into v_donation;

  -- Item progress + the open -> funded flip, race-safe under a row lock.
  if v_draft.item_id is not null then
    select * into v_item
    from public.upa_wishlist_items
    where id = v_draft.item_id
    for update;

    if v_item.id is null then
      raise exception 'NOT_FOUND: upa_wishlist_item % does not exist', v_draft.item_id;
    end if;

    v_new_funded := v_item.funded_amount + v_draft.amount;
    update public.upa_wishlist_items
    set funded_amount = v_new_funded
    where id = v_draft.item_id;

    -- Flip only while still open. A concurrent capture may already have flipped
    -- it to funded; calling the internal machine again would raise
    -- INVALID_TRANSITION, so guard on the current status.
    if v_item.status = 'open' and v_new_funded >= v_item.cost then
      perform public.upa_wishlist_item_transition_internal(v_draft.item_id, 'funded');
    end if;
  end if;

  -- Notify the UPA owner (PRD-06 FR-18). Deep link to the funded item, or the
  -- dashboard for a general (no item) donation. No emoji, no hyphens (house style).
  select applicant_user_id into v_owner
  from public.upa_applications
  where id = v_draft.upa_id;

  v_deep_link := case
    when v_draft.item_id is not null then '/wishlist/' || v_draft.item_id::text
    else '/dashboard'
  end;

  if v_owner is not null then
    insert into public.notifications (user_id, type, title, body, deep_link)
    values (
      v_owner,
      'donation',
      'You received a donation',
      'A sponsor contributed ' || to_char(v_draft.amount, 'FM999999990.00') || ' toward your goal.',
      v_deep_link
    );
  end if;

  return v_donation;
end;
$$;

revoke all on function public.record_donation_from_draft(uuid) from public;
revoke execute on function public.record_donation_from_draft(uuid) from anon, authenticated;
grant execute on function public.record_donation_from_draft(uuid) to service_role;

comment on function public.record_donation_from_draft(uuid) is
  'Atomic state half of finalize-donation-payment (AT-112): inserts the donations row, increments the item funded_amount under a row lock, flips open -> funded when reached, notifies the UPA owner, all in one transaction. Idempotent on payment_intent_id. Service-role only; the balanced ledger group is written by the edge function afterwards.';
