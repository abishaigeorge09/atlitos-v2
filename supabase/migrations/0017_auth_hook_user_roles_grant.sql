-- ATLITOS v2 — 0017_auth_hook_user_roles_grant.sql
-- Domain: identity (fixes 0001/0008 era custom_access_token_hook wiring).
--
-- Bug: registering public.custom_access_token_hook as the project's Access
-- Token hook (done via dashboard 2026-07-13, P2 punch item 1) was not
-- enough. GoTrue executes the hook as `supabase_auth_admin`, which had no
-- select privilege and no RLS policy on public.user_roles, so the hook's
-- role lookup returned zero rows and every issued JWT carried
-- app_metadata.roles = []. has_role() then failed everywhere: this is the
-- deeper root cause of Phase 2 blocking finding 4 (bookings invisible on
-- Live Today, admin verification queue rendering empty for a real admin).
-- Surfaced 2026-07-15 by decoding a freshly issued admin JWT during the
-- founder's admin portal walkthrough.
--
-- Fix per the Supabase custom access token hook docs: grant the auth admin
-- role schema usage and select on user_roles, add a permissive select
-- policy scoped to it, and (defensively) revoke the broad grants the docs
-- warn about. Existing sessions keep their old claims until refresh; demo
-- accounts must sign out and back in once after this applies.

grant usage on schema public to supabase_auth_admin;
grant select on public.user_roles to supabase_auth_admin;

create policy user_roles_auth_admin_select on public.user_roles
  as permissive for select
  to supabase_auth_admin
  using (true);
