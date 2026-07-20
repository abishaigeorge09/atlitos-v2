# Phase 4 Status: Commerce

Gate (docs/PLAN.md P4): "catalog CRUD in admin, inventory, checkout w/ roundup stub, order lifecycle driver. GATE: Journey 4 incl. admin advancing order live."

Scope ceiling: `docs/prd/PRD-07-shopper.md`, plus the admin-side commerce FRs PLAN.md's P4 line explicitly names (`PRD-04` FR-13 to FR-26), which PRD-07 section 1 delegates to PRD-04 rather than owning. Nothing else. One inherited P3 advisory (PRD-02 FR-35) is absorbed here because P3 homed it here by name.

Planned 2026-07-20. Stories AT-65 through AT-87, plus AT-26 widened rather than duplicated.

## Gate definition

P4 passes when all of the following hold on the deployed stack:

1. **PRD-07 Journeys A through F** complete end to end: browse, PDP with per variant stock, wishlist toggle, cart with stock capping, checkout with `BillSummary` and the roundup row, a real Razorpay test payment, order success, order tracking, feedback once delivered, My Orders, Address Book.
2. **Admin advances the order live** (PRD-04 FR-22, FR-23): an order moves `placed` to `shipped` in `apps/admin`, one `order_timeline` row and one `audit_log` row are written, the shopper's Order Detail reflects it, and a skip attempt is rejected with `INVALID_TRANSITION`.
3. **The commerce ledger group balances** for the paid order, one group, one order, verified by summing `ledger_entries` for `domain='commerce'` and that `entity_id`. No denormalized balance column added anywhere.
4. **No oversell, demonstrated rather than argued.** A concurrency probe drives two checkouts against a variant with stock 1; exactly one reaches capture, the other is refused with `OUT_OF_STOCK` before Razorpay is called, and `product_variants.stock` never goes negative. A `CHECK (stock >= 0)` violation counts as a failed gate, not a passed one.
5. **The reservation lifecycle is closed on all three exits**: captured (reservation consumed), payment failed (reservation released), abandoned (reservation swept). Each exercised.
6. **The unified expiry sweep is scheduled and running** across courts, sessions, and commerce, and the two live stale session rows from P3 (`4a64c535`, `4ee5bca9`) are cleared by it, not by hand.
7. `pnpm turbo typecheck build lint` green, RLS advisor run and diffed against the P3 baseline, light and dark web evidence captured, biased approver APPROVE.

**Not a gate clause, deliberately:** any seller payout. Razorpay Route is still not enabled on the merchant account (PHASE-3-STATUS.md, PAYMENTS.md). See the deferral section.

## Decisions this planner makes, so builders do not each pick one

### D1. Commerce is a THIRD pricing shape, and it is additive with no seller split

Courts are additive (subtotal, GST, platform fee rows). Sessions carve the fee out of the coach's price and show no fee row. Commerce is neither, because Atlitos is the seller of record for v1 gear: there is no counterparty to split with.

```
subtotal          sum(unit_price * qty), server derived
delivery_charges  fee_config commerce.delivery_flat
gst_and_others    fee_config commerce.gst_percent applied to subtotal
donation_roundup  fee_config commerce.donation_roundup_flat, only if the box is checked
total             subtotal + delivery_charges + gst_and_others + donation_roundup
```

`BillSummary` renders exactly these rows in this order, per PRD-07 FR-13. There is **no platform fee row** on a commerce bill. Record this in SCHEMA.md in the same change as the migration.

The capture ledger group, for an order of 1000 subtotal, 50 delivery, 180 GST, 20 roundup:

```
debit  platform   1250.00  clearing: order <id> payment captured
credit platform   1230.00  commerce revenue, order <id>
credit platform     20.00  donation roundup held for Empower allocation, order <id>
```

The roundup gets its **own leg** even though both legs are `platform`, so P6 can find every roundup rupee with one indexed query and move it to a real `upa_fund` account_ref without re-reading order rows. It is not credited to `upa_fund` in P4 because `ledger_entries.account_ref` is not nullable for non-platform accounts and the checkout roundup targets no specific UPA. That attribution is a P6 handoff, written down here so P6 does not have to derive it.

### D2. Inventory reservation. This is the new hazard and the mechanism is decided here.

An oversell is a money bug. Neither courts nor sessions had this problem: a slot is protected by a partial unique index, which is a binary yes or no. Stock is a counter, and a counter has a window between "the shopper committed" and "the money landed" during which a second shopper can spend the same unit.

