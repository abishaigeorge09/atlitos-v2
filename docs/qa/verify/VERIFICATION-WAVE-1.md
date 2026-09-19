# Verification wave 1: six lanes, consolidated

Consolidated 2026-08-14 from six independent read-only lanes.
Lane baseline `integration/p6-audit-fixes` @ `4793ce4`. Current HEAD `709bc40`.
**The only change between them is `CLAUDE.md`** (`git diff --name-only 4793ce4..HEAD`), so every
lane finding below still holds against the current tree. No lane wrote code, ran a migration, or
touched a device.

## What I re-verified myself before consolidating

Consolidation is where a wrong number gets laundered into a fact. Six load-bearing figures were
re-derived by my own query against `syzzfgaudpifwvbpycyi`, not copied from the lanes:

| Claim | Lane said | My query returned |
|---|---|---|
| Applied migration ceiling | 0097 / 0096a, 2026-08-07 | `0096a_is_actor_active_anon_revoke` |
| Live `cron.job` rows | 1 | 1 |
| `sweep_group_memberships` + `notify_session_parties` in `pg_proc` | absent | 0 |
| Pending refunds | 10 | 10 |
| Orphaned captured membership intents | 56 | 56 |
| Captured sessions cancelled/declined with no `refunds` row | 7 | 7 |

Plus the filesystem half of the security-gate finding, which is absence-shaped and therefore the
exact thing this project gets wrong: `.git/hooks/pre-push` exists and calls both scripts at `:42`
and `:55` behind `[ -x ]`; `scripts/dod.sh` and `scripts/security-invariants.sh` are absent from
the tree, absent from `git log --all`, and there is no `.github/` directory. Confirmed.

**One trap worth recording.** `order by version desc limit 1` on `schema_migrations` returns
`0096a`, not `0097`, because `0097`'s timestamp version (`20260807043523`) is lower than `0096a`'s
(`20260807044724`). File numbering and applied ordering disagree. Both are applied; nothing turns
on it, but a future ceiling check written the obvious way will report the wrong name.

---

## 1. THE HEADLINE

**A payment can be captured, deliver nothing, refund nothing, and be permanently unrecoverable,
and there is no queue, job, or screen anywhere that can find one. Production already contains
rows in that end state.**

The root is `_shared/finalize-payment.ts`. It flips the intent to `captured` **before** dispatching
to the domain handler:

```
.update({ status: "captured", razorpay_payment_id })
  .eq("razorpay_order_id", ...)
  .eq("status", "created")
```

That correctly guarantees at-most-once. It also guarantees that if the handler dies for any reason
after that UPDATE commits, **no future delivery can ever re-enter it**, because the intent is no
longer `created`. Both entry points, `razorpay-webhook` and `verify-payment`, go through this one
gate. There is no second door.

So three separate repair mechanisms written into the codebase are dead code by construction, each
carrying a docblock claiming it handles exactly the case it cannot reach:

| Repair check | Its docblock claims | Reality |
|---|---|---|
| `finalize-membership-payment.ts:88-103` | "covers a previous run that died between" activation and ledger write | A died run left the intent `captured`; no delivery reaches this line again |
| `finalize-order-payment.ts:189-203` | PAYMENTS.md:99 "a redelivered capture repairs a missing group" | A redelivered capture never reaches the handler |
| `finalize-donation-payment.ts:112-126` | "a redelivery cannot double-credit the fund" | There is no re-entry path |

**In user terms.** An athlete taps Cancel while the charge is in flight, or their UPI payment takes
sixteen minutes instead of fourteen. They are charged. The session is `cancelled` or the court
booking is `expired`. No ledger is written, no refund row is created, the court slot is resold to
someone else, and the app tells them nothing. There is no admin screen that can refund a session,
no retry, and `webhook_events` has no status or error column to poll, so nobody can even produce a
list of who this happened to. The only signal is a Sentry capture.

**Seven such rows exist in production right now** (my query, above): sessions in `cancelled` or
`declined` against a `captured` intent with no `refunds` row at all. Seventeen rows total are
captured-against-a-dead-session; the other ten have a `refunds` row stuck `pending` forever, which
is P1-2 below.

**The one thing keeping this off an incident footing is that the production Razorpay key is still
`rzp_test_`.** No real rupees have moved. The founder decision already on record is that the live
key lands **before** store submission. The moment it does, every row of this shape becomes a real
customer charged real money with no path to a refund. That sequencing is the finding: this must be
fixed before the key swap, not after.

**The fix is one change, and it collapses three P0s.** Flip the intent to `captured` after the
handler succeeds, or add a `finalized_at` column so a redelivery can re-enter a captured but
unfinalized intent. That single change makes the three dead repair checks live and turns P0-2,
P0-3 and the court ledger gap from unrecoverable into retryable.

---

## 2. Every P0 and P1, ranked

Ranked by money at risk, then by permanent user harm, then by whether a gate that should catch it
can fire at all. Lane attribution in the last column.

### P0

#### P0-1. The capture gate is single-shot, so every documented repair path is unreachable, and nothing scans for the damage
The headline above. `_shared/finalize-payment.ts` flips before dispatch; `razorpay-webhook/index.ts:513-518`
states outright that `webhook_events` "has no status/error column to poll: id, event_type, payload,
processed_at only"; `cron.job` holds one row and it is `expire-stale-holds`, which reads only local
state. Nothing anywhere scans for captured intents missing their ledger group.
**Lane: edge cases (F3).**

#### P0-2. A session cancelled or declined while the payment is in flight captures the money and never refunds it. Seven such rows are live
`cancel-session-refund/index.ts:181-197` reads the intent, finds `status = 'created'`, records
`refund_status: "not_applicable"`, and cancels the session. Correct given what it can see. The
capture then lands, and `_shared/finalize-session-payment.ts:44-70` selects `id, status` from the
session and **never looks at the status it just read**, returning `outcome: "captured"` on an
already-cancelled session. Nothing recovers it: both refund functions require `requested`,
`session_transition` refuses a second cancel with `INVALID_TRANSITION`, and `admin-order-refund` is
commerce-only by construction (PAYMENTS.md:337). A TOCTOU with a fifteen minute window, not a
microsecond one: `unpaid_hold_ttl()` is 15 minutes and UPI collect routinely exceeds it.
Live: 7 with no refund row, 10 more with a permanently stuck one, all 17 carrying real `order_` ids.
**Lane: edge cases (F1).**

