-- ATLITOS v2 — 0030_verified_coach_discovery_rls.sql
-- Story AT-63. Requirements: PRD-01 FR-20 to FR-22, PRD-02 FR-5.
--
-- THE DEFECT
--
-- 0019_coaching_rls.sql gates session_types_select_public and
-- coach_availability_windows_select_public on
--
--   exists (select 1 from public.coach_profiles cp
--           where cp.user_id = <table>.coach_id and cp.status = 'verified')
--
-- A subquery inside an RLS policy is itself evaluated under the CALLER's
-- privileges, so that EXISTS is subject to coach_profiles' own RLS. And
-- coach_profiles (0001_identity.sql) has exactly two SELECT policies:
-- coach_profiles_select_own (user_id = auth.uid()) and
-- coach_profiles_select_admin. There is no policy for anon, and none for a
-- non-owner authenticated user, by deliberate design: RLS.md says "the base
-- table has no public SELECT policy, public discovery of verified coaches
-- reads the view coach_profiles_public instead".
--
-- Consequence: for every athlete and every guest, that EXISTS returns false
-- for every row, so both policies denied everything. Reproduced against this
-- project before the fix, as `set role anon` and as a non-owner authenticated
-- athlete: session_types 0 rows, coach_availability_windows 0 rows.
--
-- SCOPE OF THE BREAKAGE, as measured, not assumed
--
-- Coach discovery ITSELF was NOT broken. listCoaches (packages/api/src/
-- use-coaching.ts) reads the view public.coach_profiles_public, which is
-- `with (security_invoker = false)` and therefore runs as its owner and
-- bypasses the base table's RLS. Verified: 2 of 2 verified coaches visible to
-- both anon and a non-owner athlete. public_profiles (same definer-view
-- shape) and get_coach_busy_slots (SECURITY DEFINER, granted to anon and
-- authenticated) were also unaffected.
--
-- So the dead half of the journey was precisely the coach DETAIL screen and
-- everything downstream of it: getCoach returned a coach with zero session
-- types (no pricing tiers, FR-21) and zero availability windows, which made
-- computeAvailableSessionSlots generate zero bookable slots (FR-22), which
-- made booking unreachable. A catalogue you can browse and cannot buy from.
--
-- These two are also the COMPLETE set of affected policies. Every policy in
-- the database whose USING or WITH CHECK expression mentions coach_profiles
-- was enumerated from pg_policy; the result was exactly these two and nothing
-- else.
--
-- THE FIX, AND WHY NOT THE OBVIOUS ONE
--
-- The obvious fix is to add a public SELECT policy on coach_profiles scoped
-- to status = 'verified'. Rejected, for two reasons:
--
--   1. It contradicts the documented design. coach_profiles' public surface
--      is already defined, deliberately and column-by-column, by the
--      coach_profiles_public view: the view omits `status` (a moderation
--      state) and `updated_at`, and exposes the twelve columns that are
--      genuinely the product. A base-table policy re-grants the whole row and
--      leaves two definitions of "public coach profile" to drift apart.
--
--   2. It would make coach_profiles permissive-OR, the exact shape CLAUDE.md
--      records three separate incidents for. Every existing read of the base
--      table would silently become capable of returning other coaches' rows,
--      and every future one would inherit that hazard. (The three current
--      reads, packages/api/src/hooks.ts and two in use-coach.ts, are all
--      already .eq("user_id", ...) owner-scoped, so nothing leaks TODAY. The
--      objection is that this fix would spend a permanent, repo-wide
--      correctness constraint to buy something the view already provides.)
--
-- Instead: a SECURITY DEFINER boolean, public.is_verified_coach(uuid), which
-- answers the single question the policies actually need to ask without
-- granting any read of coach_profiles to anybody. This is the pattern the
-- coaching and chat domains already use for exactly this purpose,
-- session_exists_between and session_links_pair (0019, 0022): let a policy
-- ask a question about a table the caller cannot read.
--
-- Net effect on the read surface: session_types and coach_availability_windows
-- become readable for VERIFIED coaches only, which is what RLS.md's guest read
-- surface table has claimed all along and what 0019 intended. coach_profiles
-- itself gains no new reader. Nothing else changes, so no existing query needs
-- new owner-scoping as a result of this migration.
--
-- The permissive-OR warning in 0019's header still stands unchanged for these
-- two tables: an unscoped `select * from session_types` still returns every
-- verified coach's rows (that is the point of a discovery policy), so UI
-- queries must keep carrying their own .eq('coach_id', ...) filter. This
-- migration makes that warning TRUE rather than vacuous: until now the public
-- disjunct matched nothing, so the leak it warns about could not occur, which
-- is a broken feature, not a safe default.

-- ============================================================================
-- is_verified_coach(uuid)
-- ============================================================================

-- SECURITY DEFINER so the policies below can test coach verification without
-- the caller holding any SELECT on public.coach_profiles. It is a strictly
-- narrower disclosure than a base-table policy: it returns one boolean about
-- one user_id the caller already has in hand (it came from the public view or
-- from the row being filtered), never a row, never a column value, and it
-- cannot be used to enumerate coaches.
--
-- STABLE, not VOLATILE, so the planner can fold it into the policy scan
-- instead of re-invoking per row.
--
-- search_path pinned to public per 0023's function_search_path_mutable fixes.
create or replace function public.is_verified_coach(_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.coach_profiles cp
    where cp.user_id = _coach_id
      and cp.status = 'verified'
  );
$$;

-- Not `to public`: only the two roles whose policies call it, matching the
-- grant discipline RLS.md's advisor section describes ("no SECURITY DEFINER
-- function is callable by a role broader than it needs"). anon is included
-- because guest coach browsing is PRD-01 FR-2/FR-20.
revoke all on function public.is_verified_coach(uuid) from public;
grant execute on function public.is_verified_coach(uuid) to anon, authenticated;

-- ============================================================================
-- Re-create the two broken discovery policies
-- ============================================================================

drop policy if exists session_types_select_public on public.session_types;

create policy session_types_select_public on public.session_types
  for select to anon, authenticated
  using (public.is_verified_coach(coach_id));

drop policy if exists coach_availability_windows_select_public on public.coach_availability_windows;

create policy coach_availability_windows_select_public on public.coach_availability_windows
  for select to anon, authenticated
  using (public.is_verified_coach(coach_id));

-- The *_select_own and *_select_admin policies on both tables are untouched.
-- They are what keeps an UNVERIFIED coach able to see and edit their own
-- session types and availability while they are still setting up: the public
-- disjunct above is false for them, the own disjunct is true, and OR does the
-- rest. Verified explicitly after applying this migration.
