-- ATLITOS v2 — 0081_group_rls_recursion_fix.sql
-- Domain: coaching groups RLS. Fixes two defects the Track A probes caught
-- against the LIVE database (scripts/verify-groups-probes.mjs), both rooted
-- in the same Postgres fact: a subquery inside a policy is itself subject to
-- the referenced table's RLS, evaluated as the calling user.
--
--   1. INFINITE RECURSION (42P17). 0076's training_groups_select_member
--      subqueried group_memberships, whose group_memberships_select_coach
--      subqueried training_groups: a cycle, which Postgres refuses at query
--      time, so EVERY read of either table by an authenticated non-owner
--      failed 500. The same cycle existed latently between sessions
--      (sessions_select_group_participant -> session_participants) and
--      session_participants (*_select_coach -> sessions).
--
--   2. ANON DISCOVERY SILENTLY EMPTY. training_groups_select_public checked
--      the owning coach is verified by subquerying coach_profiles, which has
--      no anon SELECT policy on the base table (RLS.md: public discovery
--      reads the coach_profiles_public VIEW). Under anon the exists() was
--      false for every row, so public browse of active groups returned zero
--      rows instead of the founder-wanted discovery surface.
--
-- Fix, same shape 0022 used with session_links_pair: tiny SECURITY DEFINER
-- boolean predicates, which run as owner and therefore neither recurse nor
-- inherit the caller's RLS view of the referenced table. Each returns a
-- plain boolean and exposes nothing else.

-- is_verified_coach(uuid) ALREADY EXISTS (0030_verified_coach_discovery_rls
-- defined the identical definer predicate as is_verified_coach(_coach_id)).
-- Reused as is; only the anon grant is (re)asserted below.

create or replace function public.is_group_member_live(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group_id
      and m.player_id = p_user_id
      and m.status <> 'lapsed'
  );
$$;

create or replace function public.is_group_coach(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.training_groups g
    where g.id = p_group_id and g.coach_id = p_user_id
  );
$$;

create or replace function public.is_session_coach(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.coach_id = p_user_id
  );
$$;

create or replace function public.is_session_participant(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_participants sp
    where sp.session_id = p_session_id and sp.player_id = p_user_id
  );
$$;

revoke all on function public.is_group_member_live(uuid, uuid) from public;
revoke all on function public.is_group_coach(uuid, uuid) from public;
revoke all on function public.is_session_coach(uuid, uuid) from public;
revoke all on function public.is_session_participant(uuid, uuid) from public;
-- is_verified_coach backs an anon-visible policy, so anon keeps execute.
grant execute on function public.is_verified_coach(uuid) to anon, authenticated;
grant execute on function public.is_group_member_live(uuid, uuid) to authenticated;
grant execute on function public.is_group_coach(uuid, uuid) to authenticated;
grant execute on function public.is_session_coach(uuid, uuid) to authenticated;
grant execute on function public.is_session_participant(uuid, uuid) to authenticated;

-- Recreate the five policies on the predicates. Semantics unchanged from
-- 0076's intent; only the evaluation mechanics move.

drop policy training_groups_select_public on public.training_groups;
create policy training_groups_select_public on public.training_groups
  for select to anon, authenticated
  using (active = true and public.is_verified_coach(coach_id));

drop policy training_groups_select_member on public.training_groups;
create policy training_groups_select_member on public.training_groups
  for select to authenticated
  using (public.is_group_member_live(id, auth.uid()));

drop policy group_memberships_select_coach on public.group_memberships;
create policy group_memberships_select_coach on public.group_memberships
  for select to authenticated
  using (public.is_group_coach(group_id, auth.uid()));

drop policy session_participants_select_coach on public.session_participants;
create policy session_participants_select_coach on public.session_participants
  for select to authenticated
  using (public.is_session_coach(session_id, auth.uid()));

drop policy sessions_select_group_participant on public.sessions;
create policy sessions_select_group_participant on public.sessions
  for select to authenticated
  using (public.is_session_participant(id, auth.uid()));
