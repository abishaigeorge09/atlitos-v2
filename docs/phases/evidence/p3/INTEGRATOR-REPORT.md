# Phase 3 Integrator Report

Prepared for the biased approver. Run date 2026-07-20. Baseline for every diff in
this document is `b29a4ca`, the P2 gate close.

Judged against the AMENDED P3 gate (docs/PLAN.md line 52, docs/phases/PHASE-3-STATUS.md
line 3, both amended 2026-07-20), not the original "visible Route transfer" clause.

The P2 approver rejected an integrator report that overstated completeness. Section 6
of this document is the honest not-verified list, and it is long. Read it before
reading anything else.

## 1. Build

`pnpm turbo typecheck build lint` from the repo root: **GREEN, 24/24 tasks successful.**

It was not green on first run. Three things were wrong and I fixed all three; every
fix is disclosed here because two of them touch other tracks' files.

1. **eslint was linting vendored CocoaPods sources.** The native dev build generated
   for the simulator evidence put `apps/mobile/ios/Pods` on disk, including minified
   JS inside `RazorpayStandard.xcframework`, which failed to parse. Added `ios/**` and
   `android/**` to `apps/mobile/eslint.config.js`. Integrator infrastructure, clearly
   mine.
2. **Five dead bindings** in Track C/D/E files: unused imports in
   `chat/[id].tsx`, `chat/index.tsx`, `trainings/availability.tsx`, and an unread
   `error` state plus its now empty catch binding in `trainings/earnings/transfer.tsx`.
   I checked the `error` one specifically rather than deleting on sight, because an
   unread error state can mean a swallowed failure. It does not here: the load error
   branch renders its own copy and a Retry, and the transfer failure reason renders
   through `resultMessage`. Nothing user visible changed. These are other tracks'
   files and the approver should treat them as integrator edits, not builder work.
3. **The mobile typecheck failure is NOT the false alarm recorded in `b78002e`.**
   This matters and I want it read carefully. `apps/mobile` declares
   `typescript: ~6.0.3` while every other workspace declares `^5.x`. `pnpm run
   typecheck` resolves the workspace local 6.0.3 and fails deterministically on
   `scripts/gen-tokens.ts`'s `node:fs` / `node:path` / `node:url` imports. I
   reproduced it twice with no concurrent `pnpm install` running. The reason
   `npx tsc --noEmit` "returns 0" is that `npx` resolves the hoisted root **5.9.3**
   instead, so the folklore check has been silently running a different compiler.
   I made it pass by adding `"types": ["node"]` to `apps/mobile/tsconfig.json`.

   **Advisory finding for the approver, not fixed:** the TypeScript version skew is
   real and remains. `apps/mobile` on 6.x against a 5.x monorepo is a trap that will
   keep producing "works under npx, fails under pnpm" confusion. `b78002e`'s note
   should be corrected or deleted. I did not unilaterally change a dependency major.

I also swept in a pre-existing uncommitted `apps/mobile/app.json` change I did not
author (iOS `bundleIdentifier`, Android location permissions, `expo-font` and
`expo-status-bar` plugins). It is native dev build configuration consistent with the
P3 simulator work. Flagging it because it rode in on my commit.

## 2. Supabase advisors

Project `syzzfgaudpifwvbpycyi`. Both advisor types run 2026-07-20.

### Security: 83 findings. 2 ERROR, 80 WARN, 1 INFO.

**New ERRORs introduced by migrations 0018 through 0029: ZERO. The bar is met.**

Both ERRORs are `security_definer_view`, on `public_profiles` and
`coach_profiles_public`. Both views are created in `0001_identity.sql` with an
explicit `with (security_invoker = false)` and a comment explaining that they
deliberately read past base table RLS to expose a narrow public column set. They
predate this phase. `0023_coaching_chat_advisor_fixes.sql` names both at line 29 and
records that it is deliberately not touching them. Verified by reading the migration
source, not by trusting the note.

P3 migrations did clear the advisor findings they raised themselves: `0023` exists
precisely to fix the two findings that `0021` and `0022` introduced.

### Performance: 109 findings. 90 WARN, 19 INFO. No ERRORs.

Split by whether the flagged object is a P3 table (`sessions`, `session_types`,
`coach_availability_windows`, `chat_threads`, `chat_messages`, `transfers`,
`payout_accounts`):

