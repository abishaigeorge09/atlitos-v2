-- ATLITOS v2 — 0088_clip_saves.sql
-- Domain: clutch. Phase 11 (Clutch viewer + profile). PRD-01 FR-45.
--
-- Real saved clips (bookmarks): the private, personal collection a viewer keeps
-- from the Clutch feed/viewer rail, surfaced back on their own profile's Saved
-- grid. Additive only: it adds one membership table and its policies, and
-- touches nothing 0041/0042 already shipped.
--
-- SCOPING. clip_saves is a PRIVATE, owner-only table, unlike clip_likes/follows
-- (which are public-read for their counts). There is no count on clips to keep,
-- so no trigger and no RPC-only write path is needed: direct owner-scoped DML is
-- the write path, gated by RLS AND grant. Every policy is `user_id = auth.uid()`,
-- so a caller can only ever see and manage their OWN saves. Even so, the app's
-- listSavedClips read carries its own explicit `user_id` filter (CLAUDE.md: RLS
-- is a ceiling, not a scoping mechanism), and the joined clips read is filtered
-- to `status = 'published'` so a save on a since-removed clip never resurfaces.

create table public.clip_saves (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clip_id, user_id)
);

-- The Saved grid reads `where user_id = <me> order by created_at desc`; the
-- index serves it directly.
create index idx_clip_saves_user_created_at on public.clip_saves (user_id, created_at desc);

alter table public.clip_saves enable row level security;

-- ============================================================================
-- Owner-only policies. A viewer sees, adds, and removes ONLY their own saves.
-- No public read (a save is private, unlike a like). Guests cannot save
-- (`not public.is_guest()`, matching clip_comments_insert_own). No UPDATE:
-- a save is a membership row, toggled by insert/delete, never mutated.
-- ============================================================================

create policy clip_saves_select_own on public.clip_saves
  for select to authenticated
  using (user_id = auth.uid());

create policy clip_saves_insert_own on public.clip_saves
  for insert to authenticated
  with check (user_id = auth.uid() and not public.is_guest());

create policy clip_saves_delete_own on public.clip_saves
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- GRANTS. The second lock (0010/0032/0042 house pattern). Owner DML for
-- authenticated; never updatable; anon has no save surface at all.
-- ============================================================================

revoke update on public.clip_saves from authenticated;
revoke all on public.clip_saves from anon;

comment on table public.clip_saves is
  'Private per-user saved (bookmarked) clips for the Clutch profile Saved grid (PRD-01 FR-45). Owner-only RLS: a caller sees and manages only their own saves. No public read, no count trigger, no RPC; owner-scoped direct DML is the write path.';
