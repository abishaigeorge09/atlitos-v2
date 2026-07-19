-- ATLITOS v2 — 0019_coaching_rls.sql
-- Domain: coaching. Epic AT-5, story AT-36.
-- Requirements: PRD-02 FR-11, FR-12, FR-20.
--
-- Policies for session_types, coach_availability_windows, and sessions,
-- following RLS.md's "coaching" table verbatim. RLS was already enabled on all
-- three by 0018_coaching.sql, so until this migration ran they returned zero
-- rows to every client role.
--
-- ============================================================================
-- PERMISSIVE-OR WARNING, read this before writing any query against these
-- tables. This is the P2 venues defect (PHASE-3-STATUS.md durable lesson 1),
-- restated in the coaching domain because the same shape is unavoidable here.
--
-- Postgres combines multiple permissive policies for the same role and command
-- with OR. Both of the following are true at once:
--
--   sessions: sessions_select_coach (coach_id = auth.uid()) OR
--             sessions_select_player (player_id = auth.uid())
--   session_types / coach_availability_windows:
--             *_select_public (owning coach is verified, ANY coach) OR
--             *_select_own (coach_id = auth.uid())
--
-- So an unscoped `select * from sessions` run by a user who is both a coach
-- and a player returns BOTH sides of their life mixed into one list, and an
-- unscoped `select * from session_types` returns every verified coach's
-- session types, not the caller's own. RLS here is an authorization ceiling,
-- not a scoping mechanism.
--
-- UI builders (AT-45 through AT-54) MUST therefore filter by owner in the
-- query itself:
--   coach request queue (FR-12):  .eq('coach_id', user.id)
--   coach trainees roster (FR-20): .eq('coach_id', user.id)
--   athlete upcoming/history:      .eq('player_id', user.id)
--   coach's own session types and availability editor: .eq('coach_id', user.id)
-- Omitting the filter does not raise an error, it silently shows the other
-- party's rows. That is exactly how P2 lost two reject cycles on venues.
-- ============================================================================

-- ============================================================================
-- session_types (RLS.md coaching: "own coach's rows; verified coach's
-- session_types also public (discovery needs them)"; guest read surface table:
-- "status = 'verified' rows only")
-- ============================================================================

create policy session_types_select_public on public.session_types
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.coach_profiles cp
      where cp.user_id = session_types.coach_id
        and cp.status = 'verified'
    )
  );

create policy session_types_select_own on public.session_types
  for select to authenticated
  using (coach_id = auth.uid());

create policy session_types_select_admin on public.session_types
  for select to authenticated
  using (public.has_role('admin'));

-- Write: owning coach only. `for all` covers insert, update, and delete with
-- one policy pair, the same shape 0009_courts.sql used for
-- court_availability_windows.
create policy session_types_write_own on public.session_types
  for all to authenticated
  using (public.has_role('coach') and coach_id = auth.uid())
  with check (public.has_role('coach') and coach_id = auth.uid());

-- ============================================================================
-- coach_availability_windows (identical shape; PRD-02 FR-22, FR-23)
-- ============================================================================

create policy coach_availability_windows_select_public on public.coach_availability_windows
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.coach_profiles cp
      where cp.user_id = coach_availability_windows.coach_id
        and cp.status = 'verified'
    )
  );

create policy coach_availability_windows_select_own on public.coach_availability_windows
  for select to authenticated
  using (coach_id = auth.uid());

create policy coach_availability_windows_select_admin on public.coach_availability_windows
  for select to authenticated
  using (public.has_role('admin'));

create policy coach_availability_windows_write_own on public.coach_availability_windows
  for all to authenticated
  using (public.has_role('coach') and coach_id = auth.uid())
  with check (public.has_role('coach') and coach_id = auth.uid());

-- ============================================================================
-- sessions: SELECT only, for the two parties and admin. There is deliberately
-- NO insert, update, or delete policy for authenticated or anon on this table,
-- ever. This is CLAUDE.md's financial invariant expressed in the schema:
-- sessions carries price, platform_fee, total, and a status that gates an
-- earnings ledger write, so the only writers are the book-session edge
-- function (service_role, bypasses RLS) and the SECURITY DEFINER RPCs
-- session_transition / rate_session (0020_coaching_rpcs.sql), which run with
-- their owner's privileges and re-check caller identity and current state
-- themselves. Exactly the court_bookings shape from 0009_courts.sql.
-- ============================================================================

create policy sessions_select_coach on public.sessions
  for select to authenticated
  using (public.has_role('coach') and coach_id = auth.uid());

create policy sessions_select_player on public.sessions
  for select to authenticated
  using (player_id = auth.uid());

create policy sessions_select_admin on public.sessions
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

-- Defense in depth beyond the absent policies. Supabase's default privileges
-- grant every verb on new public tables to anon and authenticated, leaving RLS
-- as the sole guard; RLS.md's ledger_entries note establishes the stricter
-- precedent of removing the verb at the grant level too, so a future migration
-- that carelessly adds a permissive policy still cannot produce a client write
-- path to a money-bearing row. SECURITY DEFINER RPCs are unaffected (they run
-- as their owner), and service_role keeps all verbs for book-session.
revoke insert, update, delete on public.sessions from anon, authenticated;

-- ============================================================================
-- get_session_participants: used by 0021_chat.sql to enforce PRD-02 FR-30
-- ("a chat thread exists only if a session has ever existed between the two
-- users") without granting the chat layer any read of session rows. Declared
-- here rather than in the chat migration because it is a coaching-domain
-- predicate over a coaching-domain table.
--
-- SECURITY DEFINER because the check must see a session between two users from
-- the point of view of either one of them, which the permissive-OR select
-- policies above already allow, but a chat-thread WITH CHECK subquery runs
-- before the caller is proven to be a participant of anything; running it as
-- owner keeps the answer a plain boolean and never exposes a session row.
-- ============================================================================

create or replace function public.session_exists_between(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
    where (s.coach_id = p_user_a and s.player_id = p_user_b)
       or (s.coach_id = p_user_b and s.player_id = p_user_a)
  );
$$;

revoke all on function public.session_exists_between(uuid, uuid) from public;
revoke execute on function public.session_exists_between(uuid, uuid) from anon;
grant execute on function public.session_exists_between(uuid, uuid) to authenticated;
