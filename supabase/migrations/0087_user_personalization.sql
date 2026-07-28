-- ATLITOS v2 — 0087_user_personalization.sql
-- Phase 9 WS-personalization. Additive settings/personalization columns on
-- public.users so the new Settings surface (mobile tab + Profile + Trainings
-- entries) can persist appearance and notification preferences to the
-- caller's own profile row. Preferred sports and city/state already exist on
-- users (0001); this migration only adds the two that do not.
--
-- No new RLS: users_update_own (0001) already scopes every write to
-- id = auth.uid(), and Postgres UPDATE policies are row level, so the owner
-- can write these new columns with no policy change. No client money write,
-- no service role, no bypass. Fully reversible (drop column) and idempotent
-- (add column if not exists).

alter table public.users
  add column if not exists theme text not null default 'system'
    check (theme in ('system', 'light', 'dark')),
  add column if not exists notification_prefs jsonb not null
    default '{"sessions": true, "messages": true, "promotions": false}'::jsonb;

comment on column public.users.theme is
  'User appearance preference for the mobile app: system | light | dark. Applied client side via nativewind colorScheme.';
comment on column public.users.notification_prefs is
  'Per category notification opt ins: { sessions, messages, promotions }. Read/written only by the owner through the Settings surface.';
