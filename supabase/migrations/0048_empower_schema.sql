-- ATLITOS v2 — 0048_empower_schema.sql
-- Domain: empower. Epic AT-8 (Empower and Atlitos Life), story AT-108.
-- Requirements: PRD-05 FR-1, FR-3, FR-5, FR-6, FR-11, FR-12, FR-13, FR-19;
--               PRD-06 FR-1, FR-6, FR-11.
--
-- The foundation Track B (donations/ledger/allocation) and Tracks C/D (the
-- Life portal and the consumer Empower surfaces) build on: the UPA application
-- and verified-profile row, its evidence, the funding wishlist, the donations
-- ledger-of-record row, gratitude posts, the three empower enums, the
-- users.show_donor_name opt-in column, the three storage buckets, and the
-- reserved General Fund ledger anchor.
--
-- MONEY PHASE. Per CLAUDE.md's financial invariant, nothing here lets a client
-- write a money row or a status/transition field. This migration only creates
-- the tables and the anchor; RLS and grants that enforce the invariant are
-- 0049, and the state-machine + admin-verify RPCs are 0050. donations and the
-- funded_amount/status columns are written ONLY by Track B's donate finalize
-- edge function under the service role (SCHEMA.md, PHASE-6-STATUS.md trap 3).

-- ============================================================================
-- Enums (SCHEMA.md "Domain: empower" + the enum table)
--
-- upa_status machine (SCHEMA.md line 30, expanded here, see below):
--   submitted     -> under_review | needs_info | verified | rejected
--   under_review  -> needs_info | verified | rejected
--   needs_info    -> under_review | verified | rejected   (resubmit reopens)
--   verified      -> deactivated                          (owner self-withdraw)
--   rejected      -> (terminal; reapply creates a NEW row)
--   deactivated   -> (terminal)
--
-- `deactivated` is an ADDITION beyond SCHEMA.md's original five values, needed
-- by AT-110's deactivate RPC (the brief's application lifecycle set is
-- submit/resubmit/reapply/deactivate). A verified UPA that self-withdraws goes
-- `deactivated`; the public browse policy (0049) filters `status = 'verified'`
-- so a deactivated UPA disappears from the consumer app without a delete. The
-- expansion is recorded in the SCHEMA.md update alongside this migration, the
-- same way 0041/0043 recorded the clip machine's `uploading -> rejected` edge.
-- ============================================================================

create type public.upa_status as enum (
  'submitted', 'under_review', 'needs_info', 'verified', 'rejected', 'deactivated'
);

-- Wishlist item machine (SCHEMA.md line 31): open -> funded -> delivered, both
-- edges server-only (0050 upa_wishlist_item_transition_internal). funded is
-- reached by the donate finalize handler when funded_amount >= cost; delivered
-- by the owning UPA marking fulfillment.
create type public.upa_wishlist_item_status as enum ('open', 'funded', 'delivered');

-- How a donation reached the platform (SCHEMA.md line 32).
create type public.donation_method as enum ('standalone', 'checkout_roundup');

-- ============================================================================
-- users.show_donor_name (PHASE-6-STATUS.md PRD-05 open question 3, resolved by
-- assumption): a donor renders as "A Sponsor" unless they opt in. Minimal
-- additive boolean, default false. Added `if not exists` so this migration is
-- idempotent and self-contained regardless of environment drift.
-- ============================================================================

alter table public.users add column if not exists show_donor_name boolean not null default false;

comment on column public.users.show_donor_name is
  'Donor name visibility opt-in (PRD-05 FR-17 / PRD-06 anonymization). Default false: donations render as "A Sponsor" unless the donor opts in. PHASE-6-STATUS.md resolved-by-assumption 3.';

-- ============================================================================
-- upa_applications
--
-- One row per UPA for the whole lifecycle. A rejected applicant reapplying
-- creates a NEW row (0050 reapply_upa_application), not a resurrection, so the
-- partial unique index below permits at most one non-terminal row per user.
-- `rejected` AND `deactivated` are both terminal for the index, so a rejected
-- (or deactivated) applicant can start a fresh row without tripping it.
-- ============================================================================

