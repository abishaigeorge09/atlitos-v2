-- ATLITOS v2 — 0018_coaching.sql
-- Domain: coaching (SCHEMA.md "Domain: coaching"). Epic AT-5, story AT-35.
-- Requirements: PRD-02 FR-4, FR-5, FR-22, FR-24.
--
-- Tables created here: public.session_types, public.coach_availability_windows,
-- public.sessions. public.coach_profiles and public.coach_certificates already
-- exist from 0001_identity.sql and are NOT recreated.
--
-- Decisions made here, and why:
--
--   1. Availability overlap constraint uses public.timerange, not tsrange.
--      SCHEMA.md's coaching section literally writes
--      "EXCLUDE ... tsrange(start_time, end_time) WITH &&", but start_time and
--      end_time are `time` columns and tsrange is a range over `timestamp`;
--      that expression does not type-check. 0009_courts.sql already hit this
--      exact problem for court_pricing_rules and solved it by defining the
--      custom range type public.timerange (Postgres ships no built-in range
--      over `time`). Reusing that type here rather than inventing a second
--      mechanism. SCHEMA.md is updated in the same commit to say timerange.
--
--   2. effective_from is NOT part of the exclusion key. SCHEMA.md scopes the
--      overlap rule to (coach_id, day_of_week) only, and PRD-02 FR-5 says
--      overlapping windows on the same day for the same coach are rejected,
--      full stop. Consequence for the availability editor (AT-49): editing a
--      window is an UPDATE in place, not the insertion of a second superseding
--      row with a later effective_from. FR-23 ("changes take effect for future
--      slot generation only and never retroactively invalidate an already
--      accepted session") still holds because slot generation is a read-time
--      computation (AT-38) while an accepted session is a persisted row that
--      no availability edit touches.
--
--   3. session_status carries no pending_payment / expired value, unlike
--      court_booking_status after 0011. SCHEMA.md's session_status enum and
--      PRD-01 FR-24 ("a successful session booking creates a session in
--      requested status") are explicit: a session's first persisted state is
--      `requested`. The book-session edge function (AT-40, Track B) therefore
--      inserts the row with status `requested` and its payment_intent_id, and
--      the slot hold is the partial unique index below from the moment of
--      insert. If Track B finds it needs a pre-payment hold state the way
--      courts did, that is a schema change to be raised, not something to work
--      around by writing status from the client.
--
--   4. sessions.price is copied from session_types.price at booking time by
--      book-session and never recomputed. Nothing in this migration
--      recalculates it; there is deliberately no trigger syncing it back to
--      session_types, per SCHEMA.md and the AT-35 ticket.
--
--   5. RLS is ENABLED on all three tables here with zero policies, which means
--      zero rows for every non-superuser role until 0019_coaching_rls.sql adds
--      them (RLS.md: "If a table has zero matching policies for a role, that
--      role gets zero rows, not an error"). Enabling in the schema migration
--      rather than the policy migration means there is no window in which
--      these tables exist unprotected.

-- ============================================================================
-- Enums
-- ============================================================================

-- Machine (SCHEMA.md, PRD-02 FR-19): requested -> (accepted | declined);
-- accepted -> (completed | cancelled | rescheduled); completed -> rated.
-- Enforced by session_transition / rate_session in 0020, never by a client.
create type public.session_status as enum (
  'requested',
  'accepted',
  'declined',
  'completed',
  'cancelled',
  'rescheduled',
  'rated'
);

create type public.session_frequency as enum ('one_time', 'weekly', 'monthly');

-- ============================================================================
-- session_types (PRD-02 FR-4)
-- ============================================================================

create table public.session_types (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  price numeric(12, 2) not null check (price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_session_types_coach_id on public.session_types (coach_id);

create trigger session_types_set_updated_at
  before update on public.session_types
  for each row execute function public.set_updated_at();

-- ============================================================================
-- coach_availability_windows (PRD-02 FR-5, FR-22, FR-23)
-- ============================================================================

create table public.coach_availability_windows (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index idx_coach_availability_coach_id on public.coach_availability_windows (coach_id);

-- PRD-02 FR-5: two windows for the same coach on the same day of week may not
-- overlap. Rejected at write time by the database, so the client-side error
-- FR-5 asks for is a nicety rather than the actual guard. btree_gist (already
-- installed by 0009_courts.sql) supplies the gist opclass for the uuid and
-- smallint equality terms; public.timerange supplies the && operator. See
-- header note 1 on why this is timerange and not SCHEMA.md's tsrange.
alter table public.coach_availability_windows
  add constraint coach_availability_windows_no_overlap
  exclude using gist (
    coach_id with =,
    day_of_week with =,
    public.timerange(start_time, end_time, '[)') with &&
  );

-- ============================================================================
-- sessions (PRD-02 FR-24, PRD-01 FR-24)
-- ============================================================================

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  player_id uuid not null references public.users (id) on delete cascade,
  session_type_id uuid not null references public.session_types (id) on delete restrict,
  frequency public.session_frequency not null,
  date date not null,
  slot_start time not null,
  slot_end time not null,
  focus_area text,
  location text,
  status public.session_status not null default 'requested',
  -- Locked at booking time, never recomputed. See header note 4.
  price numeric(12, 2) not null,
  platform_fee numeric(12, 2) not null,
  total numeric(12, 2) not null,
  payment_intent_id uuid references public.payment_intents (id) on delete set null,
  rating smallint check (rating between 1 and 5),
  remarks text,
  decline_reason text,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_end > slot_start)
);

-- PRD-02 FR-24, the sole arbiter of the slot race. Two athletes booking the
-- same (coach, date, slot_start) concurrently: the database rejects the loser
-- with 23505 and book-session (AT-40) maps that to SLOT_TAKEN without ever
-- calling Razorpay. Declined and cancelled sessions free the slot again;
-- every other status (including rescheduled, which leaves a tombstone row
-- behind pointing at the new one) keeps holding it.
create unique index sessions_coach_date_slot_unique
  on public.sessions (coach_id, date, slot_start)
  where (status not in ('declined', 'cancelled'));

create index idx_sessions_coach_id_status on public.sessions (coach_id, status);
create index idx_sessions_player_id on public.sessions (player_id);

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS enabled, policies land in 0019_coaching_rls.sql. See header note 5.
-- ============================================================================

alter table public.session_types enable row level security;
alter table public.coach_availability_windows enable row level security;
alter table public.sessions enable row level security;
