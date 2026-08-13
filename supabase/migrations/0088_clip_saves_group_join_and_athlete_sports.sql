-- ATLITOS v2 - 0088_clip_saves_group_join_and_athlete_sports.sql
--
-- MERGED FILE. Three separate migrations were each authored as version 0088:
--   0088_clip_saves.sql
--   0088_join_group_member_before_full.sql
--   0088_set_athlete_sports.sql
-- Filenames differ so git never flagged the collision, and production was
-- unaffected because production's schema_migrations is timestamp versioned
-- (applied via the management API, not `supabase db push`), so it never used
-- these numbers at all. A CLEAN LOCAL START, however, is impossible with them:
-- supabase_migrations.schema_migrations has version as its primary key, so the
-- second 0088 fails with 23505 and the whole stack rolls back. That is why no
-- local stack, no db reset and no preview branch has ever worked on this repo.
--
-- Merged rather than renumbered because every integer from 0001 to 0113 is
-- already taken, and a letter suffix (0088a_) does NOT match the CLI's
-- digits-only version pattern, so such a file is SILENTLY SKIPPED rather than
-- rejected. The three bodies below appear in the exact order the runner applied
-- them (alphabetical), so behaviour is unchanged. They are independent: a saves
-- table, an ordering fix inside join_training_group, and an athlete sports RPC.


-- ===== begin 0088_clip_saves.sql =====

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


-- ===== begin 0088_join_group_member_before_full.sql =====

-- ATLITOS v2 — 0088_join_group_member_before_full.sql
-- BUG-015 (Phase 10): join_training_group checked capacity (GROUP_FULL)
-- BEFORE the already-a-member case. An existing live member of a FULL group
-- who re-triggered join was wrongly told GROUP_FULL, because the only
-- already-member signal was the group_memberships_one_live_per_player unique
-- index (0076) which is hit at INSERT time, AFTER the capacity guard raised.
--
-- Fix (additive, ordering only): add an explicit non-lapsed membership check
-- that runs BEFORE the capacity count, so a re-joining member always gets
-- ALREADY_MEMBER (a well-formed 409, mapped in _shared/app-error.ts) rather
-- than GROUP_FULL. A genuine new joiner of a full group is unaffected: they
-- have no live membership row, fall through the new guard, and still hit the
-- GROUP_FULL capacity check exactly as before.
--
-- Nothing else changes. This is a state-machine error-precedence fix, not a
-- money write: no fare, fee, ledger, capacity rule, or subscription logic is
-- touched (CLAUDE.md financial invariant untouched). The unique index is
-- kept as the structural backstop for the concurrent-duplicate race.

create or replace function public.join_training_group(
  p_actor_id uuid,
  p_group_id uuid
)
returns public.group_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.training_groups;
  v_membership public.group_memberships;
  v_live_count int;
  v_fee numeric(12, 2);
