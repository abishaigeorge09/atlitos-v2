# Phase 3 Status: Coaching + Chat + Payouts

Gate (docs/PLAN.md P3, AMENDED 2026-07-20): "v1 Journeys 2+3 with test payments, and Route transfer proven as far as the account permits." Epics AT-5 (Coaching Engine), AT-11 (Payments and Ledger), AT-12 (Chat and Notifications), AT-3 (Athlete Core).

**Why clause 2 changed.** Razorpay Route is not enabled on the test merchant account; the live API returns 400 "Route feature not enabled for the merchant". Enabling it needs account activation work the founder is not doing yet, and live transfers are required for production regardless, so the live transfer is DEFERRED to P8 hardening rather than blocking the six remaining phases. This is a deferral with a named home, not a quiet drop: no real money may move until it runs.

Planned 2026-07-19. Stories AT-35 through AT-64 (five were added mid-phase by verification findings: AT-60 the FR-19 cancel and refund, AT-61 the transition bypass, AT-62 the Realtime publication gap, AT-63 the coach discovery RLS defect, AT-64 the Alert.alert no-op).

## Gate: APPROVED cycle 2 (2026-07-20)

Rejected cycle 1, approved cycle 2 on the same day, no escalation. What the
approver actually verified, so P4 does not have to re-derive it:

- **Session 99384050** (`99384050-a82c-461a-a930-e08a3e934936`) rated against a
  captured payment intent, coach side and athlete side agreeing.
- **Ledger group 3ef7ac3f balanced**: 1000 platform debit, 990 coach credit,
  10 platform fee credit. Sums to zero, fee carved out of the coach's price as
  SCHEMA.md specifies, not added on top.
- **Session 43c52265** (`43c52265-2fa8-493a-8807-6db2e36a7ec9`) refunded.
  `refunds` row `rfnd_TFhrCu5zWLRuzd`, status processed, amount 1000.00,
  attempts 1, reversing ledger group f627e3fd. One refund, one reversal, no
  duplicate on the webhook.
- **Six ledger groups total, all balanced, one per entity, no double accrual.**
  The idempotency guard on complete and on refund both held.
- **Coach wallet 990.00 agrees across three independent readings**: the raw
  `ledger_entries` rows, `get_coach_wallet_balance()` called under the coach's
  own JWT, and the rendered earnings screen. The number the coach sees is the
  number the ledger holds.

The gate clauses, all met on the deployed stack:

1. PRD-01 Journey 2 end to end: browse coaches, book a session with a real Razorpay test payment, session lands in `requested`, chat with the coach, coach accepts, session completes, athlete rates once and a second attempt is rejected.
2. PRD-02 Journey C, as far as the account permits (amended 2026-07-20): coach earnings balance derived from `ledger_entries` and correct; the Route onboarding and transfer functions built, deployed, and shown to handle the real API's not-entitled response honestly rather than faking success; the transfer path's ledger and `transfers` writes exercised in a rolled back transaction so the maths is proven without live money. DEFERRED TO P8: payout account reaching `active` and a live transfer landing. Tracked as a P8 hardening item; must run before any real money moves.
3. PRD-01 Journey 3's coaching-adjacent legs hold (the commerce legs are P4; this phase owes the court booking and payments ledger portions already shipped in P2 plus the session charge appearing in the unified payments ledger).
4. Mobile verification, AMENDED 2026-07-20 (founder decision). The original clause required simulator evidence for every phase-touched mobile screen. That was written the day the emulator gap was found, before anyone had measured how much of this app is actually platform-divergent. It has since been measured: **two `Platform.OS` branches in the entire codebase**, both keyboard offsets in chat, and one properly isolated `.web.ts`/`.native.ts` split for checkout behind a shared contract. Everything else, every screen, hook, query, state machine and money calculation, is one shared implementation that Expo web exercises genuinely.

   So the bar is now: shared logic verified on Expo web (docs/phases/evidence/p3-web/), the platform-divergent surface enumerated rather than assumed (docs/phases/evidence/p3-web/NATIVE-RISK-REGISTER.md), and the highest-risk divergent item verified natively. That last item was the native Razorpay checkout, 41 lines that had never executed while every payment in the project's history went through the different web implementation. It is now verified end to end on the simulator, webhook included (docs/phases/evidence/p3-native/).

   DEFERRED TO P8: native screen-level coverage, and the remaining register items (haptics across 19 files, image picker, location, splash, phone-width layout, iOS keyboard offsets). Also still open and named: the native checkout's FAILURE path, which maps both a dismissed sheet and a genuine payment failure to a cancellation, so a declined card may tell a user they cancelled.

   This is a bar re-drawn on measured evidence, not a bar lowered because it was inconvenient. The blocker that motivated the original clause, an unexecuted native payment path, is retired.