create table public.upa_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references public.users (id) on delete cascade,
  story_headline text not null,
  story_body text not null,
  sport public.sport not null,
  region text not null,
  state text not null,
  photo_url text,
  status public.upa_status not null default 'submitted',
  -- which apply-wizard step/field staff flagged on a needs_info bounce (FR-8).
  needs_info_field text,
  rejection_reason text,
  -- admin-set cooldown on rejection (PRD-05 open question 2, resolved by
  -- assumption): /status offers immediate reapply when null, else shows the date.
  reapply_after date,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active (non-terminal) application per user. reject/deactivate are
-- terminal, so a fresh reapply row is allowed (SCHEMA.md line 705, widened to
-- exclude deactivated too, recorded in the SCHEMA.md update).
create unique index uq_upa_applications_active_per_user
  on public.upa_applications (applicant_user_id)
  where status not in ('rejected', 'deactivated');

-- Public browse filters to verified only; the composite serves that hot path.
create index idx_upa_applications_status on public.upa_applications (status);
create index idx_upa_applications_applicant on public.upa_applications (applicant_user_id);

create trigger upa_applications_set_updated_at
  before update on public.upa_applications
  for each row execute function public.set_updated_at();

comment on table public.upa_applications is
  'Combined UPA application and verified-profile row, one per lifecycle. Public only while status = verified (0049). status is never client-writable; it moves only via 0050 RPCs (submit/resubmit/reapply/deactivate) and the admin verify branch.';

-- ============================================================================
-- upa_evidence
--
-- Certificates, ID proof, guardian consent, and external video links behind one
-- `kind` discriminator. Uploaded kinds carry a storage_path into the PRIVATE
-- upa-evidence bucket; video_link carries an external url (no upload/transcode).
-- ============================================================================

create table public.upa_evidence (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.upa_applications (id) on delete cascade,
  kind text not null check (kind in ('certificate', 'id_proof', 'guardian_consent', 'video_link')),
  storage_path text,
  url text,
  created_at timestamptz not null default now()
);

create index idx_upa_evidence_application_id on public.upa_evidence (application_id);

-- ============================================================================
-- upa_wishlist_items
--
-- Distinct from product_wishlist_items (commerce). funded_amount and status are
-- NEVER client-written: funded_amount is written ONLY by the donate finalize
-- handler, atomically in the same transaction as the ledger credit (it is the
-- FR-5 race guard and item-level progress, never the source of a displayed
-- money total, PRD-06 FR-3/FR-4). RLS (0049) additionally requires
-- status = 'open' AND funded_amount = 0 to edit/delete, and excludes both
-- columns from the WITH CHECK allowed set.
-- ============================================================================

