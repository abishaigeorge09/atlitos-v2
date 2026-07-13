-- ATLITOS v2 — 0010_payments_core.sql
-- Domain: payments (SCHEMA.md "Domain: payments"; docs/architecture/PAYMENTS.md;
-- CLAUDE.md's financial invariant; epic AT-11).
--
-- Tables: public.payment_intents, public.ledger_entries,
--         public.payout_accounts, public.transfers, public.webhook_events,
--         public.fee_config.
--
-- This is the migration CLAUDE.md's financial invariant is written for:
-- every table here either has zero authenticated/anon write grant at all
-- (payment_intents, payout_accounts, transfers, webhook_events — writers are
-- edge functions running as service_role, which bypasses RLS and, being the
-- table owner's privilege class, is unaffected by anything revoked below
-- from authenticated/anon specifically) or, for ledger_entries, has zero
-- write grant for EVERY role including service_role beyond INSERT (RLS.md:
-- "not even service_role gets UPDATE/DELETE ... enforcing insert-only at the
-- grant level"). fee_config is the one exception, an admin-editable
-- reference table, not a money-movement table.
--
-- Naming decision on fee_config keys: the task brief specifies flat platform
-- fees (court_booking platform fee flat 1000 paise = ₹10.00, session flat
-- 1000 paise = ₹10.00, i.e. the v1 "500 + 50 + 10" pattern: subtotal, then a
-- percentage GST, then a flat platform fee), which is what is actually
-- seeded below. PAYMENTS.md's "Keys in use at launch" line previously named
-- these `sessions.platform_fee_percent` / `courts.platform_fee_percent`;
-- corrected in the same change (docs update duty, CLAUDE.md) to
-- `platform_fee_flat`, matching `fee_value_type = 'flat'` and the actual
-- seeded rows here, since a `_percent`-suffixed key holding a flat rupee
-- amount would mislead the edge function that reads it.
--
-- court_bookings.payment_intent_id's foreign key (deferred from
-- 0009_courts.sql, see that migration's header note 6) is added at the end
-- of this file, now that public.payment_intents exists.

-- ============================================================================
-- Enums
-- ============================================================================

create type public.payment_intent_status as enum (
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'partially_refunded'
);

create type public.payment_domain as enum ('session', 'court', 'commerce', 'donation');

create type public.payout_account_status as enum (
  'not_started',
  'pending',
  'active',
  'needs_attention',
  'failed'
);

create type public.transfer_status as enum ('processing', 'paid', 'failed');

create type public.fee_value_type as enum ('percentage', 'flat');

create type public.ledger_account_type as enum ('platform', 'coach', 'court_partner', 'upa_fund', 'user');

create type public.ledger_direction as enum ('debit', 'credit');

-- ============================================================================
-- Tables
-- ============================================================================

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  domain public.payment_domain not null,
  entity_id uuid,
  razorpay_order_id text not null unique,
  razorpay_payment_id text,
  amount numeric(12, 2) not null,
  currency text not null default 'INR',
  status public.payment_intent_status not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_payment_intents_user_id on public.payment_intents (user_id);
create index idx_payment_intents_razorpay_order_id on public.payment_intents (razorpay_order_id);
create index idx_payment_intents_domain_entity on public.payment_intents (domain, entity_id);

create trigger payment_intents_set_updated_at
  before update on public.payment_intents
  for each row execute function public.set_updated_at();

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_group_id uuid not null,
  payment_intent_id uuid references public.payment_intents (id) on delete set null,
  account_type public.ledger_account_type not null,
  account_ref uuid,
  direction public.ledger_direction not null,
  amount numeric(12, 2) not null check (amount > 0),
  domain public.payment_domain not null,
  entity_id uuid not null,
  description text not null,
  created_at timestamptz not null default now()
);

create index idx_ledger_entries_account on public.ledger_entries (account_type, account_ref);
create index idx_ledger_entries_entity on public.ledger_entries (domain, entity_id);
create index idx_ledger_entries_entry_group on public.ledger_entries (entry_group_id);

-- Double-entry balance guard: every entry_group_id's debits must equal its
-- credits, checked once per row at end-of-transaction (deferred), by which
-- point every leg of that economic event's insert has already happened
-- (SCHEMA.md's worked example: one group, 2+ balanced legs, in one
-- transaction).
create function public.assert_ledger_group_balanced()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_debit numeric(14, 2);
  v_credit numeric(14, 2);
begin
  select
    coalesce(sum(amount) filter (where direction = 'debit'), 0),
    coalesce(sum(amount) filter (where direction = 'credit'), 0)
  into v_debit, v_credit
  from public.ledger_entries
  where entry_group_id = new.entry_group_id;

  if v_debit <> v_credit then
    raise exception 'LEDGER_UNBALANCED: entry_group % debits % do not equal credits %', new.entry_group_id, v_debit, v_credit;
  end if;

  return new;
end;
$$;

create constraint trigger ledger_entries_assert_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function public.assert_ledger_group_balanced();

create table public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('coach', 'court_partner')),
  owner_id uuid not null,
  razorpay_account_id text,
  status public.payout_account_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_type, owner_id)
);

create trigger payout_accounts_set_updated_at
  before update on public.payout_accounts
  for each row execute function public.set_updated_at();

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  payout_account_id uuid not null references public.payout_accounts (id) on delete cascade,
  amount numeric(12, 2) not null,
  razorpay_transfer_id text,
  status public.transfer_status not null default 'processing',
  ledger_entry_group_id uuid not null,
  created_at timestamptz not null default now()
);

create index idx_transfers_payout_account_id on public.transfers (payout_account_id);

