-- ATLITOS v2 — 0089_security_lockdown_phase1.sql
-- Phase 1 pre launch security lockdown (docs/qa/SECURITY-LOCKDOWN.md). Additive
-- only: storage bucket limits + anon RPC lockdown. Does not touch seed
-- password rotation or the reviewer account, those are Phase 6.
--
-- Root cause note for every REVOKE below: this project's ALTER DEFAULT
-- PRIVILEGES IN SCHEMA public grants EXECUTE on every new function directly
-- to anon, authenticated and service_role as named ACL entries, not via the
-- PUBLIC pseudo-role. Earlier migrations (0005, 0081, 0088) wrote
-- `revoke all on function ... from public`, which is a no-op against those
-- named entries, so the intended anon lockdown never actually took effect.
-- The fix is `revoke execute ... from anon` explicitly, which is what this
-- migration does. Any future function that must not be anon-callable needs
-- the same explicit anon revoke, not a `from public` revoke.

-- ============================================================================
-- 1. Storage: file size limits + MIME allow list on the 5 public buckets.
-- Every one of these buckets holds photo uploads only (avatars, venue
-- photos, UPA verification/profile photos, gratitude post photos, product
-- images); none carries video today (grepped product_media/venue_photos
-- schemas, no media_type column implying video). 10MB is generous headroom
-- over a phone camera photo re-encoded by the client.
-- ============================================================================

update storage.buckets
set file_size_limit = 10485760, -- 10MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id in ('avatars', 'venue-media', 'upa-photos', 'gratitude-photos', 'product-media');

-- ============================================================================
-- 2. Anon RPC lockdown. Decision made per function below; see
-- docs/qa/SECURITY-LOCKDOWN.md for the full keep/revoke table and the
-- evidence each decision rests on (deliberate anon grant in the function's
-- own migration + a real guest facing call site, vs. trigger only / mutation
-- / no anon call site anywhere in the client).
-- ============================================================================

-- Trigger only functions. Each fires from a table trigger (chat thread sync,
-- court staff role grant, auth.users signup, group chat membership sync);
-- Postgres invokes trigger functions with the trigger owner's privileges
-- regardless of EXECUTE grants, so no session, anon or authenticated, has
-- any legitimate reason to call these directly as an RPC.
--
-- All four were created before this project's newer default-privilege
-- convention (named grants to anon/authenticated/service_role at CREATE
-- FUNCTION time) took hold, so each still carried a literal legacy PUBLIC
-- execute grant that a plain `revoke ... from anon` does not touch (PUBLIC
-- is a separate ACL entry every role, including anon, inherits from). Both
-- the named grant and the PUBLIC grant must be revoked to actually close
-- anon off; this was verified with has_function_privilege() after applying,
-- not assumed.
revoke execute on function public.create_group_chat_thread() from anon, authenticated, public;
revoke execute on function public.sync_group_chat_membership() from anon, authenticated, public;
revoke execute on function public.grant_court_staff_role_on_accept() from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Internal RLS-policy predicates that 0081 already intended as
-- authenticated-only (grant execute ... to authenticated, no anon). Confirmed
-- via grep that every policy calling these four is declared `for select to
-- authenticated` (never `to anon, authenticated`), so revoking anon's direct
-- RPC access breaks no RLS evaluation for the anon role. These four only
-- ever had the anon named grant (no legacy PUBLIC entry), so `from anon`
-- alone is sufficient here (verified after applying).
revoke execute on function public.is_group_coach(uuid, uuid) from anon;
revoke execute on function public.is_group_member_live(uuid, uuid) from anon;
revoke execute on function public.is_session_coach(uuid, uuid) from anon;
revoke execute on function public.is_session_participant(uuid, uuid) from anon;

-- has_role: confirmed (grepped every `create policy` block across all
-- migrations) that no anon-applicable policy ever calls has_role() in its
-- USING/WITH CHECK clause, and no client code calls it as an RPC. It only
-- reads the caller's own JWT claims (no table access), so revoking anon
-- direct-call access is pure hardening, not a functional change. Created in
-- 0001 alongside handle_new_user, so it also carried the legacy PUBLIC
-- grant; revoke that too and keep the authenticated grant explicit since
-- dozens of `to authenticated` RLS policies call it.
revoke execute on function public.has_role(text) from public;
grant execute on function public.has_role(text) to authenticated;

-- set_athlete_sports: 0088 already intended authenticated-only (grant
-- execute ... to authenticated, no anon); this mutates the caller's own
-- users.sports/athlete_sports rows and belongs to authenticated onboarding,
-- not the pre-auth guest surface.
revoke execute on function public.set_athlete_sports(public.sport[], public.sport) from anon;

-- The following anon-executable SECURITY DEFINER functions were reviewed and
-- kept intentionally guest facing, each with a deliberate anon grant already
-- in its own migration plus a real guest facing call site; no change here.
-- See docs/qa/SECURITY-LOCKDOWN.md for the per-function evidence:
--   get_coach_busy_slots, get_court_available_slots, get_court_busy_slots,
--   get_court_rating_summary, is_verified_coach, general_fund_balance,
--   get_empower_stats, public_upa_profile, upa_fund_balance,
--   upa_money_summary, variant_available_stock, get_group_member_counts
