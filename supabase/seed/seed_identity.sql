-- ATLITOS v2 — seed_identity.sql
--
-- README: auth.users cannot be seeded from plain SQL. Supabase Auth stores
-- passwords through GoTrue's own bcrypt hashing, not a column this script
-- can write directly, so a raw `insert into auth.users (...)` never
-- produces an account that can actually sign in. The workflow for the two
-- demo accounts this file supports is therefore:
--
--   1. Create the accounts through the app itself (normal email/password
--      sign up against apps/mobile or the Supabase Auth API), using the two
--      email addresses named below. The public.users row and the default
--      'player' user_roles row are created automatically by the
--      on_auth_user_created trigger from 0001_identity.sql the moment
--      auth.users gains the row.
--   2. Re-run this file (or just the two blocks below). Each block matches
--      the demo account by email against auth.users and is a no-op until
--      that account exists, so this script is safe to run before step 1,
--      after step 1, or repeatedly.
--
-- Documented placeholder identifiers (reference only, not used in any
-- INSERT below, since the real auth.users id is assigned by GoTrue at
-- signup and cannot be chosen in advance):
--   demo coach  -> demo.coach@atlitos.dev  (illustrative uuid 00000000-0000-0000-0000-000000000001)
--   demo admin  -> demo.admin@atlitos.dev  (illustrative uuid 00000000-0000-0000-0000-000000000002)

-- Demo coach: promote to 'coach' and attach a verified coach_profiles row.
insert into public.user_roles (user_id, role)
select u.id, 'coach'::public.app_role
from auth.users au
join public.users u on u.id = au.id
where au.email = 'demo.coach@atlitos.dev'
on conflict (user_id, role) do nothing;

insert into public.coach_profiles (
  user_id, sport, experience_years, coaching_style, specialization, bio, city, state, status
)
select
  u.id,
  'football'::public.sport,
  5,
  'Technical, video-led feedback after every session',
  array['dribbling', 'finishing'],
  'Former state league player, five years coaching juniors.',
  'Bengaluru',
  'Karnataka',
  'verified'::public.coach_status
from auth.users au
join public.users u on u.id = au.id
where au.email = 'demo.coach@atlitos.dev'
on conflict (user_id) do nothing;

-- Demo admin: promote to 'admin'.
insert into public.user_roles (user_id, role)
select u.id, 'admin'::public.app_role
from auth.users au
join public.users u on u.id = au.id
where au.email = 'demo.admin@atlitos.dev'
on conflict (user_id, role) do nothing;

-- After either insert above actually adds a row, the affected account must
-- refresh its Supabase session (or wait for its next natural token
-- refresh) before the new role appears in the JWT's app_metadata.roles
-- claim; see RLS.md's "Staleness note".