#### P0-3. The courts arm of `expire_stale_holds` has no captured-payment guard, and its two sibling arms do
The asymmetry is the finding, read from the live `pg_get_functiondef`:
- **sessions arm**: candidate query carries `and not exists (select 1 from payment_intents pi where pi.entity_id = s.id and pi.domain='session' and pi.status='captured')`, re-checked under `for update`.
- **membership**: `membership_abandon_unpaid` raises `INVALID_TRANSITION: membership % has a captured payment`.
- **courts arm**: candidate query is only `where b.status = 'pending_payment' and b.created_at <= v_cutoff`, and `court_booking_expire_payment` never looks at `payment_intents` at all.

A payment landing at 15:01 is captured by the gate, then `court_booking_confirm_payment` raises
`INVALID_TRANSITION`, `finalize-court-booking-payment.ts:70-76` throws, and
`razorpay-webhook/index.ts:508-525` logs it and **returns 200**, so Razorpay never redelivers. End
state: intent `captured`, booking `expired`, zero ledger entries, zero refunds, slot resold,
athlete charged. **Lane: edge cases (F2).**

#### P0-4. 56 orphaned captured membership payments leave Rs 63,440 of phantom WITHDRAWABLE coach balance
The ledger balances perfectly throughout, which is precisely why the ledger check cannot see this.
Mechanism from `pg_constraint`: `group_memberships_group_id_fkey` is `ON DELETE CASCADE` to
`training_groups`, while `group_memberships_payment_intent_id_fkey` is `ON DELETE SET NULL`. Deleting
a training group cascades away its memberships; the `payment_intents` rows sit on the other side of
a SET NULL edge and survive with every ledger leg intact. The 36 groups deleted in the recorded
incident left 56 captured intents (Rs 64,000) whose `entity_id` points at membership ids that no
longer exist.

`get_coach_wallet_balance()` (read from `pg_proc`) sums `ledger_entries where account_type='coach'`
with **no join to `group_memberships`**, so the orphaned credits count as spendable, and
`razorpay-route-transfer/index.ts:214` gates a withdrawal only on `if (body.amount > balance)`.
Holders: `coach2@atlitos.dev` Rs 53,640 (36 legs, 0 payout accounts), `coach1@atlitos.dev` Rs 9,800
(20 legs, **1 payout account**).

Both are demo accounts on `@atlitos.dev`, so no real coach can withdraw today. It stays P0 because
the defect is in the schema, not the data: the same cascade on a real group produces a real
withdrawable phantom balance. Fix the cause (`ON DELETE RESTRICT` on the money edge, the pattern
`sessions_group_id_fkey` already uses), not the symptom, because six other readers of
`ledger_entries` would each need the second fix. **Lane: money invariants (F-1).**

### P1

#### P1-1. Nothing reconciles a Razorpay-side capture against an intent still `created`, and the webhook has recorded no delivery in 18 days
Live counts: 158 real-order captured intents, 107 real-order `created` intents (newest 2026-08-13),
against **6** `payment.captured` rows in `webhook_events`, none since 2026-07-26. In practice
`verify-payment`, a client-invoked call, is the capture path, and it runs only if the app is alive
to run it. The 107 `created` intents are either abandoned checkouts or paid charges nobody told
this system about, and **the database cannot distinguish them**. No job asks. Compounding: for a
court, an unreported capture triggers P0-3 fifteen minutes later. **Lane: edge cases (F7).**

#### P1-2. Ten pending refunds are permanently unrecoverable, and they are trapped by a different index than the one everyone assumes
Severity adjudicated: the money lane called this P1, the edge-case lane called the same ten rows P2.
P1 stands, because the money lane found the structural trap and the edge lane found only the missing
queue. `REFUND_IN_PROGRESS` (`0095_admin_order_refund.sql:185`) is commerce-only and there are zero
commerce refunds. The index that actually traps these is `0095:73`:

```sql
create unique index refunds_one_per_entity_non_commerce on public.refunds (domain, entity_id)
  where (domain <> 'commerce');
```

**No status predicate.** Once any refund row exists for a session, in any state including a
permanently failed `pending`, no second refund row can ever be inserted. `REFUND_IN_PROGRESS` at
least clears; this never does. All 10 have `attempts = 1` and `created_at = updated_at`, untouched
since 2026-07-27. The `refund_status` enum has a `failed` value that the 404 path never writes, so
the queue reads as 10 in-flight refunds when all 10 are dead. PAYMENTS.md:317 justifies the whole
`refunds` row design on an admin queue that `refunds where status <> 'processed'` would serve; that
query is run nowhere, and `apps/admin/src/pages/orders/refund-api.ts:42` is hard-scoped to
`.eq("domain","commerce")`, so none of these 10 session refunds is reachable from any screen.
All 10 carry synthetic `pay_E2ECO...` ids that Razorpay 404s, so **no real customer is owed this
Rs 10,000**. **Lanes: money invariants (F-2) and edge cases (F8), independently.**

#### P1-3. An abandoned pending membership holds a group seat forever and permanently bricks the player
`join_training_group` inserts the membership as `pending`, and capacity counts `status <> 'lapsed'`,
so the pending row holds the seat. The seat is released in exactly one place,
`join-group/index.ts:252-259`, the catch around the Razorpay call. That covers a Razorpay failure,
not the common case of the user backing out of the sheet, losing signal, or the app being killed,
by which point `join-group` has already returned 200. **`expire_stale_holds` has no membership arm**
(its four arms are courts, sessions, commerce, clutch), and nothing else calls
`membership_abandon_unpaid`. The player is then bricked, not merely un-charged: `join_training_group`
raises `ALREADY_MEMBER` and `group_memberships_one_live_per_player` enforces it at the index level,
so they cannot re-join and pay, and `renew_group_membership` raises `INVALID_TRANSITION` so they
cannot renew into it. No self-serve exit. One live row, 17 days old, occupying one of 5 seats in an
8-seat group. **Lane: edge cases (F5).**

