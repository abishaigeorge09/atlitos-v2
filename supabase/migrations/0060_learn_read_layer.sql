-- ATLITOS v2 — 0060_learn_read_layer.sql
-- Domain: learn. Epic AT-9, story AT-132 (Track A).
-- Requirements: PRD-01 FR-48, FR-50, FR-51.
--
-- The Learn read layer. get_learn_home() returns everything the Learn home,
-- Roadmap, and Milestones screens (Track C) render for the CALLER:
--   * xp_total          — DERIVED: sum(xp_events.xp_amount), computed at read
--                         time. There is NO denormalized counter column anywhere
--                         (0057, SCHEMA.md); the total is un-forgeable because
--                         xp_events is not client-writable (0058).
--   * sport             — the player's primary sport (athlete_sports.is_primary,
--                         PHASE-7-STATUS.md assumption 3). null => Learn-home
--                         empty state (FR-48), never a zero-filled roadmap.
--   * current_stage     — a PURE FUNCTION of xp_total: the top stage_order for
--                         that sport whose xp_threshold <= xp_total (FR-50). No
--                         hardcoded stage, no client write.
--   * next_stage        — the following stage (for the progress-to-next readout).
--   * stages            — the full ladder for the sport, ascending.
--   * milestones        — every milestone with an earned flag from the caller's
--                         user_milestones (earned vs locked, FR-51), each with
--                         its lucide icon_name.
--
-- SECURITY DEFINER, strictly self-scoped to auth.uid() (the get_my_impact_summary
-- house pattern): it returns ONLY the caller's own XP/roadmap/milestones, never
-- another user's rows. Owner-scoped explicitly with `user_id = v_uid` on every
-- per-user read regardless of RLS (the permissive-OR discipline, CLAUDE.md).

create function public.get_learn_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sport public.sport;
  v_xp_total int;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  -- Primary sport (assumption 3): prefer the is_primary row, else the earliest
  -- selected sport, else null (=> Learn-home empty state, never a zero roadmap).
  select s.sport into v_sport
  from public.athlete_sports s
  where s.user_id = v_uid
  order by s.is_primary desc, s.created_at asc
  limit 1;

  -- XP total: DERIVED sum over the caller's own append-only log. No counter.
  select coalesce(sum(xp_amount), 0) into v_xp_total
  from public.xp_events
  where user_id = v_uid;

  select jsonb_build_object(
    'sport', v_sport,
    'xp_total', v_xp_total,
    -- Current stage: the top stage_order for the sport whose threshold is met.
    'current_stage', (
      select case when rs.id is null then null else jsonb_build_object(
        'id', rs.id, 'stage_order', rs.stage_order, 'name', rs.name, 'xp_threshold', rs.xp_threshold
      ) end
      from (select 1) one
      left join public.roadmap_stages rs
        on rs.sport = v_sport and rs.xp_threshold <= v_xp_total
      where rs.stage_order = (
        select max(r2.stage_order) from public.roadmap_stages r2
        where r2.sport = v_sport and r2.xp_threshold <= v_xp_total
      )
    ),
    -- Next stage: the lowest stage above the current XP total (null at the top).
    'next_stage', (
      select jsonb_build_object(
        'id', rs.id, 'stage_order', rs.stage_order, 'name', rs.name, 'xp_threshold', rs.xp_threshold
      )
      from public.roadmap_stages rs
      where rs.sport = v_sport and rs.xp_threshold > v_xp_total
      order by rs.xp_threshold asc
      limit 1
    ),
    -- The full ladder for the sport, ascending (Roadmap screen).
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rs.id, 'stage_order', rs.stage_order, 'name', rs.name, 'xp_threshold', rs.xp_threshold
      ) order by rs.stage_order)
      from public.roadmap_stages rs
      where rs.sport = v_sport
    ), '[]'::jsonb),
    -- Every milestone, earned vs locked from the caller's own user_milestones.
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'key', m.key,
        'name', m.name,
        'description', m.description,
        'icon_name', m.icon_name,
        'criteria', m.criteria,
        'earned', (um.id is not null),
        'earned_at', um.earned_at
      ) order by m.criteria->>'value', m.key)
      from public.milestones m
      left join public.user_milestones um
        on um.milestone_id = m.id and um.user_id = v_uid
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_learn_home() from public;
revoke execute on function public.get_learn_home() from anon;
grant execute on function public.get_learn_home() to authenticated, service_role;

comment on function public.get_learn_home() is
  'Learn read layer (AT-132). Returns the caller''s derived XP total (sum(xp_events.xp_amount), no counter column), primary-sport roadmap with current/next stage as a pure function of the total, the full stage ladder, and every milestone flagged earned vs locked. SECURITY DEFINER, strictly self-scoped to auth.uid().';
