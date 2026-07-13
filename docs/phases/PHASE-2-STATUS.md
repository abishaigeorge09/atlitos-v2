# Phase 2 Status: Courts Vertical Slice (Flagship Demo)

Gate (docs/PLAN.md P2): "founder books a court with a test card on deployed stack; partner sees it live; ledger correct." Epics AT-4 (Courts and Partner Portal), AT-11 (Payments and Ledger).

Last updated: 2026-07-13.

## Gate: BLOCKED

**Verdict: REJECT (Cycle 1 of max 2).** The biased approver rejected this gate. Per docs/agents/biased-approver.md's escalation rule this is cycle 1; a cycle 2 re-review happens after a builder track addresses the findings below. Do not mark any Jira ticket Done off this pass. No fixes were attempted by phase-close per docs/agents/workflows.md (fixes route back to builder tracks, phase-close only records and reconciles).

### Blocking findings (from the approver, verbatim intent, condensed)

1. **missing-evidence, No Vercel preview URLs for any portal.** apps/portal-court, apps/portal-life, apps/admin. Neither the integrator nor the verifier deployed previews; the P2 gate explicitly requires review "on deployed stack."
2. **missing-evidence, Light/dark screenshots exist for only one screen (Live Today).** venues, slots-pricing, earnings, signin, signup (all shipped this phase) have zero screenshot evidence in either mode.
3. **house-style, Dark mode in portal-court is not a first-class, reachable state.** DESIGN-LANGUAGE.md line 196 commits the portals to a warm-light default with a dark toggle; no `next-themes`, no system-preference wiring, no in-app toggle exists anywhere in apps/portal-court. The only dark screenshot that exists was produced by manually injecting a `.dark` class via devtools, which is not a state a real user or founder can reach.
4. **engineering-invariant, Auth Hook for JWT role claims never registered on the project.** `public.custom_access_token_hook` (schema correct since Phase 1) was never wired in Supabase Authentication -> Hooks -> Access Token claims on project `syzzfgaudpifwvbpycyi`. Verified directly: a real, confirmed walk-in booking for the partner's own venue was invisible on Live Today because no freshly issued JWT carries a `roles` claim at all. This breaks every role-gated RLS policy app-wide, not just courts, and should have been caught at the P1 identity gate.
5. **scope/functional, Razorpay secrets never configured on the deployed edge functions.** `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` are not set on `book-court`, `verify-payment`, `razorpay-webhook`. Confirmed independently by curl with a real athlete JWT and a real slot: `{"error":{"code":"INTERNAL","message":"Server misconfiguration: RAZORPAY_KEY_ID is not set."}}`. There is no path to a captured payment today, the literal first named criterion of the P2 gate.
6. **engineering-invariant, portal-court dashboard crashed (500) for every real logged in partner.** `apps/portal-court/src/app/dashboard/layout.tsx` (Server Component) passed a raw `lucide-react` component reference into `apps/portal-court/src/components/sidebar.tsx` (Client Component), which RSC cannot serialize. Invisible to `pnpm turbo typecheck build lint` because the auth-gated route is never statically rendered by `next build`. The fix exists on disk (uncommitted at review time, now committed, see History below); the identical pattern is unfixed in `apps/portal-life/src/app/dashboard/layout.tsx`.
7. **scope-underdelivery, Partner onboarding and venue verification submission (PRD-03 FR-1 through FR-7) is entirely unimplemented.** No `/onboarding` route exists anywhere in apps/portal-court. The verification agent had to seed venues/courts and mark a partner verified via direct service-role SQL because no real intake path exists. PLAN.md names "admin venue verification" as a P2 deliverable; the queue has no real submission surface feeding it.
8. **missing-evidence, Integrator report materially overstated phase completeness.** The integrator's checkpoint reads as "everything is complete" (24/24 green, all migrations/functions live); the verification report directly contradicts basic facts (demo data absent on remote before manual seeding, no demo users existed, the gate's own acceptance flow never attempted end to end). A gate cannot pass on a report contradicted by direct inspection.

