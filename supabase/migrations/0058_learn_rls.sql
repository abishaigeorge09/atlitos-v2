-- ATLITOS v2 — 0058_learn_rls.sql
-- Domain: learn. Epic AT-9, story AT-130 (Track A).
-- Requirements: PRD-01 FR-48, FR-49, FR-51; PRD-04 FR-49; CLAUDE.md permissive-OR.
--
-- RLS + grants for every table 0057 created. This is the crux of P7: XP must be
-- UN-FORGEABLE. The two tamper-proof tables (xp_events, user_milestones) get an
-- owner SELECT and NO client write grant OF ANY KIND, so a direct INSERT returns
-- 42501 and the only writer is the 0059 SECURITY DEFINER trigger. Enforced twice
-- (the 0010/0032/0049 house pattern): by the absence of a write policy AND by the
-- grant revocation.
--
-- ============================================================================
-- PERMISSIVE-OR WARNING. READ THIS BEFORE WRITING ANY LEARN QUERY.
-- CLAUDE.md records the repo being bitten by this exact shape (four incidents).
--
-- drills, roadmap_stages, milestones each carry an anon-inclusive PUBLIC SELECT
-- policy (public reference content, RLS.md line 118). Postgres combines
-- permissive policies with OR, so an UNSCOPED `select * from drills` returns
-- EVERY drill, INCLUDING inactive ones. There is no owner dimension on these
-- tables, but there IS an `active` dimension.
--
-- THE APP CODE CONTRACT, a requirement not a suggestion (PHASE-7-STATUS.md line
-- 50, gate clause 8):
--   * The consumer Learn surface carries its OWN `.eq('active', true)` on every
--     drills read. An inactive drill must never render in the app.
--   * The admin Drill List sees all drills (no active filter), by design.
--   * That applies to app code, packages/api, supabase/seed, and every test.
--
-- xp_events, drill_completions, user_milestones are strictly OWNER-scoped. Every
-- owner read carries its OWN `.eq('user_id', user.id)` in app code / seeds /
-- tests regardless of what RLS would do. Isolation tests assert the two party
-- ids actually DIFFER before trusting a cross-user result (the AT-62 lesson).
-- ============================================================================

alter table public.drills enable row level security;
alter table public.drill_completions enable row level security;
alter table public.roadmap_stages enable row level security;
alter table public.xp_events enable row level security;
alter table public.milestones enable row level security;
alter table public.user_milestones enable row level security;

-- ============================================================================
-- drills, roadmap_stages, milestones — PUBLIC reference content.
--
-- SELECT: all rows, anon-inclusive (a guest can browse the Learn catalog,
-- PRD-01 FR-49/FR-51). Write: has_role('admin') only. Admin CRUD actually flows
-- through Track B's SECURITY DEFINER admin_upsert_drill / admin_set_drill_active
-- RPCs (which bypass RLS by design and write the audit_log row); these admin
-- write policies are the documented ceiling (RLS.md line 257) and the belt to
-- that braces, so no non-admin client can ever write these tables directly.
-- ============================================================================

create policy drills_select_public on public.drills
  for select to anon, authenticated
  using (true);

create policy drills_write_admin on public.drills
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy roadmap_stages_select_public on public.roadmap_stages
  for select to anon, authenticated
  using (true);

create policy roadmap_stages_write_admin on public.roadmap_stages
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy milestones_select_public on public.milestones
  for select to anon, authenticated
  using (true);

create policy milestones_write_admin on public.milestones
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ============================================================================
-- drill_completions — the ONE client write in the XP path.
--
-- SELECT: own rows only. INSERT: own row only (user_id = auth.uid()). NO
-- UPDATE/DELETE policy (v2 first cut: no un-complete, no redo; the
-- UNIQUE(user_id, drill_id) from 0057 is the idempotency guard). The insert
-- fires the 0059 trigger that appends the xp_events row server side.
-- ============================================================================

create policy drill_completions_select_own on public.drill_completions
  for select to authenticated
  using (user_id = auth.uid());

create policy drill_completions_insert_own on public.drill_completions
  for insert to authenticated
  with check (user_id = auth.uid());

-- ============================================================================
-- xp_events — the APPEND-ONLY XP LOG. Owner SELECT, NO client write policy.
-- A row is written ONLY by the 0059 SECURITY DEFINER trigger. A direct
-- authenticated INSERT returns 42501 (no policy AND no grant). This is what
-- makes XP un-forgeable and the derived total un-inflatable.
-- ============================================================================

create policy xp_events_select_own on public.xp_events
  for select to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- user_milestones — earned milestones. Owner SELECT, NO client write policy.
-- Written ONLY by the 0059 evaluator. A direct authenticated INSERT returns
-- 42501, so a milestone cannot be self-awarded.
-- ============================================================================

create policy user_milestones_select_own on public.user_milestones
  for select to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- GRANTS. The second lock, independent of policy (house pattern).
-- ============================================================================

-- drills / roadmap_stages / milestones: anon + authenticated read the public
-- catalog. Writes are admin-only (gated by the *_write_admin policy above); the
-- grant is present so an admin's policy-passing write is not blocked at the
-- privilege layer, but a non-admin authenticated write fails the policy.
grant select on public.drills to anon, authenticated;
grant select on public.roadmap_stages to anon, authenticated;
grant select on public.milestones to anon, authenticated;
grant insert, update, delete on public.drills to authenticated;
grant insert, update, delete on public.roadmap_stages to authenticated;
grant insert, update, delete on public.milestones to authenticated;

-- drill_completions: own SELECT + own INSERT only. NO update/delete verb reaches
-- authenticated, so even a future careless policy cannot open a mutate path.
-- anon has no completion surface at all.
revoke insert, update, delete on public.drill_completions from anon, authenticated;
revoke all on public.drill_completions from anon;
grant select, insert on public.drill_completions to authenticated;

-- xp_events: owner SELECT only. NO write verb of any kind for anon/authenticated.
-- A direct client INSERT fails at the privilege check (42501) before any policy
-- runs. The 0059 trigger writes under the definer owner (bypasses this).
revoke insert, update, delete on public.xp_events from anon, authenticated;
revoke all on public.xp_events from anon;
grant select on public.xp_events to authenticated;

-- user_milestones: owner SELECT only. NO write verb for anon/authenticated. A
-- direct client INSERT fails 42501. The 0059 evaluator writes under the definer.
revoke insert, update, delete on public.user_milestones from anon, authenticated;
revoke all on public.user_milestones from anon;
grant select on public.user_milestones to authenticated;