create table public.webhook_events (
  id text primary key,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table public.fee_config (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain in ('courts', 'sessions', 'commerce', 'donations')),
  key text not null,
  value_type public.fee_value_type not null,
  value numeric(12, 4) not null,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (domain, key, effective_from)
);

-- Deferred FK from 0009_courts.sql, see that migration's header note 6.
alter table public.court_bookings
  add constraint court_bookings_payment_intent_id_fkey
  foreign key (payment_intent_id) references public.payment_intents (id) on delete set null;

-- ============================================================================
-- Grants (table level, on top of RLS below)
-- ============================================================================

-- ledger_entries: insert-only for every role, including service_role, per
-- RLS.md's financial write prohibition. Supabase's default project grants
-- (the same "auto-grant at CREATE TABLE time" behavior 0005_tighten_rpc_grants.sql
-- documented for functions) can hand service_role broader table privileges
-- than intended, so this is stripped explicitly rather than assumed absent.
revoke update, delete on public.ledger_entries from service_role;
revoke insert, update, delete on public.ledger_entries from authenticated, anon;
grant select, insert on public.ledger_entries to service_role;
grant select on public.ledger_entries to authenticated;

-- payment_intents / payout_accounts / transfers / webhook_events: no
-- INSERT/UPDATE/DELETE grant for authenticated/anon at all; every write is
-- an edge function running as service_role.
revoke insert, update, delete on public.payment_intents from authenticated, anon;
revoke insert, update, delete on public.payout_accounts from authenticated, anon;
revoke insert, update, delete on public.transfers from authenticated, anon;
revoke all on public.webhook_events from authenticated, anon;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.payment_intents enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.payout_accounts enable row level security;
alter table public.transfers enable row level security;
alter table public.webhook_events enable row level security;
alter table public.fee_config enable row level security;

-- payment_intents: own rows; admin reads all. No anon access.
create policy payment_intents_select_own on public.payment_intents
  for select to authenticated
  using (user_id = auth.uid());

create policy payment_intents_select_admin on public.payment_intents
  for select to authenticated
  using (public.has_role('admin'));

-- ledger_entries: coach's own balance rows, court_partner's own venue's
-- balance rows, or a user-account row of their own; admin reads all; no
-- anon access ever.
create policy ledger_entries_select_own on public.ledger_entries
  for select to authenticated
  using (
    (account_type = 'coach' and account_ref = auth.uid())
    or (account_type = 'user' and account_ref = auth.uid())
    or (
      account_type = 'court_partner'
      and exists (select 1 from public.venues v where v.id = ledger_entries.account_ref and v.partner_user_id = auth.uid())
    )
  );

create policy ledger_entries_select_admin on public.ledger_entries
  for select to authenticated
  using (public.has_role('admin'));

-- payout_accounts: own (coach) or own venue's (court_partner); admin reads
-- all. No authenticated write policy at all: PRD-03 FR-23/FR-26, linking is
-- a call to the razorpay-route-onboard edge function, the portal never
-- writes this table directly.
create policy payout_accounts_select_own on public.payout_accounts
  for select to authenticated
  using (
    (owner_type = 'coach' and owner_id = auth.uid())
    or (
      owner_type = 'court_partner'
      and exists (select 1 from public.venues v where v.id = payout_accounts.owner_id and v.partner_user_id = auth.uid())
    )
  );

create policy payout_accounts_select_admin on public.payout_accounts
  for select to authenticated
  using (public.has_role('admin'));

-- transfers: read only, via the owning payout_account; admin reads all
-- (PRD-03 FR-25: "written only by the razorpay-route-transfer edge
-- function, never by the client").
create policy transfers_select_own on public.transfers
  for select to authenticated
  using (
    exists (
      select 1 from public.payout_accounts pa
      where pa.id = transfers.payout_account_id
        and (
          (pa.owner_type = 'coach' and pa.owner_id = auth.uid())
          or (
            pa.owner_type = 'court_partner'
            and exists (select 1 from public.venues v where v.id = pa.owner_id and v.partner_user_id = auth.uid())
          )
        )
    )
  );

create policy transfers_select_admin on public.transfers
  for select to authenticated
  using (public.has_role('admin'));

-- webhook_events: no RLS-relevant client access at all, deliberately zero
-- policies for authenticated/anon (PAYMENTS.md: idempotency ledger for
-- razorpay-webhook, service_role only, never selected by a client).

-- fee_config: authenticated read-only on all rows (client-side bill
-- preview before server re-pricing); admin-only insert/update; no delete
-- policy for anyone (versioned rows are superseded by a new row, never
-- deleted, per SCHEMA.md).
create policy fee_config_select_authenticated on public.fee_config
  for select to authenticated
  using (true);

create policy fee_config_insert_admin on public.fee_config
  for insert to authenticated
  with check (public.has_role('admin'));

create policy fee_config_update_admin on public.fee_config
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ============================================================================
-- Seed: fee_config baseline (task brief: "court_booking platform fee flat
-- 1000 paise, gst_rate 0.10 ... session flat 1000 paise", the v1
-- "500 + 50 + 10" pattern — subtotal, 10% GST, flat ₹10 platform fee).
-- Reference/config data, seeded in the schema migration itself (the app is
-- non-functional without at least one active row per key), not in
-- supabase/seed/seed_p2.sql, which is demo fixture data only.
-- ============================================================================

insert into public.fee_config (domain, key, value_type, value) values
  ('courts', 'platform_fee_flat', 'flat', 10.00),
  ('courts', 'gst_percent', 'percentage', 0.10),
  ('sessions', 'platform_fee_flat', 'flat', 10.00);
