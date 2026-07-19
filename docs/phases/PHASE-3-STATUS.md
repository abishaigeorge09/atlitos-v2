# Phase 3 Status: Coaching + Chat + Payouts

Gate (docs/PLAN.md P3): "v1 Journeys 2+3 with test payments + visible Route transfer." Epics AT-5 (Coaching Engine), AT-11 (Payments and Ledger), AT-12 (Chat and Notifications), AT-3 (Athlete Core).

Planned 2026-07-19. Stories AT-35 through AT-59, all Backlog.

## Gate: NOT STARTED

The gate is met when all of the following are true on the deployed stack:

1. PRD-01 Journey 2 end to end: browse coaches, book a session with a real Razorpay test payment, session lands in `requested`, chat with the coach, coach accepts, session completes, athlete rates once and a second attempt is rejected.
2. PRD-02 Journey C end to end: coach earnings balance derived from `ledger_entries`, Route payout account reaches `active`, and a transfer is initiated and visibly lands as a `transfers` row plus a balancing ledger group.
3. PRD-01 Journey 3's coaching-adjacent legs hold (the commerce legs are P4; this phase owes the court booking and payments ledger portions already shipped in P2 plus the session charge appearing in the unified payments ledger).
4. Evidence captured from the iOS simulator, not Expo web, for every phase-touched mobile screen, per docs/PLAN.md "Verification gap noted 2026-07-19".
5. `pnpm turbo typecheck build lint` green, RLS advisor run, biased approver APPROVE.

## Deliverables owed, by track

### Track A: schema, RLS, RPC (opus)
- [ ] AT-35 Coaching schema migration: session_types, availability windows, sessions
- [ ] AT-36 Coaching RLS policies for sessions, session types, and availability
- [ ] AT-37 session_transition and rate_session RPCs (full state machine)
- [ ] AT-38 Slot engine read path: get_coach_busy_slots RPC
- [ ] AT-39 Chat schema, RLS, and Realtime publication

### Track B: payments and Route (opus)
- [ ] AT-40 book-session edge function with server re-pricing and SLOT_TAKEN
- [ ] AT-41 Session completion earnings accrual: ledger write on complete
- [ ] AT-42 razorpay-route-onboard edge function and payout account status sync
- [ ] AT-43 razorpay-route-transfer edge function and transfer webhook handling
- [ ] AT-44 Ledger derived coach balance RPCs: wallet and transactions

### Track C: mobile coach (sonnet)
- [ ] AT-45 Coach verification status screen and Trainings gating
- [ ] AT-46 Coach Stats dashboard and session requests accept or decline
- [ ] AT-47 Coach session detail with complete, cancel, and reschedule
- [ ] AT-48 Trainees roster list and trainee detail
- [ ] AT-49 Coach availability window editor
- [ ] AT-50 Coach earnings, payout account setup, and transfer screens
- [ ] AT-51 Coach analytics readouts with insufficient data state

### Track D: mobile athlete (sonnet)
- [ ] AT-52 Coach discovery list and coach profile with real availability
- [ ] AT-53 Athlete session booking flow with BillSummary and Razorpay checkout
- [ ] AT-54 Athlete session management: cancel, reschedule, rate, and Trainings stat tiles

### Track E: chat (sonnet)
- [ ] AT-55 Realtime chat thread list and thread screen, both role entry points

### Track F: fixtures and copy (haiku)
- [ ] AT-56 Coaching seed data and fixtures for the P3 gate
- [ ] AT-57 House style copy pass across all P3 coaching and chat screens

### Track G: verification (opus and sonnet)
- [ ] AT-58 Verify native Razorpay checkout on the iOS simulator
- [ ] AT-59 Prove Realtime instant push for chat messages and session transitions

## Dependency order

Track A first (AT-35 gates everything; AT-36 and AT-38 follow it; AT-37 needs AT-35 and AT-36; AT-39 needs AT-35). Track B next (AT-40 needs AT-35; AT-41 needs AT-37; AT-42 is independent; AT-43 needs AT-42, AT-41, AT-44). Tracks C, D, and E build on A and B in parallel. Track F runs last, seed after the RPCs exist and the copy pass after all screens land. Track G verifies at the end.

