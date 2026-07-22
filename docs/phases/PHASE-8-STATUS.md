# Phase 8 Status: Search + Notifications + Hardening

The LAST autonomous build phase. After the P8 gate come the ship stages P9 (native verification) and P10 (TestFlight), which genuinely need the founder.

PLAN.md P8 line (the contract): "Search + Notifications + Hardening: ai-search, push, states pass, RLS/advisor audit, 5-journey regression, perf, docs freeze. GATE: full sign-off, then the ship stages."

Epics touched: AT-1 (Foundation/Infra, the hardening home), AT-3 (Athlete/search), AT-12 (Chat+Notifications), AT-5 (Coaching, AT-88), AT-8 (Empower, donor-name), AT-11 (Payments, carried money-ops).

Planner date: 2026-07-22. Tickets AT-140..AT-153.

## Scope, each item traced to source

1. **ai-search** (API-MAPPING.md `search` lane, PLAN.md edge functions). The v1 heuristic ported verbatim behind the `POST /search` contract: keyword to entityTypes, weighted distance/price/rating score. LLM re-rank is a drop-in swap inside the one function. Autonomous. `AT-144` (fn), `AT-145` (mobile surface).
2. **Notifications / push** (API-MAPPING.md `notify-dispatch`; consumed as a given across PRD-01/02/04/07). The `notifications`, `notification_prefs`, `push_tokens` tables already exist (`0002_notifications.sql`). P8 builds: the `notify-dispatch` edge-function fan-out that every RPC/edge function writing a `notifications` row calls, the notification ROW writes wired into the sources that owe them (e.g. PRD-04 FR-10 verification decisions, deferred at architecture time until `notify-dispatch` exists), and the in-app notification surface (list, unread badge, mark-read, deep links) plus the prefs screen. All web-verifiable. **Device push delivery (APNs/FCM) needs native credentials and is carried to P9. Do not fake device push**; the dispatch function stubs the device leg behind a clean seam. `AT-146` (fn + row-writing), `AT-147` (in-app surface + prefs).
3. **States pass** (PLAN.md hardening). Read-only correctness audit of EVERY state machine: sessions, court_bookings, orders, clips, upa_applications, upa_wishlist_items, xp. Check INVALID_TRANSITION coverage completeness and that NO status/transition field is client-writable. Findings doc; fix any client-writable status leak found. `AT-143`.
4. **RLS / advisor audit + burn-down** (PLAN.md; accumulated since P1). Live advisor baseline (2026-07-22, `syzzfgaudpifwvbpycyi`): perf 143 WARN / 41 INFO, security 3 ERROR / 148 WARN / 4 INFO. Fix the genuinely fixable WARNs without changing security semantics; sign off the by-design ones in RLS.md. `AT-140`, `AT-141`, `AT-142`. See the burn-down table below.
5. **5-journey regression** (PLAN.md; the gate proof). Drive J1..J5 end to end against the live stack, scripted-real, AFTER all P8 changes land. THE most important deliverable. `AT-153`.
6. **perf** (PLAN.md). Proportionate pass: admin bundle-size warning, unindexed_foreign_keys (26) where load-bearing, unused_index (14) review, obvious N+1s. Not a rewrite. `AT-151`.
7. **docs freeze** (PLAN.md). Reconcile SCHEMA/RLS/PAYMENTS/API-MAPPING/VIDEO to shipped reality; feeds the P9/P10 handoff. `AT-152`.

Carried-debt burn-down (money-surface + ops): `AT-148` (AT-88 refund, deferred twice), `AT-149` (show_donor_name), `AT-150` (AT-25/26/73 + TS skew verifications).

## Gate definition

The gate is "full sign-off". Given the three founder-blocked items below CANNOT be self-served, the gate passes, mirroring the P3 Route-deferral precedent (founder-approved gate amendment, 2026-07-20), on:

- **G1** All 7 P8 scope items delivered and integrator-green (`pnpm turbo typecheck build lint`).
- **G2** The advisor burn-down landed: `auth_rls_initplan` and `multiple_permissive_policies` and `function_search_path_mutable` WARNs materially reduced by migration, with the residual by-design ERRORs/WARNs explicitly dispositioned and signed off in RLS.md (not merely inherited). Semantics unchanged: every touched permissive-OR table re-proven non-vacuously (two ids asserted to DIFFER first).
- **G3** The states pass produced findings and no client-writable status field exists on any money-bearing or state-bearing row.
- **G4** The 5-journey regression (`AT-153`) is GREEN end to end on the live stack after all P8 changes: the "does the whole product still work" proof.
- **G5** Docs frozen; P9/P10 can start cold from this doc.
- **G6** The three founder-blocked items are listed as explicit pre-ship (P9/P10) conditions, not silently dropped.

The biased approver runs on the integrator diff + regression evidence + light/dark screenshots + a fresh advisor run. APPROVE/REJECT, max 2 fix cycles then founder escalation.

## Founder-blocked items (gate amendment, P3 precedent)

P8 CANNOT self-serve these. The gate passes on autonomous hardening + green 5-journey regression + advisor burn-down; these become explicit pre-ship conditions carried to P9/P10. The docs-freeze sign-off must NOT claim green on them.

1. **Enable Razorpay Route** (the live transfer/payout split, deferred since P3). The ledger is already correct and derivable, so this is config-not-rebuild. Carry to when-Route-is-on (before any real money moves).
2. **Delete `tmp-seed-demo-users`** edge function (still ACTIVE and JWT-callable; needs dashboard access).
3. **Ratify the platform fee rate + the PRD-02 / PRD-05 resolved-by-assumption decisions** (coaching fee rate, cancel/reschedule notice window, transfer minimums/fee, analytics threshold; the six PRD-05 + six PRD-06 assumptions incl. `show_donor_name` default and direction).

## Deliverables checklist

- [ ] `AT-140` initplan subselect wrap + function_search_path fix migration (opus)
- [ ] `AT-141` multiple_permissive_policies collapse migration (opus)
- [ ] `AT-142` advisor disposition + RLS.md sign-off (opus)
- [ ] `AT-143` states pass audit, findings + any client-writable leak fix (opus)
- [ ] `AT-144` ai-search edge function, v1 heuristic behind contract (sonnet)
- [ ] `AT-145` search surface, mobile discovery (sonnet)
- [x] `AT-146` notify-dispatch fan-out + notification row-writing wired into sources (sonnet). Built `supabase/functions/notify-dispatch` + shared orchestration `_shared/notify.ts` (deployed, ACTIVE, service-role-only); device push STUBBED behind `deliverToDevice()` TODO(P9). Migration `0066_verification_decision_notification` wires the deferred FR-9/FR-10 verification-decision notification into `admin_approve/reject_verification_request`. Owner-scoping + no-forge proven non-vacuously (two distinct ids, own_visible 1 / others_visible 0, cross-user mark-read 0 rows, authenticated insert rejected).
- [x] `AT-147` in-app notification surface + prefs screen, mobile (sonnet). `packages/api/src/use-notifications.ts` (owner-scoped list/unreadCount/markRead/markAllRead/listPrefs/setPref/subscribe), routes `apps/mobile/src/app/notifications/{index,preferences}.tsx`, reached from the Home AppBar bell (badge wired via `unreadCount`). NEW mobile routes `/notifications` and `/notifications/preferences`.
- [x] `AT-148` AT-88 refund surfaced to cancelled-session athlete, PRD-02 FR-35 (sonnet) DONE (Track E). Shared `readRefundSummary` (payer-scoped, no money write); real FR-35 refund `rfnd_TFhrCu5zWLRuzd` shown with a status-keyed heading.
- [x] `AT-149` show_donor_name finalize-time snapshot + read path, PRD-05 FR-17 (opus, money-path) DONE (Track E). Migration `0067_donation_donor_name_snapshot` adds `donations.donor_display_name`, snapshotted in `record_donation_from_draft` iff opted-in; portal reads the snapshot. Amounts/ledger untouched.
- [x] `AT-150` carried verifications: AT-25 date filter, AT-26 sweep coverage, AT-73 late-capture, TS skew (sonnet) DONE (Track E, see disposition below). TS skew fixed (mobile pinned `~5.9.3`).
- [ ] `AT-151` perf pass: admin bundle, FK indexes, N+1s (sonnet)
- [ ] `AT-152` docs freeze: SCHEMA/RLS/PAYMENTS/API-MAPPING/VIDEO reconcile + P9/P10 handoff (sonnet)
- [ ] `AT-153` 5-journey regression, the gate proof (opus)