#### P1-4. Coaches can be double booked through overlapping session durations, and both athletes are charged
Three layers, all keyed on `slot_start` alone and none aware of `slot_end`:
1. `sessions_coach_date_slot_unique ON sessions (coach_id, date, slot_start)`. 10:00 and 10:30 are different keys.
2. `get_coach_busy_slots` returns `TABLE(date date, slot_start time)`. **`slot_end` is dropped at the source**, so overlap detection is structurally impossible downstream.
3. `book-session/index.ts:307-309` compares `normalizeTime(slot.slot_start) === slotStart`, exact equality.

Reachable through the ordinary UI: two production coaches already have mixed durations
(`5b262cf1` has [60, 90], `883b6f5d` has [45, 120]). Athlete A books 90 minutes at 09:00; athlete B
books 60 minutes at 10:00; busy list is `[09:00]`, the window fits, the unique key is free, the
insert succeeds, and the 23505 that `book-session/index.ts:376` relies on to refuse a loser never
fires. Courts are safe only by accident of data (zero courts have two windows for one weekday) and
**`court_availability_windows` has no exclusion constraint**, unlike `coach_availability_windows_no_overlap`
and `court_pricing_rules_no_overlap` which are real gist EXCLUDEs. Adding a second window reopens it.
**Lane: edge cases (F4).**

#### P1-5. An expired court booking removes its slot from sale permanently
Two predicates that should match and do not:
- `court_bookings_court_date_slot_unique ... WHERE status <> ALL(ARRAY['cancelled','expired'])` frees a slot on cancelled **or expired**.
- `get_court_available_slots` uses `and b.status <> 'cancelled'`, freeing a slot on **cancelled only**.

So a booking the sweep expired still blocks its slot in the availability list forever, and
`book-court/index.ts:284-292` re-checks against that same list and raises `SLOT_TAKEN`. The database
would accept the row; the application refuses to offer it. 39 expired rows exist today, all on past
dates, so there is no live victim and none is claimed. The defect is forward-looking: every future
abandoned checkout burns a slot for the life of the court. **Lane: edge cases (F6).**

#### P1-6. The pre-push security gate is a no-op, and its absence PASSES
`.git/hooks/pre-push:42` and `:55` guard both security checks behind `[ -x scripts/dod.sh ]` and
`[ -x scripts/security-invariants.sh ]`. **Neither file exists in the tree, and neither has ever
existed in any commit** (`git log --all` returns nothing for both). The `[ -x ]` guard means their
absence exits 0 silently. There is no `.github/` directory, so there is no CI to fall back on.
Independently confirmed by me, above.

This is CURRENT-STATE's fourth disguise exactly, an absence of a generated artifact where the
absence passes, applied to the enforcement layer itself. Every invariant in the RLS lane's document,
and the financial invariant in `CLAUDE.md`, is currently held by reviewer attention alone. It also
means the house rule "CI that cannot block is not a gate" has been failing silently since the hook
was written on 11 August. **Lane: RLS and isolation.**

#### P1-7. `API-MAPPING.md` and `SCHEMA.md` describe 0103, 0104 and 0105 in the present tense as shipped contract. None of it exists
The applied ceiling is 0097; the repo contains 0099 through 0106 (107 migration files on disk).
`session_transition_internal`'s live source does not contain `notify_session_parties`; neither that
function nor `sweep_group_memberships` appears in the 129-function `pg_proc` listing;
`group_memberships` has no `renewal_reminder_sent_at` or `expiry_notified_at`; its status CHECK is
`ARRAY['pending','active','lapsed']` with no `expired`; `clips` has no `comments_enabled`. So
API-MAPPING L374's `renewMembership` contract, renewing from an `expired` membership, **cannot be
satisfied against production, because the state it renews from is unrepresentable**. This is the
root of D-02, D-03 and part of D-08 in that lane, and it is the direct cause of the UAT lane's
blocking Gate 0. **Lane: contract drift (D-01).**

#### P1-8. `database.types.ts` describes a database that has never existed
6026 lines, last genuinely regenerated at `c5574e8` (2026-08-04). It is missing 5 applied tables
(`ai_spend_daily`, `blocked_users`, `clip_saves`, `edge_rate_limits`, `sweep_failures`), 14 applied
non-trigger functions (including `is_actor_active`, `claim_order_refund`, `admin_suspend_user`,
`take_rate_limit_token`), and 4 applied columns. **And in the same file it carries
`expiry_notified_at` and `renewal_reminder_sent_at`, which come from unapplied 0104**, hand-added at
`d134628` rather than generated (`git log -S`). Ahead of production in one place and nine migrations
behind it everywhere else. It cannot be trusted as a description of anything, and hand-patching is
what produced this state. **Lane: contract drift (D-05).**

#### P1-9. `sessions.session_type_id` is NULLABLE, and the most-cited sentence in `CURRENT-STATE.md` gives the wrong mechanism
`information_schema.columns`: `player_id`, `session_type_id` and `group_id` are all `YES` nullable;
0076 relaxed both for group sessions. `API-MAPPING L36`, repeated verbatim in `CURRENT-STATE.md`'s
OPEN section, says "`sessions.session_type_id` is `NOT NULL`, so NOTHING IS BOOKABLE FROM THAT
COACH". `SCHEMA.md L209-210` says the same and **contradicts itself 60 lines later at L247**
("Group sessions have player_id NULL, session_type_id NULL").

