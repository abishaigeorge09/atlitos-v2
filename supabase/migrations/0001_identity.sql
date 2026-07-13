-- ATLITOS v2 — 0001_identity.sql
-- Domain: identity/roles (SCHEMA.md "Domain: identity/roles" plus coaching's
-- coach_profiles/coach_certificates, pulled forward into this migration
-- because Phase 1 needs a coach's own profile row from day one).
--
-- Tables: public.users, public.user_roles, public.addresses,
--         public.coach_profiles, public.coach_certificates,
--         public.athlete_sports.
--
-- Naming decision: the task brief called the first table "profiles"; this
-- migration names it public.users to match SCHEMA.md exactly (SCHEMA.md is
-- the column-name source of truth per CLAUDE.md). It is the 1:1 auth.users
-- extension table the brief describes.
--
-- Schema decision: public.athlete_sports is new relative to SCHEMA.md (which
-- only has users.sports sport[] as a denormalized cache). It gives an
-- athlete a normalized per-sport row (skill_level, is_primary) without
-- removing the cache column. Added to SCHEMA.md in the same change.
--
-- Role decision: public.app_role gains 'moderator' (needed by 0003's
-- moderation/audit RLS) in addition to every value SCHEMA.md already lists
-- (including 'court_staff', reserved for the courts domain migration).
-- Added to SCHEMA.md in the same change.

-- ============================================================================
-- Enums
-- ============================================================================

create type public.app_role as enum (
  'player',
  'coach',
  'court_partner',
  'court_staff',
  'upa',
  'admin',
  'moderator'
);

create type public.user_status as enum ('active', 'suspended');

create type public.sport as enum ('football', 'cricket', 'badminton', 'tennis');

create type public.coach_status as enum ('pending_review', 'verified', 'rejected');

-- ============================================================================
-- Shared trigger helper (reused by every later migration)
-- ============================================================================

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  phone text unique,
  dob date,
  avatar_url text,
  channel_name text,
  city text,
  state text,
  sports public.sport[] not null default '{}',
  status public.user_status not null default 'active',
  suspended_reason text,
  show_donor_name boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_users_phone on public.users (phone);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create index idx_user_roles_user_id on public.user_roles (user_id);

-- ============================================================================
-- has_role() and friends (RLS.md, "has_role() and friends")
-- Signature is has_role(text) per the task brief rather than
-- has_role(app_role); it compares against the plain string already carried
-- by the JWT's app_metadata.roles array so callers can pass a literal
-- string without an enum cast. Defined here, after public.user_roles
-- (is_guest() queries it) and before any later table's trigger or policy
-- uses these.
-- ============================================================================

create function public.has_role(_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' -> 'roles') @> to_jsonb(_role),
    false
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.has_role('admin');
$$;

create function public.is_moderator()
returns boolean
language sql
stable
as $$
  select public.has_role('moderator');
$$;

create function public.is_guest()
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from public.user_roles where user_id = auth.uid()
  );
$$;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  pincode text not null check (pincode ~ '^[0-9]{6}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_addresses_user_id on public.addresses (user_id);

create table public.coach_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  sport public.sport not null,
  experience_years int not null,
  coaching_style text,
  specialization text[] not null default '{}',
  bio text,
  city text not null,
  state text not null,
  status public.coach_status not null default 'pending_review',
  rating numeric(3, 2) not null default 0,
  rating_count int not null default 0,
  players_coached_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_coach_profiles_status_sport on public.coach_profiles (status, sport);
create index idx_coach_profiles_city on public.coach_profiles (city);

create trigger coach_profiles_set_updated_at
  before update on public.coach_profiles
  for each row execute function public.set_updated_at();

-- coach_profiles.sport immutability trigger (SCHEMA.md: "immutable after
-- first verification_requests submission") is created in
-- 0003_moderation_audit.sql, once public.verification_requests exists.

-- status is admin-only (verification RPC path); rating/rating_count/
-- players_coached_count are server-computed aggregates the future ratings
-- pipeline writes, not something a coach edits on their own profile.
create function public.lock_coach_profile_admin_fields()
returns trigger
language plpgsql
as $$
begin
  if (
    new.status is distinct from old.status
    or new.rating is distinct from old.rating
    or new.rating_count is distinct from old.rating_count
    or new.players_coached_count is distinct from old.players_coached_count
  ) and not public.has_role('admin') then
    raise exception 'FIELD_LOCKED: status, rating, rating_count, players_coached_count change only via admin or a server-side pipeline';
  end if;
  return new;
end;
$$;

create trigger coach_profiles_lock_admin_fields
  before update on public.coach_profiles
  for each row execute function public.lock_coach_profile_admin_fields();

create table public.coach_certificates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  name text not null,
  storage_path text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_coach_certificates_coach_id on public.coach_certificates (coach_id);

create table public.athlete_sports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  sport public.sport not null,
  skill_level text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sport)
);

create index idx_athlete_sports_user_id on public.athlete_sports (user_id);

create trigger athlete_sports_set_updated_at
  before update on public.athlete_sports
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Signup trigger: auto create the public.users row and a default 'player'
-- role the moment a new auth.users row lands.
-- ============================================================================

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  );

  insert into public.user_roles (user_id, role)
  values (new.id, 'player');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Custom access token hook (RLS.md, "JWT custom claims hook")
