-- ATLITOS v2 — 0041_clutch_schema.sql
-- Domain: clutch. Epic AT-7 (Clutch Video), story AT-89.
-- Requirements: PRD-01 FR-42, FR-44, FR-45, FR-46, FR-47.
--
-- The foundation every other P5 track builds on: the clip lifecycle tables,
-- the engagement tables (likes, comments, follows), the reports table
-- (moderation/audit domain, deferred out of 0003 explicitly for this
-- migration), the count triggers that keep likes_count/comment_count
-- authoritative, and the creator_stats aggregate the profile screen reads.
--
-- STORAGE ADAPTER SHAPE, honouring VIDEO.md's DECISION UPDATE (2026-07-13) and
-- PHASE-5-STATUS.md. Cloudflare Stream is DEFERRED; v1 Clutch ships on a
-- private Supabase Storage bucket behind the SAME two edge function contracts.
-- The clips table keeps Stream shaped column names so the future swap is config
-- plus one adapter, not a migration:
--
--   * cf_stream_uid  nullable, the future Cloudflare video id slot, NULL in v1.
--                    (SCHEMA.md and PHASE-5-STATUS.md line 16 both name it
--                    cf_stream_uid; VIDEO.md's prose paraphrase "cloudflare_uid"
--                    is the same slot. cf_stream_uid is the canonical name.)
--   * storage_path   the object KEY in the private `clips` bucket. This is
--                    VIDEO.md's "playback_id = storage path for now".
--   * playback_id    the Stream shaped alias, = storage_path in v1.
--   * thumb_path     the thumbnail object KEY.
--
-- PATHS ONLY, NEVER A RESOLVED URL. PHASE-5-STATUS.md trap 1: a stored public
-- or long lived signed URL silently defeats takedown, because a removed clip
-- stays fetchable at the stored URL. So there is deliberately NO video_url or
-- thumb_url column (SCHEMA.md's earlier draft named them; this migration and
-- the SCHEMA.md update replace them with PATH columns). Every view of a clip is
-- a freshly minted, short lived signed URL produced by an edge function against
-- the LIVE clip row (Track B, AT-96); nothing here persists a resolved URL.

-- ============================================================================
-- Enums
-- ============================================================================

-- The clip lifecycle. The machine itself lives in 0043_clutch_state_machine.sql
-- (clip_transition_internal), enforced by RPC exactly like orders/sessions.
--   uploading  -> processing | rejected
--   processing -> ready | rejected
--   ready      -> published | rejected
--   published  -> removed        (moderation takedown only)
--   rejected   -> (terminal)
--   removed    -> (terminal)
-- uploading -> rejected is the abandoned upload / reconcile-absent-object edge
-- required by AT-93 (a clip stranded in uploading with no storage object is
-- rejected). See 0043 and 0045.
create type public.clip_status as enum (
  'uploading', 'processing', 'ready', 'published', 'rejected', 'removed'
);

-- Reports lifecycle (SCHEMA.md moderation/audit `reports`). A report is resolved
-- by takedown (actioned) or dismissal (dismissed); pending until a moderator
-- acts (0043 resolve_report).
create type public.report_status as enum ('pending', 'actioned', 'dismissed');

-- ============================================================================
-- clips
-- ============================================================================

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  -- Future Cloudflare Stream swap slot, NULL in v1 (see header).
  cf_stream_uid text,
  -- Object KEY in the private `clips` bucket. Never a resolved URL.
  storage_path text,
  -- Stream shaped alias, = storage_path in v1.
  playback_id text,
  -- Thumbnail object KEY. Never a resolved URL.
  thumb_path text,
  caption text not null,
  sport public.sport not null,
  status public.clip_status not null default 'uploading',
  rejection_reason text,
  -- Maintained by trigger from clip_likes / clip_comments, never client written.
  likes_count int not null default 0,
  comment_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Feed query is `status = 'published' order by created_at desc`; the composite
-- index serves it directly. The owner index serves the profile query.
create index idx_clips_status_created_at on public.clips (status, created_at desc);
create index idx_clips_owner_id on public.clips (owner_id);

create trigger clips_set_updated_at
  before update on public.clips
  for each row execute function public.set_updated_at();

comment on column public.clips.cf_stream_uid is
  'Future Cloudflare Stream video id. NULL in v1 (Supabase Storage adapter). The provider swap sets this and reads playback through it; see VIDEO.md.';
comment on column public.clips.storage_path is
  'Object KEY in the private `clips` bucket. A PATH, never a resolved URL: every view is a freshly minted signed URL (AT-96). Storing a URL would defeat takedown (PHASE-5-STATUS.md trap 1).';