**Rejected: decrement at capture only, with a `stock >= qty` guard.** This is what PAYMENTS.md currently describes ("if a concurrent sale already dropped stock below what checkout reserved... the webhook handler issues an automatic refund"). It cannot oversell, because the guarded UPDATE and the `CHECK (stock >= 0)` both hold. But it means a shopper who paid can be told afterwards that their order bounced, and it makes a refund a routine outcome of ordinary traffic rather than an exception. Note also that the phrase "what checkout reserved" already presumes a reservation that does not exist. That gap is what this decision closes.

**Rejected: decrement `product_variants.stock` at checkout time and add it back on failure.** Simple, but the stock column then means two different things (real inventory minus in-flight carts), every admin stock readout in PRD-04 FR-13 and FR-17 becomes a lie during traffic, and a crashed edge function loses the information needed to know how much to add back.

**Chosen: an explicit `stock_reservations` table with a TTL, written inside the `checkout` edge function before Razorpay is called.**

- New table `stock_reservations`: `id`, `payment_intent_id` (not null, unique per intent per variant), `product_variant_id`, `qty`, `status` (`held`, `consumed`, `released`), `expires_at`, timestamps. `UNIQUE(payment_intent_id, product_variant_id)`.
- Available stock is `product_variants.stock - coalesce(sum(qty) filter (where status = 'held' and expires_at > now()), 0)`. Every read that shows stock to a shopper (PDP, cart, checkout) reads **available**, not raw stock, through one shared expression so the PDP and the checkout cannot disagree.
- `reserve_stock_for_checkout(p_payment_intent_id, p_lines jsonb)` is a `security definer` RPC granted to `service_role` only. It takes `for update` on every `product_variants` row in the order, in `product_variant_id` order to make deadlock impossible, re-derives available for each, raises `OUT_OF_STOCK` naming every offending line if any line does not fit, and otherwise inserts the `held` rows. All lines or none.
- TTL is 15 minutes, a single named constant, chosen to exceed the Razorpay checkout sheet's practical lifetime with margin. It is not a `fee_config` value because it is an operational timeout, not a price.
- `consume_reservation(p_payment_intent_id)` flips `held` to `consumed` AND applies the real `UPDATE product_variants SET stock = stock - qty` in the same transaction as the `orders` and `order_items` inserts. This is PRD-07 FR-21's atomicity, and it is one plpgsql function so it cannot be half done.
- `release_reservation(p_payment_intent_id, p_reason)` flips `held` to `released` and touches `product_variants` not at all, because nothing was decremented yet.

**The three exits, all named:**

| exit | trigger | what runs |
|---|---|---|
| paid | `finalize-order-payment.ts` via the shared gate | `consume_reservation`, then order and ledger writes, one transaction |
| failed | `payment.failed` webhook, or `checkout`'s own Razorpay call throwing | `release_reservation` |
| abandoned | nothing arrives at all | the AT-26 sweep expires the reservation past its TTL |

**Late webhook, stated explicitly because it is the ugly case.** A capture that arrives after the TTL finds its reservation expired. The handler does NOT trust the expired row. It re-attempts the guarded decrement (`stock = stock - qty WHERE stock >= qty`) inside `consume_reservation`. If it succeeds, the order is created normally and the reservation is marked consumed late. If it fails, stock genuinely went to someone else, and the only correct outcome is to keep the money nowhere: no order row is created, and the existing `refunds` plus `settle_refund` machinery from AT-60 issues an automatic full refund. Do not invent a second refund path for this; reuse AT-60's. This is rare by construction (a 15 minute TTL against a test-mode capture that is near instant) but it is reachable, so it is built and it is tested.

**Why not just a `reserved` counter column on `product_variants`.** A counter cannot expire. Releasing it correctly requires knowing which in-flight intent owns how much, which is a table with a TTL wearing a disguise. The table also makes the sweep trivially correct and gives the approver something to count.

### D3. AT-26. P4 implements the unified sweep. It is not deferred a third time.

Widen the existing AT-26 rather than cutting a third story, exactly as PHASE-3-STATUS.md instructs. One `pg_cron` job, one `expire_stale_holds()` function, three domains: `court_booking_expire_payment` for courts, `session_abandon_unpaid` for sessions, `release_reservation` for commerce reservations past TTL.

Justification, since two prior phases chose to defer:

