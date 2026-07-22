-- ATLITOS v2 — 0057_learn_schema.sql
-- Domain: learn. Epic AT-9 (Learn and XP), story AT-129 (Track A).
-- Requirements: PRD-01 FR-48, FR-49, FR-50, FR-51; PRD-04 FR-49.
--
-- The foundation the whole XP engine (0059), the RLS lockdown (0058), the read
-- layer (0060), the admin drill CRUD (Track B), the Learn screens (Track C),
-- and the seed fixtures (Track D) build on. Exactly SCHEMA.md "Domain: learn".
--
-- NOT A MONEY PHASE (PHASE-7-STATUS.md line 9). XP is progression, not currency.
-- There is NO ledger leg, NO double-entry, NO finalize gate. We mirror the
-- ledger DISCIPLINE only: xp_events is an append-only log, the XP total is
-- DERIVED (sum(xp_amount)) not a stored mutable counter, and (in 0058) neither
-- xp_events nor user_milestones is client-writable. This migration only creates
-- the tables, enums, constraints, and indexes; RLS/grants are 0058, the XP
-- triggers are 0059, the read layer is 0060.

-- ============================================================================
-- Enums (SCHEMA.md "Domain: learn" enum table, lines 41-42).
--   drill_difficulty  beginner | intermediate | advanced
--   xp_source         drill_complete | milestone | other
-- xp_source carries 'other' as a DESIGNED-IN HOOK ONLY (PHASE-7-STATUS.md line
-- 19): no PRD FR wires any cross-domain source (session/court/donation/clip) to
-- XP in P7, so P7 grants XP from drill_complete only. A later phase adds one
-- more trigger on the relevant domain table with zero change to the read layer.
-- ============================================================================

create type public.drill_difficulty as enum ('beginner', 'intermediate', 'advanced');

create type public.xp_source as enum ('drill_complete', 'milestone', 'other');

-- ============================================================================
-- drills
--
-- Admin-authored reference content (PRD-04 FR-49). xp_value is the ONLY source
-- of an XP grant's amount: the 0059 trigger reads it server side, a client can
-- never supply it. CHECK (xp_value > 0) so a drill can never grant zero or
-- negative XP. `active` gates the consumer surface: 0058 makes the whole
-- catalog publicly readable (permissive-OR), so every consumer read MUST carry
-- its own `.eq('active', true)` filter (SCHEMA.md, PHASE-7-STATUS.md line 50).
-- ============================================================================