### Advisory findings (non-blocking, must not be lost)

- Bookings history, Ratings, Settings/staff invite, payout account link, transfer history screens unimplemented (PRD-03 FR-21, FR-23, FR-24, FR-25, FR-27, FR-28). Not in PLAN.md's P2 headline scope, so non-blocking, but must be tracked as open debt against PRD-03.
- `auth_rls_initplan` (56) and `multiple_permissive_policies` (19) WARN findings persist from Phase 1 patterns, now larger surface with courts/payments tables added. Zero new ERRORs. Correctly deferred to the P8 hardening gate per PLAN.md.
- `public_bucket_allows_listing` on the new `venue-media` bucket (same accepted pattern as `avatars` in Phase 1). New listing surface this phase; worth a single follow-up ticket, not blocking.
- Working tree was left dirty by the verification agent's real bug fix (finding 6 above). Fix is correct and correctly scoped; now committed by phase-close, see History.

### Punch list to reach APPROVE (max 5, ordered by blast radius, from the approver)

1. Register `public.custom_access_token_hook` as the project's Auth Hook (Authentication -> Hooks -> Access Token claims) on `syzzfgaudpifwvbpycyi`. Highest blast radius: breaks every role-gated RLS policy in the app, not just courts.
2. Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` as edge function secrets on the same project. Literal first-named criterion of the P2 gate; nothing downstream can be verified until this lands.
3. Commit the RSC serialization fix in `apps/portal-court/src/{app/dashboard/layout.tsx,components/sidebar.tsx}` (done by phase-close, see History) and apply the identical fix to `apps/portal-life/src/app/dashboard/layout.tsx` before that portal is ever exercised.
4. Build the partner onboarding and venue verification submission flow (`/onboarding/*`, PRD-03 FR-1 through FR-7) so the "verified partner" demo state is real product behavior, not a hand-seeded SQL row, and reseed demo data through that real path.
5. Wire a real dark mode toggle in portal-court per DESIGN-LANGUAGE.md, then produce Vercel preview URLs and light and dark screenshots for every screen touched this phase (venues, slots-pricing, live-today, earnings, signin, signup) for the next review cycle.

## What did land this phase (not gated, informational)

Despite the REJECT, substantial real work landed and is committed to `main`. Recording it here so the next builder track picks up from an accurate baseline, not from scratch.

### Schema (remote, project syzzfgaudpifwvbpycyi, migrations 0009 through 0015, all applied and confirmed via `list_migrations`)

- `0009_courts.sql`: venues, venue_photos, venue_staff, courts, court_availability_windows, court_blackouts (gist overlap-exclusion), court_pricing_rules, court_bookings (partial unique slot guard), `venue_bookings_today` view, RPCs (`submit_venue_verification`, `accept_venue_staff_invite`, `get_court_busy_slots`, `get_court_available_slots`, `court_booking_check_in`, `court_booking_transition`, `rate_court_booking`), full RLS, wires the venue branch of the Phase 1 admin verification RPCs.
- `0010_payments_core.sql`: payment_intents, ledger_entries (insert-only, deferred balanced-group constraint trigger), payout_accounts, transfers, webhook_events, fee_config (seeded: courts.platform_fee_flat=10.00, courts.gst_percent=0.10, sessions.platform_fee_flat=10.00), RLS.
- `0011_courts_payment_state.sql` + `0012_courts_payment_state_rpcs.sql`: `pending_payment`/`expired` enum values (split across 2 migrations, Postgres same-transaction enum restriction), widened slot-release unique index, `court_booking_confirm_payment`/`court_booking_expire_payment` (service_role only).
- `0013_admin_courts_bookings.sql`: admin/moderator read-only `court_bookings` policy, `admin_update_fee_config` RPC (audit-logged).
- `0014_venue_media_bucket.sql`: `venue-media` public storage bucket, partner-scoped write policies.
- `0015_court_rating_summary.sql`: `get_court_rating_summary` aggregate RPC.

### Edge functions (remote, ACTIVE, confirmed via `list_edge_functions`)

- `book-court` (verify_jwt=true), `verify-payment` (verify_jwt=true), `razorpay-webhook` (verify_jwt=false, own signature check). All deployed and reachable; blocked from doing anything useful by finding 5 above (Razorpay secrets not set).

### Application code (committed, `5def08c` plus fix-up commits)

- Mobile courts booking flow: browse, court detail, slot pick + pay, bookings list, booking detail, native/web Razorpay checkout wrapper.
- Partner portal (portal-court): venues, slots-pricing, live-today (Realtime ops board with check-in/cancel/walk-in), earnings pages; shared `BillSummary` money component used throughout per CLAUDE.md's financial invariant.
- Admin (Refine): venue verification queue wiring, read-only bookings support view, fee config editor.
- `packages/api`: `useCourts` fully implemented, replacing its Phase 1 stub.
- `packages/types`: database types regenerated post-migration; enums/domain/transitions/errors extended for courts/payments.
- Seed/demo data: `supabase/seed/seed_p2.sql`, `scripts/seed-demo-users.mjs`.
- Docs updated in the same change per CLAUDE.md docs-update-duty: `docs/architecture/{API-MAPPING,PAYMENTS,SCHEMA}.md`, `docs/design/DESIGN-LANGUAGE.md`.

### Build/typecheck/lint

`pnpm turbo typecheck build lint`: 24/24 green across all 10 packages, verified after the type regeneration and 3 downstream fixes it required (see History). Note finding 6: green here does not mean the app works when logged in, an auth-gated route crash was invisible to this gate.

### Security/performance advisors (get_advisors, run after 0009-0015 and all 3 functions live)

Zero new ERROR-level findings introduced by 0009-0015, both domains. Security: 2 ERRORs total, both pre-existing Phase 1 `security_definer_view` debt (intentional, documented). Performance: 0 ERRORs; WARN/INFO growth is the expected `auth_rls_initplan` / `multiple_permissive_policies` / `unused_index` pattern extending onto the new courts/payments tables, tracked as advisory debt above, not blocking.

## History (folded in from docs/phases/PHASE-2-CHECKPOINT.md, now deleted; its job was done once this status doc absorbed it)

The integrator ran this phase as a resumable, checkpointed pass rather than one end-of-phase commit, per the new practice documented in docs/agents/workflows.md's "Crash recovery / checkpoint protocol" section (added this phase-close). Commit trail, in order:

1. `8676963` through `8ebe3bd`: migrations 0009 through 0015 applied to remote one at a time, each its own commit.
2. `54e6565`, `a022955`, `792e0e6`: `book-court`, `verify-payment`, `razorpay-webhook` edge functions deployed to remote, each its own commit; `792e0e6` notes Razorpay secrets are not settable via the Supabase MCP tool surface available to that agent (no `secrets set` tool exposed), flagged explicitly so a red runtime test would not be misread as a failed deploy.
3. `5def08c`: full Phase 2 builder tree (mobile courts flow, portal-court dashboard pages, admin resources, `BillSummary`, edge functions, seed data) committed together, since none of it had been committed before this integration pass. Includes 4 fixes required to turn `pnpm turbo typecheck build lint` green: regenerated `packages/types/src/db/database.types.ts` against the live schema; deleted `apps/portal-court/src/lib/supabase/courts-database.types.ts` (a scaffold file whose own header called for deletion at this point) and repointed its 7 call sites at `@atlitos/types`; changed two `transitionBooking`/`rateBooking` optional-arg call sites from `?? null` to `?? undefined` to match the regenerated RPC arg types; typed `live-today/page.tsx`'s `venue_bookings_today` view query with an explicit `.returns<BookingRow[]>()` non-null shape.
4. `c7ce21f`: checkpoint note recording the 24/24 green build result.
5. `43d09f4`: checkpoint note recording the security/performance advisor run, zero new errors.
6. `60402cf`: checkpoint note recording the integrator's diff summary for the biased approver (92 files changed, 12239 insertions, 737 deletions, P1 gate close `85946d5` through this pass).

After the checkpoint commits, a verification agent hand-tested the running apps and found the RSC serialization crash (finding 6) and the missing Auth Hook / Razorpay secrets (findings 4, 5), fixing only the RSC crash on disk (left uncommitted at review time; committed by this phase-close pass, see below) and leaving the Auth Hook and secrets as findings rather than attempting an out-of-scope infra fix.

## Jira

Project key is `AT` (not `ATL`; the site's actual key, noted here so the next agent does not waste a search on the wrong key). Only two epics touch this phase's scope: `AT-4` (Courts and Partner Portal) and `AT-11` (Payments and Ledger), both still in **Backlog** status with **zero child stories** under either. No stories were ever cut for this phase's work (the planner step in docs/agents/workflows.md was not run, or its output was not filed to Jira). Because the gate is REJECT, no Jira transitions were made this pass regardless. **Flagging to the founder**: a phase this large shipped with no Jira story-level tracking at all; the next planner should cut AT-4/AT-11 stories retroactively against the FRs actually delivered (see "What did land this phase" above) before continuing, or the board will never reflect reality.

## Known debt, non-blocking (carried plus new this phase)

- Everything under "Advisory findings" above.
- Phase 1's `auth_rls_initplan`/`multiple_permissive_policies` pre-existing debt, now larger surface (courts/payments tables added), still correctly deferred to P8 per PLAN.md.
- `function_search_path_mutable` WARN on 7 pre-existing functions (unchanged this phase).
- Admin bundle size over Vite's 500KB warning threshold (unchanged this phase, Phase 1 debt).
- `apps/mobile` 48px button height / 44pt tap target sizing-token gap (unchanged this phase, Phase 1 debt, still recommend a `sizing` token category in `packages/theme`).

## Handoff notes for Phase 3 planner (and for whichever track picks up the P2 fix cycle first)

- **This phase does not close until a cycle-2 re-review returns APPROVE.** Do not start Phase 3 planning against this doc as if Courts were done; the punch list above is the actual next work, routed to a builder track, not to a fresh phase.
- **What is real and usable as a foundation regardless of gate status**: courts/payments schema (0009-0015) is live, correct, and RLS'd; the 3 edge functions are deployed and structurally correct, only missing secrets; the mobile booking flow, portal-court dashboard pages, and admin resources are built and typecheck/build green. This is genuine progress, just not yet verified end to end on the deployed stack, which is the actual gate.
- **The single highest-leverage fix is the Auth Hook registration** (punch list item 1). It is a one-time dashboard action, not code, and it silently breaks role-gated RLS everywhere in the app, including in Phase 1 surfaces already marked done. Whoever has Supabase dashboard access should do this immediately, independent of the rest of the punch list.
- **Do not trust "24/24 green" as evidence an authenticated route works.** Finding 6 is a durable lesson: `next build` never statically renders an auth-gated dashboard route, so a Server-to-Client Component serialization crash on that route is invisible to the standard gate. Recommend the integrator add a real logged-in smoke check (Chrome automation or equivalent) to its standard checklist before declaring build green sufficient, for every future phase, not just this one.
- **Onboarding (PRD-03 FR-1 through FR-7) has to exist before Phase 3 assumes a partner-facing verification flow is a solved pattern.** It was hand-seeded via SQL this phase, which is fine for demo data but is not the flow itself.
- **Vercel preview deploys have now been outstanding across two phases** (Phase 1's handoff flagged the same gap). Recommend Phase 3's integrator treat "preview URL live" as a blocking pre-check before ever handing off to the biased approver, not an optional nice-to-have.
- **Jira has no story-level history for this phase.** See Jira section above. Retroactive ticket-cutting against delivered FRs is needed before Phase 3's planner can rely on the board.