## Work breakdown, parallel builder tracks with model tiers

**Track A, RLS + advisor burn-down (opus).** `AT-140`, `AT-141`, `AT-142`. Money/RLS-sensitive. `AT-140` and `AT-141` are migrations; `AT-141` (permissive-collapse) is the highest-risk because it rewrites policy sets, so it re-proves every touched permissive-OR table non-vacuously (ids asserted to DIFFER first, per CLAUDE.md). `AT-142` is the disposition doc.

**Track B, states pass (opus).** `AT-143`. Read-only correctness audit; fixes only a client-writable status leak if found.

**Track C, search (sonnet).** `AT-144`, `AT-145`. Contract already specified in API-MAPPING.md.

**Track D, notifications (sonnet).** `AT-146`, `AT-147`. Device push stubbed behind a seam, carried to P9.

**Track E, carried debt (mixed).** `AT-148` (sonnet), `AT-149` (opus, money-path snapshot), `AT-150` (sonnet).

**Track F, perf (sonnet).** `AT-151`.

**Track G, docs freeze (sonnet).** `AT-152`. Runs late, after other tracks land.

**Track V, verification, the 5-journey regression (opus). THE gate.** `AT-153`. Runs LAST, after every other P8 ticket is merged to main. Drives all 5 core journeys scripted-real against live `syzzfgaudpifwvbpycyi`, proving the product still works after the RLS/policy migrations and the states-pass changes:
- **J1** athlete books a court + pays (Razorpay test card, ledger balanced).
- **J2** athlete books coaching, coach accepts + completes, athlete rates, coach earnings accrue.
- **J3** commerce browse to cart to checkout to pay to order, admin advances lifecycle.
- **J4** Clutch upload to moderate to published to feed playback + takedown.
- **J5** Empower donate + roundup allocation, and Learn XP-from-real-activity.
Each journey re-run AFTER the `AT-140`/`AT-141` policy migrations to prove no read broke and no isolation regressed; ids asserted to DIFFER in every isolation check. Light + dark web evidence under `docs/phases/evidence/p8-web/`; note native-only slivers as owed to P9, do not fake them.

## Dependency order

1. `AT-143` states audit and `AT-140`/`AT-141` migrations land first (they change the substrate the regression runs against).
2. `AT-144`/`AT-146` (server) before `AT-145`/`AT-147` (their UI).
3. `AT-142` disposition after `AT-140`/`AT-141` (documents the residual).
4. `AT-148`/`AT-149`/`AT-150`/`AT-151` in parallel.
5. `AT-152` docs freeze after all feature/migration tracks.
6. `AT-153` regression LAST, after everything is on main.

## Carried-debt inventory: burn down vs re-defer

Assembled from every PHASE-N-STATUS open-defects section. Live advisor counts from `syzzfgaudpifwvbpycyi`, 2026-07-22.

### FIX in P8 (genuinely fixable, no semantic change)