create table public.drills (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  sport public.sport not null,
  skill_category text not null,
  difficulty public.drill_difficulty not null,
  xp_value int not null check (xp_value > 0),
  media_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot path: the Learn library filters by sport and active (SCHEMA.md line 802).
create index idx_drills_sport_active on public.drills (sport, active);

create trigger drills_set_updated_at
  before update on public.drills
  for each row execute function public.set_updated_at();

comment on table public.drills is
  'Admin-authored drill reference content (PRD-04 FR-49). xp_value (CHECK > 0) is the ONLY source of an XP grant amount; the 0059 trigger reads it server side, never a client-supplied number. Public catalog (0058, permissive-OR): every consumer read carries its own active = true filter.';

-- ============================================================================
-- drill_completions
--
-- The single client write in the whole XP path (PHASE-7-STATUS.md line 23): a
-- player INSERTs its own row (user_id = auth.uid(), drill_id). 0058 grants
-- authenticated an own-row INSERT and NOTHING ELSE (no UPDATE/DELETE). The
-- UNIQUE(user_id, drill_id) is THE idempotency guard FR-49 requires: a second
-- completion of the same drill fails the constraint, the 0059 trigger never
-- fires again, and no second xp_events row is written. It is a schema
-- constraint, not bypassable application logic. v2 first cut: one-time XP per
-- drill, no redo affordance (PHASE-7-STATUS.md resolved assumption 2).
-- ============================================================================

create table public.drill_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  drill_id uuid not null references public.drills (id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (user_id, drill_id)
);

create index idx_drill_completions_user_id on public.drill_completions (user_id);

comment on table public.drill_completions is
  'The ONE client write in the XP path (own-row INSERT only, 0058). UNIQUE(user_id, drill_id) is the FR-49 idempotency guard: a duplicate completion fails the constraint and no second xp_events row is written. No UPDATE/DELETE grant.';

-- ============================================================================
-- roadmap_stages
--
-- Seed-authored reference content per sport (PHASE-7-STATUS.md resolved
-- assumption 4: NOT an admin CRUD surface). The roadmap current stage is a PURE
-- FUNCTION of the XP total at read time (0060): the top stage_order for the
-- player's sport whose xp_threshold <= sum(xp_events.xp_amount). Nothing
-- denormalized. UNIQUE(sport, stage_order) keeps the ladder well-formed.
-- ============================================================================

create table public.roadmap_stages (
  id uuid primary key default gen_random_uuid(),
  sport public.sport not null,
  stage_order smallint not null,
  name text not null,
  xp_threshold int not null check (xp_threshold >= 0),
  unique (sport, stage_order)
);

create index idx_roadmap_stages_sport on public.roadmap_stages (sport, xp_threshold);

comment on table public.roadmap_stages is
  'Seed-authored roadmap ladder per sport (not an admin surface, PHASE-7-STATUS.md assumption 4). Current stage is derived at read time: top stage_order for the player sport whose xp_threshold <= XP total. UNIQUE(sport, stage_order).';

-- ============================================================================
-- xp_events — THE APPEND-ONLY XP LOG
--
-- The tamper-proof core. A row is written ONLY by the 0059 trigger, in the same
-- transaction as the drill_completions insert, with xp_amount read server side
-- from drills.xp_value. 0058 gives authenticated an owner SELECT and NO write
-- grant of any kind, so a direct client INSERT returns 42501 and XP cannot be
-- forged. The XP total is sum(xp_amount) at read time; there is deliberately NO
-- denormalized counter column anywhere (SCHEMA.md line 838, the same rule as
-- ledger balances). source carries the xp_source enum; drill_id is set for
-- drill_complete, nullable for a future 'other' source.
-- ============================================================================

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  drill_id uuid references public.drills (id) on delete set null,
  source public.xp_source not null,
  xp_amount int not null check (xp_amount > 0),
  created_at timestamptz not null default now()
);

create index idx_xp_events_user_id on public.xp_events (user_id);

comment on table public.xp_events is
  'Append-only XP log. Rows written ONLY by the 0059 AFTER INSERT trigger on drill_completions, xp_amount read server side from drills.xp_value. NO client write grant (0058): a direct INSERT returns 42501. XP total = sum(xp_amount) at read time; no denormalized counter, ever (SCHEMA.md).';

-- ============================================================================
-- milestones
--
-- Seed-authored reference content (not an admin surface, assumption 4). Each
-- carries a lucide icon_name (never an emoji, CLAUDE.md) and a criteria jsonb
-- the 0059 evaluator reads: {"type":"xp_threshold","value":N} against the
-- running XP sum, or {"type":"drill_count","value":N} against the completion
-- count. key is a stable unique handle for seeds/tests.
-- ============================================================================

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null,
  icon_name text not null,
  criteria jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.milestones is
  'Seed-authored milestone definitions. icon_name is a lucide name, never an emoji (CLAUDE.md). criteria jsonb is read by the 0059 evaluator: {"type":"xp_threshold","value":N} vs the XP sum, or {"type":"drill_count","value":N} vs the completion count.';

-- ============================================================================
-- user_milestones
--
-- An earned-milestone row, inserted ONLY by the 0059 evaluator when a criterion
-- is newly met. 0058 gives authenticated an owner SELECT and NO write grant, so
-- a milestone cannot be self-awarded (a direct INSERT returns 42501).
-- UNIQUE(user_id, milestone_id) makes the unlock idempotent: the evaluator
-- re-running never inserts a duplicate (SCHEMA.md line 859).
-- ============================================================================

create table public.user_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  earned_at timestamptz not null default now(),
  unique (user_id, milestone_id)
);

create index idx_user_milestones_user_id on public.user_milestones (user_id);

comment on table public.user_milestones is
  'Earned-milestone rows, inserted ONLY by the 0059 evaluator. NO client write grant (0058): a direct INSERT returns 42501, a milestone cannot be self-awarded. UNIQUE(user_id, milestone_id) makes the unlock idempotent.';
