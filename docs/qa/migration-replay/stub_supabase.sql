-- Supabase platform stubs so the Atlitos migration history can replay against a
-- plain Postgres cluster. This file recreates only the roles, schemas, tables and
-- functions that Supabase provides out of the box and that the migrations depend
-- on. It is a test harness. It is never applied to any Supabase project.

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists realtime;
create schema if not exists graphql_public;
create schema if not exists cron;

-- Platform roles.
do $stub$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres login superuser;
  end if;
end
$stub$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema auth, storage, extensions, realtime, graphql_public, cron
  to anon, authenticated, service_role, supabase_auth_admin;

-- Extensions the platform installs into the extensions schema.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- auth schema.
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text,
  phone text,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- Request-context helpers. On the real platform these read the verified JWT out
-- of the request GUCs. The stub keeps the same signatures and return types.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $stub$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$stub$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $stub$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid;
$stub$;

create or replace function auth.role()
returns text
language sql
stable
as $stub$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user::text
  );
$stub$;

create or replace function auth.email()
returns text
language sql
stable
as $stub$
  select nullif(coalesce(
    current_setting('request.jwt.claim.email', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  ), '');
$stub$;

-- storage schema.
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[],
  version text
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $stub$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end
$stub$;

create or replace function storage.filename(name text)
returns text
language plpgsql
immutable
as $stub$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[array_length(parts, 1)];
end
$stub$;

create or replace function storage.extension(name text)
returns text
language plpgsql
immutable
as $stub$
declare
  parts text[];
begin
  parts := string_to_array(storage.filename(name), '.');
  return parts[array_length(parts, 1)];
end
$stub$;

-- realtime schema. Broadcast authorization is an RLS policy on realtime.messages,
-- and realtime.send() is what SECURITY DEFINER triggers call to publish.
create table if not exists realtime.messages (
  id bigserial,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, inserted_at)
) partition by range (inserted_at);

create table if not exists realtime.messages_default
  partition of realtime.messages default;

alter table realtime.messages enable row level security;

-- The platform ships an empty publication that tables opt into for postgres
-- changes replication.
do $stub$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$stub$;

create or replace function realtime.topic()
returns text
language sql
stable
as $stub$
  select nullif(current_setting('realtime.topic', true), '');
$stub$;

create or replace function realtime.send(
  payload jsonb,
  event text,
  topic text,
  private boolean default true
)
returns void
language plpgsql
as $stub$
begin
  insert into realtime.messages (topic, extension, payload, event, private)
  values (topic, 'broadcast', payload, event, private);
end
$stub$;

-- pg_cron is not available in a plain cluster, so cron.schedule and
-- cron.job_run_details are stubbed with the same shapes the migrations read.
create table if not exists cron.job (
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

create table if not exists cron.job_run_details (
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
as $stub$
declare
  v_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update
    set schedule = excluded.schedule, command = excluded.command
  returning jobid into v_id;
  return v_id;
end
$stub$;

create or replace function cron.schedule(schedule text, command text)
returns bigint
language sql
as $stub$
  select cron.schedule('job_' || md5(schedule || command), schedule, command);
$stub$;

create or replace function cron.unschedule(job_name text)
returns boolean
language plpgsql
as $stub$
begin
  delete from cron.job where jobname = job_name;
  return true;
end
$stub$;

create or replace function cron.unschedule(job_id bigint)
returns boolean
language plpgsql
as $stub$
begin
  delete from cron.job where jobid = job_id;
  return true;
end
$stub$;