-- Registered against Auth > Hooks > Customize Access Token Claims in the
-- Supabase dashboard/Management API; that registration step is outside SQL
-- and is not performed by this migration.
-- ============================================================================

create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  user_roles_arr jsonb;
begin
  select coalesce(jsonb_agg(role), '[]'::jsonb)
    into user_roles_arr
    from public.user_roles
    where user_id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{app_metadata,roles}', user_roles_arr);
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- Deliberately no "revoke all on public.user_roles from authenticated" here:
-- authenticated must keep its normal table grant so the RLS policies below
-- (own rows readable) still work. supabase_auth_admin already carries
-- BYPASSRLS by default on Supabase projects; this grant is defensive only.
grant select on public.user_roles to supabase_auth_admin;

-- ============================================================================
-- Public-safe views
-- Postgres views run with the privileges of their owner (here, the migration
-- role) by default, so these deliberately omit security_invoker: they read
-- past the base tables' owner/admin-only RLS and re-expose a narrow, public
-- column set, filtered to the safe status, as the sole public read surface.
-- ============================================================================

create view public.public_profiles
with (security_invoker = false) as
select id, name, avatar_url, channel_name
from public.users;

grant select on public.public_profiles to anon, authenticated;

create view public.coach_profiles_public
with (security_invoker = false) as
select
  user_id,
  sport,
  experience_years,
  coaching_style,
  specialization,
  bio,
  city,
  state,
  rating,
  rating_count,
  players_coached_count,
  created_at
from public.coach_profiles
where status = 'verified';

grant select on public.coach_profiles_public to anon, authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.addresses enable row level security;
alter table public.coach_profiles enable row level security;
alter table public.coach_certificates enable row level security;
alter table public.athlete_sports enable row level security;

-- users: own row read/write; admin reads all; insert is trigger-only.
create policy users_select_own on public.users
  for select to authenticated
  using (id = auth.uid());

create policy users_select_admin on public.users
  for select to authenticated
  using (public.has_role('admin'));

create policy users_update_own on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- user_roles: own rows read only; admin reads all; no client write at all,
-- every grant happens via the signup trigger (SECURITY DEFINER, bypasses
-- RLS as the function owner) or a future verification-approval RPC.
create policy user_roles_select_own on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());

create policy user_roles_select_admin on public.user_roles
  for select to authenticated
  using (public.has_role('admin'));

-- addresses: full owner CRUD. The "block delete while referenced by a
-- non-delivered/non-cancelled order" trigger from RLS.md is deferred to the
-- commerce domain migration, since public.orders does not exist yet.
create policy addresses_select_own on public.addresses
  for select to authenticated
  using (user_id = auth.uid());

create policy addresses_insert_own on public.addresses
  for insert to authenticated
  with check (user_id = auth.uid());

create policy addresses_update_own on public.addresses
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy addresses_delete_own on public.addresses
  for delete to authenticated
  using (user_id = auth.uid());

-- coach_profiles: base table stays owner+admin only; public discovery goes
-- through public.coach_profiles_public above (task brief: "public read on
-- safe columns of coach_profiles via a view").
create policy coach_profiles_select_own on public.coach_profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy coach_profiles_select_admin on public.coach_profiles
  for select to authenticated
  using (public.has_role('admin'));

create policy coach_profiles_insert_own on public.coach_profiles
  for insert to authenticated
  with check (user_id = auth.uid() and public.has_role('coach'));

create policy coach_profiles_update_own on public.coach_profiles
  for update to authenticated
  using (user_id = auth.uid() and public.has_role('coach'))
  with check (user_id = auth.uid() and public.has_role('coach'));

-- coach_certificates: owner CRUD on upload/delete; admin reads all and is
-- the only role that can flip `verified`.
create policy coach_certificates_select_own on public.coach_certificates
  for select to authenticated
  using (coach_id = auth.uid());

create policy coach_certificates_select_admin on public.coach_certificates
  for select to authenticated
  using (public.has_role('admin'));

create policy coach_certificates_insert_own on public.coach_certificates
  for insert to authenticated
  with check (coach_id = auth.uid() and public.has_role('coach'));

create policy coach_certificates_delete_own on public.coach_certificates
  for delete to authenticated
  using (coach_id = auth.uid() and public.has_role('coach'));

create policy coach_certificates_update_admin on public.coach_certificates
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- athlete_sports: full owner CRUD; admin reads all.
create policy athlete_sports_select_own on public.athlete_sports
  for select to authenticated
  using (user_id = auth.uid());

create policy athlete_sports_select_admin on public.athlete_sports
  for select to authenticated
  using (public.has_role('admin'));

create policy athlete_sports_insert_own on public.athlete_sports
  for insert to authenticated
  with check (user_id = auth.uid());

create policy athlete_sports_update_own on public.athlete_sports
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy athlete_sports_delete_own on public.athlete_sports
  for delete to authenticated
  using (user_id = auth.uid());