The downstream conclusion still holds, on a different mechanism: the athlete booking screen lists
only `session_types` where `active`, so a coach with none has nothing to book. Live, 1 of 3 verified
coaches is unbookable. The conclusion is right and the stated reason is wrong, which is the more
dangerous combination, because anyone fixing the cited cause fixes nothing. Note the generated types
file agrees with the live database here while the hand-written prose does not. When the artifact and
the prose disagree, the artifact is the schema. **Lane: contract drift (D-03, D-04).**

#### P1-10. A doc correction was applied to the prose and not to the table above it
`API-MAPPING L32` says `submit_coach_verification` "writes `coach_profiles` and
`coach_certificates`, `coach_availability_windows`, and the `verification_requests` row atomically".
A `pg_proc.prosrc` probe returns `writes_coach_profiles=true, writes_certificates=true,
mentions_availability=false, mentions_session_types=false, writes_verif=true`. The 0099 correction
paragraph at L34 says plainly "It never has" and struck only `session_types`;
`coach_availability_windows` still stands in the row above it. The 14 live availability rows are
written by client code through the `coach_availability_windows_write_own` policy, not by this RPC.
**Lane: contract drift (D-02).**

#### P1-11. Every clip tile on every profile grid loses its like count in dark mode
`ClutchProfileView.tsx:173-182` carries a detailed docblock for the B5 fix: `colors.textInverse` is
`#14100B` in dark mode (`packages/theme/src/colors.ts:143`), so painting it on an arbitrary video
thumbnail with no scrim reads as a near-invisible glyph. The fix, a `colors.overlay` pill, is
correctly applied at `:198-210`. **The same shape is unfixed inside the component that screen
renders**: `ClutchPostCard.tsx:119-125`, the `variant === 'thumb'` branch, draws a `Heart` and the
like count in `textInverse` directly on the thumbnail with no scrim, and `ClutchProfileView.tsx:162`
renders exactly that component with `variant="thumb"`.

The B5 fix was applied to the sibling options button overlaid on the tile, and not to the content
inside the tile. The class was swept: all seven other `textInverse`-over-media usages are backed by
a `colors.overlay` scrim and are fine, so this is the single unscrimmed instance.
**Lane: accessibility and house rules (finding 1).**

#### P1-12. Three destructive buttons in coach onboarding are unnamed and undersized
`app/(onboarding)/coach-setup/[step].tsx:393`, `:430`, `:488`: remove certificate, remove session
type, remove availability window. Each is a `Trash2` icon-only `Pressable` with
`accessibilityRole="button"`, `hitSlop={8}`, no explicit size and **no `accessibilityLabel`**. Two
defects at once. A screen reader announces "button" three times on the same screen with nothing to
distinguish which row is being deleted, and the target is the glyph's intrinsic 18pt plus 2x
hitSlop(8) = **34pt**, below the 44pt minimum, for an irreversible action. This lands on the coach
creation layer that `CURRENT-STATE.md` lists as the newly built path on which everything a coach
offers depends. **Lane: accessibility and house rules (finding 2).**

#### P1-13. Nine Maestro flows use a selector this project has already proven false-passes
`auth-register-skip.yaml:62` documents it in the repo, written by the agent that proved it:
`"ATLITOS"` false-matches `app.json`'s `"name": "Atlitos"` surfaced in the OS accessibility tree, so
the assertion can report COMPLETED while the app sits on Register, proven via screenshot plus
screen-hierarchy JSON. It was fixed in that one flow and **not swept**. It survives in nine other
flows across twelve sites: `clutch-like-gate:49`, `courts-header:51`, `search-domains:34`,
`profile-gate:40,54`, `shop-back:52,71`, `smoke-guest-home:34`, `groups-join-guard:55`,
`gate-login-nav:28,44`, `trainings-shell:79,290`.

The four used as `when:`/`while:` conditions are worse than the assertions, because a condition that
wrongly evaluates true silently skips or runs the wrong branch and fails nothing. This is the class
sweep rule in `CLAUDE.md` going unheld: fixed once, shipped twelve times.
**Lane: UAT plan (F1).**

### P2s worth knowing, not re-ranked

Listed because two of them are close to the P1 line and a reader should decide for themselves. I did
not promote them; the lanes' calls stand.

- **Suspension enforcement never reaches the 27 mutating SECURITY DEFINER RPCs.** `select proname from pg_proc where prosecdef and prosrc ilike '%is_actor_active%'` returns **0 rows** in `public`, while 27 volatile non-trigger definer RPCs are executable by `authenticated` (`create_training_group`, `session_transition`, `mark_attendance`, `court_booking_transition`, `add_to_cart`, `submit_upa_application`). `0096` claims platform-wide coverage at `:180` and documents only 2 exemptions at `:200-205`. A suspended user keeps driving all of them until their token expires. (RLS lane.)
- **`user_roles` and `audit_log` carry anon and authenticated INSERT/UPDATE/DELETE grants with ZERO write policies.** Refused today by RLS alone. The revoke leg 0089 applied to the money tables was never applied to the privilege-escalation table or the audit trail. (RLS lane.)
- **TRUNCATE is granted to `anon` on 54 public tables**, `authenticated` on 71, including `ledger_entries` and `payment_intents`. TRUNCATE bypasses RLS entirely. No reachable exploit path found, because PostgREST exposes no TRUNCATE verb, so the only control is an accident of the API layer rather than a designed one. One statement fixes it. (Money lane, F-3.)
- **The webhook dedupe key is a request header the signature does not cover.** `razorpay-webhook/index.ts:416` reads `x-razorpay-event-id`; `verifyWebhookSignature` at `:389` is HMAC over the body only. Not exploitable for a double credit, because the domain gates stop it, but the comment at `:426-429` treating the `webhook_events` insert as the idempotency guarantee is more confidence than the mechanism earns. Worse, a missing header returns `200 "ok (no event id)"` and processes nothing, so a rename of Razorpay's header would silently discard every capture, failure and refund event. Fails open in the losing direction. (Edge lane, F9.)
- **Three `verify-*` scripts have zero assertions and no failure exit path.** `verify-shopper-ui.mjs` drives the entire athlete shop checkout to the point of clicking "Continue to pay" and screenshotting the Razorpay sheet, inside one try/catch that swallows everything, exiting 0 regardless. It prints the two actual product rules (out-of-stock disables add-to-cart, quantity caps at stock) and compares neither. `verify-shopper-ui-address-snapshot.mjs` asserts its claim **in a screenshot filename** (`21-order-detail-shipto-UNCHANGED-light`), so a changed address still produces a file named UNCHANGED and exits 0. `verify-ai-search.ts` has no `process.exit(1)` and no `throw`. (UAT lane, F2, F3, F4.)

