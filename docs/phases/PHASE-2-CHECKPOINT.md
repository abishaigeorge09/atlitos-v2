# Phase 2 Cycle-2 Checkpoint (in-flight working memory)

Per docs/agents/workflows.md crash recovery protocol. This file is the resume point for the cycle-2 fix pass against the punch list in PHASE-2-STATUS.md. Delete when phase-close folds it into PHASE-2-STATUS.md after an APPROVE.

Last updated: 2026-07-18, mid integrator pass, during the e2e payment attempt.

## Punch list state (all 5 DONE, order matches PHASE-2-STATUS.md)

1. **Auth Hook registration: DONE, plus a deeper root-cause fix (0017).** Dashboard registration (2026-07-13) was NOT sufficient: GoTrue runs the hook as `supabase_auth_admin`, which had no grant/policy on `user_roles`, so every JWT still carried `roles: []` (finding 4's true root cause, discovered 2026-07-15 by decoding a freshly issued admin JWT). `0017_auth_hook_user_roles_grant.sql` (commit c5b3c63, applied to remote) adds the grants + policy. Verified: freshly minted JWTs for admin/partner/player all carry correct `app_metadata.roles`.
2. **Razorpay secrets: DONE and verified** (2026-07-14). Webhook registered in Test Mode at .../functions/v1/razorpay-webhook (payment.captured + payment.failed, Enabled). Probe: bogus signature returns 400 "invalid signature" = secret loaded and reachable without JWT.
3. **portal-life RSC fix: DONE**, commit 6fb7072.
4. **Partner onboarding (PRD-03 FR-1 to FR-7): DONE**, commit 7742079. Demo reseed RAN against remote 2026-07-18: 'Onboarding Demo Turf' created, photographed, and admin-approved entirely through live RPCs (submit_venue_verification + storage upload + admin_approve_verification_request), zero service-role SQL. In doing so it surfaced and forced the fix of a real storage RLS bug (see 0016 below). Follow-ups flagged in API-MAPPING.md: photos-after-venue ordering divergence; no in-place resubmission RPC (resubmit creates a new venue+request).
5. **Dark mode: DONE**, commit 2129266. Verified on the deployed portal-court: system dark default renders, in-app sidebar toggle flips to warm light. Mirrored in portal-life.

## New migrations this pass (both applied to remote AND committed)

- **0016_fix_venue_media_rls.sql** (commit 4f497c4): 0014's partner insert/update/delete policies wrote `storage.foldername(name)` inside an `exists (... venues v ...)` subquery, where `name` bound to `v.name` instead of `objects.name`, denying EVERY partner photo upload. Found by the reseed script exercising the real upload path. Policies recreated with `objects.name` qualified.
- **0017_auth_hook_user_roles_grant.sql** (commit c5b3c63): see punch item 1.
- Both documented in docs/architecture/RLS.md (commit after 4f497c4).
- Also: `@supabase/supabase-js` added as root devDependency (scripts/ could not resolve it from the repo root; both seed scripts were unrunnable as shipped).

## Demo users (created 2026-07-18)

player@ / partner@ / admin@atlitos.dev now exist on remote with correct user_roles rows (password = the fixture password in scripts/seed-demo-users.mjs). No service role key exists on this machine; creation went through a TEMPORARY edge function `tmp-seed-demo-users` (mirrors seed-demo-users.mjs, one-shot, guard token). It is now a tombstone (410) but COULD NOT be deleted (CLI 403). **Founder or anyone with dashboard access: delete function `tmp-seed-demo-users` from the atlitos project.**

## Integrator pass state (2026-07-18)

- `pnpm turbo typecheck build lint`: 24/24 green.
- Vercel: all three apps deployed fresh AND promoted to production with founder approval (preview URLs sit behind Vercel team SSO, production aliases are public). Live now, all 200:
  - https://atlitos-portal-court.vercel.app
  - https://atlitos-portal-life.vercel.app
  - https://atlitos-admin.vercel.app
  - Gotcha for future deploys: each Vercel project has Root Directory = apps/<app>, so deploy from the REPO ROOT with VERCEL_ORG_ID/VERCEL_PROJECT_ID env vars (IDs in apps/*/.vercel/project.json); running `vercel` inside the app dir doubles the path and fails.
- Logged-in smoke check on deployed portal-court: PASS (partner session via injected auth cookie, /dashboard/live-today renders, venue picker shows seeded venues, no RSC crash). Auth is COOKIE-based (@supabase/ssr), not localStorage; the admin Vite app IS localStorage-based.
- Evidence screenshots: an agent is sweeping every P2 screen light+dark into docs/phases/evidence/p2-cycle2/ (portals via real toggle, admin has no toggle).
- **E2E payment: IN FLIGHT.** book-court on the deployed stack verified working as player@: created booking + Razorpay TEST order (order_TEop7B84SjkPjF, Rs 670 = 600 + 60 GST + 10 platform fee, correct bill). Consumer app runs via Expo web locally on :8090 against the deployed backend (mobile client hosting is out of gate scope; backend is the deployed stack). Full checkout reached through the real UI (Turf A, 2026-07-19 09:00 slot, second order); Razorpay Test Mode modal renders. First card attempt FAILED: international test card 4111... is rejected in India test mode, use domestic test cards (Mastercard 5267 3181 8797 5449 / Visa 4386 2894 0766 0153). Founder is completing card entry (agents never enter card numbers). A declined-at-entry card creates no payment entity, so no webhook fires for it; webhook_events is still empty as of this writing.
- After payment succeeds, verify in order: webhook_events has payment.captured; payment_intents flipped; ledger_entries balanced group; court booking confirmed; partner Live Today shows the booking; THEN spin up the biased approver (cycle 2 of max 2) with the full evidence bundle.

## Jira (reconciled 2026-07-14)

Cloud synthsports.atlassian.net (cloudId 86e91c66-2964-4a92-a1aa-a9aaad1d1bc1), project AT. No In Review status exists; delivered-but-ungated stories sit In Progress with a "do not Done until APPROVE" note.

- AT-13..AT-18: retroactive delivered P2 work, In Progress.
- AT-19 onboarding, AT-20 dark mode, AT-21 RSC fix: code-complete (7742079, 2129266, 6fb7072), In Progress until gate.
- AT-22 venue-media listing advisory: Backlog.
- AT-23 payments schema, AT-24 edge functions: In Progress under AT-11.
- New tickets the next planner should cut: (a) delete tmp-seed-demo-users function, (b) resubmit_venue_verification RPC decision, (c) courts list "Finding your location..." UX on web, (d) court detail hero placeholder is enormous at desktop widths on web (mobile-first layout, fine on phone-sized viewports).

## Environment notes for the resuming agent

- Supabase dashboard via this machine's Chrome is on the WRONG account for atlitos (Side_Projects org only); local supabase CLI 403s on secrets and function delete. The claude.ai Supabase MCP connector DOES have full access (SQL, migrations, edge function deploys) to project syzzfgaudpifwvbpycyi; use it. Verify function config by curl probes.
- Razorpay dashboard IS in Personal Chrome (Test Mode, account activation 10 percent; live mode out of scope).
- Demo sessions for browser evidence: mint via supabase-js signInWithPassword in a Node one-liner (fixture creds), then inject: portals want the `sb-syzzfgaudpifwvbpycyi-auth-token` COOKIE (value = 'base64-' + base64url(session JSON)); admin and Expo web want the same-named localStorage key. Never type passwords into browser forms; session injection via script-minted tokens is the sanctioned pattern.
- Expo web: `npx expo start --web --port 8090` in apps/mobile, run with nohup + disown (the harness reaps plain background dev servers).
