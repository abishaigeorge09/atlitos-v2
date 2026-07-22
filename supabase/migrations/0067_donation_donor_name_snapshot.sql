-- ATLITOS v2 — 0066_donation_donor_name_snapshot.sql
-- Domain: empower / payments. Epic AT-8, story AT-149 (Track E, carried debt).
-- Requirements: PRD-05 FR-17 / PRD-06 anonymization; resolved-by-assumption 3
-- (PHASE-6-STATUS.md): donations render as "A Sponsor" unless the donor opts in
-- via users.show_donor_name.
--
-- THE BUG (carried since P6). No read path respected users.show_donor_name, so
-- the UPA-facing sponsor list rendered every donor as "A Sponsor", even the ones
-- who opted in. Reading the LIVE users.show_donor_name at display time was
-- rejected for the same reason the order address is snapshotted, not joined: a
-- donor who opts in, is shown, then later toggles off would keep leaking on old
-- rows, and a donor who was anonymous when they gave would retroactively appear
-- if they toggled on later. Both are wrong. The visibility choice belongs to the
-- MOMENT of the donation, so it is snapshotted onto the row at finalize time.
--
-- THE SNAPSHOT. A nullable donor_display_name column on donations, written once
-- inside record_donation_from_draft (the atomic state half of
-- finalize-donation-payment) in the SAME transaction as the row insert, so the
-- flag is read exactly at finalize and cannot drift:
--   users.show_donor_name = true  -> donor_display_name = users.name
--   users.show_donor_name = false -> donor_display_name = null  (renders "A Sponsor")
-- The read path (portal-life funding detail) reads this column and NEVER the live
-- users row, matching the address-snapshot discipline.
--
-- MONEY INVARIANT UNCHANGED. This migration adds a display-name column and its
-- snapshot only. It does NOT touch the amount, the funded_amount increment, the
-- open -> funded flip, the notification, or the ledger group (which is written by
-- the edge function, not this RPC). Existing donation rows keep donor_display_name
-- null, which correctly renders as "A Sponsor" (we cannot know their past flag).

alter table public.donations
  add column if not exists donor_display_name text;

comment on column public.donations.donor_display_name is
  'Snapshot of the donor name to show the UPA, taken at finalize time: users.name if users.show_donor_name was true at that moment, else null (renders "A Sponsor"). Read by portal-life; never joined live against users, matching the address-snapshot discipline (AT-149).';

-- Replace record_donation_from_draft to snapshot donor_display_name on insert.
-- Byte-for-byte identical to 0054 except: the new v_donor_display_name declare,
-- the select that computes it from users, and the two added tokens in the insert
-- column list and values list. Nothing money-bearing changes.
create or replace function public.record_donation_from_draft(p_payment_intent_id uuid)
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
  v_donor_display_name text;
begin
  if p_payment_intent_id is null then
    raise exception 'VALIDATION: payment_intent_id is required';
  end if;

  -- Idempotency: a donation already recorded for this intent means an earlier
  -- call did the work. Return it untouched (no second increment, no re-snapshot).
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

  -- AT-149: snapshot the donor's chosen visibility AT THIS MOMENT. Opt-in true
  -- captures the name; false captures null (the UPA sees "A Sponsor"). Read in
  -- this same transaction as the insert so a later toggle cannot rewrite it.
  select case when u.show_donor_name then u.name else null end
  into v_donor_display_name
  from public.users u
  where u.id = v_draft.donor_id;

  -- The ledger-of-record row. method is always standalone here (the checkout
  -- roundup General Fund donation is written by finalize-order-payment, never
  -- through a draft). order_id null: a standalone donation belongs to no order.
  insert into public.donations (
    donor_id, upa_id, item_id, amount, method, order_id, payment_intent_id, donor_display_name
  )
  values (
    v_draft.donor_id, v_draft.upa_id, v_draft.item_id, v_draft.amount,
    'standalone', null, p_payment_intent_id, v_donor_display_name
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

    if v_item.status = 'open' and v_new_funded >= v_item.cost then
      perform public.upa_wishlist_item_transition_internal(v_draft.item_id, 'funded');
    end if;
  end if;

  -- Notify the UPA owner (PRD-06 FR-18).
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
  'Atomic state half of finalize-donation-payment (AT-112, snapshot added AT-149): inserts the donations row (with the donor_display_name visibility snapshot), increments the item funded_amount under a row lock, flips open -> funded when reached, notifies the UPA owner, all in one transaction. Idempotent on payment_intent_id. Service-role only; the balanced ledger group is written by the edge function afterwards.';
