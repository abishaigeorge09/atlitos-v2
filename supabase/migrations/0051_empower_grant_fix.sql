-- ATLITOS v2 — 0051_empower_grant_fix.sql
-- Domain: empower. Epic AT-8, story AT-110 (advisor follow-up).
--
-- Two advisor-clean fixes on 0048/0050, exactly the tightening 0005 applied to
-- the Phase 1 RPCs and 0046/0047 applied to clutch:
--
-- 1. Supabase's default privileges grant EXECUTE on new functions DIRECTLY to
--    anon and authenticated, so `revoke all ... from public` in 0050 did NOT
--    remove anon's execute (the advisor's anon_security_definer_function_executable
--    WARN, and a real drift from the baseline where submit_coach_verification is
--    anon=false via 0005). Explicitly revoke execute from anon on every
--    client-facing empower RPC. Each already raises UNAUTHENTICATED when
--    auth.uid() is null, so this is defense in depth aligned to the P5 baseline,
--    not a behavior change. authenticated keeps execute (intentional, RLS.md:
--    these are client-facing RPCs that re-check auth.uid() internally).
--
-- 2. general_fund_account_ref had no `set search_path` (function_search_path_mutable
--    WARN). It returns a constant and touches no table, so an empty search_path
--    is correct and silences the advisor.

revoke execute on function public.submit_upa_application(jsonb) from anon;
revoke execute on function public.resubmit_upa_application(uuid, jsonb) from anon;
revoke execute on function public.reapply_upa_application(jsonb) from anon;
revoke execute on function public.deactivate_upa_application(uuid) from anon;
revoke execute on function public.mark_wishlist_item_delivered(uuid) from anon;

alter function public.general_fund_account_ref() set search_path = '';
