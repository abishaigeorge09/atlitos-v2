-- ATLITOS v2 — 0023_coaching_chat_advisor_fixes.sql
-- Domain: coaching + chat. Epic AT-5, AT-12. Stories AT-37, AT-39.
--
-- Two Supabase security advisor findings raised by 0021 and 0022, fixed in
-- the same phase rather than left for the gate, per PLAN.md's rule that the
-- advisor must be clean before the biased approver reviews.
--
--   1. anon/authenticated_security_definer_function_executable on
--      public.touch_chat_thread_last_message(). It is a trigger function, so
--      calling it over /rest/v1/rpc/ would fail at runtime anyway ("trigger
--      functions can only be called as triggers"), but it should never have
--      been in PostgREST's callable surface at all. Supabase's default
--      privileges grant EXECUTE on new functions to public, which is why it
--      landed there; the fix is the same revoke shape every deliberate RPC in
--      this repo already carries. The trigger itself is unaffected: trigger
--      execution does not check EXECUTE on the function.
--
--   2. function_search_path_mutable on
--      public.lock_coach_profile_admin_fields(). This predates 0021 (the
--      function ships in 0001_identity.sql without a search_path), but 0021
--      re-declared it to honour the app.rating_pipeline GUC, so it is this
--      track's to fix now. A SECURITY INVOKER trigger function with a mutable
--      search_path is a real, if narrow, hazard: it calls public.has_role(),
--      and a caller who can set search_path could otherwise shadow that name.
--      Pinning search_path = public matches every other function this phase
--      shipped. Body is otherwise byte-identical to 0021's.
--
-- Deliberately NOT touched here, all pre-existing and owned elsewhere: the
-- security_definer_view ERRORs on public_profiles and coach_profiles_public
-- (0001_identity.sql, deliberate bypass views), rls_enabled_no_policy on
-- webhook_events (0010_payments_core.sql, service_role only by design), the
-- remaining function_search_path_mutable WARNs from P1/P2, and
-- auth_allow_anonymous_sign_ins (0008, the guest experience). Those stay on
-- the P8 hardening list in PHASE-2-STATUS.md.

revoke all on function public.touch_chat_thread_last_message() from public;
revoke execute on function public.touch_chat_thread_last_message() from anon, authenticated;

create or replace function public.lock_coach_profile_admin_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.status is distinct from old.status
    or new.rating is distinct from old.rating
    or new.rating_count is distinct from old.rating_count
    or new.players_coached_count is distinct from old.players_coached_count
  )
    and not public.has_role('admin')
    and coalesce(current_setting('app.rating_pipeline', true), '') <> 'on'
  then
    raise exception 'FIELD_LOCKED: status, rating, rating_count, players_coached_count change only via admin or a server-side pipeline';
  end if;
  return new;
end;
$$;