1. **The reservation mechanism in D2 is not correct without it.** A `held` row with no release valve strands inventory permanently. In courts and sessions a missing sweep left a stale row that was ugly; here it removes sellable stock from the catalog forever. The sweep stops being operational hygiene and becomes part of the money design.
2. **The debt is now demonstrably three domains and two live rows**, and it has never once been true that the next phase was a better time.
3. **It is small.** The three release RPCs already exist or are being written this phase anyway. AT-26 is a `pg_cron` schedule plus a wrapper function plus a test, not a new subsystem.

The sweep clearing sessions `4a64c535` and `4ee5bca9` is a gate clause, so "scheduled" has to mean "observed to have run", not "the cron row exists".

### D4. Route stays deferred. No P4 gate clause depends on a payout.

`POST /v2/accounts` returns "Route feature not enabled for the merchant"; `POST /v1/transfers` returns a bare not-found because the endpoint is not routed for a non-Route merchant. Both classify `ROUTE_UNAVAILABLE` 503 and both are correct as built.

Commerce in P4 is first party (D1), so there is no seller to pay and no Route leg to build. This is a real difference from coaching, not a workaround: the deferral costs P4 nothing because P4 has no counterparty. **If and when third party sellers enter the product, that is a new PRD and a new phase, not a P4 stretch.** Do not add a seller split, a seller payout screen, or a `payout_accounts` owner_type for sellers in this phase. Deferred to P8 alongside the coach and partner payout proof.

### D5. Web this phase, native later. What that means concretely here.

Consistent with the founder's standing instruction and P3's measured amendment.

**Verified on web in P4:** every screen in PRD-07 section 3, all four states each, light and dark; the whole cart and checkout money path; the admin order lifecycle (a web app regardless); the concurrency and reservation probes, which are backend and platform independent.

**Deferred to the P8 native pass:** screen level native capture of the shop routes, phone width layout, image gallery gestures on the PDP, and haptics.

**Not deferrable, because it is the one genuinely native surface:** commerce checkout reuses the exact `react-native-razorpay` wrapper P3 verified end to end on the simulator (`docs/phases/evidence/p3-native/`). Builders must reuse that wrapper through its existing shared contract and must not write a second checkout invocation. If a builder finds themselves adding a `Platform.OS` branch or a new `.native.ts` file in the commerce checkout path, that is a signal they have forked the wrapper, and it is a rejectable finding.

**One thing P4 must not inherit: `Alert.alert`.** AT-64 established it is inert on react-native-web, so ten existing confirm dialogs are no-ops there and unverified natively. Commerce introduces two more destructive confirmations (remove a cart line, delete a saved address). Those must NOT use `Alert.alert`. AT-84 builds one token driven `ConfirmSheet` and commerce uses it. This does not close AT-64, which still owns the ten existing call sites, but it stops the count growing and gives AT-64 a component to migrate onto.

## Deliverables owed, by track

### Track A: schema, RLS, inventory (opus)
- [x] AT-65 Commerce schema migration: categories, products, media, variants, wishlist, cart, orders, items, timeline, feedback (PRD-07 FR-1, FR-4, FR-8, FR-25, FR-27) — `0031_commerce.sql`
- [x] AT-66 Commerce RLS policies, public catalog beside owner scoped orders (PRD-07 FR-1, FR-7, FR-8, FR-27, FR-28) — `0032_commerce_rls.sql`
- [x] AT-67 Stock reservation: `stock_reservations`, reserve, consume, release, available stock expression (PRD-07 FR-9, FR-18, FR-20, FR-21) — `0033_stock_reservations.sql`
- [x] AT-68 Cart and wishlist RPCs with server side stock revalidation (PRD-07 FR-6, FR-9, FR-10, FR-29) — `0034_cart_wishlist_rpcs.sql`
- [x] AT-69 `order_transition` RPC and `order_timeline`, service role gated (PRD-07 FR-24, PRD-04 FR-22) — `0035_order_state_machine.sql`
- [x] AT-70 Address delete guard trigger for in flight orders (PRD-07 FR-30) — `0036_address_delete_guard.sql`
- [x] Advisor follow up on the above — `0037_commerce_advisor_fixes.sql`

#### Track A build notes, for Tracks B through F

Migrations `0031` through `0037` are applied to `syzzfgaudpifwvbpycyi`. `pnpm turbo typecheck` green, 12/12. All verification fixtures were removed afterwards; the commerce tables are empty and await AT-83's seed catalog.

