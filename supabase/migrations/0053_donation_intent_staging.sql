-- ATLITOS v2 — 0053_donation_intent_staging.sql
-- Domain: empower / payments. Epic AT-8, story AT-111 (Track B, donation payments).
-- Requirements: PRD-06 FR-5, FR-7, FR-8, FR-15, FR-16; PAYMENTS.md `donate`.
--
-- Two things the `donate` edge function needs that the schema did not yet carry:
--
--   1. fee_config donations.min_amount. PAYMENTS.md line 255 lists it as a key
--      "in use at launch" and PHASE-6-STATUS.md PRD-06 open question 2 resolves
--      MIN_AMOUNT to "a single fee_config donations.min_amount (seeded)". 0010's
--      seed only covered courts/sessions and 0038 added the commerce keys, so no
--      donations row exists yet. `donate` reads it through the shared
--      getActiveFeeConfig helper exactly as book-session reads
--      sessions.platform_fee_flat. Seeded flat at 10.00 (the founder rounding
--      multiple is also 10; a gift under one full unit is the floor we reject).
--
--   2. donation_drafts. `donate` creates ONLY the payment_intents row and the
--      Razorpay order (the donations row does not exist until capture, per
--      PHASE-6-STATUS.md line 40). But payment_intents carries no room for
--      {upa_id, item_id, donor_id} and the finalize handler must know them to
--      build the donations row and credit the right upa_fund account_ref. This
--      is the exact shape commerce solved with order_drafts (0038): stage the
--      intent's details keyed by payment_intent_id, and let the finalize handler
--      copy from the draft rather than recomputing or trusting a client. Written
--      and read ONLY under the service role (donate / finalize-donation-payment).

-- ============================================================================
-- fee_config donations.min_amount (idempotent: this migration is the single
-- seed of it, guarded so a re-run never inserts a second effective_from row).
-- ============================================================================

insert into public.fee_config (domain, key, value_type, value)
select 'donations', 'min_amount', 'flat', 10.00
where not exists (
  select 1 from public.fee_config where domain = 'donations' and key = 'min_amount'
);

-- ============================================================================
-- donation_drafts: the standalone-donation staging row, the order_drafts (0038)
-- analog for the donation domain. upa_id is NOT NULL: `donate` always targets a
-- specific verified UPA (a "general (no item)" donation is item_id NULL but
-- still to a UPA, PHASE-6-STATUS.md gate clause 3). The platform General Fund
-- (checkout roundup) never uses this table; that donation row is created
-- directly by finalize-order-payment. Cascade on payment_intents so a failed
-- intent cleanup takes its draft with it.
-- ============================================================================

create table public.donation_drafts (
  payment_intent_id uuid primary key references public.payment_intents (id) on delete cascade,
  donor_id uuid not null references public.users (id) on delete cascade,
  upa_id uuid not null references public.upa_applications (id) on delete cascade,
  item_id uuid references public.upa_wishlist_items (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

comment on table public.donation_drafts is
  'Staging for a standalone donation between donate (creates the payment_intent + Razorpay order) and finalize-donation-payment (creates the donations row + ledger credit on capture). The order_drafts analog for the donation domain. Service-role write/read only; the donations row does not exist until capture.';

-- No client surface at all: like order_drafts and every money-staging row, this
-- is created and read by edge functions under the service role only.
alter table public.donation_drafts enable row level security;
revoke all on public.donation_drafts from anon, authenticated;
grant select, insert, delete on public.donation_drafts to service_role;