5. `pnpm turbo typecheck build lint` green, RLS advisor run, biased approver APPROVE.

## Deliverables owed, by track

### Track A: schema, RLS, RPC (opus)
- [x] AT-35 Coaching schema migration: session_types, availability windows, sessions
- [x] AT-36 Coaching RLS policies for sessions, session types, and availability
- [x] AT-37 session_transition and rate_session RPCs (full state machine)
- [x] AT-38 Slot engine read path: get_coach_busy_slots RPC
- [x] AT-39 Chat schema, RLS, and Realtime publication

### Track B: payments and Route (opus)
- [x] AT-40 book-session edge function with server re-pricing and SLOT_TAKEN
- [x] AT-41 Session completion earnings accrual: ledger write on complete
- [x] AT-42 razorpay-route-onboard edge function and payout account status sync
- [x] AT-43 razorpay-route-transfer edge function and transfer webhook handling
- [x] AT-44 Ledger derived coach balance RPCs: wallet and transactions

### Track C: mobile coach (sonnet)
- [x] AT-45 Coach verification status screen and Trainings gating
- [x] AT-46 Coach Stats dashboard and session requests accept or decline
- [x] AT-47 Coach session detail with complete, cancel, and reschedule
- [x] AT-48 Trainees roster list and trainee detail
- [x] AT-49 Coach availability window editor
- [x] AT-50 Coach earnings, payout account setup, and transfer screens
- [x] AT-51 Coach analytics readouts with insufficient data state

### Track D: mobile athlete (sonnet)
- [x] AT-52 Coach discovery list and coach profile with real availability
- [x] AT-53 Athlete session booking flow with BillSummary and Razorpay checkout
- [x] AT-54 Athlete session management: cancel, reschedule, rate, and Trainings stat tiles

### Track E: chat (sonnet)
- [x] AT-55 Realtime chat thread list and thread screen, both role entry points

### Track F: fixtures and copy (haiku)
- [x] AT-56 Coaching seed data and fixtures for the P3 gate
- [x] AT-57 House style copy pass across all P3 coaching and chat screens

### Track G: verification (opus and sonnet)
- [x] AT-58 Verify native Razorpay checkout on the iOS simulator — native checkout VERIFIED end to end (docs/phases/evidence/p3-native/). Screen-level native coverage deferred to P8; the checkout FAILURE path is still unverified, see the deferral section.
- [x] AT-59 Prove Realtime instant push for chat messages and session transitions

### Track H: added mid-phase by verification findings (opus)
- [x] AT-60 Athlete cancels an unanswered session request, with automatic full refund
- [x] AT-61 Close the money-consequential transition bypass in session_transition
- [x] AT-62 Add court_bookings and sessions to the Realtime publication (root cause of AT-32)
- [x] AT-63 Coach discovery RLS defect: coach_profiles had no non-owner select policy
- [ ] AT-64 Alert.alert is a no-op on react-native-web. NOT DONE, deferred to P8, see the open defects section. Left open on the board deliberately.

## Deferred to P8: the live Route transfer (gate clause 2)

AT-43 is built, deployed, and verified as far as the merchant account permits. What remains unproven, precisely, so P8 does not have to re-derive it:

