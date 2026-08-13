# Edge cases and concurrency in the transactional core

Lane: adversarial static review of bookings, checkout, refunds and the ledger. Read-only.
Date 2026-08-14. Branch `integration/p6-audit-fixes` at `4793ce4`.
No writes, no DDL, no device, no load test. Every claim below cites a file and line, a live
`pg_proc` / `pg_indexes` definition, or a read-only query result.

**The claim on record** (docs/architecture/PAYMENTS.md) is that bookings, checkout, refunds and
the ledger are trustworthy under concurrency, guarded by unique indexes, webhook idempotency, RPC
state machines and DB-enforced oversell and slot races.

**Verdict: the oversell and slot-race guards are real and hold. The idempotency gate is real and
holds. What does NOT hold is everything downstream of the gate.** The capture path is single-shot
by construction, so every "a redelivery repairs it" claim in the code and in PAYMENTS.md is
unreachable, and three separate unhappy paths end in *money captured, nothing delivered, no
refund, no retry, no queue*. Production already contains rows in that end state.

An important framing note before the findings. The dangerous window here is not microseconds. It
is **fifteen minutes**: `unpaid_hold_ttl()` is 15 minutes, the sweep runs every 5 minutes, and a
real UPI or netbanking payment can legitimately take longer than that. The races below are
reachable by an ordinary slow payer, not only by a contrived simultaneous double-click.

---

## 0. The guard inventory, per domain, as asked

| Domain | Guard against double booking / oversell | Kind | Verdict |
|---|---|---|---|
| Court booking | `court_bookings_court_date_slot_unique` UNIQUE `(court_id, date, slot_start) WHERE status <> ALL('cancelled','expired')` | partial unique index | Real DB guard. Start-time only, see F6 for the consequence |
| Coaching session | `sessions_coach_date_slot_unique` UNIQUE `(coach_id, date, slot_start) WHERE status <> ALL('declined','cancelled')` | partial unique index | Real DB guard, but **start-time only and overlap-blind**, F4 |
| Group join | `join_training_group` takes `select * from training_groups ... for update`, counts `status <> 'lapsed'` under that lock, plus `group_memberships_one_live_per_player` UNIQUE `(group_id, player_id) WHERE status <> 'lapsed'` | row lock + partial unique index | **Correct.** Capacity counted under the lock, unique index as the backstop |
| Group renewal | none. `renew_group_membership` mutates the same row; no in-flight-renewal guard | application logic only | F12, low severity |
| Shop checkout | `reserve_stock_for_checkout` takes `perform pv.id from product_variants ... order by pv.id for update`, then re-derives `variant_available_stock` in a *later statement* (fresh READ COMMITTED snapshot) | row lock on the variant, serialising the reservation table | **Correct.** See "Ruled out" |
| Donation | none, deliberately. `funded_amount` is incremented under a row lock in `record_donation_from_draft`; `ITEM_FUNDED` is a request-time check only and a race **overfunds** rather than losing money | by design | Accepted, matches PAYMENTS.md:109 |

Evidence for every index above: `pg_indexes` on project `syzzfgaudpifwvbpycyi`, queried 2026-08-14.
Evidence for every lock: `pg_get_functiondef` on the live project, not the repo.

---

## F1. P0. A session cancelled while the payment is in flight captures the money and never refunds it. Seven such rows exist in production.

**The sequence.**

1. Athlete books. `book-session` inserts the session as `requested` and the intent as `created`.
2. Athlete opens the Razorpay sheet, then taps Cancel in the app before the charge lands (or the
   sweep abandons the session at the 15 minute mark, same end state).
