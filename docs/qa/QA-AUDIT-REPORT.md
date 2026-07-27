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
- **verify-discovery: REFUTED (not a product bug) — test-infra staleness.** SQL proof (player@atlitos.dev): every session the player sees beyond their own 1:1 rows is a GROUP session where they are an ACTIVE group member AND a session participant (3 such rows, all is_own_group_member=true + is_participant=true). Zero sessions visible where the player is neither owner nor group member. The script asserts `allSessions.count === count(player_id==me)`, a pre-groups definition of "own" that miscounts legitimate group-membership visibility as a leak. FIX IS TO THE SCRIPT (make "own" group-aware: player_id==me OR active group member), not the product. No access-control defect. Mirrors verify-realtime's fixture staleness.

## Open dependencies (founder / next session)

- **Empower/UPA demo accounts not seeded on this project** (upa.verified@/upa.tennis@/donor@ can't sign in — seed-empower-upa-users.mjs never run). Blocks the Life-portal UX walks (the UPA-needs investigation). Needs SUPABASE_SERVICE_ROLE_KEY exported to run the seed.
- **Full E2E truth-lane run** needs SUPABASE_SERVICE_ROLE_KEY at run time (correctly never committed): `E2E=1 SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @atlitos/e2e test`.
- Session limit reset 7:10am IST -> resume: finish spec authoring, run Playwright + Maestro, run the sequential Chrome-extension persona walks (UPA seats first), then the missing-features backlog led by the UPA gap matrix.

## P1 — React #418 hydration mismatch on dynamic routes (ROOT-CAUSED, fix deferred to founder)

**Symptom (QA):** a hard navigation / refresh on the deployed athlete web app throws React error #418 (hydration mismatch), 100% reproducibly, on "every route except / and /clutch". The app self-heals with a client re-render, so it is a console-error + first-paint-flicker defect, not a broken screen.

**Refined reproduction (this pass).** Loaded the deployed export and a fresh local `expo export` build headlessly (Playwright chromium, light and dark, fresh contexts). The failure is NOT "every route except / and /clutch". It is precisely: **every DYNAMIC route (a segment `[id]`) throws #418; every STATIC route does not.**
- Throws: `/coaching/coach/:id`, `/clutch/post/:id`, `/clutch/creator/:id`, `/learn/drill/:id`, and the other `[id]` screens (booking/session/trainee/group-session/chat-thread/[id], onboarding `[step]`, etc).
- Clean: `/` (a pure `<Redirect>`, renders no content), `/clutch`, `/profile`, `/notifications`, `/coaching`, and the rest of the static routes.
The QA phrasing was imprecise because the two routes it happened to sample as "working" (`/` and `/clutch`) are both static; the deep links it sampled as "broken" happened to be dynamic.

**Root cause.** `app.json` sets `web.output: "static"`, so `expo export` pre-renders each route to HTML in a Node pass. A dynamic route `[id]` has no concrete param at export time, so expo-router pre-renders it ONCE with an empty/undefined param (the fallback template). On a real browser deep-link the same HTML is served, then the client hydrates with the REAL param from `useLocalSearchParams()` (e.g. `id="abc"`). The server-rendered tree (param undefined) and the client's first render (param present) diverge, and React aborts hydration with #418 before re-rendering from scratch on the client (hence the self-heal). Static routes have no param, so their server and first-client render are identical and never mismatch. This is a known expo-router `output: "static"` limitation for parameterized routes, not a bug in our screen code; the divergence is in the framework's param-less pre-render, so no per-screen data guard removes it cleanly.

**Secondary, lower-confidence observation.** On the LOCAL served build (not the deployed one) a #418 also appeared on some static routes only under emulated `prefers-color-scheme: dark`. This smells like a separate nativewind color-scheme hydration effect (server renders light, client's first paint flips the `dark` class). It did not reproduce on the deployed static routes in the same run, so it is timing/environment sensitive and should be treated as a distinct, smaller follow-up, not conflated with the dynamic-route cause above.

**Why no fix applied here.** Every correct fix is broad or changes the web architecture, so per the QA mandate (do not force a risky fix) it is left for founder review:
1. `web.output: "single"` (SPA, client-only render, no pre-render → no hydration step → #418 impossible). One line in app.json, but it removes pre-rendering for EVERY route (first-paint/SEO change), requires a Vercel catch-all rewrite to `index.html` (same shape as the admin SPA fix in commit 02f77ea), and interacts with the hand-tuned static-export font pathing documented in `src/app/_layout.tsx`. Cleanest end state, biggest blast radius.
2. Per-dynamic-screen "mounted gate": render a param-independent loading skeleton on the first paint (matching the server), then reveal param-dependent content after a mount effect. Safe conceptually but touches ~15 `[id]` screens and only helps if the divergence is entirely in our render (unverified vs expo-router's own `<Head>`/route context), so it may not fully clear #418.
3. `generateStaticParams` per dynamic route to pre-render real instances — not viable here (params are user/data driven, unbounded) and returning `[]` risks turning deep links into 404s.

Recommendation: option 1 (`output: "single"` + catch-all rewrite) as a deliberate, separately-verified change, since the app is already effectively a client-rendered SPA once hydrated and gets no value from the per-route pre-render.

## Missing-features backlog seed
See docs/qa/PHASE-A-GAP-INVENTORY.md — 39 PRD-vs-code gaps. Deepest: admin (Dashboard, Refund action, User Detail, Feature Flags, Support Tickets, Audit Log Viewer all absent), court portal (All-bookings, Ratings, Settings, payout onboarding), UPA portal (draft-save, self-service-deactivate-vs-PRD contradiction, gratitude moderation, zero testids). Prioritized backlog with S/M/L effort produced in the final report after the walks.
