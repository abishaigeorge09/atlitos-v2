-- ATLITOS v2 — seed_identity.sql
--
-- Attaches the verified `coach_profiles` rows for the two fixture coach
-- accounts. That is the one identity fixture nothing else in this repo
-- creates: scripts/seed-demo-users.mjs owns account creation and role grants
-- (it holds the service role key and drives the GoTrue admin API) but never
-- touches coach_profiles, and scripts/seed-coaching-fixtures.mjs runs with the
-- anon key and explicitly defers coach_profiles.status to an out of band admin
-- call (see its BLOCKERS output, step 3). Without this file the two verified
-- coach profiles the project actually has would have no seed provenance.
--
-- README: auth.users cannot be seeded from plain SQL. Supabase Auth stores
-- passwords through GoTrue's own bcrypt hashing, not a column this script can
-- write directly, so a raw `insert into auth.users (...)` never produces an
-- account that can sign in. Accounts and roles therefore come from
-- scripts/seed-demo-users.mjs; this file only matches those accounts by email,
-- and each block is a no-op until the account exists.
--
-- Run order: after scripts/seed-demo-users.mjs (which creates
-- coach1@atlitos.dev and coach2@atlitos.dev and grants them the 'coach' role),
-- and before scripts/seed-coaching-fixtures.mjs, whose session_types and
-- coach_availability_windows rows both carry a foreign key to
-- coach_profiles(user_id) and cannot be written until the profile below
-- exists. Safe in any order and safe to re-run: an insert whose email is not
-- present selects zero rows, and every insert carries `on conflict (user_id)
-- do nothing`, so an existing profile is never overwritten.
--
-- This runs with elevated (migration/service-role) privileges, so it writes
-- coach_profiles directly rather than through submit_coach_verification
-- (0004_player_and_coach_setup_rpc.sql). That RPC plus the admin approval
-- queue is the real coach onboarding path; this is fixture loading, the same
-- relationship seed_p2.sql has to submit_venue_verification.
--
-- History (2026-09-12 auth and deployment audit): this file used to target
-- demo.coach@atlitos.dev and demo.admin@atlitos.dev. Neither address was ever
-- created, here or by hand, and every statement was guarded by
-- `where au.email = 'demo.*'`, so the whole file was a silent no-op. The real
-- fixture accounts are coach1@atlitos.dev and coach2@atlitos.dev (coach) and
-- admin@atlitos.dev (admin), all three created and role granted by
-- scripts/seed-demo-users.mjs, so the role grants that used to live here are
-- removed rather than duplicated: user_roles has exactly one owner. The
-- profile values below mirror the live rows on the project, so a fresh
-- environment reproduces the fixtures the app was verified against.

-- Fixture coach 1: Ravi Kumar, cricket, Bangalore.
insert into public.coach_profiles (
  user_id, sport, experience_years, coaching_style, specialization, bio, city, state, status
)
select
  u.id,
  'cricket'::public.sport,
  8,
  'technical',
  array['batting', 'fielding'],
  'Former state level batter. Focus on technique and match temperament.',
  'Bangalore',
  'Karnataka',
  'verified'::public.coach_status
from auth.users au
join public.users u on u.id = au.id
where au.email = 'coach1@atlitos.dev'
on conflict (user_id) do nothing;

-- Fixture coach 2: Sana Iyer, tennis, Delhi.
insert into public.coach_profiles (
  user_id, sport, experience_years, coaching_style, specialization, bio, city, state, status
)
select
  u.id,
  'tennis'::public.sport,
  5,
  'match_play',
  array['forehand', 'serve'],
  'Coaching juniors and adults on footwork and consistency.',
  'Delhi',
  'Delhi',
  'verified'::public.coach_status
from auth.users au
join public.users u on u.id = au.id
where au.email = 'coach2@atlitos.dev'
on conflict (user_id) do nothing;

-- A verified profile is what makes a coach discoverable and bookable: the
-- coach_profiles_public view is `where status = 'verified'`, and
-- is_verified_coach(uuid) backs the public policies on session_types and
-- coach_availability_windows. Role changes are a separate concern and belong
-- to scripts/seed-demo-users.mjs; when a role grant does change, the affected
-- account must refresh its Supabase session before the new role appears in the
-- JWT's app_metadata.roles claim, see RLS.md's "Staleness note".
