-- ATLITOS v2 — 0005_tighten_rpc_grants.sql
-- Supabase applies its own `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated` at the public schema level, which grants
-- EXECUTE to anon at CREATE FUNCTION time regardless of a same-migration
-- `REVOKE ALL ... FROM PUBLIC` (that only revokes the PUBLIC pseudo-role's
-- own grant, not anon's separately-applied explicit one). Confirmed via the
-- security advisor after 0004 landed (get_advisors flagged both new RPCs as
-- anon-executable despite the explicit `revoke all ... from public` in
-- 0004). This migration explicitly strips the anon grant from every
-- mutating function so only authenticated callers (still gated by
-- auth.uid() checks inside each function body) can invoke them, and strips
-- both anon and authenticated from the trigger-only handle_new_user, which
-- nobody should call directly via RPC (it errors outside trigger context
-- anyway, but there is no reason to leave it in the exposed RPC surface).

revoke execute on function public.complete_player_setup(public.sport[], text, text, text) from anon;
revoke execute on function public.submit_coach_verification(jsonb) from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
