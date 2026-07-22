-- ATLITOS v2 — 0055_roundup_backfill_general_fund.sql
-- Domain: empower / payments. Epic AT-8, story AT-113 (Track B, the inherited debt).
-- Requirements: PRD-06 FR-11; PHASE-4-STATUS.md D1; PHASE-6-STATUS.md lines 13, 28.
--
-- THE ONE-TIME RECONCILIATION OF THE P4 ROUNDUP LEDGER DEBT.
--
-- P4's finalize-order-payment parked every checkout roundup as a SECOND platform
-- credit leg tagged "Donation roundup held for Empower allocation, order <n>",
-- because ledger_entries.account_ref is not nullable for non-platform accounts
-- and the checkout roundup targets no specific UPA (PHASE-4-STATUS.md D1). P6
-- owes moving those rupees onto the reserved General Fund upa_fund account_ref
-- as a BALANCED reconciling movement, without re-reading order rows (the legs
-- are found by their tag and by domain='commerce').
--
-- For every historical roundup credit leg with no checkout_roundup donation yet,
-- this migration writes, per source order:
--   (a) the missing donations row (method='checkout_roundup', upa_id NULL = the
--       platform General Fund, order_id set, donor_id = the order's buyer), and
--   (b) a balanced reclassification group keyed to that donation:
--         debit  platform            <roundup>   "Reclassify roundup ... order n"
--         credit upa_fund(general)   <roundup>   "Roundup allocated ... order n"
--       Debit equals credit, so the group balances. The platform debit exactly
--       offsets the original P4 platform roundup credit, so summed over the
--       roundup legs platform nets to zero; the General Fund gains the rupees.
--
-- This is a ledger MOVEMENT, not a mutation of the P4 leg (ledger_entries is
-- INSERT-only; P4 legs are immutable history).
--
-- IDEMPOTENT. The reclass is keyed to "one checkout_roundup donation per order":
-- the loop skips any order that already has one, so re-running this whole block
-- writes nothing twice. The zero-roundup invariant is inherited for free, since
-- P4 wrote no roundup leg at all when the roundup was 0.00, so there is nothing
-- to find and no 0.00 group is ever manufactured here.

do $$
declare
  v_leg record;
  v_donation_id uuid;
  v_group uuid;
  v_order_number text;
begin
  for v_leg in
    select
      le.amount            as amount,
      le.entity_id         as order_id,
      le.payment_intent_id as payment_intent_id,
      o.user_id            as donor_id,
      o.order_number       as order_number
    from public.ledger_entries le
    join public.orders o on o.id = le.entity_id
    where le.domain = 'commerce'
      and le.account_type = 'platform'
      and le.direction = 'credit'
      and le.description like 'Donation roundup held for Empower allocation, order %'
      -- Idempotency: skip any order already reclassified.
      and not exists (
        select 1 from public.donations d
        where d.order_id = le.entity_id and d.method = 'checkout_roundup'
      )
  loop
    v_order_number := v_leg.order_number;

    -- (a) The missing donations row. upa_id NULL = platform General Fund.
    insert into public.donations (
      donor_id, upa_id, item_id, amount, method, order_id, payment_intent_id
    )
    values (
      v_leg.donor_id, null, null, v_leg.amount, 'checkout_roundup',
      v_leg.order_id, v_leg.payment_intent_id
    )
    returning id into v_donation_id;

    -- (b) The balanced reclass group, keyed to the new donation row (domain
    --     donation, entity_id = donation.id), the same shape the forward path
    --     and finalize-donation use so every donation-domain ledger row points
    --     at a donations row.
    v_group := gen_random_uuid();
    insert into public.ledger_entries (
      entry_group_id, payment_intent_id, account_type, account_ref,
      direction, amount, domain, entity_id, description
    )
    values
      (
        v_group, v_leg.payment_intent_id, 'platform', null,
        'debit', v_leg.amount, 'donation', v_donation_id,
        'Reclassify roundup from platform clearing to UPA general fund, order ' || v_order_number
      ),
      (
        v_group, v_leg.payment_intent_id, 'upa_fund', public.general_fund_account_ref(),
        'credit', v_leg.amount, 'donation', v_donation_id,
        'Roundup allocated to general fund, order ' || v_order_number
      );
  end loop;
end;
$$;
