# Atlitos QA Audit — running report (2026-07-27)

Full-surface QA audit. Three lanes: Playwright (apps/e2e, scripted/repeatable), SQL + verify scripts (truth), Chrome-extension walks (judgment). Status: Phase A + partial B complete; the UPA-needs seat walks (founder priority) are DONE and lead this report. Remaining Playwright spec authoring + Maestro resume next session.

## LEAD: UPA gap matrix (founder priority) — need x capability-today x promise x seat-experience

Method: three sequential Chrome-extension seat walks against the live Life portal
(atlitos-portal-life.vercel.app) plus the consumer Empower Hub (atlitos-app.vercel.app),
read against a full code inventory of apps/portal-life and PRD-05. Seeded accounts
(EmpowerDemo!2026): upa.verified@ (verified, 3 wishlist items + 1 gratitude post),
upa.tennis@ (under_review), donor@. The interview script is the founder's fixed six
questions. Verdicts: WORKS / EXISTS-BUT-LIMITED / MISSING, with live evidence.

**The core UPA seat can, today: (capability inventory)** view a read-only funding dashboard
(total raised, items funded/open counts, awaiting-thanks nudge); add a wishlist item (title +
rupee cost only); edit/remove an item while open and unfunded; view per-item funding progress +
a donor list; mark a funded item delivered; compose/soft-delete a gratitude post on a funded
item; preview the public "as-sponsor" profile; view read-only account fields; self-service
deactivate. That is the whole surface. Everything a donor-facing side (PRD-06, consumer app)
implies about money landing, impact, and ongoing relationship has no matching UPA-side capability.

### Top UPA needs, ranked by priority

| # | UPA need (seat interview) | Capability today | What PRD / donor side promises | Seat experience (live evidence) | Verdict |
|---|---|---|---|---|---|
| 1 | "Where do I see money in, and what can I use it for?" (disbursement / payout) | Per-item funding bar + donor list + one ledger-derived "Total raised" tile. No payout, no disbursement, no "funds available," no cash-out or in-kind fulfilment tracking beyond a "Mark as delivered" button. | PRD-05 §2 "track who is funding it"; donor side (Empower Hub) promises the money lands and impact is real. | **Incoherent across three surfaces.** Funded item shows "Funded 100%, ₹2,500 of ₹2,500" yet "Sponsors: 0 donations, No sponsors yet"; dashboard "Total raised ₹0.00"; consumer hub says ₹6,735 raised for the same UPA. UPA cannot tell what money exists, whose it is, or how it reaches them. | **MISSING** (existing-FR-broken: FR-16/FR-18 reconciliation + no disbursement concept at all) |
| 2 | "How do I ask for a NON-money need (gear in kind, court time, coaching)?" | None. Add-item form is title + "Cost in rupees" (> 0 required) only. | JTBD "list the specific gear I need"; a young athlete's real needs are often in-kind (a coach's hours, court slots, donated bats). | "Ground rental for three months" exists only as a ₹3,000 line. Every need must be priced in rupees; there is no in-kind, quantity, category, "needed by," or photo field. | **MISSING** (NEW-FR) |
| 3 | "How do I tell supporters what I need this month?" (campaign / update) | Add discrete priced wishlist items. | JTBD "sponsors know exactly what to fund"; the relationship is meant to feel human and current. | No campaign, no monthly update, no message-to-supporters, no narrative broadcast. The only lever is adding/editing line items; supporters are never told anything proactively. | **EXISTS-BUT-LIMITED** (NEW-FR) |
| 4 | "Update my story / profile after I am verified" | None in UI. Account shows read-only fields + "contact support to change your story." | **PRD-05 FR-26 explicitly promises self-service edit** of headline, story, sport, region after verification without a new review cycle. | Verified seat has zero edit affordance. The same page offers one-click deactivate but blocks a story edit. The two are exactly backwards vs PRD (see FR-27 below). | **MISSING** (existing-FR-broken: FR-26) |
| 5 | "What would bring me back weekly?" (engagement loop) | Realtime funding refresh + a dashboard "awaiting thanks" nudge. | Mission surface meant to make an athlete feel seen and return to check support landing. | No notifications inbox (PRD-05 §5 lists notifications read, none rendered), no sponsor messages (out of scope by design), no new-donation feed in-portal. Once the wishlist is set there is little pull to return. | **EXISTS-BUT-LIMITED** (NEW-FR) |

### Secondary UPA seat verdicts

| UPA need | Verdict | Evidence |
|---|---|---|
| "I just got verified, what can I do first?" | **WORKS** | Sign-in routes verified UPA to /home; dashboard + empty-state "Add your first wishlist item" CTA are clear. |
| "How do I post a thank-you / gratitude?" | **WORKS** (was 100% broken pre-0083) | Composer appears for funded-unposted items, one per item; published post renders body + photo + soft-delete. The 0083 RLS-recursion fix is what makes this function at all. |
| Profile preview matches donor view | **WORKS, but leaks the money incoherence** | "Viewing as a sponsor" renders story/badge/wishlist/total. But it shows the same "Total raised ₹0.00 while an item is Funded 100%" contradiction a real donor sees, and the profile photo renders broken (alt-text only). |
| Self-service deactivate (verified) | **CONTRADICTS PRD** (EM-17) | One-click "Deactivate my profile" via RPC with only a confirm dialog. PRD-05 FR-27 requires a verified UPA to contact support. Live-confirmed. |
| Draft-save across the apply wizard (FR-1) | **UNVERIFIED / likely gap** | No per-step persistence found in code; not exercised live (verified/pending seats are past the wizard). Flag for the pending-seat reapply path. |

