# Phase 2 Cycle-2 Checkpoint (in-flight working memory)

Per docs/agents/workflows.md crash recovery protocol. This file is the resume point for the cycle-2 fix pass against the punch list in PHASE-2-STATUS.md. Delete when phase-close folds it into PHASE-2-STATUS.md after an APPROVE.

Last updated: 2026-07-14, ~14:15 IST.

## Punch list state (order matches PHASE-2-STATUS.md)

1. **Auth Hook registration: DONE** (2026-07-13, via Chrome, confirmed enabled on syzzfgaudpifwvbpycyi).
2. **Razorpay secrets: DONE and verified** (2026-07-14). Founder set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET in Edge Functions Secrets. Webhook registered in Razorpay Test Mode: URL https://syzzfgaudpifwvbpycyi.supabase.co/functions/v1/razorpay-webhook, payment.captured + payment.failed, Enabled. Verified functionally: POST with bogus signature returns 400 "invalid signature" (proves secret loaded AND function reachable without JWT); a missing secret would return 500 "webhook not configured".
3. **portal-life RSC fix: DONE**, commit 6fb7072. Same rendered-node-not-component-ref pattern as the committed portal-court fix. Typecheck green.
4. **Partner onboarding (PRD-03 FR-1 to FR-7): DONE**, commit 7742079, typecheck/build/lint green (7/7), token check clean. Routes under apps/portal-court/src/app/onboarding/ (venue-details, courts+submit via submit_venue_verification RPC, photos 3-12 to venue-media, review, pending with rejected-reason + resubmit). FR-7 gate in dashboard/layout.tsx (unverified partners redirected to /onboarding); signup now lands on /onboarding. No new migrations. Two follow-ups recorded in API-MAPPING.md: (a) photos step runs AFTER venue creation (storage RLS needs an owned venue), a documented divergence from PRD-03 prose order; (b) resubmit creates a NEW venue+request row, no in-place resubmission RPC exists, candidate resubmit_venue_verification RPC flagged for founder. Demo reseed script scripts/seed-onboarding-demo.mjs is READY BUT NOT RUN against remote (runs entirely through live RPCs as partner@atlitos.dev / admin@atlitos.dev, idempotent; run after seed-demo-users.mjs). The integrator should run it as its first step.
5. **Dark mode: DONE**, commit 2129266. next-themes class strategy, system default, explicit choice persisted, toggle in sidebar footer beside user menu, mirrored to portal-life (identical shell). Both portals typecheck + build green.

## Remaining to reach the cycle-2 gate (in order)

1. Run scripts/seed-onboarding-demo.mjs against remote (after seed-demo-users.mjs) so demo verified-partner state exists through the real path.
2. Integrator pass: `pnpm turbo typecheck build lint` across the monorepo (must be green before anything else).
3. Deploy fresh Vercel previews for atlitos-admin, atlitos-portal-court, atlitos-portal-life (existing URLs are STALE, predate all cycle-2 work; approver explicitly rejected stale previews). Projects already linked: atlitos-admin.vercel.app, atlitos-portal-court.vercel.app, atlitos-portal-life.vercel.app.
4. Light AND dark screenshots of every P2-touched screen: venues, slots-pricing, live-today, earnings, signin, signup, plus the new onboarding screens. Dark mode must be reached via the real in-app toggle, not devtools class injection.
5. Real logged-in smoke check on the deployed previews (durable lesson from finding 6: green build does not prove auth-gated routes render).
6. End-to-end payment attempt: book a court with a Razorpay test card on the deployed stack, confirm captured payment, partner sees booking on Live Today, ledger correct. This is the literal P2 gate.
7. Spin up the biased approver (docs/agents/biased-approver.md) with the full evidence bundle. This is cycle 2 of max 2: a REJECT here escalates to the founder.
8. On APPROVE: phase-close updates PHASE-2-STATUS.md, moves AT-13 through AT-21, AT-23, AT-24 to Done, deletes this file.

## Jira (reconciled 2026-07-14, founder flag from phase-close cleared)

Cloud: synthsports.atlassian.net (cloudId 86e91c66-2964-4a92-a1aa-a9aaad1d1bc1), project AT. Workflow statuses are Backlog / Selected for Development / In Progress / Done; there is NO In Review status, so delivered-but-ungated stories sit In Progress with a "do not Done until APPROVE" note in each description.

- AT-13 inventory pages, AT-14 courts schema, AT-15 mobile booking, AT-16 Live Today, AT-17 earnings, AT-18 admin queue + fee config: retroactive for delivered P2 work, In Progress.
- AT-19 onboarding, AT-20 dark mode, AT-21 portal-life RSC fix: cycle-2 items, In Progress. AT-20 and AT-21 are code-complete (commits 2129266, 6fb7072); update their status notes when the gate closes.
- AT-22 venue-media bucket listing advisory: Backlog task.
- AT-23 payments schema, AT-24 edge functions: retroactive under AT-11, In Progress. AT-24's description records the 2026-07-14 Razorpay verification.

## Environment notes for the resuming agent

- Supabase dashboard access from this machine's Chrome ("Personal Chrome" profile) is logged into the WRONG Supabase account for atlitos (sees only the Side_Projects org). The local supabase CLI token also 403s on secrets for syzzfgaudpifwvbpycyi. Verify deployed-function config by behavior (curl probes), not by dashboard.
- Razorpay dashboard IS accessible in the Personal Chrome profile (Test Mode).
- The founder's Razorpay account is in Test Mode with account activation at 10 percent; live mode is out of scope for the P2 gate.