| Finding | Pre-existing | New from 0018-0029 |
|---|---|---|
| `auth_rls_initplan` (WARN) | 55 | 12 |
| `multiple_permissive_policies` (WARN) | 18 | 5 |
| `unindexed_foreign_keys` (INFO) | 5 | 3 |
| `unused_index` (INFO) | 7 | 3 |
| `auth_db_connections_absolute` (INFO) | 1 | 0 |

The pre-existing counts reconcile with the P2 baseline recorded in
PHASE-2-STATUS.md (`auth_rls_initplan` 56, `multiple_permissive_policies` 19), within
the drift expected from policies being re-declared this phase.

**Verdict: PASS on the stated bar (zero new ERRORs).** The 17 new WARNs and 6 new
INFOs on coaching and chat tables are the same class of debt the P2 approver accepted
against the P8 hardening gate. They are new debt, though, not zero, and I am not
going to describe them as clean.

## 3. Deployed state vs repo

**Migrations: confirmed.** `list_migrations` returns 30 entries. 0018 through 0029 are
all applied: `0018_coaching`, `0019_coaching_rls`, `0020_coach_busy_slots`,
`0021_session_state_machine`, `0022_chat`, `0023_coaching_chat_advisor_fixes`,
`session_abandon_unpaid`, `wallet_and_transactions_rpcs`,
`session_request_cancel_refund`, `session_transition_service_role_gate`,
`route_transfers`, `route_transfers_rpcs`, `realtime_courts_sessions`. The later ones
carry descriptive names rather than numeric prefixes remotely, but map one to one
onto `supabase/migrations/0024`-`0029` in the repo.

**Edge functions: confirmed.** All five required functions ACTIVE:

| Function | Version | Status | verify_jwt |
|---|---|---|---|
| `book-session` | 1 | ACTIVE | true |
| `complete-session` | 2 | ACTIVE | true |
| `cancel-session-refund` | 2 | ACTIVE | true |
| `razorpay-route-onboard` | 1 | ACTIVE | true |
| `razorpay-route-transfer` | 2 | ACTIVE | true |

`razorpay-webhook` is at **version 8, ACTIVE, `verify_jwt: false`** as required, and
its `updated_at` (1784527881359) is the newest of any function on the project,
i.e. it was redeployed after the AT-43 transfer webhook work. Correct.

## 4. Vercel previews: deliberately NOT deployed

`git diff --stat b29a4ca HEAD -- apps/portal-court apps/portal-life apps/admin` is
**empty**. No web application source changed this phase; P3 is a mobile, schema, and
edge function phase.

I checked the indirect path too rather than stopping at the source diff. All three web
apps depend on `@atlitos/types`, which did change (generated DB types plus new domain
and error types). Those changes are additive and type level, so they are erased at
runtime and cannot alter built output. None of the three depends on `@atlitos/api`,
where the new coaching and chat hooks actually live. The web apps' `typecheck` and
`build` both pass green in the run above, which is the real coverage for the types
change.

Deploying three previews to demonstrate an unchanged bundle would burn deploys and
prove nothing. Skipped, per the brief. The P2 preview URLs remain valid for web.

## 5. Mobile simulator evidence

Captured on the iPhone 17 simulator `A91EC474-AE40-49D8-BA90-CCF14ED517D7`, native
dev build `com.synthorgtech.atlitos-mobile`, Metro owning port 8081. Metro bundled
3675 modules for iOS. No Expo Go, no react-native-web, no substitutions.

Sessions were minted with `signInWithPassword` and injected into the app's
AsyncStorage backing store, per the house rule that agents do not type credentials
into a UI.

### Captured

| File | Screen | Mode |
|---|---|---|
| `guest-home-light.png` | Home, unauthenticated guest | light |
| `coach-home-light.png` / `coach-home-dark.png` | Home, signed in as `coach1@atlitos.dev` | light, dark |
| `athlete-home-light.png` / `athlete-home-dark.png` | Home, signed in as `player@atlitos.dev` | light, dark |
| `onboarding-role-select-light.png` | `(onboarding)/role-select` | light |
| `blocker-deeplink-confirm-dialog.png` | Proof of the navigation blocker below | light |
| `blocker-launch-url-arg-ignored.png` | Proof that `--url` does not navigate | light |

