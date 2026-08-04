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