- **Nothing has ever been transferred.** `record_transfer`'s success path has never run behind a real provider acceptance. Every assertion about it comes from rolled back transactions against the remote database, not from money moving.
- **No `transfer.processed` or `transfer.failed` event has ever been received from Razorpay.** Their handlers and the RPCs behind them were exercised directly and are idempotent, but the wire format has never been observed. Razorpay's real transfer entity field names are unconfirmed, specifically which spelling of the failure reason it sends (`failure_reason` or `error_description`, both read defensively) and whether `recipient` carries the linked account id in the shape `resolveTransferRow` matches on.
- **The `payout_accounts.status = 'active'` state has never been reached legitimately.** AT-42's onboarding create path still cannot run, so `active` has only ever existed as a probe fixture that was removed.
- **Two distinct not-entitled responses are now known** and both classify as `ROUTE_UNAVAILABLE` 503. `POST /v2/accounts` says "Route feature not enabled for the merchant"; `POST /v1/transfers` says "The requested URL was not found on the server." because the endpoint is not routed at all on a non-Route merchant. Details and the classifier's scoping rule are in PAYMENTS.md.

P8 owes: enable Route on the merchant account, onboard a coach to `active`, run one real transfer end to end, and confirm the two webhook events against real deliveries. No real money may move before that runs.

## Dependency order

Track A first (AT-35 gates everything; AT-36 and AT-38 follow it; AT-37 needs AT-35 and AT-36; AT-39 needs AT-35). Track B next (AT-40 needs AT-35; AT-41 needs AT-37; AT-42 is independent; AT-43 needs AT-42, AT-41, AT-44). Tracks C, D, and E build on A and B in parallel. Track F runs last, seed after the RPCs exist and the copy pass after all screens land. Track G verifies at the end.

## Durable lessons carried into this phase

1. **Permissive-OR RLS is not scoping.** `sessions` is readable by both the coach and the player. Any query behind a role-specific UI must filter by owner explicitly in the query itself. This is exactly the P2 venues defect, which cost two full reject cycles; do not rediscover it in a new domain.
2. **Razorpay puts the webhook event id in the `x-razorpay-event-id` HEADER, not the body.** Reading `event.id` yields undefined and violates the `webhook_events` not-null primary key on every delivery.
3. **`verify-payment` (the client callback) is the reliable finalize path; the webhook is the backup** and can lag behind real time due to retry backoff. Both must funnel through ONE shared finalize helper so they cannot diverge.
4. **The auth hook needs `supabase_auth_admin` grants on any table it reads**, separately from registering the hook in the dashboard.
5. **Storage policies that join a table must qualify `objects.name`** inside the subquery, or the joined table's own `name` column silently shadows it and denies every write.
6. **Mobile is verified on the iOS simulator from this phase onward, not Expo web.** react-native-web silently papers over gestures, safe areas, keyboard behaviour, and native modules. The native Razorpay checkout has never been exercised; P2's payment went through the web wrapper. See docs/phases/evidence/p3-simulator/README.md for the dev build state, the Metro port 8081 contention with the concurrently running synth project, and the expo-modules-jsi Swift 6.2 patch that must be re-applied after any fresh install.
7. **A provider can refuse the same way in two different wordings.** Razorpay signals "Route is not enabled" as a business error on `/v2/accounts` but as a bare "requested URL was not found" on `/v1/transfers`, because the endpoint is not routed at all for a non-Route merchant. AT-43's first deployed version misclassified the second as a generic 502. Probe the exact endpoint you will call, with the real credentials, before trusting an error classifier written against a sibling endpoint.
8. **The local `supabase` CLI account cannot link this project** (`supabase link` returns "your account does not have the necessary privileges"), so edge functions are deployed through the Supabase MCP `deploy_edge_function` with the file set supplied inline. Deploy with the entrypoint at `<function-name>/index.ts` and shared modules at `_shared/*.ts` so the repo's `../_shared/...` imports resolve unchanged; a flat bundle forces rewritten import paths and silently diverges the deployed source from the repo.
9. **Realtime instant push has never been observed** (advisory AT-32). Rendered state a day later proves persistence, not push. P3 proves it for both chat and session transitions.
8. **Agents never enter card details or passwords in a browser.** Use script-minted sessions with cookie or localStorage injection built from a `signInWithPassword` call.