Dark mode resolves correctly through `packages/theme` on the screens captured.

### NOT captured, and why. This is the important part.

**Every Phase 3 mobile screen is unreached. Coverage of P3 surfaces is zero.**

The screens above are the app shell and the auth gate. They are the only routes
reachable without a tap, because they are what the app boots into. Not one of the
following was reached:

`trainings/index`, `trainings/verification`, `trainings/requests`,
`trainings/session/[id]`, `trainings/trainees`, `trainings/trainee/[id]`,
`trainings/availability`, `trainings/analytics`, `trainings/chat`,
`trainings/earnings/index`, `trainings/earnings/payout-setup`,
`trainings/earnings/transfer`, `coaching/index`, `coaching/coach/[id]`,
`coaching/book/pay`, `coaching/booking/[id]`, `coaching/bookings`, `chat/index`,
`chat/[id]`, `(onboarding)/coach-setup/[step]`.

That is AT-45 through AT-55 inclusive: all of Track C, all of Track D, and Track E.

**Cause: there is no programmatic tap, and deep linking does not work around it.**
`xcrun simctl` has no tap primitive. I tested the two escapes and both failed:

- `xcrun simctl openurl <udid> atlitos://trainings` raises an iOS SpringBoard
  confirmation, "Open in Atlitos?", which itself requires a tap. Terminating the app
  first does not suppress it. Captured as `blocker-deeplink-confirm-dialog.png`.
- `xcrun simctl launch <udid> <bundle> --url atlitos://trainings` launches the app but
  ignores the argument and lands on Home. Captured as
  `blocker-launch-url-arg-ignored.png`.

The permission fallbacks documented in `p3-simulator/README.md` are still denied on
this machine, re-tested today, not assumed:
- `screencapture` returns "could not create image from display" (Screen Recording).
- `osascript` to System Events returns -1743, "Not authorized to send Apple events"
  (Automation / Accessibility).
- `cliclick` is installed at `/opt/homebrew/bin/cliclick` and would work the moment
  either grant lands.

**I did not substitute Expo web screenshots, and I did not alter the app's initial
route to manufacture a capture.** Temporarily repointing the router would have
produced screenshots of P3 screens, but it would have changed the app under test and
could have masked a real navigation defect. That is a methodology decision for the
founder or the approver, not for me to make silently. Flagging it as the fastest
available unblock if screenshots are judged more valuable than fidelity.

**Unblock, cheapest first:** grant the terminal Screen Recording and Accessibility in
System Settings, Privacy and Security, **then restart the terminal** (a grant does not
apply to an already running process, which is the trap the last attempt hit).
`cliclick` then drives every screen unattended, for this gate and every future one.

## 6. What is NOT verified

Explicitly and completely:

1. **Every Phase 3 mobile screen, on the simulator.** Section 5. Gate clause 4 requires
   simulator evidence for every phase-touched mobile screen. **It is not met.** The
   screens exist in the repo, compile, and are included in the Expo export (visible in
   the build output), but no one has seen them render on iOS.
2. **AT-58, native Razorpay checkout.** Unverified, and doubly blocked: the checkout
   screen cannot be reached without a tap, and entering test card details is something
   agents do not do regardless. This is the phase's own stated open item. P2's payment
   went through the react-native-web wrapper, so the native checkout sheet has still
   never been exercised by anyone.
3. **The live Route transfer.** Deferred to P8 by the 2026-07-20 amendment. Nothing has
   ever been transferred; `record_transfer`'s success path has never run behind a real
   provider acceptance. No `transfer.processed` or `transfer.failed` event has ever
   been received, so Razorpay's real transfer entity field names remain unconfirmed.
   `payout_accounts.status = 'active'` has never been reached legitimately. Full
   detail in PHASE-3-STATUS.md lines 60-69; I am repeating it here so the approver does
   not have to take the deferral on faith.
4. **Journeys 2 and 3 end to end.** Gate clauses 1 and 3 describe a full walkthrough:
   browse coaches, book with a real test payment, chat, coach accepts, complete, rate
   once and have a second attempt rejected. **I did not run it.** It is a multi step
   UI flow and the tap blocker prevents it. The underlying RPCs, edge functions, and
   Realtime push were exercised by their own builder tracks (AT-59 and AT-62 have
   their own evidence in `p3-realtime/`), but the assembled user journey has not been
   observed on a device.