---

## 3. RULED OUT

This section matters as much as the findings. Nine wrong conclusions in five disguises have cost
this project more than its real bugs have. Everything here was **checked against the artifact**, not
inferred from an absence, and several were negative-tested so the green could be trusted.

### Ruled out with a negative test (the check was watched failing first)

- **`venues` has unfiltered siblings.** NO. All 17 tables carrying both an owner policy and a public policy were enumerated from `pg_policy`, and every `.from()` call site across `apps/`, `packages/` and `scripts/` was **opened and read**, not greped. Every read carries its own ownership filter: `use-groups.ts:402` `.eq(coach_id,userId)`, `use-coach.ts:821/946`, `venue-scope.tsx:81` `.or(partner_user_id...)`, `empower.ts:68`, `hooks.ts:1402`. `venues` was the known example and there are no others.
- **0096's restrictive suspend policies have coverage gaps.** NO. A live diff of 0096's own selection rule against `pg_policy` returns 0 rows. **Negative-tested**: excluding `clips_active_insert` from the have-set makes it return exactly `clips | w_ins=true | h_ins=false`, so the check can fail and the green is real.
- **The money tables are defended only by RLS.** NO. `payment_intents`, `ledger_entries`, `payout_accounts` and `transfers` have zero write policies **and** zero INSERT/UPDATE/DELETE grants to `anon` or `authenticated`. A client write is refused before RLS is consulted. **Negative-tested** by adding `users` to the same two queries, which returned 8 rows.
- **The a11y sweep's clean results are clean trees rather than broken checks.** Every check was **born red** against a planted canary file containing a deliberate instance of each violation class, then re-run against the real tree after deletion. **One check failed its own negative test**: the touch-target checker skipped the canary's small Pressable because it had no `onPress`, and would have reported "no small touch targets" from a check that never ran. It was fixed, re-run, and then fired at 32pt. That is disguise four caught in the act.

### Ruled out by reading the artifact

- **The ledger is broken.** NO. 195 entry groups, 0 unbalanced, worst absolute imbalance 0.00, 532 entries, 0 single-leg groups, using the direction-aware sum. A naive `sum(amount)` has produced a false alarm here before and is meaningless, because `amount` is positive with a separate `direction` enum.
- **The admin panel writes order status from the browser.** NO, and this one needed real work to rule out. `apps/admin/src/App.tsx:51` registers a Refine Supabase `dataProvider` over `orders`, `court_bookings` and `fee_config`, which is a genuine write capability that a table-name grep cannot see. But no Refine mutation hook (`useUpdate`/`useCreate`/`useDelete`/`useForm`) appears anywhere in `apps/admin/src`, and `authenticated` holds no UPDATE grant on `orders`. It mutates through the `admin-order-advance` edge function at `orders/show.tsx:139,166`.
- **`book-court` trusts a client-supplied price.** NO. `book-court/index.ts:294` does read `round2(body.price_override ?? matchedSlot.price)`, but `price_override` is parsed only inside `if (booking_source === "walk_in")` (`:163`, `:177`), and the walk-in path calls `assertCourtPartnerOrStaff` at `:267`, which throws `FORBIDDEN` **before** the subtotal is computed. A self-service athlete request cannot carry the field at all. This is PRD-03 FR-17, a partner pricing their own court.
- **The e2e specs violate the financial invariant.** NO. Four writes against money tables exist and all four are negative tests asserting refusal. `courts.spec.ts:173` is the model: it attempts the write, asserts zero rows affected, **and re-reads with the service client to confirm the status is still `pending_payment`**. That read-back is what makes it a proof rather than a vacuous pass.
- **Checkout has a last-unit race.** NO, and the mechanism is subtle enough to record so nobody re-opens it. `reserve_stock_for_checkout` locks `product_variants ... order by pv.id for update` in its own statement, then computes availability in a **later** statement, which takes a fresh READ COMMITTED snapshot and therefore sees the winner's committed reservation. The lock is on the variant row while the contended resource is the reservation table, and that is exactly right: the variant row is the mutex. The `order by pv.id` also removes the multi-line deadlock.
- **Group capacity can be oversold.** NO. It is the best-guarded path in the codebase: real `for update` row lock on the group, count taken under the lock, `group_memberships_one_live_per_player` partial unique index as backstop, and `ALREADY_MEMBER` checked before capacity.
- **`verify-payment` is a weaker second door than the webhook.** NO. `verify-payment/index.ts:71-82` verifies Razorpay's own HMAC over `order_id|payment_id`, and `:110-116` additionally require `intent.user_id === user.id`. It reaches the same gate. Related: **"`verify-payment` may mark an authorized-but-uncaptured payment as captured"** is also ruled out, because `_shared/razorpay.ts:82` sends `payment_capture: 1` on every order.
- **0089's function revoke has drifted.** NO. Exactly 12 SECURITY DEFINER functions are anon-executable and all 12 are the documented keep-list at `0089:89-93`. Nothing outside it is anon-executable, nothing since has re-granted, and every definer function has `set search_path = public`.
- **`public_profiles` and `coach_profiles_public` are an RLS-bypass defect.** NO. They are definer views (`security_invoker` false), the intended pattern for projecting a safe column subset over an RLS-locked base. Definitions were read: no email, phone, dob or money column.
- **0091 dropped an access branch when it merged policies.** NO. All four merged expressions were read and quoted; every branch survives. `RLS.md`'s security conclusions all still hold. Only six policy **names** in that doc are stale.
- **An edge function in the repo is undeployed.** NO. All 25 directories in `supabase/functions/` (excluding `_shared`) are deployed and ACTIVE, and no deployed function is missing from the repo. This includes the two that `SCHEMA.md L254` and `API-MAPPING L431,432` still describe as "WRITTEN NOT DEPLOYED": `coach-trainee-video-upload-url` and `get-coach-trainee-video-url` are both v3 ACTIVE, 0082 is applied, the table exists with exactly the 6 documented columns, and the widening escape hatch is already gone from `use-coach.ts`. The docs are stale in the **safe** direction here, which is its own hazard: an integrator following that TODO would try to apply an applied migration.
- **`razorpay-create-order` is missing and undeployed.** NO. It is a Deno module, `supabase/functions/_shared/razorpay.ts`, which exists. `PAYMENTS.md:10` is explicit; its placement in API-MAPPING's edge-function table at L420 is what invites the wrong conclusion.
- **`product_media_public_read` is missing from `pg_policy`.** NO. It is a `storage.objects` policy, not a `public` schema one, and is confirmed present in the `storage`-schema catalog.
- **`price-text.tsx:36` renders a sans-face price.** NO, and this is the third disguise met head on. It was flagged because the sweep looked for the literal `textStyle('numericBase')`, while the file writes `textStyle(SIZE_VARIANT[size])` at `:39` with the lookup table at `:16-20`. `PriceText` is correct: mono, tabular, via the token path.
- **Five lucide icon names are missing from the package.** NO. That was a false negative in the lane's own scan. All 113 imported names were checked **against the installed package artifact** and all are present at `node_modules/.pnpm/lucide-react-native@1.24.0.../dist/types/lucide-react-native.d.ts:22767`. `CheckCircle2`, `XCircle` and `ImageIcon` are legacy aliases that resolve correctly at 1.24.0.
- **The 10 pending refunds are real money owed.** NO. All carry synthetic `pay_E2ECO...` ids that Razorpay 404s with "no Route matched with those values". No customer is owed any of it.
- **`anon` can rewrite the platform fee table.** NO. The grant says yes, RLS says no, and RLS is decisive because `anon` has **no permissive policy of any kind** on `fee_config`, so every command including SELECT is denied. Write policies require `has_role('admin')` and there is no DELETE policy at all.
- **250 of 258 live policies are undocumented in `RLS.md`, so the doc is drift.** NO. `RLS.md` documents strategy per domain, not a policy inventory. Absence of a name is not a claim. Only the six names it does assert and that no longer exist are drift.
- **The three `#RRGGBB` matches in mobile source are hardcoded colours.** NO, all three are comments explaining a token decision. **0** hex literals, **0** `rgba()`/`hsl()` literals, **0** emojis, **0** non-lucide icon imports. `AuthScene.tsx:52-57` defines an `rgba()` helper but every call site feeds it a token.
- **`'Trainings - home'` and `'player - training'` are hyphen violations.** NO, Figma frame names inside docblocks, never rendered.

