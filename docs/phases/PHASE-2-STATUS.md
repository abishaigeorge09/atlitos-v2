# Phase 2 Status: Courts Vertical Slice (Flagship Demo)

Gate (docs/PLAN.md P2): "founder books a court with a test card on deployed stack; partner sees it live; ledger correct." Epics AT-4 (Courts and Partner Portal), AT-11 (Payments and Ledger).

Last updated: 2026-07-19.

## Gate: APPROVED (cycle 3, 2026-07-19)

Cycle 1 REJECT (8 blocking findings: missing previews, missing screenshots, dark mode not first class, Auth Hook never registered, Razorpay secrets never configured, portal-court dashboard RSC crash, onboarding unimplemented, overstated integrator report) and cycle 2 REJECT (3 blocking findings: venue picker scoping, undemonstrated "partner sees it live" leg, incomplete evidence matrix) both preceded this approval. Every finding from both cycles is resolved; see History for the fix commits.

**Process note (required by the cycle-3 approver verdict):** cycle 3 exceeded the normal max-2-cycle rule in docs/agents/biased-approver.md. It proceeded under the founder's explicit pre-authorization given 2026-07-18 before he slept ("keep going through the workflow, he will test later"). His post-wake review of the cycle-3 verdict is still pending and stands as the formal sign-off on this gate.

## Root-cause fixes shipped across the fix cycles

1. **0016_fix_venue_media_rls.sql** (commit 4f497c4): venue-media partner storage policies bound `name` to `venues.name` inside the `exists` subquery instead of `objects.name`, denying every partner photo upload. Fixed by qualifying `objects.name`.
2. **0017_auth_hook_user_roles_grant.sql** (commit c5b3c63): the true root cause of the roles:[] JWT bug. Dashboard Auth Hook registration alone was not sufficient; GoTrue runs the hook as `supabase_auth_admin`, which had no grant on `user_roles`. Granted read access; freshly minted JWTs now carry correct `app_metadata.roles`.
3. **razorpay-webhook v5** (commit 53d0b66): Razorpay sends the event id in the `x-razorpay-event-id` HEADER, not the body. The function read `event.id` (undefined), violating the webhook_events not-null PK on every delivery (dozens of 500s). Fixed to read the header first.
4. **portal-court venue-scoping** (commits 55523e4, bb1b329): all 6 `from("venues")` call sites scoped explicitly to the signed-in partner (owned or accepted-staff), not left to RLS. Sites: venue-scope.tsx, dashboard/layout.tsx (FR-7 gate), onboarding/page.tsx, onboarding/review/page.tsx, onboarding/pending/page.tsx, lib/onboarding.ts. The onboarding router/review/pending/fetchLatestOnboardingVenue variant was redirect-looping every brand new partner before this fix.

## Gate evidence (verified cycle 3)

- Rs 670 real Razorpay Test Mode payment captured (order_TErBxAfmtgvszZ, pay_TErGlfbvx9ONe7) through the real consumer UI.
- Booking confirmed: court_bookings 52f95edc, Turf A, 2026-07-19 11:00-12:00, pending_payment to confirmed.
- Ledger balanced, one group (84c55e29): platform debit 670.00 = court_partner credit 660.00 (subtotal 600 + GST 60) + platform fee credit 10.00.
- Owning partner's Live Today renders the booking through the partner's own JWT (not a service-role read): "Athlete booking, Cricket, 11:00 am to 12:00 pm, Rs 670, Upcoming" with Check in/Cancel, 3 abandoned bookings correctly badged Expired.
- Earnings reconciles: Gross 670, fee -10, Net payable 660, matching the ledger group exactly.
- webhook_events holds the real payment.captured event (TErGu0RHq4IggE) after the header fix, confirming the webhook path (backup) works alongside verify-payment (the finalize path actually used).

## Advisory findings carried forward, none lost

From cycle 1:
- PRD-03 FR-21, FR-23, FR-24, FR-25, FR-27, FR-28 (bookings history, ratings, settings/staff invite, payout account link, transfer history) unimplemented, tracked as debt against PRD-03.
- `auth_rls_initplan` (56) and `multiple_permissive_policies` (19) WARNs, deferred to P8 hardening gate.
- `public_bucket_allows_listing` on venue-media bucket.
- `function_search_path_mutable` WARN on 7 pre-existing functions.
- Admin bundle over Vite's 500KB warning threshold.
- `apps/mobile` 48px button height vs 44pt tap-target sizing-token gap; recommend a `sizing` token category in packages/theme.

