# Payments Architecture (Razorpay, test mode)

All money in ATLITOS v2 moves through Razorpay test mode. This document is the pattern every payment-touching edge function follows, per PLAN.md's financial invariant: clients never write money rows or state transitions, RPCs enforce machines, edge functions (service role) write ledgers, the server always re-prices. Real KYC and live mode are deferred (PLAN.md P0 note); everything here is built to flip from test to live by swapping keys, not by rewriting logic.

## Principles

1. **The server is the only source of a chargeable amount.** Every edge function that creates a Razorpay order re-derives the price from `fee_config` and current source data (product price/stock, slot price, session price, donation target) before calling Razorpay. If the client's submitted total does not match, the function returns `PRICE_MISMATCH` and creates no order, matching the `PRICE_MISMATCH` pattern preserved verbatim from v1.
2. **Payment confirmation is webhook-driven, never client-driven.** No edge function or client code treats a successful return from the Razorpay checkout sheet as proof of payment. The `razorpay-webhook` function, verified by signature, is the only writer of `captured` status and the only trigger for creating the domain entity's "confirmed" row (or flipping it from an implicit awaiting-payment state).
3. **`ledger_entries` is the only balance.** No table anywhere stores a mutable `balance` column. Every screen that shows money (Earnings, My Impact, admin's refund panel, the empower hub's aggregate counter) computes it live from `ledger_entries`, per `SCHEMA.md`.
4. **One shared order-creation helper.** `razorpay-create-order` is not a client-facing endpoint; it is a Deno module (`supabase/functions/_shared/razorpay.ts`) imported by `book-session`, `book-court`, `checkout`, and `donate`, so the `notes: {domain, entity_id}` convention and the re-pricing discipline exist in exactly one place, not copy-pasted four times.

## The shared `createRazorpayOrder` helper

```ts
// supabase/functions/_shared/razorpay.ts
export async function createRazorpayOrder(opts: {
  supabase: SupabaseClient;           // service-role client
  userId: string;
  domain: 'session' | 'court' | 'commerce' | 'donation';
  amount: number;                     // rupees, converted to paise below
  entityId?: string;                  // may be unset until the domain row exists
}) {
  const amountPaise = Math.round(opts.amount * 100);

  // 1. Insert the payment_intents row first (id exists before Razorpay does).
  const { data: intent } = await opts.supabase
    .from('payment_intents')
    .insert({
      user_id: opts.userId,
      domain: opts.domain,
      entity_id: opts.entityId ?? null,
      amount: opts.amount,
      status: 'created',
      razorpay_order_id: 'pending', // placeholder, updated below
    })
    .select()
    .single();

  // 2. Call Razorpay with notes carrying {domain, entity_id} so the webhook
  //    can resolve which row to update without any other lookup.
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: intent.id,
    notes: { domain: opts.domain, entity_id: opts.entityId ?? intent.id, payment_intent_id: intent.id },
  });

  // 3. Persist the real Razorpay order id.
  await opts.supabase
    .from('payment_intents')
    .update({ razorpay_order_id: order.id })
    .eq('id', intent.id);

  return { intentId: intent.id, razorpayOrderId: order.id, amountPaise };
}
```

