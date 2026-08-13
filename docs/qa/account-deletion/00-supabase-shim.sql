-- Local-only shim that reproduces the parts of a Supabase project the
-- Atlitos migrations depend on, so the full migration history can be replayed
-- against a plain Postgres 17 cluster. Never applied to any hosted project.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit login;
create role supabase_auth_admin login bypassrls createrole;
create role supabase_storage_admin login bypassrls;
create role supabase_realtime_admin login;
create role dashboard_user;
create role supabase_admin login bypassrls superuser;

grant anon, authenticated, service_role to authenticator;

create schema extensions;
create schema auth authorization supabase_auth_admin;
create schema storage authorization supabase_storage_admin;
create schema realtime authorization supabase_realtime_admin;
create schema cron;
create schema graphql_public;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

alter database postgres set search_path = "$user", public, extensions;

-- gen_random_uuid lives in pg_catalog on PG13+, nothing to shim.

-- ---------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous boolean not null default false,
  encrypted_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  identity_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider_id, provider)
);

create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table auth.refresh_tokens (
  id bigserial primary key,
  session_id uuid references auth.sessions (id) on delete cascade,
  token text
);

-- request.jwt.claims is how Supabase's auth.uid()/auth.jwt() actually resolve.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_setting('role', true));
$$;

grant usage on schema auth to anon, authenticated, service_role, postgres;
grant select on all tables in schema auth to postgres, service_role;

-- ---------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------
create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

grant usage on schema storage to anon, authenticated, service_role, postgres;
grant all on storage.objects, storage.buckets to postgres, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

-- ---------------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------------
create table realtime.messages (
  id bigserial,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now(),
  primary key (id, inserted_at)
) partition by range (inserted_at);

create table realtime.messages_default partition of realtime.messages default;

alter table realtime.messages enable row level security;

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text;
$$;

create or replace function realtime.send(
  payload jsonb,
  event text,
  topic text,
  private boolean default true
)
returns void
language plpgsql
as $$
begin
  insert into realtime.messages (topic, extension, payload, event, private)
  values (topic, 'broadcast', payload, event, private);
end;
$$;

grant usage on schema realtime to anon, authenticated, service_role, postgres;
grant select, insert on realtime.messages to anon, authenticated, service_role, postgres;
grant usage, select on all sequences in schema realtime to anon, authenticated, service_role, postgres;

-- ---------------------------------------------------------------------------
-- cron (pg_cron is not installable on this cluster, so schedule/unschedule are
-- recorded rather than executed; every migration only registers jobs)
-- ---------------------------------------------------------------------------
create table cron.job (
  jobid bigserial primary key,
  schedule text,
  command text,
  nodename text default 'localhost',
  nodeport int default 5432,
  database text default current_database(),
  username text default current_user,
  active boolean default true,
  jobname text unique
);

create table cron.job_run_details (
  jobid bigint,
  runid bigserial primary key,
  job_pid int,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language plpgsql
as $$
declare
  id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into id;
  return id;
end;
$$;

create or replace function cron.schedule(schedule text, command text)
returns bigint
language plpgsql
as $$
declare
  id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (gen_random_uuid()::text, schedule, command)
  returning jobid into id;
  return id;
end;
$$;

create or replace function cron.unschedule(job_name text)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = job_name;
  return true;
end;
$$;

grant usage on schema cron to postgres, service_role;

-- ---------------------------------------------------------------------------
-- public schema grants, as Supabase ships them
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