comment on column public.clips.playback_id is
  'Stream shaped alias, = storage_path in v1 (VIDEO.md "playback_id = storage path for now").';

-- ============================================================================
-- clip_likes
-- ============================================================================

create table public.clip_likes (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clip_id, user_id)
);

create index idx_clip_likes_user_id on public.clip_likes (user_id);

-- ============================================================================
-- clip_comments
-- ============================================================================

create table public.clip_comments (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  text text not null check (btrim(text) <> ''),
  created_at timestamptz not null default now()
);

create index idx_clip_comments_clip_id on public.clip_comments (clip_id, created_at);

-- ============================================================================
-- follows
-- ============================================================================

create table public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.users (id) on delete cascade,
  followee_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (follower_id <> followee_id),
  unique (follower_id, followee_id)
);

create index idx_follows_followee_id on public.follows (followee_id);
create index idx_follows_follower_id on public.follows (follower_id);

-- ============================================================================
-- reports (SCHEMA.md moderation/audit domain, deferred here from 0003 because
-- it is scoped to clip/comment moderation).
-- ============================================================================

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('clip', 'comment')),
  entity_id uuid not null,
  reporter_id uuid not null references public.users (id) on delete cascade,
  reason text not null check (btrim(reason) <> ''),
  status public.report_status not null default 'pending',
  resolved_by uuid references public.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_reports_status on public.reports (status);

-- ============================================================================
-- Count triggers. The counts on clips are the authoritative display figure and
-- are never client written (RLS.md clutch table). Both toggle RPCs (0044) and
-- any direct insert/delete funnel through these, so the count cannot drift from
-- the membership tables. greatest(...,0) guards against an underflow that a
-- double delete could otherwise produce.
-- ============================================================================

create function public.clip_likes_maintain_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.clips set likes_count = likes_count + 1 where id = new.clip_id;
    return new;
  else
    update public.clips set likes_count = greatest(likes_count - 1, 0) where id = old.clip_id;
    return old;
  end if;
end;
$$;

create trigger clip_likes_count_insert
  after insert on public.clip_likes
  for each row execute function public.clip_likes_maintain_count();

create trigger clip_likes_count_delete
  after delete on public.clip_likes
  for each row execute function public.clip_likes_maintain_count();

create function public.clip_comments_maintain_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.clips set comment_count = comment_count + 1 where id = new.clip_id;
    return new;
  else
    update public.clips set comment_count = greatest(comment_count - 1, 0) where id = old.clip_id;
    return old;
  end if;
end;
$$;

create trigger clip_comments_count_insert
  after insert on public.clip_comments
  for each row execute function public.clip_comments_maintain_count();

create trigger clip_comments_count_delete
  after delete on public.clip_comments
  for each row execute function public.clip_comments_maintain_count();

-- These are TRIGGER functions, not RPCs. A trigger fires as the table owner
-- regardless of execute grants, so withdraw execute from every client role so
-- neither is reachable over /rest/v1/rpc (the 0037 precedent for
-- block_delete_address_in_use, and what the RLS advisor's
-- *_security_definer_function_executable check wants).
revoke all on function public.clip_likes_maintain_count() from public, anon, authenticated;
revoke all on function public.clip_comments_maintain_count() from public, anon, authenticated;

-- ============================================================================
-- creator_stats. The display only aggregate the creator profile reads (FR-47):
-- published clip count, follower/following counts, total likes across published
-- clips. security_invoker = on so the view runs under the caller's RLS rather
-- than the definer's, which is both the advisor-clean choice and correct here:
-- `published` clips and `follows` are public read (0042), so the aggregate is
-- deterministic and identical for every viewer, and no private (non published)
-- clip ever contributes to a count. Tapping a count to browse the list is NOT
-- built in v1 (PHASE-5-STATUS.md open question 7); these are numbers only.
-- ============================================================================

create view public.creator_stats
with (security_invoker = on)
as
select
  u.id as user_id,
  (
    select count(*) from public.clips c
    where c.owner_id = u.id and c.status = 'published'
  )::int as published_clips_count,
  (
    select count(*) from public.follows f
    where f.followee_id = u.id
  )::int as followers_count,
  (
    select count(*) from public.follows f
    where f.follower_id = u.id
  )::int as following_count,
  coalesce((
    select sum(c.likes_count) from public.clips c
    where c.owner_id = u.id and c.status = 'published'
  ), 0)::bigint as total_likes
from public.users u;

grant select on public.creator_stats to anon, authenticated;

comment on view public.creator_stats is
  'Display only per creator aggregate for the Clutch profile (FR-47): published clip count, follower/following counts, total likes across published clips. security_invoker so counts obey caller RLS; only published clips and public follows contribute, so no private clip leaks and the numbers are identical for every viewer.';