### Corrections to `CURRENT-STATE.md` itself

Four statements in the project's own memory document are now wrong. Each was overturned by an
artifact, and each is the same shape as an entry already in its DISPROVEN section.

1. **"No pg_cron jobs exist anywhere in the repo."** True of the repo, **false of production**. `pg_cron` is installed and job 1, `expire-stale-holds`, `*/5 * * * *`, is active. Found independently by **three lanes**. This is the webhook entry's shape exactly: absence of config in the tree is not evidence of absence in production. The sentence should read "no pg_cron job expires memberships", which remains true and is the point being made. The underlying gap is in fact worse than a missing job: `pg_proc` has **no membership expiry function at all**, so there is nothing for a job to call.
2. **"`sessions.session_type_id` is NOT NULL."** False. See P1-9. Right conclusion, wrong mechanism.
3. **"Maestro: 13 pass, 1 fail, 1 not executed."** A true statement about the tree at `d0c755a` (13 August 14:35). `git diff --name-only d0c755a..HEAD -- apps/mobile/src` returns **28 files**, of which 18 are screens, including `(auth)/login.tsx`, the exact file holding the one documented failure. Reporting it as current status is the fifth disguise, evidence about a previous run presented as evidence about this one.
4. **"The Razorpay sheet has been driven once, by a human, on 20 July."** False, and wrong in both directions. Counting intents matching the genuine Razorpay shape `^pay_[A-Za-z0-9]{14}$` as distinct from the `pay_E2E...`/`pay_TBVERIFY...`/`pay_probe...` synthetic tags: court 1, session 3, commerce 1, membership 4, **donation 0**. Nine, not one. Better than recorded for four domains and worse for one: **the donation checkout has never been paid for by a human**.

---

## 4. UNRESOLVED, and the experiment that settles each

UNRESOLVED is a result. None of these was guessed at to fill a row.