**What Track B must call, and how.** All four reservation RPCs plus `order_transition` are `service_role` only, so they are unreachable from an edge function using the caller's JWT. `reserve_stock_for_checkout(intent_id, '[{"product_variant_id":..., "qty":...}]'::jsonb)` before Razorpay; `consume_reservation(intent_id)` in the SAME transaction as the `orders` and `order_items` inserts; `release_reservation(intent_id, reason)` on failure; `release_expired_stock_reservations()` is the commerce arm AT-26 wires into `expire_stale_holds()`, and it is deliberately not scheduled by `0033`.

**What Track C and D must read.** Never `product_variants.stock` for a shopper-facing number. Read `product_variant_availability` (view) or `variant_available_stock(uuid)`. Raw `stock` is correct only for PRD-04's admin inventory readouts. Cart writes go through `add_to_cart`/`update_cart_item`, which return `capped`, `requested_qty` and `available_stock` for the FR-9 notice and the FR-12 block; the direct upsert path is closed by both policy and grant. Every read of an owner scoped table carries its own `.eq("user_id", user.id)`, per the contract now recorded in RLS.md.

**Proofs run against the live project, not argued.**

- *Oversell, gate clause 4.* Two competing `held` claims were staged on a variant with raw stock 1, then two captures were fired **simultaneously on two separate connections**, the first holding its row lock open for 6 seconds so they genuinely overlapped. Exactly one won: stock went 1 to 0, the winner's reservation became `consumed`, and the loser blocked, re-evaluated the guard after the winner committed, and raised `OUT_OF_STOCK` with its transaction rolled back (its reservation still `held`, so the caller can refund per D2). Final stock 0, never -1; `CHECK (stock >= 0)` never fired. Separately, `reserve_stock_for_checkout` refused a second reservation on the last unit outright, so in the ordinary path the refusal happens **before** Razorpay is ever called, which is what clause 4 asks for.
- *RLS isolation, non-vacuously.* The two shoppers' ids were asserted to differ before the result was trusted (the AT-62 lesson). `dc6b14da...` saw only its own cart line, order, order item and timeline row; `58756043...` saw only its own, and the row ids returned differed. Zero cross-visibility either way. `anon` gets the catalog and the availability view, and a hard permission error on `cart_items` and `stock_reservations`.
- *The shared expression.* With 3 units held against raw stock 10, the view reported `held_qty` 3 and `available_stock` 7, the scalar function agreed, `available = raw - held` held exactly, and the TTL was exactly `00:15:00`.
- *Three exits, all exercised.* Consumed (above); released on payment failure with raw stock untouched; swept on abandonment, where an expired hold was **already** excluded from availability before the sweep ran, so correctness does not depend on cron latency. The sweep then made the row's status honest.
- *State machine.* `placed` to `delivered` rejected with `INVALID_TRANSITION`, `placed` to `shipped` accepted and wrote one timeline row with actor and location, cancel from `shipped` rejected. `order_transition`, direct cart insert, and feedback on a non-delivered order were each refused to `authenticated`. Deleting an address on a `shipped` order raised `ADDRESS_IN_USE` (AC-F3).

**A real bug the concurrency probe caught**, worth recording because it would not have shown up in any single-threaded test: `consume_reservation` originally locked its reservation group with `SELECT count(*) ... FOR UPDATE`, which Postgres rejects outright ("FOR UPDATE is not allowed with aggregate functions"). The lock is now its own statement, ordered by id, with the count taken after. Writing the probe was what surfaced it.

**Two things the founder should see.**

1. *`orders.address_id` has no snapshot.* `order_items` freezes title, variant label and unit price (FR-25), but the shipping address is a live foreign key, so editing a saved address retroactively changes what a past order appears to have shipped to, and an address can never be deleted once any order references it. `0036` makes the second case explainable (`ADDRESS_ON_PAST_ORDER`) rather than a raw foreign key error, but the fix is to snapshot the address onto the order and make `address_id` nullable with `ON DELETE SET NULL`. That is a schema change beyond FR-30's scope, so it is flagged rather than taken. Not reachable in the P4 gate.
2. *The Jira project key is `AT`, not `ATL`.* CLAUDE.md's "Jira ticket transition duty" section says `ATL`; the only atlitos project on the site is `AT` (id 10066). Worth correcting in CLAUDE.md. Related: the `AT` board has no **In Review** status, only Backlog, Selected for Development, In Progress and Done, so CLAUDE.md's instruction to move a finished ticket to In Review cannot be followed literally. AT-65 through AT-70 are left **In Progress** with an implementation-note comment on each, for the integrator and phase-close agent to move to Done.

