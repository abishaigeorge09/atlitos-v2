-- ATLITOS v2 — 0101_clip_comments_enabled.sql
-- Domain: clutch. Founder decision 2026-08-13 (docs/qa/CURRENT-STATE.md):
-- "Clip controls: delete your own clip, plus comments off per clip. NOT a full
-- audience model."
--
-- Comments off per clip. Three locks, in the order they are checked:
--   1. RLS. clip_comments_insert_own is re declared below to require the
--      target clip's comments_enabled, so a direct PostgREST insert against a
--      closed thread is refused even though the caller is signed in and the
--      clip is published.
--   2. The owner is the only party who can flip the flag, through
--      set_clip_comments_enabled. 0042 revokes update on clips from
--      authenticated, so there is no direct write path to the column.
--   3. The UI hides the composer (apps/mobile/src/app/(tabs)/clutch/post/[id]),
--      so a closed thread reads as closed instead of failing on submit.
--
-- EXISTING COMMENTS SURVIVE. Turning comments off closes the thread to NEW
-- comments; it does not delete what is already there, and it does not change
-- clips.comment_count. Reading is untouched, so a viewer still sees the
-- conversation that happened before the creator closed it. Deleting the
-- history is a different action from stopping the conversation, and conflating
-- them would destroy other people's words on a single toggle.
--
-- Requirements: PRD-01 FR-43, FR-45.

alter table public.clips
  add column if not exists comments_enabled boolean not null default true;

comment on column public.clips.comments_enabled is
  'Per clip comments switch, owner controlled through set_clip_comments_enabled. False refuses NEW comments (clip_comments_insert_own) and hides the composer; existing comments and comment_count are untouched.';

-- ============================================================================
-- RLS. Re declare clip_comments_insert_own (0042_clutch_rls.sql:120) with the
-- comments_enabled predicate added. Drop and create rather than editing 0042,
-- which is an applied migration.
--
-- The rest of the predicate is carried over UNCHANGED from the version that is
-- LIVE and must stay that way: own row author, not a guest (FR-43 comments are
-- a member action), and the clip published. The AT-63 lesson still applies to
-- the EXISTS subquery, which is itself subject to the clips policies:
-- clips_select_published makes a published clip readable by anon and
-- authenticated alike, so this predicate evaluates rather than silently
-- returning false.
--
-- NOTE THE `(select auth.uid())` WRAP, and do not "simplify" it back to a bare
-- auth.uid(). 0042 wrote it bare; 0090_rls_initplan_subselect_wrap.sql later
-- rewrapped every policy in the schema so Postgres hoists the call to an
-- InitPlan and evaluates it ONCE per statement instead of once per row. That
-- rewritten version is what is live in production today, confirmed by reading
-- pg_policy against project syzzfgaudpifwvbpycyi. Restating the 0042 text here
-- would have silently reverted the optimisation on this table.
--
-- This migration also deliberately leaves the sibling policies alone.
-- Production additionally carries clip_comments_active_insert and
-- clip_comments_active_delete (is_actor_active(), the suspend enforcement) and
-- a merged select policy; none of them are touched, so the suspension gate
-- keeps applying alongside this one.
-- ============================================================================

drop policy if exists clip_comments_insert_own on public.clip_comments;

create policy clip_comments_insert_own on public.clip_comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not public.is_guest()
    and exists (
      select 1 from public.clips c
      where c.id = clip_comments.clip_id
        and c.status = 'published'
        and c.comments_enabled
    )
  );

-- ============================================================================
-- set_clip_comments_enabled. Owner scoped, SECURITY DEFINER, the only write
-- path to the column, because 0042 leaves authenticated with no update grant
-- on clips at all and this migration does not restore one.
-- ============================================================================

create function public.set_clip_comments_enabled(
  p_clip_id uuid,
  p_enabled boolean
)
returns public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
begin
  if p_clip_id is null or p_enabled is null then
    raise exception 'VALIDATION: a clip id and a value are both required';
  end if;

  select * into v_clip from public.clips where id = p_clip_id for update;

  if v_clip.id is null then
    raise exception 'NOT_FOUND: clip % does not exist', p_clip_id;
  end if;

  -- Explicit ownership check. This function is SECURITY DEFINER so RLS is not
  -- evaluated for it, and clips carries a public published policy alongside
  -- the owner one; without this line any signed in user could close comments
  -- on anyone's clip in the feed.
  if v_clip.owner_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the owner can change comments on this clip';
  end if;

  if v_clip.status = 'removed' then
    raise exception 'INVALID_TRANSITION: clip % is removed', p_clip_id;
  end if;

  update public.clips
  set comments_enabled = p_enabled
  where id = p_clip_id
  returning * into v_clip;

  return v_clip;
end;
$$;

revoke all on function public.set_clip_comments_enabled(uuid, boolean) from public;
revoke execute on function public.set_clip_comments_enabled(uuid, boolean) from anon;
grant execute on function public.set_clip_comments_enabled(uuid, boolean) to authenticated, service_role;

comment on function public.set_clip_comments_enabled(uuid, boolean) is
  'Owner scoped toggle for clips.comments_enabled. The only write path to the column: clients hold no update grant on clips.';