| # | Question | The experiment that settles it | Cost |
|---|---|---|---|
| U-1 | **How many of the 107 `created` intents against real `order_` ids were actually paid?** The database cannot answer this; only Razorpay can. Any non-zero result is P1-1 realised and real money owed. | For each, `GET https://api.razorpay.com/v1/orders/{razorpay_order_id}/payments` with the existing credentials, count those with a `captured` payment. **Read-only HTTP, no DB write, no device.** | Minutes, needs credential access |
| U-2 | **Is the production Razorpay webhook still registered and enabled?** The 18-day gap in `webhook_events` is equally consistent with "not delivering" and "no real charges in that window". `RAZORPAY_WEBHOOK_SECRET` being set is a different question from the endpoint being subscribed. | Open the Razorpay dashboard, or send one test event and look for a new `webhook_events` row. | Minutes |
| U-3 | **Is the 0099 to 0106 gap intentional staging or a silent miss?** Everything in P1-7 becomes correct the moment they are applied and stays wrong until then. No query can settle this. | A founder or integrator decision. Not another query. | One decision |
| U-4 | **Do the 7 unrefunded session captures correspond to real settled money?** They carry real `order_`/`pay_` ids under test-mode keys. | `GET /v1/payments/{id}`, read-only. Under `rzp_test_` no rupees moved; the same rows under a live key are a genuine liability. | Minutes |
| U-5 | **`scripts/verify-rls-matrix.mjs` was never run.** It is the repo's own read-only live probe for exactly the isolation lane, and reading `apps/portal-court/.env.local` for `SUPABASE_ANON_KEY` was refused by the permission system. Per the house rule, a check that should apply but cannot run is a failure, not a skip, so its verdict for the current tree is **unknown**. | Grant the env read, run it, force uncached. | Minutes |
| U-6 | **No live PostgREST probe backs any RLS claim.** Everything in that lane is catalog truth (`pg_policy`, `pg_proc`, `proacl`, `information_schema`) plus source reading. Strong evidence for what the database will do, not the same as watching `anon` be refused over HTTP. | Run U-5, which is exactly this. | Same as U-5 |
| U-7 | **Can the mobile slot picker offer an overlapping start through the UI alone?** The server accepts one (P1-4); the picker's grid generation in `apps/mobile` was not read. This changes P1-4's severity, not its existence, because the edge function takes `slot_start` from the request body. | Read the slot list builder for the session booking screen. Static, no device. | Under an hour |
| U-8 | **Were all 56 orphans produced by the recorded cascade?** The mechanism is proven from `pg_constraint` and the count is consistent, but the reported incident figure was 57 against 56 found, and their `created_at` spans 2026-07-25 to 2026-08-11, wider than a single event. | Read `audit_log` around the deletion window. | Under an hour |
| U-9 | **Does `expire_stale_holds` reach unpaid membership holds?** `membership_abandon_unpaid` exists; whether the cron job reaches it was not traced. Relevant to P1-3. | Read the live `expire_stale_holds` definition for a membership arm. The edge lane says its four arms are courts, sessions, commerce, clutch, which implies no, but it was not confirmed as the same question. | Minutes |
| U-10 | **`storage.objects` bucket policies were never audited.** Out of the isolation lane's scope, same permissive-OR hazard, and migrations 0014/0016 show this repo was already bitten there once. | A pass over `storage`-schema `pg_policy` with the same permissive-OR enumeration. | Half a day |
| U-11 | **Contrast ratios were never computed**, and Dynamic Type / font scaling was never checked. Fixed heights such as the 32pt chip at `trainee/[id].tsx:314` will clip at large text sizes. | Colour maths against WCAG AA needs no device. Confirming the clipping needs a render. | Half a day |
| U-12 | **`0098` (account deletion) exists nowhere on this branch.** Referenced by `CURRENT-STATE.md` and `SCHEMA.md`, but no `0098*.sql` and no function directory. Presumably on an unmerged branch; other branches were not checked, so it cannot be called lost. | `git log --all -- 'supabase/migrations/0098*'`. | Seconds |
| U-13 | **The RPC-to-doc diff is name-based.** A doc row naming the right function but describing the wrong behaviour is caught only where the source was read. `submit_coach_verification` was read because it had a known history; the other ~90 documented functions were confirmed to **exist with the documented signature**, not confirmed to **do** what their note says. | A behavioural read of the remaining documented RPCs. | Days |
| U-14 | **Unapplied migrations 0099 to 0106 were read for policy and grant changes only.** Their full RLS impact once applied was not simulated, and cannot be without a preview branch, which 0027's committed tool-call XML currently prevents. | Repair 0027, cut a preview branch, apply, re-run the matrix. | Blocked on 0027 |

---

## 5. What is now genuinely PROVEN that was not before

Quiet results are results. Three of the six lanes came back substantially clean, and that is worth
as much as the P0s, because it retires whole categories of suspicion.

**The financial invariant holds, and at a stronger layer than anyone claimed.**
`CLAUDE.md` asserts clients never write money rows. That is now proven **twice over**: zero client
write policies **and** zero INSERT/UPDATE/DELETE grants to `anon` or `authenticated` on
`payment_intents`, `ledger_entries`, `payout_accounts` and `transfers`, so a client write is refused
before RLS is even consulted. Negative-tested. 86 `.from()` sites on money tables were swept and the
only four writes are e2e negative tests. `PRICE_MISMATCH` is raised in all five checkout paths that
show a bill.

**The ledger is not merely balanced, it is enforced.** 195 groups, 0 unbalanced, and
`ledger_entries_assert_balanced` is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger raising
`LEDGER_UNBALANCED`, so a multi-leg group is legal mid-transaction and illegal at commit. That is the
correct design. (One gap: it is `AFTER INSERT` only, so an UPDATE or DELETE of one leg would not be
caught. Only the service role can reach those, so the invariant is enforced one way rather than both.)

**The permissive-OR scoping rule is genuinely being held in code.** This is the rule `CLAUDE.md`
says has bitten the project three times. All 17 tables carrying both an owner and a public policy
were enumerated from `pg_policy`, every call site was opened and read, and every one carries its own
ownership filter. `venues` was the known example and **there are no others**. Not an absence
argument from a stale tree.

**The concurrency guards that were claimed are real.** Every unique index and row lock in PAYMENTS.md
was verified against `pg_indexes` and `pg_get_functiondef` **on the live project, not the repo**.
Group join, group capacity, and shop checkout's last-unit race are all correct, and the checkout
mechanism is correct in a subtle way that would not survive a casual rewrite.

**The state machines cannot be bypassed.** Every plpgsql/sql function in `public` containing both
`set status =` and an update against a money table was enumerated. Of eleven, only two are
client-reachable, and both are safe. Triggers were checked too, since a trigger is a status writer no
function grep would find; none writes a status. The three money-moving session actions are
deliberately refused by the RPC with `USE_EDGE_FUNCTION`.

**Deploy state of the edge tier is fully known.** All 25 edge functions are deployed and ACTIVE.
No undeployed function, no deployed function missing from the repo. Two that the docs still call
"WRITTEN NOT DEPLOYED" have been live for weeks.