## Durable lessons carried into this phase

1. **Permissive-OR RLS is not scoping.** `sessions` is readable by both the coach and the player. Any query behind a role-specific UI must filter by owner explicitly in the query itself. This is exactly the P2 venues defect, which cost two full reject cycles; do not rediscover it in a new domain.
2. **Razorpay puts the webhook event id in the `x-razorpay-event-id` HEADER, not the body.** Reading `event.id` yields undefined and violates the `webhook_events` not-null primary key on every delivery.
3. **`verify-payment` (the client callback) is the reliable finalize path; the webhook is the backup** and can lag behind real time due to retry backoff. Both must funnel through ONE shared finalize helper so they cannot diverge.
4. **The auth hook needs `supabase_auth_admin` grants on any table it reads**, separately from registering the hook in the dashboard.
5. **Storage policies that join a table must qualify `objects.name`** inside the subquery, or the joined table's own `name` column silently shadows it and denies every write.
6. **Mobile is verified on the iOS simulator from this phase onward, not Expo web.** react-native-web silently papers over gestures, safe areas, keyboard behaviour, and native modules. The native Razorpay checkout has never been exercised; P2's payment went through the web wrapper. See docs/phases/evidence/p3-simulator/README.md for the dev build state, the Metro port 8081 contention with the concurrently running synth project, and the expo-modules-jsi Swift 6.2 patch that must be re-applied after any fresh install.
7. **Realtime instant push has never been observed** (advisory AT-32). Rendered state a day later proves persistence, not push. P3 proves it for both chat and session transitions.
8. **Agents never enter card details or passwords in a browser.** Use script-minted sessions with cookie or localStorage injection built from a `signInWithPassword` call.

## Carried-forward advisory debt that touches P3

- **Route transfers** were never built in P2; the whole Route leg (onboard plus transfer) is new here and is the riskiest surface in the phase (AT-42, AT-43).
- **Payout account link, PRD-03 FR-23, FR-24, FR-25** (court partner payout account and transfer history) remains unimplemented from P2. AT-42's `razorpay-route-onboard` serves both `owner_type` values, so the court partner side becomes reachable in this phase even though its portal screens are not in P3 scope.
- **Expiry sweep**: `court_booking_expire_payment` still has no scheduled sweep wired (AT-26). Coaching sessions create the same class of stale `pending_payment` rows via `book-session`. Deliberately not cut as a P3 story since it is operational rather than PRD-traceable, but if the gate walkthrough accumulates stale session holds, wire one sweep covering both domains rather than two.
- **Realtime verification** (AT-32) is now formally owned by AT-59.
- Everything else in PHASE-2-STATUS.md's advisory list stays open against AT-4 and the P8 hardening gate: `auth_rls_initplan` (56) and `multiple_permissive_policies` (19) WARNs, `venue_bookings_today` not date-filtered (AT-25), resubmission RPC decision (AT-27), fixture password hygiene (AT-29), missing onboarding evidence (AT-30, AT-31), the sizing-token gap for 44pt tap targets, and the admin bundle size warning.

## What the founder must do

- **Razorpay Route test-mode sub-merchant onboarding.** AT-42 and AT-43 may need his Razorpay dashboard access to enable Route on the test account and to inspect linked accounts and transfers. This is the P3 equivalent of the P0 credential hand-off and is the single most likely blocker on the gate's "visible Route transfer" clause.
- **Simulator payment testing.** AT-58 needs a real test-card payment through the native checkout sheet on the simulator. Agents do not enter card details. Either the founder performs the payment, or he grants the terminal Accessibility and Screen Recording permissions so the simulator can be driven for everything up to the card entry step.
- **Open questions from PRD-02 section 9** that P3 builds past on assumption: the coaching platform fee rate (item 1, assumed to mirror courts via a `sessions.platform_fee_flat` fee_config row), the cancel and reschedule notice window (item 3, assumed none in v1), Route transfer minimums and any transfer fee (item 5, assumed zero so the BillSummary fee row may be omitted), and the analytics insufficient-data threshold (item 6, assumed 3 completed sessions).