5. **Light and dark for P3 screens.** Only the shell screens have both modes. The
   workflows.md requirement of light and dark for every screen touched this phase is
   not met, for the same reason.

### Defect found during integration, not fixed

**The P3 coaching fixtures leave demo coaches unable to leave onboarding (AT-56).**
`coach1@atlitos.dev` and `coach2@atlitos.dev` had `public.users.city = null` and
placeholder names (`coach1`, `coach2`). The app's `needsOnboarding()` is
`me != null && !me.city`, so both demo coaches were routed to `role-select` forever
and no coach surface was reachable even in principle. `seed-coaching-fixtures.mjs`
populates `coach_profiles` but never completes the base `public.users` row.

To capture anything at all on the coach side I set `city`, `state`, and display names
for those two demo accounts by direct SQL against the remote project. **This was a
data edit to fixtures on the remote database, disclosed here, and the seed script
itself is still wrong.** It should be fixed so the next agent does not rediscover
this. No money bearing table was touched.

### Process note

`docs/phases/PHASE-3-STATUS.md`'s deliverable checkboxes are stale: AT-35 through
AT-39 and AT-45 through AT-59 are all unchecked, yet each has a corresponding feature
commit in `b29a4ca..HEAD`. Reconciling that is phase-close's duty, but the approver
should not read the unchecked boxes as work not done.

## 7. Diff summary since P2 close

**87 files changed, 14546 insertions, 650 deletions** across 46 commits.

Schema, RLS, RPC (Track A):
- AT-35 coaching schema: session types, availability windows, sessions
- AT-36 coaching RLS for sessions, session types, availability
- AT-37 `session_transition` and `rate_session` full state machine
- AT-38 `get_coach_busy_slots` slot engine read path
- AT-39 chat schema, RLS, and Realtime publication
- AT-37/AT-39 follow up: cleared the two advisor findings 0021 and 0022 raised

Payments and Route (Track B):
- AT-40 `book-session` with server re-pricing, `SLOT_TAKEN`, and one shared finalize gate
- AT-41 session completion earnings accrual, ledger write on complete
- AT-42 `razorpay-route-onboard`, surfacing the real not-entitled response as 503 rather than faking success
- AT-43 `razorpay-route-transfer` plus transfer webhook handling
- AT-44 ledger derived coach wallet and transactions RPCs
- AT-60 `cancel-session-refund`, refunds table, `settle_refund`, and `refund.processed` handling
- AT-61 money consequential session transitions restricted to service role

Mobile coach (Track C): AT-45 verification status and Trainings gating, AT-46 requests
list, AT-47 session detail lifecycle, AT-48 trainees roster and detail, AT-49
availability window editor, AT-50 earnings, payout setup and transfer, AT-51 analytics
readouts.

Mobile athlete (Track D): AT-52 coach discovery and profile with real availability,
AT-53 booking flow with BillSummary and Razorpay checkout, AT-54 session cancel,
reschedule, rate and stat tiles, AT-60 athlete cancel of an unanswered request.

Chat (Track E): AT-55 thread list and thread view, both role entry points.

Fixtures and copy (Track F): AT-56 coaching seed data (see the defect above), AT-57
house style copy pass.

Verification (Track G): AT-59 and AT-62 proved Realtime instant push and cross partner
isolation, with evidence in `p3-realtime/`. **AT-58 remains unverified.**

Types: `packages/types` regenerated for coaching, chat, and session payments;
`packages/api` gained `use-coaching`, `use-coach`, and `use-chat`.

## 8. Integrator recommendation

The backend half of this phase is in good shape: build green, zero new advisor ERRORs,
every migration and edge function deployed and matching the repo, and the Route
not-entitled path handled honestly rather than stubbed.

The mobile half is **unverified on the target platform**, which is the one thing the
founder specifically added to this phase after P2 (docs/PLAN.md, "Verification gap
noted 2026-07-19"). Gate clause 4 is not met, and clauses 1 and 3 are not demonstrated
end to end.

I am not recording a verdict; that is the approver's call. But the approver should know
that approving P3 today means approving the same class of gap that P3 was created to
close, and that a single macOS permission grant plus a terminal restart is what stands
between this report and real coverage.