## Open defects raised in P3, with deferral homes

These were found during P3 verification and must not live only in an evidence
README. The next phase's agents read this file, not those.

- **AT-64: `Alert.alert` is inert on react-native-web**, so every
  confirm-before-destructive-action is a no-op there. Ten call sites across
  three files, and every one guards a money-consequential action (cancel a
  session, cancel a booking, initiate a transfer). Found by P3 web verification
  when the athlete cancel button issued zero network requests. It is expected
  to work natively and is UNVERIFIED there, because native screen coverage is
  blocked. So this path is currently unproven on BOTH platforms. Home: P8, or
  sooner if web becomes a supported target. This is also the flaw in P3's own
  clause 4 amendment, which counted only `Platform.OS` branches and
  `.web`/`.native` splits and missed the category of RN APIs that silently
  no-op under react-native-web.
- **Native Razorpay checkout failure path unverified.** The wrapper maps both a
  user-dismissed sheet and a genuine payment failure to
  `RazorpayCheckoutCancelledError`, assuming the library rejects with
  `{ code, description }`. Only the SUCCESS path has ever run. If the
  assumption is wrong, a declined card tells the user they cancelled. Home: P8,
  or the next time the simulator is driven; settling it costs two taps
  (dismiss a sheet, then fail a payment) and the harness already printed raw
  thrown objects so the shapes can be compared.
- **TypeScript version skew**: `apps/mobile` declares `~6.0.3` against a `^5.x`
  monorepo, so `pnpm run typecheck` and a bare `npx tsc` resolve different
  compilers and disagree. Papered over with `types: ["node"]` in 8b114c6; the
  skew itself is untouched. Home: P8.
- **`tmp-seed-demo-users` is still ACTIVE and JWT-callable** on the project, a
  temporary seeding function left deployed since P2. Needs dashboard access to
  delete. Founder action.
- **Real app screens do not follow the system dark preference on web.**
  `apps/mobile/src/theme/use-theme-colors.ts` resolves nativewind's
  `useColorScheme()`. On a fresh hard load of any real route on Expo web, the
  screen renders light even when the OS reports `prefers-color-scheme: dark`,
  while `dev/gallery`'s own toggle resolves the same system signal as dark
  correctly. So the system-follow path is broken for real routes and works only
  in the dev-only gallery. DESIGN-LANGUAGE.md says dark is first class, not an
  inverted afterthought; today it silently is not, on web. Either an
  initial-render/hydration mismatch sticking to a light default, or two
  different resolution paths. Not chased in P3 because the ask was to produce
  dark evidence, not to fix theme resolution. Home: P8, alongside the other
  theming and native-surface debt. Found in
  docs/phases/evidence/p3-web-cycle2/README.md.

### New advisories from cycle 2

- **Nested Pressables in the coach request preview.**
  `apps/mobile/src/app/(tabs)/trainings/index.tsx:240` renders `SessionCard`
  with `variant="request"`, which puts the card's Accept and Decline pressables
  inside the card's own pressable. React DOM raises a nesting error on web, and
  natively the hit resolution between outer card tap and inner action tap is
  ambiguous rather than merely noisy. Both actions are money-consequential
  (accept holds a slot against a captured payment, decline is on the refund
  path), so an ambiguous tap is not cosmetic. Home: P8, or sooner if a coach
  track reopens this screen.