| Item | Count | Fix | Ticket |
|---|---|---|---|
| `auth_rls_initplan` (re-eval of `auth.*()` per row) | 100 WARN | wrap `auth.uid()`/`auth.role()` in `(select ...)` scalar subselect | AT-140 |
| `function_search_path_mutable` | 14 WARN | `SET search_path = ''` / explicit schema on each function | AT-140 |
| `multiple_permissive_policies` (permissive-OR overlap) | 43 WARN | collapse redundant policies per (role, action) preserving the exact access set, re-prove non-vacuously | AT-141 |
| `unindexed_foreign_keys` | 26 INFO | add FK indexes where load-bearing | AT-151 |
| `unused_index` | 14 INFO | review, drop the safe ones | AT-151 |
| AT-88 refund not surfaced (PRD-02 FR-35), **deferred twice** | 1 | render reversing-leg / refund amount via BillSummary | AT-148 |
| show_donor_name unwired (PRD-05 FR-17) | 1 | finalize-time donor-name snapshot on donation row + read path | AT-149 |
| AT-25 venue_bookings_today date filter | 1 | verify today-scoping correct | AT-150 |
| AT-26 sweep coverage | 1 | confirm covers courts+sessions+commerce | AT-150 |
| AT-73 late-capture auto-refund branch never run e2e | 1 | drive it once | AT-150 |
| TS version skew apps/mobile ~6.0.3 vs ^5.x | 1 | align compiler | AT-150 |
| admin bundle-size warning | 1 | proportionate trim | AT-151 |

### Track E carried-debt disposition (AT-148, AT-149, AT-150), landed on `p8/track-e-debt`