begin
  if p_actor_id is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_group from public.training_groups
  where id = p_group_id
  for update;

  if v_group.id is null then
    raise exception 'NOT_FOUND: training group % does not exist', p_group_id;
  end if;
  if not v_group.active then
    raise exception 'GROUP_INACTIVE: training group % is not accepting members', p_group_id;
  end if;
  if v_group.coach_id = p_actor_id then
    raise exception 'VALIDATION: a coach cannot join their own group';
  end if;
  if not exists (
    select 1 from public.coach_profiles cp
    where cp.user_id = v_group.coach_id and cp.status = 'verified'
  ) then
    raise exception 'NOT_FOUND: training group % is not open for joining', p_group_id;
  end if;
  if v_group.monthly_fee <= 0 then
    raise exception 'VALIDATION: this group has no monthly fee configured';
  end if;

  -- BUG-015: already-a-member takes precedence over capacity. A player who
  -- already holds a live (non-lapsed) membership in this group is told
  -- ALREADY_MEMBER regardless of whether the group is full. This mirrors the
  -- unique index predicate (status <> 'lapsed') so the guard and the index
  -- agree on what "live" means. Runs under the same group row lock taken
  -- above, so it is consistent with the capacity count below.
  if exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group_id
      and m.player_id = p_actor_id
      and m.status <> 'lapsed'
  ) then
    raise exception 'ALREADY_MEMBER: player % already has a live membership in group %', p_actor_id, p_group_id;
  end if;

  -- Fare snapshot: carve-out model, same fee key sessions use (PAYMENTS.md).
  select fc.value into v_fee
  from public.fee_config fc
  where fc.domain = 'sessions'
    and fc.key = 'platform_fee_flat'
    and fc.effective_from <= now()
  order by fc.effective_from desc
  limit 1;

  if v_fee is null or v_fee >= v_group.monthly_fee then
    raise exception 'VALIDATION: platform fee is not configured below the monthly fee';
  end if;

  -- Capacity, counted under the lock. 'pending' holds a seat while its
  -- checkout lives, exactly as a requested unpaid session holds its slot;
  -- membership_abandon_unpaid releases it on a failed checkout.
  select count(*) into v_live_count
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.status <> 'lapsed';

  if v_live_count >= v_group.capacity then
    raise exception 'GROUP_FULL: training group % is at capacity', p_group_id;
  end if;

  begin
    insert into public.group_memberships (
      group_id, player_id, status, price, platform_fee, total
    )
    values (
      p_group_id, p_actor_id, 'pending',
      v_group.monthly_fee, v_fee, v_group.monthly_fee
    )
    returning * into v_membership;
  exception
    when unique_violation then
      -- Structural backstop for the concurrent-duplicate race: two joins by
      -- the same player serialising on the group lock. Same error the
      -- explicit guard above raises.
      raise exception 'ALREADY_MEMBER: player % already has a live membership in group %', p_actor_id, p_group_id;
  end;

  return v_membership;
end;
$$;

revoke all on function public.join_training_group(uuid, uuid) from public;
revoke execute on function public.join_training_group(uuid, uuid) from anon, authenticated;
grant execute on function public.join_training_group(uuid, uuid) to service_role;


-- ===== begin 0088_set_athlete_sports.sql =====

-- ATLITOS v2 — 0088_set_athlete_sports.sql
-- Domain: identity/roles (API-MAPPING.md "profile"). Phase 11 sports/learn.
--
-- The drift fix. Two sport models exist:
--   * users.sports              — the array shown on the profile / MySportsCard.
--   * athlete_sports.is_primary — the model Learn (get_learn_home, 0060) and
--                                 coach search read from.
-- Onboarding (complete_player_setup, 0004) writes BOTH. Post-onboarding sport
-- edits, however, patched ONLY users.sports, so athlete_sports (and therefore
-- the Learn roadmap/drills/XP and the coach-search default) stayed frozen on
-- the original onboarding pick. This RPC gives edits the same dual-write
-- onboarding already has, in one owner-scoped, SECURITY DEFINER transaction, so
-- the two models never drift again.
--
-- Owner-scoped explicitly with auth.uid() on every write regardless of RLS (the
-- permissive-OR discipline, CLAUDE.md): a caller edits only their own sports.
-- Additive: creates one function, touches no existing object.

create or replace function public.set_athlete_sports(
  p_sports public.sport[],
  p_primary public.sport
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_sports is null or array_length(p_sports, 1) is null then
    raise exception 'VALIDATION: at least one sport is required';
  end if;

  if p_primary is null or p_primary <> all (p_sports) then
    raise exception 'VALIDATION: primary sport must be one of the selected sports';
  end if;

  -- users.sports mirror, kept in step with athlete_sports below.
  update public.users
  set sports = p_sports
  where id = auth.uid();

  -- Drop sports the caller no longer plays.
  delete from public.athlete_sports
  where user_id = auth.uid()
    and sport <> all (p_sports);

  -- Upsert the surviving/new sports, recomputing is_primary for every row so
  -- exactly the chosen primary carries the flag (mirrors complete_player_setup).
  insert into public.athlete_sports (user_id, sport, is_primary)
  select auth.uid(), s, s = p_primary
  from unnest(p_sports) as s
  on conflict (user_id, sport) do update set is_primary = excluded.is_primary;
end;
$$;

revoke all on function public.set_athlete_sports(public.sport[], public.sport) from public;
grant execute on function public.set_athlete_sports(public.sport[], public.sport) to authenticated;
