-- 0092_user_blocks.sql
--
-- App Store guideline 1.2 (user generated content) requires three controls on
-- any surface where members see content other members create: filtering, a way
-- to REPORT objectionable content, and a way to BLOCK the member producing it.
--
-- Two of the three already existed. `public.reports` (0041) plus the admin
-- queue in apps/admin covers reporting end to end EXCEPT that no client ever
-- inserted a row, and `clips.status` plus the moderation flow covers filtering.
-- Blocking did not exist at all: no table, no policy, no surface.
--
-- WHY A RESTRICTIVE POLICY AND NOT A CLIENT FILTER. CLAUDE.md's standing rule
-- is that RLS is a floor and every read carries its own scoping filter, which
-- is right for OWNERSHIP. A block is the opposite shape: it is a subtraction
-- that must hold on every read of the table, including reads written later by
-- someone who has never heard of blocking. A RESTRICTIVE policy is ANDed with
-- every permissive policy, so it cannot be forgotten at a call site the way an
-- `.eq()` can. The client filter is still added on the feed query as defence in
-- depth, per the same rule; this is the layer that makes forgetting it safe.
--
-- Blocking is deliberately ONE directional and invisible to the blocked member:
-- the blocker stops seeing the blocked member's clips and comments. It does not
-- tell the blocked member, and it does not remove the blocker's own content
-- from the blocked member's feed. That matches the platform norm and avoids
-- turning "block" into a signal an abuser can act on.

create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (blocker_id <> blocked_id),
  unique (blocker_id, blocked_id)
);

-- The unique constraint already indexes (blocker_id, blocked_id), which is the
-- lookup the restrictive policies below drive. This second index serves the
-- reverse direction only, used by the admin queue when reviewing a reported
-- member ("how many people blocked this account").
create index idx_user_blocks_blocked_id on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- Own rows only, in every direction. A member may not read who blocked THEM,
-- which is the point of the feature.
create policy user_blocks_select_own on public.user_blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy user_blocks_insert_own on public.user_blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()));

create policy user_blocks_delete_own on public.user_blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- No update: a block is created or removed, never edited.
revoke update on public.user_blocks from anon, authenticated;
revoke all on public.user_blocks from anon;
grant select, insert, delete on public.user_blocks to authenticated;

-- ============================================================================
-- The subtraction. RESTRICTIVE, so it ANDs with clips_select_published /
-- clips_select_own / clips_select_admin rather than widening anything.
--
-- `to authenticated` only: anon has no auth.uid() and therefore no blocks, and
-- adding a restrictive policy for anon would evaluate a subquery per row for
-- every signed out feed read to always return true.
--
-- auth.uid() is wrapped in a scalar subselect for the same reason 0062 wrapped
-- every other policy: the planner evaluates it once per query, not once per row.
-- ============================================================================

create policy clips_hide_blocked on public.clips
  as restrictive
  for select to authenticated
  using (
    not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = (select auth.uid())
        and b.blocked_id = clips.owner_id
    )
  );

create policy clip_comments_hide_blocked on public.clip_comments
  as restrictive
  for select to authenticated
  using (
    not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = (select auth.uid())
        and b.blocked_id = clip_comments.user_id
    )
  );
