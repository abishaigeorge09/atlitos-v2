-- ATLITOS v2 — scripts/local-supabase-shim.sql
--
-- The smallest set of Supabase platform objects the migration chain needs in
-- order to apply to a PLAIN Postgres. Used by scripts/verify-migrations-local.sh
-- so the 91 migrations and scripts/verify-security-fixes.sql can be replayed on
-- a laptop or in CI with no Supabase project, no service-role key and no Docker.
--
-- THIS IS NOT A SUPABASE REPLICA. GoTrue, PostgREST, Storage, Realtime and
-- pg_cron are all absent; what is here are stand-ins good enough to prove the
-- SQL is valid and the functions behave. A green run means "the migrations
-- apply and the RPCs and policies do what they claim", NOT "the deployed
-- platform is configured correctly". Auth hook registration, storage object
-- policies against a real bucket, realtime publication behaviour and the
-- pg_cron schedule all still need the real project.
--
-- The grants at the bottom matter more than they look: Supabase gives
-- anon/authenticated broad table privileges and relies on RLS for scoping. Omit
-- them and every policy assertion passes for the wrong reason, refused at the
-- GRANT layer before any policy is consulted.

-- Minimal Supabase-platform shim so the migration chain can be applied to a
-- plain Postgres for syntax + logic verification. NOT a Supabase replica:
-- GoTrue, PostgREST, Storage and pg_cron are absent, so this proves the SQL is
-- valid and the functions behave, not that the platform wiring is right.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create role authenticator noinherit login;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists cron;

create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean not null default false
);

-- Session-scoped identity, driven by set_config('request.jwt.claims', ...).
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb);
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb) ->> 'sub', '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb) ->> 'role', 'anon');
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  metadata jsonb
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/');
$$;

-- pg_cron is unavailable off-platform; the schedule call is a no-op stub so
-- migrations that register the sweep still apply.
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$ select 1::bigint; $$;
create or replace function cron.schedule(schedule text, command text)
returns bigint language sql as $$ select 1::bigint; $$;
create or replace function cron.unschedule(job_name text)
returns boolean language sql as $$ select true; $$;

grant usage on schema auth, storage, extensions, cron to anon, authenticated, service_role, supabase_auth_admin, postgres;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants anon/authenticated table privileges by default and relies on
-- RLS for scoping; without this the shim would refuse writes at the GRANT layer
-- and every policy assertion would pass for the wrong reason.
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