3. `cancel-session-refund/index.ts:181-197` looks up the intent and finds `status = 'created'`:

       if (!intent || intent.status !== "captured" || !intent.razorpay_payment_id) {
         ... refund_status: "not_applicable", outcome: "cancelled_without_refund"

   The session is transitioned to `cancelled`. No `refunds` row is created. Correct so far, given
   what it can see.
4. The capture lands. `finalizePaymentCaptured` flips the intent to `captured` and dispatches to
   `finalizeSessionCaptured`.
5. `_shared/finalize-session-payment.ts:44-70` selects `id, status` from the session and **never
   looks at the status it just read**. It returns `outcome: "captured"` on a session that is
   already `cancelled`.

**Why nothing recovers it.** `cancel-session-refund` and `decline-session-refund` both require the
session to be in `requested`; it is now `cancelled`, so neither can be invoked again.
`session_transition` refuses a second cancel with `INVALID_TRANSITION`. `admin-order-refund` is
commerce-only by construction (PAYMENTS.md:337: "Every index predicate and ledger check in `0095`
uses `'commerce'`"). There is no admin screen that can refund a session. The money is stuck.

**This is a TOCTOU in the exact shape the lane asked for**: a read of `payment_intents.status` in
application code, followed by a write to `sessions`, with no lock joining the two and a 15 minute
window between them.

**Live evidence.** Read-only query, 2026-08-14:

    session_status  intent_status  n   with_refund_row  first        last
    declined        captured       7   3                2026-07-27   2026-07-27
    cancelled       captured       10  7                2026-07-27   2026-08-03

**Seven** of those 17 have no `refunds` row at all: captured, no reversal, no record that anything
is owed. All 17 carry real `razorpay_order_id` values beginning `order_`. The other 10 have a
`refunds` row stuck `pending`, which is F8.

Caveat stated honestly: these are test-mode charges, so no real rupees are at stake today. The
*code path* that produced them is unchanged and live.

---

## F2. P0. The sweep expires a court booking at 15 minutes with no captured-payment guard; a payment landing at 15:01 is captured against an expired booking, writes no ledger, and refunds nothing.

**The asymmetry is the finding.** `expire_stale_holds` has three money-bearing arms and they do
not agree with each other. Live `pg_get_functiondef`:

- **sessions arm** carries an explicit guard in the candidate query:
  `and not exists (select 1 from payment_intents pi where pi.entity_id = s.id and pi.domain='session' and pi.status='captured')`,
  and `session_abandon_unpaid` re-checks it under `for update` on the session.
- **membership** has the same guard inside `membership_abandon_unpaid`:
  `if v_captured > 0 then raise exception 'INVALID_TRANSITION: membership % has a captured payment'`.
- **courts arm has no guard at all.** The candidate query is only
  `where b.status = 'pending_payment' and b.created_at <= v_cutoff`, and
  `court_booking_expire_payment` checks nothing but `v_booking.status <> 'pending_payment'`.
  It never looks at `payment_intents`.

**What happens next.** `court_booking_confirm_payment` (live definition) raises
`INVALID_TRANSITION: court_booking % is not pending_payment` for any status other than
`pending_payment`. `_shared/finalize-court-booking-payment.ts:70-76` turns that into a thrown
`AppError`. The intent has **already** been flipped to `captured` by the gate (F3). The throw
propagates to `razorpay-webhook/index.ts:508-525`, which logs, captures to Sentry, and **returns
200**. The `webhook_events` row was written before the side effect, so Razorpay will never redeliver
it, and if it did, the gate would short-circuit it.

End state: `payment_intents.status = 'captured'`, `court_bookings.status = 'expired'`, zero
`ledger_entries`, zero `refunds`, the slot released to someone else, and the athlete charged.

**Why it is not exotic.** The trigger is a payment taking longer than 15 minutes. UPI collect
requests, netbanking redirects and OTP retries routinely do.

---

## F3. P0. The capture gate is single-shot, so every "a redelivery repairs it" claim in the code and in PAYMENTS.md is unreachable.

`_shared/finalize-payment.ts` flips the intent **before** dispatching:

    .update({ status: "captured", razorpay_payment_id })
    .eq("razorpay_order_id", ...)
    .eq("status", "created")

Only then does it call the domain handler. That correctly guarantees at-most-once. It also
guarantees that **if the handler dies for any reason after that UPDATE commits, no future delivery
can ever re-enter it**: the intent is no longer `created`, so every subsequent call falls into
`describeAlreadyProcessed`, which the file itself documents as "Read-only, so this branch can never
write a second ledger group". Both entry points (`razorpay-webhook`, `verify-payment`) go through
this one gate, so there is no second door.

The consequence is that three separate repair mechanisms are dead code by construction:

| Repair check | Its own docblock claims | Reality |
|---|---|---|
| `_shared/finalize-membership-payment.ts:88-103` existence check on the coach leg | "covers a previous run that died between" the activation and the ledger write | A run that died left the intent `captured`; no delivery can reach this line again |
| `_shared/finalize-order-payment.ts:189-203` existence check on the commerce group | PAYMENTS.md:99 "so a redelivered capture repairs a missing group rather than doubling a written one" | A redelivered capture never reaches the handler |
| `_shared/finalize-donation-payment.ts:112-126` existence check on the donation group | "so a re-entry writes ... a redelivery cannot double-credit the fund" | There is no re-entry path |

PAYMENTS.md:211 makes the same claim for session accruals ("a session that is `completed` but
unaccrued gets its accrual written on a later `complete-session` call"). That one *is* reachable,
because `complete-session` is invoked by a coach, not by the gate. The other three are not.

**And there is no queue to find the damage.** `razorpay-webhook/index.ts:513-518` states it
outright: "`webhook_events` ... has no status/error column to poll: id, event_type, payload,
processed_at only". The only alerting is a Sentry capture. `cron.job` on the live project contains
exactly one row (`expire-stale-holds`, `*/5 * * * *`), so nothing scans for captured intents
missing their ledger group.

This is the same failure shape CURRENT-STATE.md keeps recording, applied to a safety net: the check
exists in the tree, and nobody has ever watched it run.

---

## F4. P1. Coach double booking through overlapping session durations. Both guards are start-time only, and two production coaches already have mixed durations.

Three layers, all keyed on `slot_start` alone, none of them aware of `slot_end`:

1. **The unique index.** `sessions_coach_date_slot_unique ON sessions (coach_id, date, slot_start)`.
   A 10:00 booking and a 10:30 booking are different keys.
2. **The busy check.** `get_coach_busy_slots` (live definition) returns
   `RETURNS TABLE(date date, slot_start time)` and selects `s.date, s.slot_start`. **`slot_end` is
   dropped at the source**, so overlap detection is structurally impossible downstream.
3. **The application check.** `book-session/index.ts:307-309`:
   `const isBusy = busySlots.some((slot) => normalizeTime(slot.slot_start) === slotStart)` —
   exact equality on the start time.

The availability-window check at `book-session/index.ts:277-281` *does* use `slot_end`, but only
against the coach's declared window, never against other bookings.

**Reachable through the ordinary UI, not just a crafted request.** Live query:

    coach_id                              n  durations
    5b262cf1-8f95-45df-b453-0802013f82a1  2  [60, 90]
    883b6f5d-c245-4e8c-9cba-0db623f8247d  2  [45, 120]

Coach `5b262cf1` with a 09:00 to 13:00 window: athlete A books the 90 minute type at 09:00, giving
09:00 to 10:30. Athlete B books the 60 minute type at 10:00. Busy list is `[09:00]`, so 10:00 is not
busy; 10:00 to 11:00 fits inside the window; the unique key `(coach, date, 10:00)` is free. The
insert succeeds. The coach is double booked from 10:00 to 10:30, and **both athletes are charged**,
because the 23505 that `book-session/index.ts:376` relies on to refuse a losing racer never fires.

**Courts are not exposed the same way today**, but only by accident of data:
`get_court_available_slots` generates its grid from a single `slot_duration_minutes` per window and
filters bookings on `b.slot_start = g.gen_start`, so overlap is impossible while a court has one
window per weekday. Live check: zero courts have more than one `court_availability_windows` row for
the same `day_of_week`, and unlike `coach_availability_windows_no_overlap` (a real gist EXCLUDE
constraint) and `court_pricing_rules_no_overlap`, **`court_availability_windows` has no exclusion
constraint at all**. Adding a second window for a weekday reopens F4 for courts.

The right fix for both is the mechanism the schema already uses twice: a gist EXCLUDE over
`(coach_id/court_id, date, timerange(slot_start, slot_end))`.

---

## F5. P1. An abandoned pending membership holds a group seat forever and permanently bricks the player. One such row is live.

`join_training_group` inserts the membership as `pending`, and that `pending` row is what holds the
seat: capacity is counted as `status <> 'lapsed'`.

The seat is released in exactly one place: `join-group/index.ts:252-259`, the `catch` around the
Razorpay call, calling `membership_abandon_unpaid`. That covers a Razorpay *failure*. It does not
cover the common case, which is the client abandoning the checkout sheet: the user backs out, loses
signal, or the app is killed. In that case `join-group` has already returned 200 and no code runs
again.

**`expire_stale_holds` has no membership arm.** Its four arms, from the live definition, are
`courts`, `sessions`, `commerce` and `clutch`. Nothing anywhere calls `membership_abandon_unpaid`
except that one catch block.

**The player is then bricked, not merely charged nothing.** `join_training_group` raises
`ALREADY_MEMBER` for any `status <> 'lapsed'` row, and `group_memberships_one_live_per_player`
enforces it at the index level, so they cannot re-join and pay. `renew_group_membership` raises
`INVALID_TRANSITION: membership % is not active`, so they cannot renew into it either. There is no
self-serve exit.

**Live evidence**, read-only, 2026-08-14:

    membership 352acc62-f363-4397-9b50-8cac1b74a9cb
    status pending, created_at 2026-07-28 19:50:49+00  (17 days ago)
    payment_intent 04cea3a0..., intent status 'created'  (never paid)
    group capacity 8, live_count 5  (this row is one of the 5)

---

## F6. P1. An expired court booking removes its slot from sale permanently, because the availability RPC and the unique index disagree about which statuses free a slot.

Two predicates that should be the same and are not:

- `court_bookings_court_date_slot_unique ... WHERE status <> ALL(ARRAY['cancelled','expired'])`
  — the index frees a slot on **cancelled or expired**.
- `get_court_available_slots` (live definition):
  `where not exists (select 1 from court_bookings b where ... and b.slot_start = g.gen_start and b.status <> 'cancelled')`
  — the RPC frees a slot on **cancelled only**.

So a booking the sweep expired still blocks its slot in the availability list forever. Worse, the
booking path re-checks against that same list: `book-court/index.ts:284-292` requires a
`matchedSlot` and otherwise raises `SLOT_TAKEN`. The DB would happily accept the row; the
application refuses to offer it. The slot is unsellable for the life of the court.

**Live evidence:** 39 rows in `court_bookings` with `status='expired'`. All 39 are on past dates
today, so there is no live victim yet, and I am not going to claim one. The defect is
forward-looking: every future abandoned checkout burns a slot.

---

## F7. P1. Nothing reconciles a payment captured at Razorpay against an intent still `created` here, and the webhook has recorded no delivery in 18 days.

This is the lane's "payment captured but the client never calls back" case, and the answer is that
there is no recovery at all beyond the webhook.

Live counts, 2026-08-14:

    kind                    status     n    last created
    real razorpay order     captured   158  2026-08-11
    real razorpay order     created    107  2026-08-13
    walkin                  captured    47  2026-08-11

    webhook_events: payment.captured  6 rows, last 2026-07-26 16:14 UTC
                    payment.failed    3 rows, last 2026-07-18

So 158 captures were finalised, but only 6 `payment.captured` events were ever recorded, and none
since 26 July, while real Razorpay orders continued to be created through 13 August. **In practice
`verify-payment`, a client-invoked call, is the capture path; the webhook is not currently
delivering.** `verify-payment` runs only if the app is alive to run it.

The 107 `created` intents against real `order_` ids are, by definition, either abandoned checkouts
or paid charges nobody told this system about. **The database cannot distinguish them**, and no job
asks: `cron.job` holds one row and it is `expire_stale_holds`, which reads only local state.

I will not guess how many of the 107 were paid. See "The experiments that would settle it".

Note the compounding: for a court, an unreported capture also triggers F2 fifteen minutes later.

---

## F8. P2. Ten refunds have been stuck `pending` for up to 18 days. They are a number on a dashboard, not a queue anyone can work.

    refunds.status  n   first        last
    pending         10  2026-07-27   2026-08-03
    processed        7  2026-07-20   2026-08-03

PAYMENTS.md:317 justifies the `refunds` row design on exactly this: "it makes the admin queue FR-35
requires a single indexed query (`refunds where status <> 'processed'`)". That query is not run
anywhere in the admin app. `apps/admin/src/pages/dashboard/api.ts:23` exposes a `pending_refunds`
count as a KPI, and the only row-level read is
`apps/admin/src/pages/orders/refund-api.ts:42`, hard-scoped to `.eq("domain","commerce")` and one
`order_id`. Every one of these 10 pending refunds is a **session** refund, so none of them is
reachable from any screen.

PAYMENTS.md:350 states "No auto-resume of a failed Razorpay call, deliberately ... visible in the
admin refunds queue". The deliberate choice is defensible; the queue it depends on does not exist.

---

## F9. P2. The webhook dedupe key is a request header that the signature does not cover, and a delivery missing it is acknowledged and silently discarded.

Answering the lane's question directly.

- **Where the key comes from.** `razorpay-webhook/index.ts:416`:
  `const eventId = req.headers.get("x-razorpay-event-id") ?? event.id;`
- **What the signature covers.** `verifyWebhookSignature(rawBody, signatureHeader)` at line 389,
  HMAC over the **body only**. The header carrying the idempotency key is outside the signed
  payload. An actor able to replay a captured body plus its signature can vary the event id freely
  and walk straight past `webhook_events`.
- **Is that exploitable?** Not for a double credit, because of the second layer: the
  `status='created'` gate in `finalize-payment.ts` refuses the second capture, `settle_refund`
  returns an already-`processed` row unchanged, `settle_transfer` short-circuits on `paid`, and
  `record_transfer` is idempotent on `razorpay_transfer_id`. The correct statement is that
  **`webhook_events` is not what makes this safe**; the domain gates are. Treating the
  `webhook_events` insert as the idempotency guarantee, as the comment at lines 426-429 does, is
  more confidence than the mechanism earns.
- **Header missing.** Lines 417-422 return `200 "ok (no event id)"` and process **nothing**. Since
  200 stops Razorpay retrying, a change in Razorpay's header name would silently discard every
  capture, failure and refund event, with only a `console.error` to show for it. This fails open in
  the losing direction: it should fall back to a deterministic key derived from the signed body
  (the payment id plus event type) rather than dropping a signed, verified event.
- **Same id, different payload.** The insert is `id` only; the stored `payload` is never compared.
  The second delivery is dropped as a duplicate whatever its body says. Given a valid signature this
  is Razorpay's own contract violation rather than an attack, but it is unrecorded and
  undetectable.

---

## F10. P2. Capture is two round trips, not one transaction, so a court booking can be confirmed with no partner credit and no way to repair it.

`finalize-court-booking-payment.ts` calls `court_booking_confirm_payment` (round trip 1, commits),
then inserts the three-leg ledger group (round trip 2, lines 106-146). If round trip 2 fails, the
booking is `confirmed`, the intent is `captured`, and the court partner is never credited. Per F3,
no redelivery can re-enter to fix it, and unlike commerce, membership and donation, **the court
handler has no ledger-existence check at all** to repair it even if one could.

The same two-step shape exists in `finalize-membership-payment.ts` (activate, then write), but there
the activation is idempotent and the ledger check exists, so the residue is narrower.

Not currently damaged: all 205 captured intents were checked, and the 18 with no ledger rows are
**all** `domain='session'`, which correctly writes no group at capture (accrual happens at
completion). Courts, commerce, membership and donation each have their expected 3 legs.

---

## F11. P3. `refunds_one_per_entity_non_commerce` makes a group membership refundable exactly once, for its entire life, across every renewal.

`CREATE UNIQUE INDEX refunds_one_per_entity_non_commerce ON refunds (domain, entity_id) WHERE domain <> 'commerce'`.

For membership, `entity_id` is the **membership id**, and `renew_group_membership` reuses the same
row month after month (it mutates `price`/`platform_fee` in place and returns; it never inserts a
new membership). So a refund of month 1 permanently consumes the only refund slot; month 7 can never
be refunded. Commerce was split three ways in `0095` for precisely this reason; membership was not
considered, presumably because no membership refund path exists yet. It is a trap laid for whoever
builds one.

## F12. P3. Two renewals in the same second create two charges with no in-flight guard.

`renew-group-membership/index.ts:183` sets `razorpay_order_id: 'pending:renew:${membership.id}:${Date.now()}'`.
Nothing checks for an existing `created` renewal intent on the membership. Two taps a few
milliseconds apart produce two Razorpay orders; two captures each call
`activate_group_membership_paid`, which extends `period_end` by one month from
`greatest(period_end, today)` each time. The member is charged twice and gets two months. That is at
least self-consistent rather than money lost, but it is unintended and there is no server-side
refusal. Two taps inside the *same* millisecond collide on
`payment_intents_razorpay_order_id_key` and one fails, which is accidental protection, not a design.

---

## Ruled out. Things that looked like findings and are not.

- **Checkout's last-unit race.** Genuinely correct, and the mechanism is subtle enough to record.
  `reserve_stock_for_checkout` locks `product_variants ... order by pv.id for update` in its own
  statement, then computes availability in a **later** statement, which takes a fresh READ COMMITTED
  snapshot and therefore sees the winner's committed reservation.
  `product_variant_availability` (live view definition) is
  `GREATEST(0, pv.stock - COALESCE(held_qty,0))` where `held_qty` sums
  `status='held' AND expires_at > now()`. The lock is on the variant row while the contended
  resource is the reservation table, and that is exactly right: the variant row is the mutex. The
  `order by pv.id` also removes the multi-line deadlock. Two buyers of the last unit serialise, and
  the loser gets `OUT_OF_STOCK` before Razorpay is called.
- **The sweep releasing a reservation under a live payment.** Harmless.
  `release_expired_stock_reservations` only flips `held -> released`, and `consume_reservation`
  selects `where status <> 'consumed'`, so a released row is still consumed, guarded by
  `where pv.id = l.product_variant_id and pv.stock >= l.qty` with an `OUT_OF_STOCK` raise if the
  count does not match. `expires_at > now()` in the availability view means an expired hold stops
  counting the instant it lapses, so the sweep is bookkeeping, not the enforcement point.
- **`verify-payment` as a weaker second door.** It is not. `verify-payment/index.ts:71-82` verifies
  Razorpay's own HMAC over `order_id|payment_id` keyed by `RAZORPAY_KEY_SECRET`, and lines 110-116
  additionally require `intent.user_id === user.id`. It reaches the same gate.
- **"`verify-payment` may mark an authorized-but-uncaptured payment as captured."** Ruled out:
  `_shared/razorpay.ts:82` sends `payment_capture: 1` on every order, so authorisation implies
  capture.
- **Double refund on a session.** Holds. `refunds_one_per_entity_non_commerce` claims the row,
  `cancel-session-refund/index.ts:259-280` asks Razorpay what refunds already exist before retrying,
  and `settle_refund` locks the row and returns unchanged when already `processed`.
- **Donation overfunding.** By design, PAYMENTS.md:109: finalize never rejects a captured donation,
  so a race overfunds rather than losing money. `donation_drafts` has `payment_intent_id` as its
  primary key, so one draft per charge.
- **Group capacity oversell.** Holds, and it is the best-guarded path in the codebase: real row lock
  on the group, count taken under the lock, unique index as backstop, and `ALREADY_MEMBER` checked
  before capacity (`0079`, BUG-015 comment in the live definition).
- **Membership double activation from a redelivered capture.** Holds, via the F3 gate plus
  `for update` in `activate_group_membership_paid`.
- **"No pg_cron jobs exist anywhere"** (CURRENT-STATE.md, OPEN section). Now half stale: one job
  exists (`expire-stale-holds`). The membership-lapse claim is still true, because `0104` and `0105`
  are **not applied**: `supabase_migrations.schema_migrations` tops out at `0097_report_block` plus
  `0096a`, so `0098` through `0106` are repo-only. Anyone reading `0104_membership_expiry_sweep.sql`
  in the tree and concluding memberships expire would be wrong.

---

## Unresolved, and the experiment that settles each

1. **How many of the 107 `created` intents against real `order_` ids were actually paid.** The
   database cannot answer this; only Razorpay can. Read-only experiment: for each of the 107,
   `GET https://api.razorpay.com/v1/orders/{razorpay_order_id}/payments` with the existing test
   credentials, and count those with a `captured` payment. Any non-zero result is F7 realised and
   money owed. This is a read-only API call and needs no DB write.
2. **Whether the production webhook is still registered and enabled at Razorpay.** The 18 day gap in
   `webhook_events` is consistent with "not delivering" and also with "no real charges in that
   window". CURRENT-STATE.md already proved `RAZORPAY_WEBHOOK_SECRET` is set, which is a different
   question from whether the endpoint is subscribed. Settle it in the Razorpay dashboard, or by
   sending one test event and looking for a new `webhook_events` row.
3. **Whether the mobile slot picker can offer an overlapping start through the UI alone.** I proved
   the server accepts one (F4); I did not read the picker's grid generation in
   `apps/mobile`. Settle it by reading the slot list builder for the session booking screen. This
   changes F4's severity, not its existence, because the edge function takes `slot_start` from the
   request body.
4. **Whether the 7 unrefunded session captures correspond to real settled money.** They carry real
   `order_`/`pay_` ids under test-mode keys. `GET /v1/payments/{id}` would confirm status and amount
   read-only. Under `rzp_test_` no real rupees moved; the same rows under a live key would be a
   genuine liability, and the founder decision on record is that live keys land before store
   submission.

---

## Recommended order of repair, shortest path to closing the money holes

1. Make the domain handler and the intent flip one unit, or make the gate re-enterable: flip the
   intent to `captured` **after** the handler succeeds, or add a `finalized_at` column so a
   redelivery can re-enter a captured-but-unfinalized intent. This single change makes F3's three
   dead repair checks live, and turns F1, F2 and F10 from unrecoverable into retryable.
2. Give the courts arm of `expire_stale_holds` the captured-intent guard the sessions and membership
   arms already have, and put the same guard inside `court_booking_expire_payment` under its
   existing `for update` (F2).
3. Make `finalizeSessionCaptured` refuse to silently succeed on a `cancelled` or `declined` session:
   it should trigger the existing refund machinery, which is the same `refunds` plus `settle_refund`
   convergence point `decline-session-refund` already uses (F1).
4. Add a membership arm to `expire_stale_holds` calling `membership_abandon_unpaid` (F5). The RPC
   already exists and already carries the correct guard.
5. Align `get_court_available_slots` with the unique index predicate: `status <> ALL('cancelled','expired')` (F6).
6. Replace both start-time-only slot guards with a gist EXCLUDE over `timerange(slot_start, slot_end)`,
   and return `slot_end` from `get_coach_busy_slots` (F4).
7. Derive the webhook idempotency key from the **signed body** when the header is absent, rather
   than acknowledging and dropping (F9).
8. Add the reconciliation the whole design assumes: a scheduled job that asks Razorpay about intents
   still `created` past the TTL, and one that flags `captured` intents whose domain row never
   reached its expected state (F7, F3).

Every one of these is a migration or an edge function change. None of them was attempted here; this
lane wrote nothing.