- **The cancelled session detail screen does not surface the refund to the
  athlete who is owed it** (PRD-02 FR-35). The screen shows the cancellation
  state and generic refund status copy but no refund amount and no distinct
  processed-refund line, so an athlete owed 1000.00 has no in-app confirmation
  that the money is coming back. The data exists: the `refunds` row and the
  reversing ledger group are both written and were verified this cycle. This is
  a rendering gap, not a money gap. Pre-existing, not introduced by cycle 2.
  Home: P4 Commerce, since P4 touches the same athlete-facing money surfaces and
  BillSummary anyway; escalate to P8 if P4 cannot absorb it.
- **Stale `requested` sessions hold slots against unpaid `created` intents.**
  Live instances on the project right now: sessions `4a64c535` and `4ee5bca9`.
  An athlete who abandons the checkout sheet leaves a `requested` session
  occupying a coach's slot with no captured payment, and nothing sweeps it. This
  is the AT-26 expiry sweep debt, which was scoped to courts and now
  demonstrably covers sessions too. Do not build a second sweep; widen AT-26 to
  cover both domains. Home: AT-26. Note for P4: commerce orders will make this
  three domains, see the handoff notes.

## Carried-forward advisory debt that touches P3

- **Route transfers** were never built in P2; the whole Route leg (onboard plus transfer) is new here and is the riskiest surface in the phase (AT-42, AT-43).
- **Payout account link, PRD-03 FR-23, FR-24, FR-25** (court partner payout account and transfer history) remains unimplemented from P2. AT-42's `razorpay-route-onboard` serves both `owner_type` values, so the court partner side becomes reachable in this phase even though its portal screens are not in P3 scope.
- **Expiry sweep**: `court_booking_expire_payment` still has no scheduled sweep wired (AT-26). Coaching sessions create the same class of stale `pending_payment` rows via `book-session`. Deliberately not cut as a P3 story since it is operational rather than PRD-traceable, but if the gate walkthrough accumulates stale session holds, wire one sweep covering both domains rather than two.
- **Realtime verification** (AT-32) is now formally owned by AT-59.
- Everything else in PHASE-2-STATUS.md's advisory list stays open against AT-4 and the P8 hardening gate: `auth_rls_initplan` (56) and `multiple_permissive_policies` (19) WARNs, `venue_bookings_today` not date-filtered (AT-25), resubmission RPC decision (AT-27), fixture password hygiene (AT-29), missing onboarding evidence (AT-30, AT-31), the sizing-token gap for 44pt tap targets, and the admin bundle size warning.

## Track B handoff notes (AT-40, AT-41, AT-44 done)

1. **Coaches complete sessions through `complete-session`, not `session_transition(id, 'complete')`.** Track C's AT-47 is bound by this. The RPC is still granted to `authenticated`, so calling it directly completes the session and silently skips the coach's earnings accrual. `complete-session` carries a repair path (an already completed, unaccrued session gets its accrual written on a later call) but that is a safety net, not the contract.
2. **Sessions price differently from courts.** The platform fee is carved out of the coach's price, so `sessions.total = sessions.price` and the athlete sees no separate fee row. Courts remain additive with subtotal, GST, and fee rows (PRD-01 FR-31). Track D's BillSummary for AT-53 must not invent a session fee row. SCHEMA.md records the reasoning.
3. **One shared capture gate.** `_shared/finalize-payment.ts` owns the idempotency UPDATE and dispatches by `payment_intents.domain`; `razorpay-webhook` and `verify-payment` call only it. Adding commerce or donations means one branch plus one `finalize-<domain>-payment.ts`, never a second gate.
4. **AT-43 should reuse `get_coach_wallet_balance()`** for its server side balance re-check rather than reimplementing the sum, so the number the coach was shown and the number the transfer validates against cannot differ.
5. **Sessions inherit the courts expiry sweep gap.** `book-session` releases its own slot when Razorpay fails, via `session_abandon_unpaid`, but an athlete who abandons the checkout sheet still leaves a `requested` session holding a slot with no captured payment. Same class of debt as AT-26; one sweep covering both domains is still the right fix.

## What the founder must do