The `notes` object is the contract every domain function relies on: `domain` tells the webhook which table family to act on, `entity_id` tells it which row (once known), and `payment_intent_id` is always present so the webhook never has to guess. When `entity_id` is not yet known at order-creation time (a court or session booking whose row is created in the same transaction right after), the domain function updates `payment_intents.entity_id` immediately after inserting the domain row, before returning to the client, so by the time the webhook fires (which is always later than the client's own return trip) `entity_id` is populated.

## Per-flow sequence

### `book-session` / `book-court`

1. Re-price: fetch `session_types.price` or the court's `base_price_per_hour` plus any active `court_pricing_rules` peak override from `fee_config`-adjacent logic, compute `platform_fee` from `fee_config` (`domain='sessions'` or `'courts'`, `key='platform_fee_flat'`, a flat rupee amount, not a percentage), compute `gst` for courts from `fee_config` (`key='gst_percent'`). Compare to the client's submitted total; mismatch returns `PRICE_MISMATCH`, no further steps run.
2. Insert the `sessions`/`court_bookings` row (`status='requested'`/`'confirmed'`... actually courts go straight to `confirmed` per the state machine, sessions start `requested`) inside the same Postgres transaction as the unique-index check described in `SCHEMA.md`; a `23505` violation on the partial unique index is caught and returned as `SLOT_TAKEN` before Razorpay is ever called.
3. Call `createRazorpayOrder({ domain: 'session' | 'court', entityId: <the row's id>, amount: total })`.
4. Update the domain row with `payment_intent_id`.
5. Return the Razorpay order id and key to the client, which opens `react-native-razorpay`'s checkout sheet.
6. The client does **not** mark anything confirmed on its own return from the checkout sheet; it polls `sessions`/`court_bookings` by id (or subscribes via Realtime) until `payment_intents.status` (joined) reaches `captured`, per PRD-01 section 6's rule that a failed/abandoned payment never appears confirmed.

**`book-session` as built (AT-40).** Same five steps, with the session-specific facts spelled out because they differ from courts in two places.

First, pricing. For sessions the platform fee is carved OUT of `session_types.price` rather than added on top: `sessions.total = sessions.price`, and `sessions.platform_fee` is the platform's cut of that same rupee amount. SCHEMA.md's worked ledger example is the authority (1000 priced, 100 fee, platform debited 1000, coach credited 900), and PRD-01 FR-31 asks for a separate platform fee row in the `BillSummary` only for courts. Courts remain additive (`total = subtotal + gst + platform_fee`). The client sends `expected_total`, the server derives `total` from `session_types` plus the active `sessions.platform_fee_flat` row, and any difference is `PRICE_MISMATCH` with no row and no order created.

Second, there is no `pending_payment` hold. The session is inserted directly as `requested`, which is what holds the slot through `sessions_coach_date_slot_unique`. If the Razorpay call then fails, `book-session` calls `session_abandon_unpaid` (a `service_role`-only definer RPC, `0024`) to move the row to `cancelled` and free the slot, rather than updating a status column itself. That RPC refuses to release any session that already has a `captured` intent, so a Razorpay timeout that actually succeeded upstream cannot free a paid slot.

**The shared finalize gate.** As of AT-40 the capture path is one module, `_shared/finalize-payment.ts`, called by both `razorpay-webhook` and `verify-payment` and by nothing else:

```
finalizePaymentCaptured           <- owns the idempotency UPDATE and the domain dispatch
  |- finalizeCourtBookingCaptured (_shared/finalize-court-booking-payment.ts)
  |- finalizeSessionCaptured      (_shared/finalize-session-payment.ts)
```

The gate flips `payment_intents` to `captured` with a single `where status = 'created'` UPDATE and only then hands the intent to a domain handler, so exactly one caller can ever reach a handler for a given charge; the loser returns `already_processed`. Previously the gate lived inside the court-named helper, which meant adding sessions would have forced either a second copy of it or a court-named function quietly handling sessions.

The session handler writes **no** ledger group. A session has no status transition owed at capture time, and the coach has not earned anything yet: the session has not happened and can still be declined or cancelled. The accrual is written at completion by AT-41's `complete-session`, per this document's Route section. The captured funds sit in the platform's Razorpay account with no ledger attribution until then, which is exactly the "platform holds funds and releases them later" model the on-demand transfer design depends on.

### `checkout`

Same shape, with two additions: it re-fetches live stock for every `order_items` line and rejects the whole checkout with `OUT_OF_STOCK` (identifying the offending lines) if any line is unavailable, and it folds the optional `donationRoundup` amount into the single Razorpay order rather than creating a second charge, per PRD-07 FR-16/FR-17. The `orders` row itself is **not** created at this step, only after the webhook confirms capture (see below), so `placed` never exists without a paid intent behind it.

### `donate`

Re-validates the target UPA is still `status='verified'` and, if item-specific, that `upa_wishlist_items.funded_amount < cost` at request time (not from client cache), independent of what the client last fetched, per PRD-06 FR-16. Rejects `ITEM_FUNDED` or a `404` (UPA no longer verified) before calling Razorpay. Enforces `fee_config`'s `donations.min_amount` as `MIN_AMOUNT`.

## `razorpay-webhook`: signature verification and idempotency

```ts
// supabase/functions/razorpay-webhook/index.ts
Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';

  const expected = await hmacSha256Hex(RAZORPAY_WEBHOOK_SECRET, rawBody);
  if (!timingSafeEqual(signature, expected)) {
    return new Response('invalid signature', { status: 400 });
  }

  const event = JSON.parse(rawBody);

  // Idempotency: Razorpay retries webhooks on any non-2xx response, and can
  // redeliver an already-processed event. The event id is globally unique
  // and is the dedupe key, inserted before any side effect runs.
  const supabase = serviceRoleClient();
  const { error: dupeError } = await supabase
    .from('webhook_events')
    .insert({ id: event.id, event_type: event.event, payload: event });

  if (dupeError?.code === '23505') {
    // Already processed this exact event id, acknowledge and stop, no
    // second ledger write, no second notification.
    return new Response('ok (duplicate)', { status: 200 });
  }

  switch (event.event) {
    case 'payment.captured':
      await handlePaymentCaptured(supabase, event.payload.payment.entity);
      break;
    case 'payment.failed':
      await handlePaymentFailed(supabase, event.payload.payment.entity);
      break;
    case 'refund.processed':
      await handleRefundProcessed(supabase, event.payload.refund.entity);
      break;
    case 'transfer.processed':
    case 'transfer.failed':
      await handleTransferStatus(supabase, event.payload.transfer.entity);
      break;
    default:
      break; // unrecognized event types are acknowledged, not errored
  }

  return new Response('ok', { status: 200 });
});
```

`handlePaymentCaptured` is where the domain fan-out lives:

1. Look up `payment_intents` by `razorpay_order_id` (from `payment.order_id`), read `domain` and `entity_id`.
2. Update `payment_intents.status = 'captured'`, `razorpay_payment_id = payment.id`.
3. Branch on `domain`:
   - `session` / `court`: no status change needed (the row was already `requested`/`confirmed` before payment; this webhook's job here is only to flip the intent, since the domain row's own lifecycle is independent of payment status once created — a session can be `accepted` before or after capture in principle, though in practice capture is near-instant in test mode).
   - `commerce`: this is where the `orders` row is actually created (not at `checkout` call time), atomically with the stock decrement, inside one transaction: `INSERT INTO orders (...) SELECT ...` followed by `UPDATE product_variants SET stock = stock - qty WHERE id = ... AND stock >= qty` for every line, all within a single `plpgsql` function the webhook calls, so a payment success with a failed stock decrement is not a reachable state (PRD-07 FR-21). If a concurrent sale already dropped stock below what checkout reserved, this function raises and the webhook handler issues an automatic refund rather than leaving a paid order with negative stock.
   - `donation`: creates the `donations` row, and if item-specific, `UPDATE upa_wishlist_items SET funded_amount = funded_amount + amount WHERE id = ... RETURNING *`, then if the new `funded_amount >= cost`, sets `status = 'funded'`, all in one transaction (PRD-06 FR-9's atomicity requirement).
4. Writes the balanced `ledger_entries` group for the event, see the worked example in `SCHEMA.md` (debit `platform` for the full captured amount, credit the appropriate earning account(s) and `platform` fee leg).
5. Writes a `notifications` row and calls `notify-dispatch`.

`handlePaymentFailed` updates `payment_intents.status = 'failed'` and, for `commerce`/`donation` where no domain row exists yet, does nothing further, there is nothing to unwind. For `session`/`court`, the already-created row is left in place but the client-facing polling never observes a `captured` intent, so the booking never renders as confirmed; a scheduled cleanup (not built in v1, flagged for P8 hardening) can later auto-cancel stale unpaid bookings.

## Route: linked accounts and transfers

Coach and court partner payouts use Razorpay Route. Two distinct edge functions, matching PLAN.md's roster:

- **`razorpay-route-onboard`**: called from the coach's Payout Account Setup screen or `portal-court`'s Payout Account screen. Creates or updates a Razorpay Route linked account for the caller (`owner_type='coach'` with `coach_profiles.user_id`, or `owner_type='court_partner'` with the venue's `partner_user_id`), writes/updates the `payout_accounts` row, and returns Razorpay's hosted onboarding link for the KYC hand-off. Test mode uses Razorpay's test linked-account flow, which activates without real KYC documents; the `payout_accounts.status` values (`not_started`, `pending`, `active`, `needs_attention`, `failed`) map directly to Razorpay's linked account status, kept in sync by polling on return from the hosted flow (Route does not webhook linked-account status changes in the same event stream as payments, so this one path is poll-based, not push-based, and is called out here as the one intentional exception to "webhook confirms everything").

  **As built (AT-42).** `POST` with the caller's own JWT, `verify_jwt` true (unlike `razorpay-webhook`, this is user-invoked). Request `{ owner_type: 'coach' | 'court_partner', venue_id? }`, where `venue_id` is required for `court_partner` and ignored for `coach`. Response `{ payout_account_id, owner_type, owner_id, razorpay_account_id, status, onboarding_url, created }`. Error codes: `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `RAZORPAY_ERROR` 502, `ROUTE_UNAVAILABLE` 503, `INTERNAL` 500. The last two are new in `_shared/app-error.ts`'s status map.

  Ownership is re-derived server side against the validated `auth.uid()`, never a client-supplied id, because the function runs as service_role and so bypasses RLS: `coach` requires a `coach_profiles` row for the caller, `court_partner` requires `venues.partner_user_id = caller`. Venue staff are deliberately not accepted for `court_partner`, unlike the walk-in path in `book-court`, since this binds the bank account platform money is paid out to.

  Idempotency: the `payout_accounts` row is keyed by the `(owner_type, owner_id)` unique constraint from `0010_payments_core.sql`. If a row already carries a `razorpay_account_id`, the call takes the poll path instead of the create path, re-reading the linked account and its Route product configuration, syncing `status`, and returning `created: false`. Re-invoking can never create a second sub-merchant. A `23505` race on first insert re-reads rather than failing. The account id is persisted before the product-configuration call so a failure there still leaves a re-invocation on the poll path.

  Razorpay surface used, via `_shared/razorpay.ts` (extended rather than duplicated, and its shared `razorpayRequest` is what AT-43's `POST /v1/transfers` should call): `POST /v2/accounts`, `GET /v2/accounts/:id`, `POST /v2/accounts/:id/products` with `product_name: 'route'`, `GET /v2/accounts/:id/products`. The product configuration, not the bare account, is what starts KYC and carries the hosted onboarding link. `mapPayoutAccountStatus` maps Razorpay's `activation_status` (product, preferred) or account `status` onto the enum: `activated` to `active`, `needs_clarification` to `needs_attention`, `rejected`/`suspended` to `failed`, everything else to `pending`. `not_started` is never returned by the mapper; it means Razorpay has not been called at all.

  **Blocker, open as of AT-42.** Route is not enabled on the test merchant account. `POST https://api.razorpay.com/v2/accounts` with the live `rzp_test` credentials returns HTTP 400 with `{"error":{"code":"BAD_REQUEST_ERROR","description":"Route feature not enabled for the merchant","source":"business","step":"linked_account_create"}}`. The function is deployed and correct; this is a founder action in the Razorpay dashboard. Until it is done, the create path returns `503 ROUTE_UNAVAILABLE` carrying that upstream description verbatim, and the `payout_accounts` row stays at `not_started`. This is deliberately not stubbed into a fake success: PRD-02 FR-27 gates the Transfer button on `status = 'active'`, so a payout account claiming to be onboarded when no sub-merchant exists would be a money-bearing lie.

**Session earnings accrual, as built (AT-41, gate revised by AT-61).** `complete-session` is the edge function that turns a completed session into money owed. It calls `session_transition_internal(coach_id, id, 'complete')` with the **service-role** client, then writes the balanced group as service_role:

```
debit  platform                1000.00   clearing: session <id> completed
credit coach <coach_id>          990.00   session earnings, session <id>
credit platform                   10.00   platform fee, session <id>
```

Amounts come from the `sessions` row's own snapshot (`total`, `platform_fee`), which AT-40 derived from `fee_config` at booking time, so an admin editing `sessions.platform_fee_flat` between booking and completion cannot change what an already booked session accrues. `fee_config` is re-read only as a fallback for a row carrying no fee. The coach is credited `total - platform_fee`, never the gross.

Idempotency has three layers, because a double credit is unrecoverable in an insert-only ledger: the RPC refuses a second `complete` with `INVALID_TRANSITION`; the function checks for an existing `account_type='coach'` row for that session id before writing and returns `already_accrued` if it finds one; and a session that is `completed` but unaccrued gets its accrual written on a later `complete-session` call rather than failing and silently losing the coach's earnings. That third layer used to be load-bearing against a live hole (`session_transition` was granted to `authenticated`, so a client could complete a session and never credit the coach); AT-61 closed the hole, so it now covers only pre-AT-61 rows and a run that died between the transition and the ledger write.

**Money-consequential transitions are service-role only (AT-61, `0027_session_transition_service_role_gate.sql`).** The rule this migration enforces, and the one to apply to every future money-bearing state machine: *if a transition's money half is written in an edge function rather than inside the transition itself, the transition must not be callable by `authenticated`.* Two `session_transition` actions were in that category and were reachable from a client:

| action | money half that was being skipped | consequence |
| --- | --- | --- |
| `complete` | the earnings accrual group above (`complete-session`) | the coach was silently never credited |
| `cancel` while `requested` | the automatic full refund (`cancel-session-refund`, PRD-02 FR-35) | the athlete was silently never repaid |

The machine now lives in `session_transition_internal(p_actor_id, ...)`, granted to `service_role` only. The actor is an explicit argument because `auth.uid()` is null under the service-role key; both edge functions pass `getAuthenticatedUser()`'s id, which is validated against GoTrue rather than decoded locally or read from the request body, so every identity rule inside the RPC is unchanged. `session_transition` keeps its exact signature and `authenticated` grant, raises **`USE_EDGE_FUNCTION`** for those two cases, and delegates everything else. Enforcement is a grant, not a `request.jwt.claims` check: a `SECURITY DEFINER` function must not trust a GUC string.

`accept`, `decline`, `reschedule`, and `cancel` from `accepted` remain client callable and unchanged. None of them moves money; an accepted-session cancellation deliberately issues no automatic refund (PRD-02 section 8), so it has no half to skip.

**Courts is not the same exposure.** `court_booking_transition` is also granted to `authenticated`, but its `complete`/`cancel` edges have no edge-function money half: courts write their ledger group at *booking* time (`_shared/finalize-court-booking-payment.ts`), not on completion, and there is no court cancellation refund. Its money RPCs (`court_booking_confirm_payment`, `court_booking_expire_payment`) were already `service_role` only in `0012`. It was therefore deliberately left alone. **Adding a courts completion accrual or a courts cancellation refund makes this same gate mandatory in the same change**, otherwise courts reopens exactly the hole AT-61 closed for sessions.

The accrual refuses to run unless the session's `payment_intents` row is `captured` (`PAYMENT_NOT_CAPTURED`). Crediting a coach against funds that never arrived would make the ledger balance while the bank does not. No Razorpay call happens here; money leaves the platform account only on an explicit Transfer.

- **`razorpay-route-transfer`**: this build uses **on-demand transfers**, not auto-split-at-capture. A session or court booking's completion event (`session_transition(..., 'complete')` or `court_booking_transition(..., 'complete')`, called from PRD-02 FR-15 / PRD-03's completion flow) writes the earnings-accrual `ledger_entries` group immediately, crediting the coach's or partner's `ledger_account_type` balance, but does **not** call Razorpay at that moment. The coach or partner only becomes an eligible payee once their `payout_accounts.status = 'active'`, and the actual movement of money out of Atlitos's Razorpay account happens only when they explicitly tap Transfer. This decision, over auto-splitting the original charge at capture time, is deliberate: a booking can be paid and completed before the coach's Route KYC finishes, so the platform must be able to hold funds in its own account and release them later; auto-split would require KYC to be ready before the very first booking, which test-mode signup timing does not guarantee.

  `razorpay-route-transfer` flow: re-derives the requested amount does not exceed `sum(credits) - sum(debits)` for that owner (server re-check, never trusting the client's displayed balance, PRD-02 FR-28), calls Razorpay's Transfer API against the linked account, writes a `transfers` row (`status='processing'`) and the balancing `ledger_entries` group (debit the coach/partner account, credit `platform`) in one transaction, then the `transfer.processed`/`transfer.failed` webhook event updates `transfers.status` to its terminal value. A failed transfer at the Razorpay API call step (synchronous rejection, e.g. account not active) writes no `transfers` row and no `ledger_entries` row at all (PRD-02 FR-29); a failure that arrives later via `transfer.failed` webhook (asynchronous failure after initial acceptance) instead writes a **reversing** `ledger_entries` group crediting the coach/partner back, since the first group already moved the accrual out.

## `fee_config` in practice

Every re-pricing step reads the currently active row for a `(domain, key)` pair:

```sql
select value, value_type
from fee_config
where domain = $1 and key = $2 and effective_from <= now()
order by effective_from desc
limit 1;
```

Keys in use at launch: `sessions.platform_fee_flat`, `courts.platform_fee_flat` (both a flat rupee amount, `value_type='flat'`, per `0010_payments_core.sql`'s seed: the v1 "500 + 50 + 10" pattern of subtotal, then a percentage GST, then a flat platform fee, not a percentage-of-subtotal platform fee), `courts.gst_percent`, `commerce.gst_percent`, `commerce.delivery_flat`, `commerce.donation_roundup_flat` (the fixed, config-driven roundup amount per PRD-07 FR-16, not user-typed), `donations.min_amount`, `payments.route_transfer_fee_flat` (may be zero). An admin edit through `apps/admin`'s Fee Config Editor (PRD-04) inserts a **new** row with `effective_from = now()`, it never updates an existing row, so a bill computed and stored before the edit (`sessions.platform_fee`, `court_bookings.gst`, etc. are all snapshotted onto the booking/order row at creation time) is provably unaffected, and an audit of "what fee applied to booking X" is always answerable by joining on `sessions.created_at`/`court_bookings.created_at` against the fee row active at that instant.

## Refunds

There are exactly two refund paths in v2, and the distinction is deliberate: one requires human judgement, one provably does not.

**`cancel-session-refund` (added 2026-07-19, PRD-02 FR-35).** Automatic, no admin step, for one case only: an athlete cancels a session still in `requested`, before the coach ever answered. No service was rendered and nobody is owed a split, so the full captured amount goes back and the platform retains no fee. The function transitions the session, calls Razorpay's refund API against the original `payment_intents.razorpay_payment_id`, and writes a reversing `ledger_entries` group that nets the session to zero. It is idempotent on the session id, so a double tap, a retry, and a duplicate `refund.processed` webhook all converge on one refund. If Razorpay's call fails, the session still cancels (the athlete is never trapped in a state they already left) and the refund is left pending for retry and admin visibility rather than silently lost. This is the ONLY self-serve refund in v2, and it stays that way precisely because it needs no judgement.

### `cancel-session-refund`, as built (AT-60)

Migration `0026_session_request_cancel_refund.sql` plus `supabase/functions/cancel-session-refund/index.ts`. The client contract lives in `API-MAPPING.md`'s sessions section; what follows is the money reasoning.

**Order of operations.** The session is cancelled BEFORE Razorpay is called, and stays cancelled whatever Razorpay does. Ordering it the other way would mean a provider outage traps the athlete in the exact state this amendment exists to let them leave. Every non-error response therefore reports a successful cancellation; `refund_status` carries the money outcome separately.

**The reversing group.** Two legs, for a session cancelled from `requested` at a total of 1000:

```
debit  platform            1000.00   money leaves platform custody
credit user <payer>        1000.00   returned to the athlete
```

This mirrors the capture convention (`debit platform` is the clearing account as the source of a movement, credits name the destinations) pointed outward instead of inward. FR-35's "nets the session to zero" is checkable literally: for `domain='session'` and that `entity_id`, `sum(credits) - sum(debits) = 0`. It was zero before, because a session accrues nothing at capture (`finalize-session-payment.ts`: the coach is credited only at completion), and a balanced group keeps it zero. There is deliberately no fee leg to reverse, which is the real content of "the platform retains no fee": the coach never accepted, the session was never completed, so no fee was ever accrued to give back.

**How a pending refund is represented, and why.** A `refunds` row with `status='pending'` (`SCHEMA.md` has the columns). The two rejected alternatives, recorded because the choice is load bearing:

- A `payment_intents.status` value such as `refund_pending`. That enum describes one CHARGE's lifecycle. A pending refund is a second, later obligation against that charge with its own attempt count, its own failure reason, and its own provider id, and overloading the charge's status leaves the retry path nowhere to record why the last attempt failed and no key to dedupe Razorpay's refund id against.
- A ledger tag. Rejected outright: `ledger_entries` is the record of money that HAS moved. A pending refund is money that has NOT moved. Writing it there puts a liability into the table every platform balance is summed from, which is the second balance representation this document forbids, and it could never be corrected because `ledger_entries` is INSERT-only at the grant level.

A transfers-style row was chosen because `transfers` already models exactly this object pointed the other way, and because it makes the admin queue FR-35 requires a single indexed query (`refunds where status <> 'processed'`, covered by `idx_refunds_status_created`) rather than a scan across enums. `payment_intents.status` still becomes `refunded`, because that IS a fact about the charge, but only `settle_refund` sets it, so a pending refund never claims the money went back.

**Convergence.** `settle_refund(refund_id, razorpay_refund_id)` is the single atomic settle step: it locks the row, returns unchanged if already `processed`, otherwise writes the reversing group, flips the row, and sets `payment_intents.status='refunded'`. Both the synchronous path and `refund.processed` call it, which is what makes a duplicate webhook plus the synchronous path land on exactly one refund record and exactly one ledger group. It is `security definer`, granted to `service_role` only: it asserts that money moved, which no client may ever assert.

**Double-refund safety.** A first attempt is guarded by the unique index. A RETRY (a row already `pending`) first asks Razorpay what refunds exist against that payment and settles against an existing one rather than issuing a second, covering the case where a prior call succeeded but its response was lost. If Razorpay succeeds but `settle_refund` then fails, the refund is NOT retried; the row keeps its provider id and the reason, and the webhook settles it on arrival.

**Not yet exercised against live Razorpay.** As of this writing the project has no session rows at all, so no genuinely cancellable `requested` session with a captured payment exists, and none was manufactured to force a live refund. Everything above was verified against the remote database inside rolled back transactions, and both deployed functions were probed for boot and auth rejection. The first real refund is the outstanding validation.

**`admin-order-refund`** (the function PRD-04's open question resolves as a new function, distinct from `admin-order-advance`) handles everything else, and everything else is a judgement call: a cancelled `accepted` session, a no-show, a quality complaint, a commerce return. There is no shopper-initiated or coach-initiated refund flow in this phase.

1. Admin submits a refund amount from the Order Detail refund panel, which renders `BillSummary` showing original total, previously refunded, this refund, and remaining refundable, per PRD-04 FR-25.
2. The edge function re-derives "remaining refundable" server side as `orders.total - sum(prior ledger_entries debits tagged as refunds for this order)`, rejecting if the requested amount exceeds it (FR-24), never trusting the admin client's displayed number.
3. Calls Razorpay's refund API against the original `payment_intents.razorpay_payment_id`.
4. On the synchronous success response, writes a `ledger_entries` group reversing the appropriate portion of the original capture group (debit the account that was credited, credit back toward `platform`/the payer), and updates `payment_intents.status` to `refunded` or `partially_refunded`.
5. The `refund.processed` webhook event is still handled (idempotently, same `webhook_events` dedupe) as the final confirmation, matching the "webhook is the source of truth" principle even though the initiating call already got a synchronous response, since Razorpay's synchronous response confirms the refund was *accepted*, not that it fully *settled*. That handler shipped in AT-60 and is shared: it resolves an event to one `refunds` row by `razorpay_refund_id`, then by payment intent, then by creating a row if the refund was issued outside this system (a dashboard refund), and calls `settle_refund` in every case. `admin-order-refund` should reuse the same `refunds` row and `settle_refund` rather than introducing a parallel record, with the one difference that a partial refund must set `partially_refunded` on the intent instead of `refunded`.

## Ledger as source of truth, restated for payments

The read path for those sums shipped in AT-44 as two `security definer` RPCs, `get_coach_wallet_balance()` and `get_my_transactions(kind?, limit?, offset?)` (`0025_wallet_and_transactions_rpcs.sql`), both scoped by `auth.uid()` alone and both computing every figure at call time. See API-MAPPING.md's wallet section for the shapes. A coach's transferable balance is `sum(credits) - sum(debits)` for their own `coach` account, which is exactly what `razorpay-route-transfer` must re-derive server side before calling Razorpay (PRD-02 FR-28); it should call this same RPC rather than reimplementing the sum, so the number the coach was shown and the number the transfer validates against cannot differ.

Nothing in this document introduces a second balance representation. `payment_intents.status` tracks one charge's lifecycle for UI polling and idempotency; `ledger_entries` is the only place a rupee amount is attributed to an account and summed. Every number this document's flows eventually surface to a user, coach earnings, court partner net payable, a donor's total given, the empower hub's aggregate raised, is a `sum(amount) FILTER (WHERE direction=...) GROUP BY account_type, account_ref` query against `ledger_entries`, exactly as specified in `SCHEMA.md`.
