-- ATLITOS v2 — 0002_notifications.sql
-- Domain: notifications (SCHEMA.md "Domain: notifications").
--
-- Tables: public.notifications, public.push_tokens, public.notification_prefs.
--
-- Naming decision: the task brief names the token table "push_tokens";
-- SCHEMA.md's draft calls it "device_tokens". This migration ships
-- push_tokens as the literal table (same shape as device_tokens) and
-- SCHEMA.md is updated in the same change to rename it.
--
-- Schema decision: public.notification_prefs is new relative to SCHEMA.md,
-- giving per notification_type push/email opt-out instead of an all-or-
-- nothing device token. Added to SCHEMA.md in the same change.

-- ============================================================================
-- Enum
-- ============================================================================

create type public.notification_type as enum (
  'booking',
  'order',
  'chat',
  'clip_moderation',
  'donation',
  'verification',
  'transfer',
  'support'
);

-- ============================================================================
-- Tables
-- ============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text not null,
  deep_link text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user_id_read_at on public.notifications (user_id, read_at);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

create index idx_push_tokens_user_id on public.push_tokens (user_id);

create table public.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  notification_type public.notification_type not null,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, notification_type)
);

create index idx_notification_prefs_user_id on public.notification_prefs (user_id);

create trigger notification_prefs_set_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();

-- ============================================================================
-- notifications: lock every column except read_at on update, since
-- notifications are otherwise written only by service-role dispatch code
-- (RLS.md: "no authenticated INSERT ... UPDATE limited to read_at").
-- ============================================================================

create function public.lock_notification_fields()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.type is distinct from old.type
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.deep_link is distinct from old.deep_link
    or new.created_at is distinct from old.created_at
  then
    raise exception 'NOTIFICATION_LOCKED: only read_at is client-writable';
  end if;
  return new;
end;
$$;

create trigger notifications_lock_fields
  before update on public.notifications
  for each row execute function public.lock_notification_fields();

-- ============================================================================
-- RLS (owner only across all three tables)
-- ============================================================================

alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notification_prefs enable row level security;

-- notifications: own rows readable; own rows updatable (read_at only, via
-- the trigger above); no INSERT/DELETE grant, dispatch runs as service_role.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- push_tokens: full owner CRUD.
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid());

create policy push_tokens_insert_own on public.push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

create policy push_tokens_update_own on public.push_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- notification_prefs: full owner CRUD.
create policy notification_prefs_select_own on public.notification_prefs
  for select to authenticated
  using (user_id = auth.uid());

create policy notification_prefs_insert_own on public.notification_prefs
  for insert to authenticated
  with check (user_id = auth.uid());

create policy notification_prefs_update_own on public.notification_prefs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_prefs_delete_own on public.notification_prefs
  for delete to authenticated
  using (user_id = auth.uid());