**The design token discipline is in genuinely good shape.** 0 hex literals, 0 `rgba()`/`hsl()`
literals, 0 emojis, 0 non-lucide icons across 215 files. Because there are no hardcoded colours,
there is no colour that fails to flip in dark mode. The one dark-mode defect (P1-11) is not a missing
flip but a token used correctly and rendered illegibly.

**The applied migration ceiling is 0097, established independently by three lanes and by me.** This
single fact explains the UAT lane's blocking Gate 0, most of the contract-drift table, and it retires
a whole class of phantom bug: anyone walking the coach or clip journeys against production today
would hit errors that are not product bugs.

**One real refund has settled end to end**: `refunds` row `8f330e1e`, `razorpay_refund_id`
`rfnd_TFhrCu5zWLRuzd`, Rs 1,000, `processed`, 2026-07-20, against session `43c52265`. PAYMENTS.md:323
describes exactly this and is accurate.

**And the a11y lane proved its own instruments before trusting them**, which no previous sweep here
has done: eight checks planted red against a canary, one of which failed its negative test and was
repaired before use.

---

## 6. The founder's decision list

### Cheap: minutes each, mostly a yes or no

1. **Is the 0099 to 0106 gap intentional staging, or did an apply never run?** (U-3) Nothing else on this list is as blocking. UAT cannot start, three merged features have no database half, and every failure walked today gets filed as a phantom product bug. No query can answer this; only you can.
2. **Authorize the read-only Razorpay reconciliation** for the 107 `created` intents and the 7 unrefunded captures. (U-1, U-4) Read-only HTTP against an API you already have credentials for, no DB write, no device. It converts "we cannot tell paid from abandoned" into a number.
3. **Check whether the production webhook is still subscribed at Razorpay.** (U-2) Eighteen days of silence against 158 captures. One dashboard page.
4. **Grant the env read so `scripts/verify-rls-matrix.mjs` can run.** (U-5) The repo's own live isolation probe has never been run this cycle, and by house rule an unrunnable check is a failure, not a skip.
5. **Decide whether the two demo coach phantom balances get zeroed before the live key lands.** Rs 53,640 and Rs 9,800, one of the two with a payout account attached.
6. **`placeholder="YYYY-MM-DD"` at `app/profile/edit.tsx:318`.** Keep it or change it. A date input mask containing hyphens: a rule call, not a bug.
7. **Confirm the sequencing commitment**: the capture-gate fix (P0-1) lands **before** the `rzp_test_` to live key swap. Right now that ordering is the only thing standing between these findings and real customer liability.

### Expensive: real engineering, needs a plan and a phase

1. **Make the capture path re-enterable.** (P0-1) Flip the intent after the handler succeeds, or add `finalized_at`. This is the highest-leverage change on the list: it revives three dead repair checks and turns P0-2, P0-3 and the court ledger gap from unrecoverable into retryable. Do this one first.
2. **Build the reconciliation that the whole design already assumes exists.** (P1-1) A scheduled job asking Razorpay about intents still `created` past the TTL, and one flagging `captured` intents whose domain row never reached its expected state. PAYMENTS.md's "deliberately no auto-resume" stance is defensible only if the queue it depends on exists, and it does not.
3. **Give the courts arm of `expire_stale_holds` the guard its two sibling arms already have** (P0-3), add a membership arm calling the already-correct `membership_abandon_unpaid` (P1-3), and align `get_court_available_slots` with the unique index predicate (P1-5). Three small changes to one function family.
4. **Change the membership money edge to `ON DELETE RESTRICT`** (P0-4), the pattern `sessions_group_id_fkey` already uses. Fix the cause, not `get_coach_wallet_balance`, because six other readers of `ledger_entries` would each need the symptom fix.
5. **Add `and status <> 'failed'` to `refunds_one_per_entity_non_commerce`, and start writing the `failed` status the enum already has.** (P1-2) Then build the admin refunds queue PAYMENTS.md:317 already justifies.
6. **Replace both start-time-only slot guards with a gist EXCLUDE over `timerange(slot_start, slot_end)`, and return `slot_end` from `get_coach_busy_slots`.** (P1-4) The schema already uses this mechanism correctly twice. Add the missing exclusion constraint on `court_availability_windows` while you are there.
7. **Install the enforcement layer that the pre-push hook has been pretending to run since 11 August.** (P1-6) Write `scripts/dod.sh` and `scripts/security-invariants.sh`, or delete the hook stanzas so nobody reads a green as a gate. Change `[ -x ]` to a hard failure on a missing script, so an absence can never pass again. Consider `project-bootstrap`, which exists for exactly this. Record the "private repo cannot require a status check" gap in `docs/DEBT.md` with an owner.
8. **Regenerate `database.types.ts` from the live project and stop hand-patching it.** (P1-8) After the 0099 to 0106 question is settled, not before, or you will bake the hybrid in permanently.
9. **Reconcile `API-MAPPING.md` and `SCHEMA.md` against the 0097 reality.** (P1-7, P1-9, P1-10) Including the four corrections to `CURRENT-STATE.md` in section 3, since that file is the only memory each fresh agent has and three of its wrong statements are actively misleading investigations right now.
10. **Sweep the `"ATLITOS"` selector across all twelve sites, then negative-test the replacement** by planting a flow deliberately on Register and confirming it now fails. (P1-13) Add assertions to the three `verify-*` scripts, starting with `verify-shopper-ui.mjs`, which is 90 percent of a real checkout test already.
11. **Fix the tap defect that thirteen retry loops across seven flows are working around, then delete the loops.** Until then every one of them should carry a link to the open bug, so nobody reads the green as "tapping works".
12. **Re-run the Maestro suite against the current tree.** (Correction 3 in section 3) The 13/1/1 verdict predates 28 changed mobile files including 18 screens and the file holding the one documented failure. Cheap in effort, blocked only on the device gate.
13. **The donation checkout has never been paid for by a human, not once.** Whatever else the UAT plan covers, that journey has zero real-world evidence behind it.