From cycle 2:
- No in-place resubmission RPC (resubmit_venue_verification creates a new venue plus request, not an edit-in-place).
- Photos-after-venue ordering divergence, documented in API-MAPPING.md.
- `court_booking_expire_payment` has no scheduled sweep wired (stale pending_payment bookings currently require manual expiry).
- Courts list "Finding your location..." UX on web.
- Court detail hero placeholder oversized at desktop widths (mobile-first layout, fine on phone-sized viewports).
- Jira needed retroactive AT-4/AT-11 story reconciliation before P3 planning (done at this phase-close, see Jira section).

From cycle 3:
- `venue_bookings_today` is not date-filtered despite its name (plain `court_bookings JOIN courts`, no date predicate); Live Today's correctness today relies on client-side filtering. Filter in the view or rename it before any other consumer relies on it.
- Onboarding wizard steps captured in dark only, no light counterpart.
- Realtime push at the moment of payment capture is still unproven; the booking was demonstrated as rendered state a day after capture. Verify opportunistically in P3.
- Onboarding photos, review, and pending screens remain demonstrated-by-data only, no rendered capture (PRD-03 FR-3, FR-5, FR-6).
- Hygiene: `tmp-seed-demo-users` edge function still undeleted after two cycles (founder action, CLI 403s on delete); `evidence-partner@atlitos.dev` and `p2-verify-partner@atlitos.dev` (now password-enabled) sit on a production-aliased project; rotate or document the fixture password.

## Jira

Project key `AT` (not `ATL`). AT-13 through AT-21, AT-23, AT-24 transitioned to Done at this phase-close. AT-22 (venue-media listing advisory) left in Backlog, tracked via the advisory list above. New advisory tickets cut under AT-4/AT-11, all Backlog:

- AT-25 venue_bookings_today not date-filtered (AT-4)
- AT-26 court_booking_expire_payment has no scheduled sweep (AT-4)
- AT-27 resubmit_venue_verification RPC decision (AT-4)
- AT-28 delete tmp-seed-demo-users edge function, founder action (AT-4)
- AT-29 rotate or document fixture passwords, clean up evidence-partner@atlitos.dev (AT-4)
- AT-30 onboarding photos/review/pending screens lack rendered evidence (AT-4)
- AT-31 onboarding wizard light mode captures missing (AT-4)
- AT-32 Realtime instant push verification in P3 (AT-11) — **ROOT CAUSE FOUND AND FIXED.** AT-59 diagnosed it and AT-62 fixed it. This advisory was never a verification gap in the sense it was written; it was a real, shipped defect. `public.court_bookings` was never added to the `supabase_realtime` publication, not by `0009_courts.sql` which created the table nor by anything since, so the partner Live Today board had a correct `postgres_changes` subscription pointed at a table Postgres was never told to replicate. There was no publish side. The board's socket reached SUBSCRIBED, set its `realtimeConnected` indicator true, and received nothing, forever, which is exactly why P2 could only ever demonstrate the booking as rendered state a day later. It was never a client bug or a timing flake. Three shipped copy strings in `apps/portal-court` claimed real time updates and were false for the whole of P2. `0029_realtime_courts_sessions.sql` publishes `court_bookings` and `sessions` (after an RLS review, and with `court_bookings`' missing write revoke added), and `scripts/verify-realtime.mjs` Parts 3 and 4 now prove INSERT and UPDATE push to the owning partner and zero cross-partner leakage against the live project. Evidence: `docs/phases/evidence/p3-realtime/README.md`.
- AT-33 courts list location UX on web (AT-4)
- AT-34 court detail hero oversized at desktop widths (AT-4)

## History (folded in from PHASE-2-CHECKPOINT.md, now deleted; its job ends at phase close)

### Cycle 1 (through 599a339)

