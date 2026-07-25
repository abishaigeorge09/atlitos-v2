-- ATLITOS v2 — 0076_training_groups.sql
-- Domain: coaching groups (docs/design/COACH-TRAININGS-GAP.md "What MISSING
-- requires" items 1-3). Founder-ratified fares model: monthly subscription per
-- group, manual renewal v1 through the existing one-time payment rails, no
-- autopay, no pro-rata refunds, capacity guarded in the join RPC.
--
-- Tables: public.training_groups, public.group_memberships,
-- public.session_participants; plus sessions.group_id and the sessions shape
-- change that lets a session row represent a group session.
--
-- Decisions made here, and why:
--
--   1. monthly_fee is numeric(12, 2), NOT an int of paise. The brief said
--      "int, paise or the unit sessions use, MATCH the existing price unit
--      exactly"; sessions.price / platform_fee / total are numeric(12, 2)
--      rupees (0018_coaching.sql), and every fee_config value and ledger
--      amount is the same unit. Matching the unit wins over matching the
--      declared type, otherwise the membership ledger legs would be off by
--      a factor of 100 against every other domain.
--
--   2. group_memberships.status includes 'pending' in addition to the brief's
--      (active, lapsed). The join RPC (0079) must create the membership row
--      BEFORE Razorpay is called, exactly as book-session inserts the
--      `requested` session first: the capacity count can only be raced on an
--      actual INSERT under the group row lock. A membership that exists but
--      is not yet paid is 'pending'; the finalize path activates it, and an
--      abandoned checkout lapses it (membership_abandon_unpaid, 0079).
--      'pending' counts toward capacity while it lives, mirroring how a
--      `requested` unpaid session holds its slot.
--
--   3. price / platform_fee / total are snapshotted on the membership row at
--      join (and renew) time from training_groups.monthly_fee and the active
--      fee_config ('sessions', 'platform_fee_flat') row, exactly as
--      book-session snapshots onto sessions. The platform fee is carved OUT
--      of the coach's monthly fee (total = price), PAYMENTS.md's coaching
--      carve-out, so the finalize handler can write the balanced ledger group
--      without re-reading fee_config.
--
--   4. payment_intent_id mirrors sessions.payment_intent_id byte for byte
--      (nullable uuid, on delete set null). On manual renewal the SAME
--      membership row is re-linked to the new intent and the columns in note
--      3 are re-snapshotted; the full payment history stays queryable via
--      payment_intents (domain 'membership', entity_id = membership id).
--
--   5. sessions.player_id and sessions.session_type_id become nullable, with
--      a CHECK that only group rows (group_id not null) may omit them and
--      that non-group rows keep the exact old shape. A group session carries
--      price = 0 / platform_fee = 0 / total = 0: the money for group training
--      moves on membership capture, never on a session row, so group sessions
--      have no payment intent and no accrual (complete-session is not part of
--      their lifecycle; see 0077).
--
--   6. payment_domain gains 'membership' here (ADD VALUE only; first USE is
--      in 0079's RPCs and the edge functions, after this migration has
--      committed, which is what Postgres requires of new enum values).
--
--   7. RLS: enabled on all three tables in this same migration with SELECT
--      policies only. There is NO client insert/update/delete policy and the
--      verbs are revoked at the grant level too: every write path is an RPC
--      (0079) or a service-role edge function. Public browse of ACTIVE groups
--      of verified coaches is allowed for discovery (founder wants athletes
--      to find groups), which makes training_groups a permissive-OR table:
--      RLS IS NOT SCOPING, every read in app code must carry its own owner
--      or active filter (see RLS.md).

-- ============================================================================
-- payment_domain: the membership fare rides the same rails. See note 6.
-- ============================================================================

alter type public.payment_domain add value if not exists 'membership';

-- ============================================================================
-- training_groups
-- ============================================================================

create table public.training_groups (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  sport public.sport not null,
  skill_level text,
  capacity int not null check (capacity > 0),
  -- Rupees, numeric(12, 2), the unit sessions.price uses. See header note 1.
  monthly_fee numeric(12, 2) not null check (monthly_fee >= 0),
  attendance_policy text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_training_groups_coach_id on public.training_groups (coach_id);
create index idx_training_groups_active_sport on public.training_groups (active, sport);

create trigger training_groups_set_updated_at
  before update on public.training_groups
  for each row execute function public.set_updated_at();

-- ============================================================================
-- group_memberships
-- ============================================================================

create table public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.training_groups (id) on delete cascade,
  player_id uuid not null references public.users (id) on delete cascade,
  period_start date,
  period_end date,
  -- 'pending' = created by the join RPC, payment not yet captured. See note 2.
  status text not null default 'pending' check (status in ('pending', 'active', 'lapsed')),
  -- Snapshot of the fare at join/renew time. See header note 3.
  price numeric(12, 2) not null,
  platform_fee numeric(12, 2) not null,
  total numeric(12, 2) not null,
  -- Mirrors sessions.payment_intent_id. See header note 4.
  payment_intent_id uuid references public.payment_intents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live (non-lapsed) membership per player per group. The join RPC's
-- capacity count runs under the group row lock, but this index is what makes
-- a duplicate join structurally impossible rather than merely checked.
create unique index group_memberships_one_live_per_player
  on public.group_memberships (group_id, player_id)
  where (status <> 'lapsed');

create index idx_group_memberships_group_id on public.group_memberships (group_id, status);
create index idx_group_memberships_player_id on public.group_memberships (player_id, status);
create index idx_group_memberships_payment_intent_id on public.group_memberships (payment_intent_id);

create trigger group_memberships_set_updated_at
  before update on public.group_memberships
  for each row execute function public.set_updated_at();

-- ============================================================================
-- sessions: group shape. See header note 5.
-- ============================================================================

alter table public.sessions
  add column group_id uuid references public.training_groups (id) on delete restrict;

alter table public.sessions alter column player_id drop not null;
alter table public.sessions alter column session_type_id drop not null;

-- Non-group rows keep the exact pre-0076 shape; group rows have no single
-- player and no session type (the group itself is the "type").
alter table public.sessions
  add constraint sessions_group_shape check (
    (group_id is null and player_id is not null and session_type_id is not null)
    or (group_id is not null and player_id is null)
  );

create index idx_sessions_group_id on public.sessions (group_id) where group_id is not null;

-- ============================================================================
-- session_participants
-- ============================================================================

create table public.session_participants (
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null references public.users (id) on delete cascade,
  -- Null until the coach marks attendance (mark_attendance RPC, 0079,
  -- requires the session to be in_progress).
  attendance_status text check (attendance_status in ('present', 'absent')),
  marked_at timestamptz,
  primary key (session_id, player_id)
);

create index idx_session_participants_player_id on public.session_participants (player_id);

-- ============================================================================
-- RLS. SELECT-only for clients; all writes are RPC / service_role. Note 7.
-- ============================================================================

alter table public.training_groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.session_participants enable row level security;

-- training_groups: public discovery of active groups owned by verified
-- coaches (anon included, founder decision); coach reads own rows in any
-- state; a member keeps reading a group they belong to even if it goes
-- inactive; admin reads all. PERMISSIVE-OR: an unscoped select returns every
-- active group in the product. App code must filter.
create policy training_groups_select_public on public.training_groups
  for select to anon, authenticated
  using (
    active = true
    and exists (
      select 1 from public.coach_profiles cp
      where cp.user_id = training_groups.coach_id
        and cp.status = 'verified'
    )
  );

create policy training_groups_select_coach on public.training_groups
  for select to authenticated
  using (coach_id = auth.uid());

create policy training_groups_select_member on public.training_groups
  for select to authenticated
  using (
    exists (
      select 1 from public.group_memberships m
      where m.group_id = training_groups.id
        and m.player_id = auth.uid()
        and m.status <> 'lapsed'
    )
  );

create policy training_groups_select_admin on public.training_groups
  for select to authenticated
  using (public.has_role('admin'));

-- group_memberships: coach reads every membership of their own groups
-- (roster + fares screens); player reads only their own membership rows;
-- admin reads all. No cross-member visibility: one member never sees
-- another member's membership or payment linkage.
create policy group_memberships_select_coach on public.group_memberships
  for select to authenticated
  using (
    exists (
      select 1 from public.training_groups g
      where g.id = group_memberships.group_id
        and g.coach_id = auth.uid()
    )
  );

create policy group_memberships_select_player on public.group_memberships
  for select to authenticated
  using (player_id = auth.uid());

create policy group_memberships_select_admin on public.group_memberships
  for select to authenticated
  using (public.has_role('admin'));

-- session_participants: the session's coach reads all participant rows
-- (attendance marking + rate tiles); a player reads only their own rows;
-- admin reads all.
create policy session_participants_select_coach on public.session_participants
  for select to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_participants.session_id
        and s.coach_id = auth.uid()
    )
  );

create policy session_participants_select_player on public.session_participants
  for select to authenticated
  using (player_id = auth.uid());

create policy session_participants_select_admin on public.session_participants
  for select to authenticated
  using (public.has_role('admin'));

-- A group member must be able to read the group session rows they are part
-- of. sessions_select_player matches nothing for group rows (player_id is
-- null there), so participation is the membership.
create policy sessions_select_group_participant on public.sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.session_participants sp
      where sp.session_id = sessions.id
        and sp.player_id = auth.uid()
    )
  );

-- Grant-level lockdown on top of the absent write policies, the
-- ledger_entries / sessions precedent: even a future carelessly permissive
-- policy cannot produce a client write path to these money-adjacent rows.
revoke insert, update, delete on public.training_groups from anon, authenticated;
revoke insert, update, delete on public.group_memberships from anon, authenticated;
revoke insert, update, delete on public.session_participants from anon, authenticated;

-- Realtime: deliberately NOT touched here. 0078 (group chat) manages the
-- publication for its own tables; chat_messages is already published.