- **AT-148 (AT-88, PRD-02 FR-35 / PRD-04 FR-24), FIXED.** Read-only surfacing of the refund a cancelled session or order is owed. New `readRefundSummary` (shared, `packages/api/src/refunds.ts`) reads `refunds` (payer-scoped RLS, no money write), exposed as `getSessionRefund`/`getOrderRefund`; the athlete cancelled-session detail (`coaching/booking/[id].tsx`) and the shopper order detail (`shop/order/[id]/index.tsx`) now render a refund card with the real amount and a status-keyed heading so a `pending` refund never reads as done. Proven against the live FR-35 refund `rfnd_TFhrCu5zWLRuzd` (session `43c52265`, 1000.00, processed). No refund money logic touched.
- **AT-149 (PRD-05 FR-17), FIXED (money-path, surgical).** Migration `0067` adds `donations.donor_display_name` and updates `record_donation_from_draft` (finalize's atomic state half) to snapshot `users.name` when `users.show_donor_name` was true at donation time, else null, in the same transaction as the insert. `portal-life` funding detail reads the snapshot, never the live `users` row (address-snapshot discipline). Snapshot lives in the RPC, not a second edge-function write, so `finalize-donation-payment` needed no code change and its ledger/amount logic is untouched. Verified live (rolled-back txn): opted-in snapshots the name, opted-out snapshots null; clients still cannot write `donations` (only `donations_select_merged` SELECT policy exists, any write is `42501`).
- **AT-150 items:**
  - **AT-25 venue_bookings_today, VERIFIED CORRECT, no change.** The view is a convenience join (not itself date-scoped, the name is a mild misnomer), but its only consumer, `portal-court` live-today, applies `.eq("date", today)` explicitly. Advisory for future consumers: this view is NOT self-filtered; any new read must add the date filter.
  - **AT-26 sweep coverage, VERIFIED COMPLETE, no change.** `expire_stale_holds` covers every domain that HOLDS something: courts (`pending_payment`), sessions (`requested` with a stale `created` intent), commerce (`release_expired_stock_reservations`). The one domain added since P4, donations, reserves nothing before capture (`donate` inserts only a `payment_intents` + `donation_drafts` row and never pre-increments `funded_amount`), so it has no hold to sweep and is correctly excluded. An abandoned donation leaves only an inert `created` intent + draft.
  - **AT-73 late-capture refund branch, EXERCISED at the DB e2e (the part that was never run), refund leg reuses verified AT-60 machinery.** Proven live in rolled-back txns: a late capture whose reservation was swept to `released` with stock gone (stock 0) makes `consume_reservation` raise `OUT_OF_STOCK` (`1 of 1 lines could not be decremented`), which `place_order_from_draft` propagates and `finalize-order-payment.ts` catches (line 130) to call `refundUnfulfillableCapture`; the complementary late-but-available case (`released` reservation, stock 3) consumes late (stock 3 to 2, reservation `consumed`) with no refund. The refund leg itself is AT-60's `refunds` + `settle_refund`, already verified. The full real-Razorpay path stays unreachable by construction: it needs a capture arriving more than the 15 minute TTL after a checkout whose stock sold out in between, which test mode cannot force.
  - **TS version skew, FIXED.** `apps/mobile` declared `typescript ~6.0.3` while every other workspace uses `^5.x`, resolving two compilers. Pinned to `~5.9.3` (expo SDK 57 baseline, matches the root-resolved 5.9.3). One compiler across the repo; `pnpm turbo typecheck` green.

### KEEP by design, dispositioned + signed off in RLS.md (NOT fixed)

| Item | Count | Why kept |
|---|---|---|
| `security_definer_view` ERROR: `public_profiles`, `coach_profiles_public`, `product_variant_availability` | 3 ERROR | by design (RLS.md); definer views expose a deliberate column surface / read reservation data no client may read. Fixing would oversell or leak. |
| `authenticated_security_definer_function_executable` | 55 WARN | the RPC state-machine gate pattern is deliberately SECURITY DEFINER; grants tightened in 0005/0051. |
| `anon_security_definer_function_executable` | 13 WARN | same pattern; anon-callable subset audited. |
| `auth_allow_anonymous_sign_ins` | 61 WARN | guest auth path is a product requirement (PLAN.md guest mode). |

### FOUNDER / config (flag, cannot self-serve)

| Item | Count | Action |
|---|---|---|
| `auth_leaked_password_protection` disabled | 1 | dashboard toggle, cheap win, flag to founder |
| `public_bucket_allows_listing` | 4 WARN | avatars public by design; audit which buckets in AT-142, tighten listing if safe else document |
| Razorpay Route not enabled | - | founder dashboard action, pre-ship |
| `tmp-seed-demo-users` deletion | - | founder dashboard action |
| PRD-02/05/06 assumptions unratified | - | founder decision |

### RE-DEFER to P9 (native), noted not dropped

- AT-64 `Alert.alert` inert on react-native-web (10 money-consequential call sites) and its `ConfirmSheet` replacements: verify natively in P9. States pass (AT-143) notes it.
- Dark-mode mobile-web gap (real routes do not follow OS dark): P9. Note in states pass.
- Native Razorpay checkout FAILURE path (dismiss vs decline) unverified: P9.
- Native screen coverage across all prior phases (camera, gallery picker, react-native-video autoplay, haptics, keyboard offsets, splash, phone-width): P9.
- Device push delivery (APNs/FCM): P9 (P8 builds row-writing + in-app only).
- PRD-01 follow-graph list browse not built; no guest local persistence: unbuilt scope, note.
- Cross-domain XP hook (session/court/donation/clip): leave as designed-in `xp_source='other'` hook; no P8 source wires it.

## Handoff notes for P9 / P10 (write so they start cold from here)

**The definitive start-cold checklist for both ship stages is `docs/phases/SHIP-HANDOFF.md`** (AT-152 docs freeze): the full P9 native-debt inventory, the P10 TestFlight sequence, and the three founder pre-ship actions in one place. The notes below remain as the phase-local summary.

- **P9 native verification pass** burns the RE-DEFER list above: run the app on iOS sim/device, verify every money-consequential confirm, the native Razorpay sheet (success AND failure), camera + gallery, react-native-video autoplay, haptics, device push delivery through `notify-dispatch`'s stubbed seam. Needs the founder's device time + the ClaudeCode.app accessibility/screen-recording grant.
- **P10 TestFlight ship** needs the founder's Apple Developer account ($99/yr, 24 to 48h to activate). Start enrollment early; it is the critical-path external dependency.

## Mechanical mandates (held clean since P3, keep enforcing)

- Every builder ticket runs `git merge main --no-edit` as step 0 inside its worktree (stale base misses prior migrations/types/edge functions).
- Any ticket adding a mobile route regenerates `.expo/types/router.d.ts` via a brief `expo start --web` before typecheck (turbo typecheck does not regenerate it).
- CLAUDE.md house rules: tokens only, JetBrains Mono tabular numerics, lucide icons only, no emoji, no hyphen/em-dash in copy, BillSummary on every money surface, no client money/status writes, permissive-OR owner-scoping with ids asserted to DIFFER in isolation tests.