Migrations 0009-0015 applied to remote (venues/courts/bookings schema, payments core, payment state machine, admin courts/bookings, venue-media bucket, court rating summary). Edge functions book-court, verify-payment, razorpay-webhook deployed but non-functional (no Razorpay secrets, Auth Hook unregistered). Mobile booking flow, portal-court pages, admin resources, BillSummary all built and typecheck/build green (24/24), but an RSC serialization crash made the partner dashboard unusable when logged in, invisible to the standard build gate. REJECT, 8 findings (see prior verdict, fully resolved, listed under Root-cause fixes and Advisory above).

### Cycle 2 (through c5df3f0)

Auth Hook root cause found and fixed (0017, supabase_auth_admin grant); Razorpay secrets configured and probed; portal-life RSC fix (6fb7072); partner onboarding built (PRD-03 FR-1 to FR-7, commit 7742079), demo reseed run through live RPCs (not service-role SQL), which surfaced and forced the 0016 storage RLS fix; dark mode shipped (next-themes, commit 2129266). Demo users created via a temporary edge function (tmp-seed-demo-users, still not deleted, founder action). Vercel: all three apps deployed and promoted to production. REJECT, 3 findings: venue picker scoping, undemonstrated "partner sees it live," incomplete evidence matrix. Approver independently confirmed all 8 cycle-1 findings resolved and that webhook_events held a real payment.captured event from Razorpay's post-fix retry.

### Cycle 3 (through 90f227f)

Founder pre-authorized proceeding past the normal 2-cycle cap before sleeping. Venue picker and onboarding queries scoped to the signed-in partner across 6 call sites (55523e4, bb1b329). Evidence matrix completed: dark signin/signup via next-themes' own persisted toggle, onboarding wizard steps via a throwaway script-created partner. Stale pending_payment bookings expired via court_booking_expire_payment. Founder completed a real Rs 670 payment through the consumer UI; because the booking's slot (2026-07-19 11:00) became today's date, it renders on the owning partner's Live Today without a second payment. Ledger, earnings, and rendered evidence all verified against the owning partner's own JWT. APPROVE.

## Environment notes (durable, for any future agent touching this stack)

- Venues RLS is permissive-OR (own venues + public-verified venues). Portal queries must scope explicitly (partner_user_id or accepted venue_staff); never rely on RLS alone to restrict what a partner-facing UI shows.
- Storage policies that join a table (e.g. venue-media checking ownership via `venues`) must qualify `objects.name` explicitly inside the subquery, or the join's own `name` column silently shadows it and denies every write.
- The access-token Auth Hook needs `supabase_auth_admin` granted on any table it reads (e.g. user_roles), separately from registering the hook itself in the dashboard.
- Razorpay puts the event id in the `x-razorpay-event-id` header, not the payload body. `verify-payment` (the client callback) is the reliable finalize path; the webhook is the backup and can lag behind real time due to retry backoff.
- Agents must never enter card details or passwords in a browser. Use script-minted sessions with cookie (`sb-<project-ref>-auth-token`, portals) or localStorage (admin, Expo web) injection built from a supabase-js `signInWithPassword` call. Recipe lived in the now-deleted checkpoint; reproduce via a Node one-liner with fixture creds when needed.
- Vercel projects in this repo have Root Directory set to `apps/<app>`. Deploy from the repo root with `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` env vars (IDs in `apps/*/.vercel/project.json`); running `vercel` inside the app dir doubles the path and fails.

## Handoff notes for Phase 3 planner

Phase 3 scope: coaching sessions engine, Realtime chat, coach earnings, Razorpay Route onboard plus transfer on completion. Gate: v1 Journeys 2 and 3 with test payments and a visible Route transfer.

- Reuse the courts payment pattern (payment_intents/ledger_entries/webhook_events, verify-payment as primary finalize, webhook as backup) for Route transfers; the header-vs-body event id gotcha applies to every Razorpay webhook, not just the courts one.
- Apply the venue-scoping lesson up front to any coach-scoped portal query; do not repeat the cycle-2/3 discovery cycle for a new domain.
- Route onboarding needs a payout_accounts-shaped flow (schema already exists from P2); the "transfer on completion" leg is new and needs its own state machine RPC per the financial invariant (no client writes to transfers).
- Verify Realtime push at the moment of payment capture opportunistically in P3; P2 never proved live push, only rendered state a day later.
- Carry forward every advisory above, especially the PRD-03 FR-21/23/24/25/27/28 debt and the scheduled-sweep gap on expiring payment holds, since coaching sessions will likely need an analogous expiry sweep.
