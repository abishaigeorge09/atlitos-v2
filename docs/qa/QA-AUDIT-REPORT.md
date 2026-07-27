# Atlitos QA Audit — running report (2026-07-27)

Full-surface QA audit. Three lanes: Playwright (apps/e2e, scripted/repeatable), SQL + verify scripts (truth), Chrome-extension walks (judgment, pending). Status: Phase A + partial B complete; spec authoring and browser walks resume after the 7:10am IST session-limit reset.

## FIXED this pass (committed, proven)

- **CRITICAL — gratitude posting was 100% broken (migration 0083, applied to prod).** `gratitude_posts_insert_own` (0049) self-referenced its own table in WITH CHECK -> Postgres 42P17 infinite recursion -> every client gratitude insert 500'd for every applicant. PRD-05 FR-19 fully non-functional, not just insecure. Fixed with a SECURITY DEFINER helper (`gratitude_post_exists_for_item`), same pattern as 0078/0081. Proven: a real owner insert on a funded unposted item now passes the policy. Found by verify-rls-matrix.mjs.
- **HIGH — athlete web app 404'd all six brand fonts (commit f0c9064, deployed, curl 200).** Expo web export placed Inter/JetBrains Mono TTFs under a `dist/assets/__node_modules/.pnpm/...` path; Vercel's static upload silently drops anything under a `node_modules`-named directory, so the deployed app rendered in fallback fonts. Fixed by vendoring the 6 TTFs into apps/mobile/assets/fonts/ and require()-ing them locally so no `node_modules` segment appears in the export path. Found by the Playwright harness console guard on its first run.

## WORKS (verified this pass)

- **RLS / access control: clean.** verify-rls-matrix.mjs — 181 assertions across upa_applications/upa_evidence/donations/gratitude_posts, group chat (0078), coach_trainee_notes/videos dual-access (0082), fee_config, venues/court_bookings owner-scoping. **Zero access-control leaks**, all isolation assertions non-vacuous (party ids asserted distinct, codifying AT-62).
- Truth-lane baseline GREEN (7 scripts): commerce-rls (isolated + non-vacuous), empower-p6, f-donation, f-rls, groups-probes, learn-p7, oversell-probe (concurrent OUT_OF_STOCK enforced).

## Test catalog + harness (permanent assets)

- docs/qa/TEST-CATALOG.md + test-catalog.json — **141 frozen cases** (PW 58, SQL 60, EXT 16, MAESTRO 7; P0 55, P1 64, P2 17, P3 5).
- apps/e2e/ Playwright harness: 9-persona storage-state setup, test-DB guard, assertIsolation helper, console guard. Spec authoring partially done (auth/chat/clutch/follows + money partition WIP), resumes after reset.

## Baseline reds — triage (5 environmental, 2 need verification; no NEW confirmed product bug)

- verify-clutch-p5: ENVIRONMENTAL — missing /tmp/atlitos-clip.mp4 test fixture.
- verify-commerce-payments: ENVIRONMENTAL — undefined-JSON parse, missing env at run.
- verify-shopper-ui / -lib / -address-snapshot (3): ENVIRONMENTAL — `playwright` not installed at repo root (now only in apps/e2e); migrate these into the e2e project.
- verify-realtime: FIXTURE STALENESS — INVALID_TRANSITION because the seeded Cric Squad group session is not in `accepted` state (a prior run left it advanced). Realtime mechanism itself proven earlier (AT-32). Reset: `update sessions set status='accepted'` + null participant attendance for the group.
- **verify-discovery: NEEDS VERIFICATION (P1).** "athlete sees 12 sessions, 11 own" — a 1-session over-visibility. Most likely a group-session false positive (a group member legitimately sees a group session that has no single owning player_id, which the pre-groups discovery assertion treats as a leak). Refuter must confirm group-aware vs a real scoping leak before any fix.

## Open dependencies (founder / next session)

- **Empower/UPA demo accounts not seeded on this project** (upa.verified@/upa.tennis@/donor@ can't sign in — seed-empower-upa-users.mjs never run). Blocks the Life-portal UX walks (the UPA-needs investigation). Needs SUPABASE_SERVICE_ROLE_KEY exported to run the seed.
- **Full E2E truth-lane run** needs SUPABASE_SERVICE_ROLE_KEY at run time (correctly never committed): `E2E=1 SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @atlitos/e2e test`.
- Session limit reset 7:10am IST -> resume: finish spec authoring, run Playwright + Maestro, run the sequential Chrome-extension persona walks (UPA seats first), then the missing-features backlog led by the UPA gap matrix.

## Missing-features backlog seed
See docs/qa/PHASE-A-GAP-INVENTORY.md — 39 PRD-vs-code gaps. Deepest: admin (Dashboard, Refund action, User Detail, Feature Flags, Support Tickets, Audit Log Viewer all absent), court portal (All-bookings, Ratings, Settings, payout onboarding), UPA portal (draft-save, self-service-deactivate-vs-PRD contradiction, gratitude moderation, zero testids). Prioritized backlog with S/M/L effort produced in the final report after the walks.
