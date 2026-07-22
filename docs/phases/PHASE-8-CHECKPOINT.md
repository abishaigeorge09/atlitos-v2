# Phase 8 Checkpoint (Track A: RLS + advisor burn-down, AT-140/141/142)

Working memory for resumability. Phase-close folds this into PHASE-8-STATUS.md then deletes it.

## Advisor baseline (2026-07-22, syzzfgaudpifwvbpycyi)
- perf: 143 WARN / 41 INFO. auth_rls_initplan 100, multiple_permissive_policies 43, unindexed_fk 26 INFO, unused_index 14 INFO.
- security: 3 ERROR (security_definer_view), 148 WARN, 4 INFO. function_search_path_mutable 14.

## Test users (isolation harness, ids asserted to DIFFER)
- A_player 58756043-... (owns orders5, PI35, sessions11-player, donations6, clips4, drills2, upa1)
- B_guest  b290a0c8-... (roleless; owns clips3) -- non-owner for money tables
- C_coach  5b262cf1-... (player+coach; sessions11-coach, coach_profiles1)
- D_partnerA a8d0dc6f-..., E_partnerB baa261d6-... (court_partner; venues 3 / 1)
- F_anon (anon role) public tables only
Harness: public._rls_probe_r + _rls_capture + _rls_anon_probe -> public._rls_audit(phase,viewer,tbl,cnt,fp,n_a,n_b). fp = md5 of md5-ordered row::text of the FULL visible set. n_a/n_b = rows visible AND owned by A/B (cross-leak check).

## Migrations
- [x] 0062_advisor_initplan_subselect.sql — APPLIED. 100 ALTER POLICY, wrap auth.uid() in (select ...). Perf initplan 100->0. Isolation: before vs after_0062 diff = 0 rows (identical for all 6 viewers x 20 tables). 
- [x] 0063_advisor_permissive_collapse.sql — APPLIED (DO block, guarded). 22 Category-A tables (authenticated-only pure-SELECT) merged to one OR policy each. multiple_permissive 43 -> 21. Isolation: before vs after_0063 diff = 0 rows. Non-owner (B_guest, C_coach) see 0 of A's rows on orders/PI/order_items/refunds/transfers/ledger; sessions/donations nonzero-for-C are by-design dual-key (identical before/after). Remaining 21 = Category B (public+owner or FOR ALL+public), left by design.
- [x] 0064_advisor_function_search_path.sql — APPLIED. 9 postgres-owned functions set search_path=''. search_path 14 -> 5. The 5 residual (timerange/timemultirange, supabase_admin-owned internal range constructors) are not app-alterable and inert; KEEP. Auth hook JWT injection re-verified (returns ["player"]).

## Cleanup DONE
- Dropped _rls_audit + _rls_probe/_rls_probe_r/_rls_capture/_rls_anon_probe. no_primary_key INFO and rls_disabled_in_public ERROR (both harness artifacts) gone.

## Final advisor (after 0062-0064, harness removed)
- perf: initplan 100->0, multiple_permissive 43->21, fk/unused_index INFO unchanged (AT-151 scope).
- security: function_search_path 14->5 (KEEP: range constructors); security_definer_view 3 ERROR unchanged (KEEP); no new ERROR.
- Isolation: before == after_0062 == after_0063 == after_0064 (0-row diff each) across 6 viewers x 20 sensitive tables.