### Three walk verdicts

- **WALK 1 — upa.verified@ (core):** Portal is a competent read-only funding tracker. Gratitude, wishlist CRUD, preview, verified onboarding all WORK. The mission-critical holes are money-in/disbursement visibility (needs #1), non-money needs (#2), and post-verification self-edit (#4). The cross-surface money contradiction is the single biggest donor-trust risk.
- **WALK 2 — upa.tennis@ (under_review):** **PASS.** Pending state is clear (roadmap Submitted-done / Under review-current / Verified-pending, status pill, nav restricted to Status + Account). Route guard holds: hard-nav to /home and /wishlist both redirect to /status, zero verified-only leak. Nothing to do while waiting (no estimated wait time per PRD §3.3; no proactive "add more evidence"). Minor: the "contact support to change your story after verification" copy shows even for this not-yet-verified user with no funded wishlist.
- **WALK 3 — donor@:** portal-life correctly routes donor@ to a graceful "You have not applied yet / Start your application" empty state (EM-19 PASS, no crash) — but portal-life has **no donor-facing surface by design** (PRD-05 §8). The real donor journey lives in the consumer Expo app: Empower Hub (apps/mobile/src/app/home/empower.tsx + EmpowerRail), UPA public profile (home/upa/[id].tsx), donate (home/donate/[id].tsx + DonationSheet), My Impact (account/impact.tsx). Live check of the hub: discovery, sport/region filters, Donate + View profile, funding bars all render. Two donor-trust defects there: (a) the same verified UPA is listed twice with different raised totals (₹0 raised vs ₹6,725 raised), and (b) the hub's ₹6,735 raised for the UPA directly contradicts portal-life's ₹0.00 for the same athlete; plus a broken/oversized profile image.

## Prioritized missing-features backlog (UPA-led)

Effort: S (< 1 day), M (1-3 days), L (> 3 days / schema + edge fn + UI). Tag: [BROKEN-FR] an existing PRD FR that does not work, vs [NEW-FR] not in PRD-05, needs a founder scope decision. Donor-trust impact: HIGH / MED / LOW.

| Pri | Item | Effort | Tag | Donor-trust |
|---|---|---|---|---|
| P0 | Reconcile money-in across dashboard "Total raised", per-item funded_amount, donor list, and consumer hub "Raised so far" to one ledger source; a funded item must never show "0 donations / ₹0 raised". Add a guard/test asserting the four agree. | M | [BROKEN-FR] FR-16/FR-18 | HIGH |
| P0 | Fix consumer Empower Hub duplicate UPA cards + divergent raised totals for one UPA; single card, single ledger figure. | S-M | [BROKEN-FR] PRD-06 | HIGH |
| P1 | UPA disbursement / "what you can use" visibility: a payout or in-kind-fulfilment view so a verified UPA sees funds landing and their state, not just "raised". | L | [NEW-FR] | HIGH |
| P1 | Non-money / in-kind need type on wishlist (gear-in-kind, court time, coaching hours) distinct from a rupee cost; quantity + "needed by" + optional photo. | L | [NEW-FR] | MED |
| P1 | Post-verification self-service profile edit (headline, story, sport, region) per FR-26; remove the "contact support" dead-end. | M | [BROKEN-FR] FR-26 | MED |
| P1 | Resolve the FR-27 contradiction: gate verified-UPA deactivate behind a support/contact step (or founder ratifies self-service and updates PRD). | S | [BROKEN-FR] FR-27 | MED |
| P2 | Supporter update / "what I need this month" channel (a short broadcast or campaign note tied to the wishlist). | M | [NEW-FR] | MED |
| P2 | Weekly-return loop: in-portal notifications inbox (schema already lists notifications), new-donation feed, gratitude prompts. | M | [NEW-FR] | LOW |
| P2 | Confirm/implement apply-wizard per-step draft-save (FR-1); verify a hard reload keeps answers. | M | [BROKEN-FR] FR-1 | LOW |
| P2 | under_review seat: show estimated wait (PRD §3.3) and suppress the "after verification, contact support" copy for not-yet-verified users. | S | [BROKEN-FR] §3.3 | LOW |
| P2 | Fix broken UPA profile photo (renders alt-text on preview + oversized block in hub). | S | polish | MED |
| P2 | Add data-testid coverage across apps/portal-life (0 today) so these become PW regressions. | M | test-infra | n/a |

Wider non-UPA backlog (39-gap PRD-vs-code inventory in PHASE-A-GAP-INVENTORY.md) below the UPA lead: admin app is the deepest hole (Dashboard, order Refund, User Detail + suspend/reinstate, Feature Flags, Support Tickets, Audit Log Viewer all absent); court portal (All-bookings, Ratings, Settings, Razorpay payout onboarding absent). These are surface-complete tickets independent of the UPA priority above.

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