create table public.upa_wishlist_items (
  id uuid primary key default gen_random_uuid(),
  upa_id uuid not null references public.upa_applications (id) on delete cascade,
  title text not null,
  cost numeric(12, 2) not null check (cost > 0),
  funded_amount numeric(12, 2) not null default 0 check (funded_amount >= 0),
  status public.upa_wishlist_item_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_upa_wishlist_items_upa_id on public.upa_wishlist_items (upa_id);

create trigger upa_wishlist_items_set_updated_at
  before update on public.upa_wishlist_items
  for each row execute function public.set_updated_at();

comment on column public.upa_wishlist_items.funded_amount is
  'Per-item funding progress and the FR-5 race guard. Written ONLY by the donate finalize edge function, atomically with the ledger credit. NEVER a displayed money total (that is always ledger-derived, PRD-06 FR-3/FR-4) and NEVER client-writable (0049).';

-- ============================================================================
-- donations
--
-- The empower ledger-of-record row. upa_id NULL means the platform general
-- fund (the checkout roundup). NO authenticated write of any kind: rows are
-- inserted ONLY by Track B's donate finalize edge function under the service
-- role (0049 revokes insert/update/delete from anon and authenticated, and no
-- write policy exists). SCHEMA.md "donations"; PHASE-6-STATUS.md trap 3.
-- ============================================================================

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.users (id) on delete cascade,
  upa_id uuid references public.upa_applications (id) on delete set null,
  item_id uuid references public.upa_wishlist_items (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  method public.donation_method not null,
  order_id uuid references public.orders (id) on delete set null,
  payment_intent_id uuid not null references public.payment_intents (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_donations_donor_id on public.donations (donor_id);
create index idx_donations_upa_id on public.donations (upa_id);

comment on table public.donations is
  'Ledger-of-record donation row. upa_id NULL = platform general fund (checkout roundup). Service-role write only (donate finalize edge function); no client insert/update/delete by policy OR grant (0049). CHECK amount > 0 enforces the zero-roundup invariant (a 0.00 donation is never written).';

-- ============================================================================
-- gratitude_posts
--
-- At most one per funded/delivered item (UNIQUE(wishlist_item_id), FR-19).
-- Composed only for a funded/delivered item with no existing post (enforced in
-- the 0049 INSERT WITH CHECK subquery); immutable except UPA soft-delete
-- (status = 'removed'); published immediately (PRD-05 open question 5, resolved
-- by assumption: no pre-publish queue, staff can unpublish post hoc).
-- ============================================================================

create table public.gratitude_posts (
  id uuid primary key default gen_random_uuid(),
  upa_id uuid not null references public.upa_applications (id) on delete cascade,
  wishlist_item_id uuid not null unique references public.upa_wishlist_items (id) on delete cascade,
  body text not null,
  photo_url text,
  status text not null default 'published' check (status in ('published', 'removed')),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_gratitude_posts_upa_id on public.gratitude_posts (upa_id);

-- ============================================================================
-- The General Fund ledger anchor (PHASE-6-STATUS.md "The general fund account").
--
-- ledger_entries.account_ref carries NO foreign key, so the reserved General
-- Fund is a PURE LEDGER ANCHOR, a fixed sentinel UUID, not a fake upa_applications
-- row. Track B's roundup allocation (AT-113) credits upa_fund at this account_ref
-- for every checkout roundup (which targets no specific UPA, PRD-06 FR-11). Fund
-- balances derive uniformly from the ledger with no denormalized balance column:
--   general fund balance =
--     sum(amount) filter (where direction='credit')
--   - sum(amount) filter (where direction='debit')
--     where account_type = 'upa_fund'
--       and account_ref = public.general_fund_account_ref();
--
-- Exposed as an IMMUTABLE SQL function so every caller (this schema, Track B's
-- edge functions via their own TS constant GENERAL_FUND_ACCOUNT_REF, the
-- read-layer derivations, and verification) shares ONE source of truth for the
-- constant. Recorded in SCHEMA.md and PAYMENTS.md.
-- ============================================================================

create function public.general_fund_account_ref()
returns uuid
language sql
immutable
as $$
  select '00000000-0000-4000-a000-0000000f0000'::uuid;
$$;

comment on function public.general_fund_account_ref() is
  'The reserved General Fund ledger anchor: a fixed sentinel account_ref (no FK) for upa_fund credits that belong to the platform general fund (checkout roundups, PRD-06 FR-11), not a specific UPA. Single source of truth for the constant across schema, edge functions, and verification (PHASE-6-STATUS.md).';

-- ============================================================================
-- Storage buckets (RLS.md Storage table; policies land in 0049).
--   upa-evidence     PRIVATE, owner + admin read, never public (PRD-05 FR-3).
--   upa-photos       public read (the UPA profile photo).
--   gratitude-photos public read (the gratitude post photo).
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('upa-evidence', 'upa-evidence', false),
  ('upa-photos', 'upa-photos', true),
  ('gratitude-photos', 'gratitude-photos', true)
on conflict (id) do nothing;
