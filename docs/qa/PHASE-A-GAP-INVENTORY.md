# QA Audit — Phase A gap inventory (PRD-vs-code, from surface readers 2026-07-27)

Seed for the missing-features backlog. Each is a PRD feature not found in code, or a code/PRD contradiction. Confirmed in later phases before it becomes a backlog item.


## A1: Athlete app (apps/mobile, RN+Expo, web build atlitos-app.vercel.app) — auth/onboarding, Clutch social feed, follows, chat, profile social tabs

- PRD-01 FR-47/open-question-7 leaves follow list browsability unspecified for v1; code implements a full Following/Followers list UI beyond the stated PRD floor -- flag for founder confirmation this is intended scope, not drift.
- No explicit 'takedown-visibility' UI test artifact (Maestro/Playwright) found under .maestro/ or elsewhere for FR-45's rejected-clip-invisible-to-others rule; only inferable from data-lane filtering in code comments, not exercised by an existing scripted test.
- No standalone 'group creation' or 'leave group chat' UI found under (tabs)/chat -- group threads appear to be created elsewhere (Trainings/coaching flows per join-group edge function) and only viewed/messaged here; confirm this is intentional (chat does not own group lifecycle) not a missing feature.
- PRD-01 FR-13 unread notification indicator: no dedicated unread-count-in-chat-thread-list assertion point found beyond the general Notifications bell; chat-specific unread-per-thread badge not clearly located in ChatThreadList.tsx (needs direct file read to confirm presence).

## A2: Athlete app MONEY + core-journey (courts, coaching, groups, shop, empower/donate, trainings module, learn)

- PRD-02 FR-17: coach-proposed reschedule with SLOT_TAKEN conflict handling on an accepted session -- reschedule appears only bundled with cancel on booking detail screens; verify a distinct coach-initiated reschedule entry point exists
- PRD-01 FR-16: broaden-suggestion copy on empty AI search result sets -- ai-search edge-fn exists but the specific empty-state copy requirement was not directly verified against search-domains.yaml
- PRD-01 FR-49 drill redo affordance -- explicitly flagged as an open/unresolved question in the PRD itself, not a hard code gap
- MIN_AMOUNT donation floor (PRD-01 FR-54) -- flagged as an open question in PRD.md; verify packages/types has a resolved constant or if it remains unset

## apps/portal-court (Court Partner Portal, PRD-03)