- **Razorpay Route test-mode sub-merchant onboarding. CONFIRMED BLOCKED, and now the only thing standing between AT-42 and a working payout account.** Verified against the live `rzp_test` credentials during AT-42: `POST https://api.razorpay.com/v2/accounts` returns HTTP 400 `{"error":{"code":"BAD_REQUEST_ERROR","description":"Route feature not enabled for the merchant","source":"business","step":"linked_account_create"}}`. Route must be enabled on the test merchant account in the Razorpay dashboard (Settings, then request the Route product) before any linked account can be created. `razorpay-route-onboard` is built, deployed, and correct; it surfaces this as `503 ROUTE_UNAVAILABLE` with the upstream description passed through, and it was deliberately not stubbed to fake success. AT-43 (transfers) inherits the same blocker, and the gate's "visible Route transfer" clause cannot be met until this is done.
- **Simulator payment testing.** AT-58 needs a real test-card payment through the native checkout sheet on the simulator. Agents do not enter card details. Either the founder performs the payment, or he grants the terminal Accessibility and Screen Recording permissions so the simulator can be driven for everything up to the card entry step.
- **Four open questions from PRD-02 section 9. P3 shipped on assumptions, and
  the assumptions are now live in the product and in real ledger rows.** Each
  one below is a decision the founder still owes; until then the stated
  assumption is what athletes and coaches actually experience. Correcting any of
  them is a config or migration change, not a rebuild, but the first two change
  money already accrued.

  1. **Coaching platform fee rate** (section 9 item 1). ASSUMED: mirrors courts,
     via a `sessions.platform_fee_flat` row in `fee_config`. Live consequence:
     the verified ledger group carved 10 off a 1000 session, so the coach
     received 990. If the real rate is a percentage rather than a flat amount,
     or a different number, every accrual written from here forward is wrong
     until the `fee_config` row is corrected.
  2. **Cancel and reschedule notice window** (item 3). ASSUMED: none in v1. Live
     consequence: an athlete can cancel a `requested` session at any time and
     receive a full automatic refund, including minutes before the slot. A coach
     can hold a slot and lose it with no notice protection.
  3. **Route transfer minimums and any transfer fee** (item 5). ASSUMED: zero,
     so the transfer BillSummary omits a fee row entirely. Unexercised so far
     because Route is not enabled; if Razorpay charges per transfer or enforces a
     minimum, the transfer screen understates the cost and the fee row has to be
     added back before any real payout.
  4. **Analytics insufficient-data threshold** (item 6). ASSUMED: 3 completed
     sessions, kept as a single named constant so it is a one-line change. Live
     consequence: a coach with 2 completed sessions sees the empty state rather
     than a chart. Lowest stakes of the four.

## HANDOFF NOTES for the P4 Commerce planner

You start cold. This section is the only memory you have of P3. Read it before
cutting stories.

### What you inherit that already works

Do not rebuild any of this. It is deployed, exercised against real money in test
mode, and verified by the approver at the P3 gate.

- **Payment intents.** `payment_intents` carries a `domain` column and is the
  single record of an in-flight charge across every domain. Commerce adds a
  value to that column; it does not add a table.
- **The shared finalize gate.** `supabase/functions/_shared/finalize-payment.ts`
  owns the idempotency UPDATE and dispatches by `payment_intents.domain`. Both
  `verify-payment` (the client callback, the reliable path) and
  `razorpay-webhook` (the backup, which can lag on retry backoff) call only it.
  There is exactly ONE capture gate in this system and adding a domain must not
  create a second.
- **The webhook, with its header fix.** Razorpay puts the event id in the
  `x-razorpay-event-id` HEADER, not the body. Reading `event.id` yields
  undefined and violates the `webhook_events` not-null primary key on every
  delivery. This is fixed and dedupe runs through `webhook_events`. Any new
  commerce webhook event you handle inherits the same rule.
- **The double-entry ledger.** `ledger_entries` in balanced groups, one group per
  money event, verified balanced six times over at this gate. There is no
  denormalized balance column anywhere and you must not add one. Balances are
  always derived by summing entries.