### Track B: payments (opus)
- [ ] AT-71 `checkout` edge function: re-price, reserve, `PRICE_MISMATCH`, `OUT_OF_STOCK` (PRD-07 FR-16, FR-17, FR-18, FR-19, FR-20)
- [ ] AT-72 `finalize-order-payment.ts` as the third branch of the shared gate (PRD-07 FR-21, FR-22, FR-23)
- [ ] AT-73 Commerce failure and late capture paths: release, and auto refund when stock is gone (PRD-07 FR-22)
- [ ] AT-26 (widened, not new) Unified expiry sweep across courts, sessions, and commerce

### Track C: mobile shop (sonnet)
- [ ] AT-74 Category Browse with search and Recommended Gears rail (PRD-07 FR-1, FR-2, FR-3, FR-31, FR-32)
- [ ] AT-75 Product Detail with variants, live stock, wishlist heart, guest gate (PRD-07 FR-4, FR-5, FR-6, FR-7)
- [ ] AT-76 Cart with qty stepper, capping, and blocked Proceed To Buy (PRD-07 FR-8, FR-9, FR-10, FR-11, FR-12)
- [ ] AT-77 Checkout with `BillSummary`, roundup row, and address gate (PRD-07 FR-13, FR-14, FR-16, FR-17, FR-19, FR-20)
- [ ] AT-78 Address Book and address form with pincode validation (PRD-07 FR-15, FR-30)
- [ ] AT-79 Order Success, Order Detail timeline, My Orders, feedback (PRD-07 FR-23, FR-24, FR-25, FR-26, FR-27)
- [ ] AT-80 My Wishlist with Move to Cart (PRD-07 FR-28, FR-29)
- [ ] AT-84 Cross platform `ConfirmSheet` for commerce destructive actions (PRD-07 FR-10, FR-30)

### Track D: admin commerce (sonnet)
- [ ] AT-81 Product and variant CRUD with stock adjustment and audit rows (PRD-04 FR-13 to FR-19)
- [ ] AT-82 Order List, Order Detail, and the live advance action (PRD-04 FR-20 to FR-23, FR-26)

### Track E: fixtures and copy (haiku)
- [ ] AT-83 Commerce seed catalog and fixtures for the P4 gate
- [ ] AT-85 House style copy pass across all P4 commerce screens

### Track F: verification (opus)
- [ ] AT-86 Journey D money verification: one real test payment, balanced ledger, reservation consumed
- [ ] AT-87 Oversell probe: two concurrent checkouts against stock 1

### Inherited from P3, absorbed here by name
- [ ] AT-88 Cancelled session detail does not surface the refund the athlete is owed (PRD-02 FR-35)

## Dependency order

Track A first and strictly in order: AT-65 gates everything; AT-66 and AT-67 need AT-65; AT-68 needs AT-67 (the cart RPCs read available stock, not raw stock); AT-69 and AT-70 need AT-65. Track B next: AT-71 needs AT-67; AT-72 needs AT-71 and AT-69; AT-73 needs AT-72; AT-26 needs AT-67's release RPC. Tracks C and D build on A and B in parallel, and both are blocked on AT-83's seed catalog existing before any screen can render populated. AT-84 is independent and should land early because AT-76 and AT-78 consume it. Track E copy pass runs after all screens land. Track F verifies at the end and must not begin before AT-26 is scheduled.

## Traps this phase will hit

