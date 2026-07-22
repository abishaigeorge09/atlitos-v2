-- ATLITOS v2 — 0061_admin_drill_rpcs.sql
-- Domain: learn (extends 0057/0058). Epic AT-9 (Learn and XP) + AT-10 (Admin
-- Back Office), story AT-133 (Track B). Requirements: PRD-04 FR-49, FR-50, FR-51.
-- Consumed by apps/admin's Drill catalog resource.
--
-- ============================================================================
-- WHY THESE ARE RPCs AND NOT DIRECT CLIENT WRITES
--
-- 0058_learn_rls.sql already gives an admin full DML on `drills`
-- (`drills_write_admin`, `using has_role('admin')`), so a plain supabase-js
-- `.insert()` / `.update()` from apps/admin WOULD pass RLS. It is deliberately
-- not used, for exactly the reason 0039_admin_commerce_rpcs and
-- 0043_clutch_state_machine already established:
--
--   `audit_log` carries ZERO authenticated or anon write policy and zero write
--   grant (0003_moderation_audit.sql, RLS.md). A client-side mutation would
--   therefore change the drill catalog and leave no audit trail, and PRD-04
--   FR-49 through FR-51 each require an audit_log entry as PART of the action,
--   not as a best-effort follow up.
--
-- Wrapping each mutation in a SECURITY DEFINER function makes the row change
-- and its audit row ONE transaction, so they cannot diverge. Every function
-- below re-checks `has_role('admin')` itself rather than leaning on the RLS
-- policy, because a SECURITY DEFINER function bypasses RLS by construction
-- (the same belt-and-braces as 0039 and 0043).
--
-- NOT A MONEY PHASE. Drills are reference content, not money rows: no function
-- here touches `xp_events`, `ledger_entries` or any status field on a
-- money-bearing row. XP accrual stays entirely inside the 0059 trigger, which
-- reads `drills.xp_value` server side. The CHECK (xp_value > 0) from 0057 is
-- the hard floor; `admin_upsert_drill` validates it up front so an admin sees a
-- clear VALIDATION message rather than a raw check-constraint violation, but
-- the constraint remains the source of truth.
--
-- SPLIT OF CONCERNS (mirrors 0039's product update vs set_active):
--   * admin_upsert_drill owns the CONTENT fields (title, description, sport,
--     skill_category, difficulty, xp_value, media_url). It does NOT touch
--     `active`, so a content edit can never silently flip a drill's visibility.
--     A created drill is active by the 0057 table default.
--   * admin_set_drill_active owns the `active` flag only, so activate and
--     deactivate are their own audited actions ('drill.activate' /
--     'drill.deactivate'), one audit_log row each.
-- Each accepted mutation therefore writes EXACTLY ONE audit_log row.
-- ============================================================================

-- ============================================================================
-- admin_upsert_drill — create (p_id null) or edit (p_id set) a drill's content.
--
-- FR-49 create / FR-50 edit. Full-replace semantics on edit: the form submits
-- every editable field and the audit row records only what actually moved (via
-- audit_changed_fields from 0039), so a title-only edit does not restate the
-- whole drill and bury the change.
-- ============================================================================

create function public.admin_upsert_drill(
  p_id uuid,
  p_title text,
  p_description text,
  p_sport public.sport,
  p_skill_category text,
  p_difficulty public.drill_difficulty,
  p_xp_value int,
  p_media_url text default null
)
returns public.drills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.drills;
  v_after public.drills;
  v_diff jsonb;
  v_media text;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'VALIDATION: a drill title is required';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'VALIDATION: a drill description is required';
  end if;

  if p_skill_category is null or btrim(p_skill_category) = '' then
    raise exception 'VALIDATION: a skill category is required';
  end if;

  if p_sport is null then
    raise exception 'VALIDATION: a sport is required';
  end if;

  if p_difficulty is null then
    raise exception 'VALIDATION: a difficulty is required';
  end if;

  -- Mirror the 0057 CHECK (xp_value > 0) with a clear message. The constraint
  -- stays the source of truth; this only turns a raw violation into a readable
  -- refusal the admin form can show.
  if p_xp_value is null or p_xp_value <= 0 then
    raise exception 'VALIDATION: xp value must be greater than zero';
  end if;

  v_media := nullif(btrim(coalesce(p_media_url, '')), '');

  if p_id is null then
    -- CREATE. `active` is left to the 0057 table default (true); this function
    -- never sets it, so visibility only ever moves through set_drill_active.
    insert into public.drills (title, description, sport, skill_category, difficulty, xp_value, media_url)
    values (
      btrim(p_title), btrim(p_description), p_sport, btrim(p_skill_category),
      p_difficulty, p_xp_value, v_media
    )
    returning * into v_after;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    values (
      auth.uid(),
      'drill.create',
      'drill',
      v_after.id,
      null,
      jsonb_build_object(
        'title', v_after.title,
        'description', v_after.description,
        'sport', v_after.sport,
        'skill_category', v_after.skill_category,
        'difficulty', v_after.difficulty,
        'xp_value', v_after.xp_value,
        'media_url', v_after.media_url,
        'active', v_after.active
      )
    );

    return v_after;
  end if;

  -- EDIT.
  select * into v_before from public.drills where id = p_id for update;
  if v_before.id is null then
    raise exception 'NOT_FOUND: drill % does not exist', p_id;
  end if;

  update public.drills
  set title = btrim(p_title),
      description = btrim(p_description),
      sport = p_sport,
      skill_category = btrim(p_skill_category),
      difficulty = p_difficulty,
      xp_value = p_xp_value,
      media_url = v_media
  where id = p_id
  returning * into v_after;

  v_diff := public.audit_changed_fields(
    jsonb_build_object(
      'title', v_before.title, 'description', v_before.description,
      'sport', v_before.sport, 'skill_category', v_before.skill_category,
      'difficulty', v_before.difficulty, 'xp_value', v_before.xp_value,
      'media_url', v_before.media_url
    ),
    jsonb_build_object(
      'title', v_after.title, 'description', v_after.description,
      'sport', v_after.sport, 'skill_category', v_after.skill_category,
      'difficulty', v_after.difficulty, 'xp_value', v_after.xp_value,
      'media_url', v_after.media_url
    )
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'drill.update', 'drill', p_id, v_diff -> 'before', v_diff -> 'after');

  return v_after;
end;
$$;

comment on function public.admin_upsert_drill(uuid, text, text, public.sport, text, public.drill_difficulty, int, text) is
  'PRD-04 FR-49/FR-50 admin drill create (p_id null) or edit (p_id set). SECURITY DEFINER, has_role(admin) inside, one audit_log row per accepted mutation (drill.create / drill.update). Owns content fields only; never touches active (that is admin_set_drill_active). Validates xp_value > 0 up front, mirroring the 0057 CHECK.';

revoke all on function public.admin_upsert_drill(uuid, text, text, public.sport, text, public.drill_difficulty, int, text) from public;
revoke execute on function public.admin_upsert_drill(uuid, text, text, public.sport, text, public.drill_difficulty, int, text) from anon;
grant execute on function public.admin_upsert_drill(uuid, text, text, public.sport, text, public.drill_difficulty, int, text) to authenticated;

-- ============================================================================
-- admin_set_drill_active — flip the `active` flag. FR-51.
--
-- Deactivation is a flag flip, never a delete: 0058's public catalog policy
-- leaves inactive drills readable, but the consumer Learn surface carries its
-- own `.eq('active', true)` (PHASE-7-STATUS.md gate clause 8), so clearing the
-- flag hides the drill from players while leaving it intact for reactivation
-- and for the historical `drill_completions` / `xp_events` that reference it.
-- ============================================================================

create function public.admin_set_drill_active(p_id uuid, p_active boolean)
returns public.drills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.drills;
  v_after public.drills;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_active is null then
    raise exception 'VALIDATION: an active flag is required';
  end if;

  select * into v_before from public.drills where id = p_id for update;
  if v_before.id is null then
    raise exception 'NOT_FOUND: drill % does not exist', p_id;
  end if;

  update public.drills set active = p_active where id = p_id returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    case when p_active then 'drill.activate' else 'drill.deactivate' end,
    'drill',
    p_id,
    jsonb_build_object('active', v_before.active),
    jsonb_build_object('active', v_after.active)
  );

  return v_after;
end;
$$;

comment on function public.admin_set_drill_active(uuid, boolean) is
  'PRD-04 FR-51 admin activate/deactivate of a drill. SECURITY DEFINER, has_role(admin) inside, one audit_log row per flip (drill.activate / drill.deactivate). A flag flip, never a delete: inactive drills stay intact for reactivation and for the xp_events that reference them; the consumer surface hides them via its own active = true filter.';

revoke all on function public.admin_set_drill_active(uuid, boolean) from public;
revoke execute on function public.admin_set_drill_active(uuid, boolean) from anon;
grant execute on function public.admin_set_drill_active(uuid, boolean) to authenticated;