- PRD-03 3.5 'All bookings' (/bookings) search/filter history table, no route or component exists (FR-21 unimplemented)
- PRD-03 3.6 '/earnings/payout-account' Razorpay Route onboarding link/status page, no route exists; earnings page only shows a static Linked/Not linked label with no CTA to link (FR-23, FR-24 partially unimplemented, no launch-to-Razorpay-hosted-pages action)
- PRD-03 3.6 '/earnings/transfers' dedicated transfer history page, folded into /dashboard/earnings as a table section instead of its own route; acceptable substitute but route naming diverges from PRD
- PRD-03 3.7 Ratings (/ratings) screen, no route or component exists (FR-27 unimplemented); court_ratings read path not found anywhere in portal-court/src
- PRD-03 3.8 Settings (/settings): partner profile, staff access invite UI, notification preferences, logout, no dedicated settings route; only a UserMenu component exists (likely just logout), no staff-invite UI found (FR-28 unimplemented client side, though nav-items.ts comment says 'Real screens land in P2/P6')
- PRD-03 onboarding wizard step 'Bank and payout details' during onboarding (section 3.1) not found as a distinct step file (only venue-details, photos, courts, review, pending exist)
- Staff-restricted role enforcement (FR-28's 'staff sees only Today, forbidden state on direct URL attempt to Inventory/Earnings/Settings') has no visible client or layout-level check scoped to a staff role flag; dashboard/layout.tsx only gates on verified-venue-or-any-staff-membership, not on restricting staff to Today-only, flagging as an acceptance-criteria gap for the Staff access journey
- nav-items.ts code comment literally states 'Court partner portal stub nav, per PRD-03... these routes are EmptyState placeholders for now' despite Live Today, Venues, Slots and Pricing, and Earnings all being fully implemented (non-stub), stale/misleading comment, not a functional gap, but worth a docs cleanup ticket

## apps/portal-life (Atlitos Life / UPA + Empower portal, atlitos-portal-life.vercel.app, PRD-05 UPA Life + PRD-06 Sponsor read-only slices)

- PRD-05 FR-1 'save a draft after each step without losing progress on reload': apply-wizard.tsx shows RPC calls only at final submit/resubmit/reapply; no per-step draft persistence (localStorage or DB write) found in the code read - verify whether draft actually survives a hard reload, likely a gap.
- PRD-05 FR-6 'cannot submit a second application while submitted/under_review/verified': apply/page.tsx mode logic only explicitly checks status in ['rejected','deactivated'] for reapply mode; confirm the guard actually blocks verified/submitted/under_review users from reaching /apply at all.
- PRD-05 FR-27 contradiction: PRD text requires verified UPAs to contact support to deactivate; account-view.tsx implements full self-service deactivate via RPC with only a confirm dialog, no support-contact step. Flag for founder as PRD-vs-code deviation.
- Wishlist item 'delivered' status: PRD FR-14 says transitions are server-side reacting to 'donation and fulfillment events' only; funding-detail.tsx exposes a direct UPA-clickable 'mark delivered' button (via RPC) when status=funded. Confirm this is an intended UPA action or scope creep beyond the PRD-05 FR list.
- PRD-05 open question 3 (sponsor name visibility opt-in, FR-17): confirm donor_display_name has an actual UI toggle in the consumer app; portal-life only reads it read-only.
- PRD-05 open question 5 (gratitude moderation queue): gratitude-view.tsx shows immediate publish, no visible moderation_queue insert in the read code path - possible gap vs the open question, or founder may have already resolved it as immediate-publish.
- No data-testid/testId attributes anywhere in apps/portal-life/src (0 hits across the whole app) - fully untestable by stable selector without adding testids or relying on text/role selectors.
- PRD-06 donor-facing flows (Empower Hub discovery, donate, checkout roundup, My Impact) are entirely absent from apps/portal-life by design (PRD-05 section 8 explicitly excludes them); they live in the consumer Expo app. Do not flag as missing-from-portal-life; route the donor@ walk to the correct app in the gap matrix.

## apps/admin (atlitos-admin, Refine.dev SPA, PRD-04) - admin@ persona

- PRD-04 FR-4..FR-6 Dashboard Overview (KPI tiles + recent audit_log activity feed) is entirely absent from routes/resources/nav
- PRD-04 FR-24, FR-25 Order refund action (full or partial, via edge function + ledger_entries, with BillSummary confirmation) is entirely absent; Order Detail only has advance-status, no refund button, no admin-order-refund edge function call anywhere in apps/admin
- PRD-04 FR-35..FR-38 User Detail screen (roles, verification status, activity summary, suspend/reinstate with required reason) is entirely absent; /users is a read-only list only, no show route, no suspend/reinstate RPC call anywhere
- PRD-04 FR-42..FR-44 Feature Flag List (toggle, create) is entirely absent from routes/resources/nav
- PRD-04 FR-45..FR-48 Support Ticket List/Detail (resolve with note) is entirely absent from routes/resources/nav
- PRD-04 FR-52..FR-54 Audit Log Viewer (searchable/filterable read-only log with before/after diff) is entirely absent from routes/resources/nav, despite every mutation path claiming to write audit_log rows server side
- PRD-04 3.2/6 dashboard KPI for 'GMV this week' and pending counts has no UI to verify against; only inferable via direct SQL

## A6 — Backend (Supabase migrations, packages/api, edge functions)

- No verify-*-rls script currently covers empower/upa tables (upa_applications, upa_evidence, donations, gratitude_posts) for donor vs upa.verified vs admin scoping — 0049_empower_rls.sql exists but no dedicated verify script beyond verify-empower-p6.mjs (functional, not RLS-matrix)
- No script asserts ledger_entries owner-scoping across all three ledger_account_type branches (coach, court_partner via venues join, admin) in one place; logic lives split across 0010's policy comments only
- No verify script for group chat isolation (chat_thread_members/chat_threads/chat_messages group-member policies added in 0078) — 0022's chat verify scripts predate groups
- No probe for coach_trainee_notes/coach_trainee_videos owner+player dual-access (0082, 0078) in any verify-*.mjs
- fee_config (using true, admin-editable reference) has no verify script confirming authenticated cannot write it, only that it's readable
- notify-dispatch's service-role-only invariant (no client Authorization path) is asserted nowhere in scripts/
- No script confirms razorpay-webhook signature verification actually rejects a forged signature (webhook auth expectation untested)
- verify-realtime.mjs covers court_bookings/sessions; no equivalent realtime probe exists for chat_messages message delivery + RLS-per-subscriber (only insert/select policy exists, not a subscription isolation test)

## Scaffold-found (live) defect

- athlete-web (atlitos-app.vercel.app): six @expo-google-fonts TTFs (Inter 400/500/600/700, JetBrainsMono 500/600) 404 on the deployed Expo web build. Harness proven end to end: E2E=1 pnpm --filter @atlitos/e2e test:smoke ran setup + all 4 surface projects. Results: setup, admin, portal-court, portal-life PASS; athlete-web FAILS on a REAL finding (console guard): six @expo-google-fonts TTFs 404 on https://atlitos-app.vercel.app (Inter 400/500/600/

---
Total PRD-vs-code gap seeds: 39. Surfaces with the deepest gaps: admin (whole Dashboard, Refund action, User Detail, Feature Flags, Support Tickets, Audit Log Viewer all absent) and portal-court (All-bookings, Ratings, Settings, payout onboarding absent, nav literally stubbed). UPA/portal-life: draft-save, self-service-deactivate-vs-PRD contradiction, gratitude moderation, zero testids.
