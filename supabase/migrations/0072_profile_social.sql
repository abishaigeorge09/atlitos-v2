-- ATLITOS v2 — 0072_profile_social.sql
-- Domain: identity/social profile (Track C, Instagram-style profile).
-- Requirements: PRD-01 3.4 (profile surface), FR-46/FR-47 adjacents.
--
-- Adds the three public-profile columns the unified profile screen needs
-- (bio, cover_url, handle), backfills a unique handle for every existing
-- user, and re-exposes the new columns through the `public_profiles` view
-- (the sole cross-user read surface for `users`, see 0001 and RLS.md).
--
-- HANDLE SHAPE: `handle` is plain `text` (citext is NOT enabled on this
-- project; 0001 creates no extensions and `select * from pg_extension`
-- carries only the platform defaults), so case-insensitive uniqueness is a
-- unique index on lower(handle) rather than a citext column or a
-- column-level UNIQUE. The check constraint keeps the stored form lowercase
-- slug-only, so lower(handle) = handle for every accepted write; the index
-- still normalises defensively.
--
-- NO RLS/POLICY CHANGE NEEDED: `users_update_own` (0001, initplan-wrapped in
-- 0062) is a whole-row own-row UPDATE policy (USING/WITH CHECK id =
-- auth.uid(), no column list), so the owner can already write bio/cover_url/
-- handle on their own row. The only column locks on `users` are the 0065
-- `users_lock_admin_fields` trigger (status, suspended_reason), which these
-- columns do not touch. Cross-user reads keep going through
-- `public_profiles`, never the base table (CLAUDE.md scoping rule).

-- ============================================================================
-- Columns
-- ============================================================================

alter table public.users
  add column bio text
    constraint users_bio_length check (bio is null or char_length(bio) <= 160),
  add column cover_url text,
  add column handle text
    constraint users_handle_shape check (handle is null or handle ~ '^[a-z0-9_]{1,30}$');

comment on column public.users.bio is
  'Public profile bio, max 160 chars, owner-written, exposed via public_profiles.';
comment on column public.users.cover_url is
  'Public profile cover image URL (avatars bucket, cover/ prefix), owner-written.';
comment on column public.users.handle is
  'Public @handle, lowercase slug, unique case-insensitively via idx_users_handle_lower.';

-- ============================================================================
-- Backfill: slugified name (lowercase, non-alphanumeric stripped, capped at
-- 24 chars, ''athlete'' when the name slugs to nothing) with a short numeric
-- suffix on collision. Loop with an existence probe rather than a windowed
-- single pass, because a windowed suffix can itself collide with another
-- user''s bare slug (name "john2" beside two "john"s); the probe cannot.
-- Deterministic order (created_at, id) so the earliest account wins the bare
-- slug.
-- ============================================================================

do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in
    select id, name from public.users where handle is null order by created_at, id
  loop
    base := left(
      coalesce(nullif(regexp_replace(lower(r.name), '[^a-z0-9]', '', 'g'), ''), 'athlete'),
      24
    );
    candidate := base;
    n := 1;
    while exists (
      select 1 from public.users u
      where lower(u.handle) = lower(candidate) and u.id <> r.id
    ) loop
      candidate := base || n::text;
      n := n + 1;
    end loop;
    update public.users set handle = candidate where id = r.id;
  end loop;
end $$;

-- Case-insensitive uniqueness. Created after the backfill so the index build
-- itself proves the backfill produced no duplicates.
create unique index idx_users_handle_lower on public.users (lower(handle));

-- ============================================================================
-- public_profiles: append the three new public columns. This stays the ONLY
-- cross-user read surface for users (base-table RLS remains own-row/admin).
-- `create or replace view` appends columns at the end and preserves the
-- existing grants (anon, authenticated) and the deliberate definer-view
-- posture (security_invoker = false, dispositioned in RLS.md advisor notes);
-- the with clause restates it so the property is explicit, not inherited.
-- bio/cover_url/handle are public-profile data by design, same tier as
-- name/avatar_url/channel_name.
-- ============================================================================

create or replace view public.public_profiles
with (security_invoker = false) as
select id, name, avatar_url, channel_name, handle, bio, cover_url
from public.users;