1. **Permissive-OR RLS, in its highest risk configuration yet.** `products`, `product_variants`, `product_media`, and `categories` all gain a public browse policy (`active = true`). `orders`, `order_items`, `cart_items`, `product_wishlist_items`, and `addresses` are strictly owner scoped. Those two families will sit next to each other inside single joined queries on the cart and checkout screens. Every read of an owner scoped table carries `.eq("user_id", user.id)` explicitly, in app code, in `supabase/seed`, and in every test harness, regardless of what RLS would have done. This codebase has been bitten four times. Also carry P2's corollary: a test written against an unscoped query does not fail, it passes for the wrong reason, so assert the two parties' ids actually differ before trusting any isolation result.
2. **One capture gate, three domains.** `_shared/finalize-payment.ts` already dispatches court and session. Commerce is one `case "commerce":` plus one `finalize-order-payment.ts`, following the shape of the two neighbours. Do not fork the gate, do not add a parallel capture path because carts feel different, and do not let `verify-payment` and `razorpay-webhook` diverge. Note that the gate currently short circuits when `entity_id` is null with a comment saying commerce is not built; commerce is the domain where the entity row is created BY the handler, so that branch needs the commerce case to run before the null check, not after it. Read the file, do not assume.
3. **Clients never write money rows.** No client insert or update against `orders`, `order_items`, `order_timeline`, `payment_intents`, `ledger_entries`, `stock_reservations`, or `product_variants.stock`. Cart adds go through `add_to_cart`, not a PostgREST upsert. The order row is created by the finalize handler under service role, never by the app.
4. **Snapshot, do not recompute.** `order_items` freezes `product_title_snapshot`, `variant_label_snapshot`, and `unit_price` at order time, and Order Detail's `BillSummary` recap (FR-25) reads the `orders` row's stored money columns. A later admin price edit must not rewrite what a shopper was charged.
5. **Every money total goes through the shared `BillSummary`.** Cart subtotal, checkout, order detail recap, and the admin refund panel. No hand rolled breakdown. Numeric readouts in JetBrains Mono tabular, values through tokens, lucide icons only, no emoji, no hyphens or em dashes in copy strings.

## What the founder must decide before builders start

These are PRD-07 section 9 open questions. The plan above assumes an answer for each; the assumption is what ships if no answer arrives, and each is a config change rather than a rebuild except where noted.

1. **Coupons and promo codes** (item 1). ASSUMED deferred, no coupon surface in P4. Changing this after AT-71 lands means re-opening the server re-pricing path.
2. **Roundup rounding rule** (item 2). DECIDED by the founder 2026-07-20: round the cart total up to the next multiple of 10. This OVERRIDES the plan's assumption of a flat `commerce.donation_roundup_flat` figure, and it is the cart dependent variant this section flagged as "a different function". Consequences, which builders must honour:
   - The roundup is DERIVED server side in AT-71 as `ceil(preRoundupTotal / 10) * 10 - preRoundupTotal`, computed on the total AFTER delivery and GST, never client supplied. The rounding target 10 lives in `fee_config` under `commerce.donation_roundup_multiple` so it stays config driven, which keeps PRD-07 FR-16's intent ("config driven, not user typed") intact even though the figure is now derived rather than fixed.
   - The `BillSummary` roundup row in AT-77 shows a computed amount that CHANGES as the cart changes. It is not a static config figure.
   - The amount can be zero when the total is already a multiple of 10. Suppress the row entirely in that case rather than rendering a zero, and make sure the zero case writes NO donation ledger leg, otherwise the balanced group assertion breaks on an amount of 0.00.
   - AT-86's money verification must include a cart whose total lands exactly on a multiple of 10, since that is the edge that produces the empty leg.
3. **Shopper initiated cancel** (item 3). ASSUMED admin only, matching the v1 state machine, which has no shopper cancel edge. A shopper cancel would need a refund path and a new `order_transition` edge.
4. **Delivery charge shape** (item 4). CONFIRMED by the founder 2026-07-20: flat per order, from `fee_config` key `commerce.delivery_flat`. This matches the plan's assumption, so nothing changes. Free above a threshold and pincode dependent both remain re-pricing changes in AT-71 if wanted later. Note the ordering dependency with decision 2: delivery is added BEFORE the roundup is derived.
5. **Returns and refunds journey** (item 5). ASSUMED explicitly out of scope for the P4 gate, per PRD-07 section 8. `admin-order-refund` is not cut as a P4 story. If the founder wants a return flow at the gate, it is a new PRD and it changes the phase.
6. **Wishlist capacity or expiry** (item 6). ASSUMED unbounded, no expiry. Lowest stakes.

Still outstanding and unchanged from P3: the four PRD-02 assumptions (coaching fee rate, cancel notice window, transfer minimums, analytics threshold), and the founder actions to enable Razorpay Route and to delete the still deployed `tmp-seed-demo-users` function.

## Handoff notes owed at phase close

Phase close must write, at minimum: whether the reservation TTL held under real traffic, whether the late capture refund path was ever reached, the P6 handoff for moving the roundup ledger leg from `platform` to a real `upa_fund` account_ref, and the state of AT-26 across all three domains.