- **`BillSummary`.** The one shared price-breakdown component. Every screen that
  shows a money total uses it. Commerce carts and checkout use it too; do not
  hand-roll a cart total.
- **The state-machine RPC pattern.** Money-bearing entities transition through a
  SECURITY DEFINER Postgres RPC that raises `INVALID_TRANSITION` on an illegal
  edge and checks caller identity inside the function. Money-consequential
  transitions are service-role only (AT-61), so the edge function is the sole
  path. Orders get the same shape: an `order_transition` RPC, not client code
  setting a status field.

### The CLAUDE.md permissive-OR rule, and why it exists

Postgres RLS policies are permissive-OR. A table carrying both an owner policy
and a public browse policy returns OTHER PEOPLE'S ROWS to an unscoped select.
RLS is a security floor, not a scoping mechanism. Every read of such a table
carries its own explicit ownership filter, in app code, in seed scripts, and in
test harnesses.

This has bitten the codebase four times now, and P3 supplied two of them:
`sessions` is readable by both coach and player, so every role-specific list
filters by `coach_id` or `player_id` explicitly; and AT-63 was the inverse
failure, where `coach_profiles` had NO non-owner select policy, so an EXISTS
subquery against it was always false and coach discovery into booking was dead
for every real athlete until nine minutes before the cycle-1 evidence was
captured. Commerce is the highest-risk surface yet for this, because a product
catalog is public-browse by definition while orders are strictly owner-scoped,
and they will sit next to each other in the same queries. Also note the P2
lesson: a test written against an unscoped query does not fail, it passes for the
wrong reason. Assert that two parties' ids actually differ before trusting an
isolation result.

### Clients never write money rows

Restating because it is the one rule the approver blocks on with no exceptions.
No client-side insert or update against `payment_intents`, `ledger_entries`,
`payout_accounts`, `transfers`, `refunds`, or any status field on a money-bearing
row. Ledger writes happen only in edge functions under the service role. The
price shown client side is always re-validated server side at the point of
charge, preserving `PRICE_MISMATCH`. A client-supplied amount is never final.

### Specific traps P4 will hit

1. **Commerce orders are a THIRD domain in `finalize-payment.ts`, alongside
   court and session.** The dispatch already has two branches that work; yours
   must follow the same shape, one branch plus one `finalize-order-payment.ts`.
   Do not fork the gate, do not add a parallel capture path for carts because
   carts feel different, and do not let the webhook and the client callback
   diverge into two implementations. That divergence is the failure mode this
   design exists to prevent.
2. **The AT-26 expiry sweep now owes three domains.** It was cut for courts,
   P3 proved sessions have the identical stale-hold problem (two live instances,
   `4a64c535` and `4ee5bca9`), and commerce adds abandoned carts holding stock
   against unpaid `created` intents. Still no sweep is wired. Widen AT-26 to
   cover all three; do not cut a third separate sweep story.
3. **Route is not enabled on the merchant account, so no seller payouts can be
   proven in P4.** `POST /v2/accounts` returns "Route feature not enabled for the
   merchant" and `POST /v1/transfers` returns a bare 404 because the endpoint is
   not routed at all for a non-Route merchant. Both classify as
   `ROUTE_UNAVAILABLE` 503. If P4 scope includes paying a seller, that leg cannot
   reach a verified state this phase; build it, make it fail honestly, and defer
   the live proof to P8 exactly as P3 did for coach payouts. Do not stub it to
   fake success, and do not plan a gate clause that depends on it.
4. **Sessions price differently from courts, and commerce is a third pricing
   shape.** Sessions carve the platform fee out of the coach's price, so
   `sessions.total = sessions.price` and the athlete sees no fee row. Courts are
   additive with subtotal, GST, and fee rows. Decide commerce's shape explicitly
   and record it in SCHEMA.md before building BillSummary against it, rather than
   copying whichever neighbour you read first.
