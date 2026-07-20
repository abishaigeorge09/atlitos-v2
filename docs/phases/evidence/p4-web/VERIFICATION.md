# Phase 4 Track F verification (AT-86, AT-87)

Run 2026-07-20 against the live project `syzzfgaudpifwvbpycyi`, branch `main` at merge `8c46a79`.

Everything below was re-derived independently. Builder claims were treated as hypotheses and
re-run, not quoted. Where a claim was confirmed it says so; where a claim was confirmed but the
value it protects is defeated elsewhere in the stack, that is recorded as a finding rather than a
pass.

Drivers added by this track:

- `scripts/verify-oversell-probe.mjs` — AT-87, two concurrent checkouts through the deployed function
- `scripts/verify-commerce-rls.mjs` — non vacuous cross shopper isolation

## Gate clause verdicts

| # | Clause | Verdict |
|---|---|---|
| 1 | PRD-07 Journeys A to F end to end | **NOT VERIFIED** (web UI drive blocked, see F1) |
| 2 | Admin advances the order live, one timeline, one audit, skip rejected | **VERIFIED** |
| 3 | Commerce ledger group balances, one group per order, no denormalized balance | **VERIFIED** |
| 4 | No oversell, demonstrated | **VERIFIED** |
| 5 | Reservation lifecycle closed on all three exits | **VERIFIED** |
| 6 | Unified expiry sweep scheduled, running, across three domains | **VERIFIED** |
| 7 | typecheck/build/lint green, advisor diffed, light and dark evidence | **PARTIAL** (evidence missing, see F1) |

## Clause 4, AT-87 oversell. The headline.

Track A proved the property at the RPC level with parallel Postgres connections. This is the
deployed HTTP path, which is different code: availability pre check, intent insert, reserve RPC,
draft insert, Razorpay call.

Two **distinct** shoppers, ids asserted to differ before anything downstream was trusted:

- A `58756043-7c59-43b2-b23a-c72f0011970f` (`player@atlitos.dev`)
- B `dc6b14da-6696-4c1e-912d-b8cc959f8f1e` (`p2-verify-athlete@atlitos.dev`)

Variant `30000000-0000-0000-0000-000000000004` (GLOVE-CRI-M), raw stock 1, `held_qty` 0.
Both checkout calls constructed first and dispatched in the same tick via `Promise.all`.

Result, run 1:

- A: **200**, intent `844951f4-be0c-4f98-8726-93133136f992`, razorpay order `order_TFjhLbLQ8ghSAz`,
  bill `{subtotal 350, delivery 50, gst 63, roundup 0, total 463}`
- B: **409 `OUT_OF_STOCK`**, message `Not enough stock for variant(s): 30000000-...-0004`
- capture through the deployed `verify-payment`: 200, order `d20cff4c-2642-4a22-8415-cedbab91fe9e`
  `#ATL00008`, status `placed`
- `product_variants.stock` 1 to 0. Never negative. `product_variants_stock_check`
  (`CHECK (stock >= 0)`) confirmed present and never fired.

**Razorpay was not called for the loser, and the proof is stronger than the clause asks for.**
B did not merely fail before the Razorpay call, it produced **no `payment_intents` row at all**.
The only commerce intents in the table belong to A. B was refused at step 3, the availability pre
check, which runs before the intent is created and long before `createOrder`.

Run 2 (warm functions, `NO_CAPTURE=1`) reproduced the same shape: one 200, one 409 `OUT_OF_STOCK`,
again with no intent row for the loser.

Caveat recorded honestly: across both runs the refusal landed on the **step 3 pre check**, not on
step 5's authoritative `reserve_stock_for_checkout` under row lock. The step 5 refusal is the
narrower race and it is the one Track A proved directly with overlapping connections. It was not
reproduced through the deployed function here, because hitting it requires both requests to clear
step 3 inside the window before either commits its reservation, which is timing dependent and did
not occur in two attempts. The property holds either way (step 5 is authoritative and Track A
exercised it), but the deployed path has only been observed taking the earlier exit.

## Clause 3, AT-86 money

Summed `ledger_entries` where `domain='commerce'`, grouped by `entity_id` and `entry_group_id`.

| order | id | legs | debit | credit | imbalance | groups | donation legs |
|---|---|---|---|---|---|---|---|
| `#ATL00006` | `47f313f4` | 2 | 1230.00 | 1230.00 | 0.00 | 1 | 0 |
| `#ATL00007` | `c4c8fcca` | 3 | 1230.00 | 1230.00 | 0.00 | 1 | 1 |
| `#ATL00008` | `d20cff4c` | 2 | 463.00 | 463.00 | 0.00 | 1 | 0 |

`#ATL00008` is an order this track created itself, so the assertion does not rest solely on
fixtures another track left behind. Every group balances, exactly one group per order, exactly one
order per group.

Leg shape matches D1: debit platform clearing, credit platform commerce revenue, and for
`#ATL00007` a separate credit platform 1.18 `Donation roundup held for Empower allocation`.

**No denormalized balance column exists anywhere.** Scanned every column in `public` matching
`%balance%`, `%ledger_total%`, `%running%`. Zero rows.

## The zero roundup edge, resolved

Track E seeded a cart on the belief that GST is 10 percent. Track C found it is stored as a
FRACTION. Track C is right, and the real config is:

| domain | key | value |
|---|---|---|
| commerce | `delivery_flat` | 50.0000 |
| commerce | `gst_percent` | **0.1800** |
| commerce | `donation_roundup_multiple` | 10.0000 |

So with all catalog prices being whole rupees, the pre roundup total in paise is
`118 * S + 5000` where `S` is the subtotal in rupees. That is a multiple of 1000 paise exactly when
`118 * S ≡ 0 (mod 1000)`, i.e. `59 * S ≡ 0 (mod 500)`, and since `gcd(59, 500) = 1`:

> **The zero roundup edge is reached exactly when the cart subtotal is a multiple of ₹500.**

Track E's intended cart does **not** hit it, and its stated arithmetic was wrong three ways
(delivery is 50 not 40, GST is 18 percent not 10, so socks at 100 gives 100 + 50 + 18 = 168, a
roundup of 2 and a total of 170, not 150).

Measured through the deployed `checkout` with the box CHECKED:

| cart | subtotal | gst | pre roundup | roundup | total |
|---|---|---|---|---|---|
| 1x Professional Cricket Bat | 1500 | 270 | 1820 | **0** | 1820 |
| 1x Tennis Racket Carbon | 2500 | 450 | 3000 | **0** | 3000 |
| 5x Sports Socks Pack | 500 | 90 | 640 | **0** | 640 |
| 1x Sports Socks Pack (Track E's cart) | 100 | 18 | 168 | 2 | 170 |
| 2x Cricket Legguards | 900 | 162 | 1112 | 8 | 1120 |

**The edge is genuinely reachable from the shopper UI, in one tap.** A single Professional Cricket
Bat (`30000000-...-0001`, ₹1500, stock 8) or a single Tennis Racket Carbon Series
(`30000000-...-0021`, ₹2500, stock 7) each land on it with one Add To Cart and no quantity fiddling.
It is not an API only curiosity.

Track B's `#ATL00006` claim independently confirmed: 2 legs, zero donation legs, `donation_roundup`
0.00, imbalance 0.00.

Client side suppression is correct too: `shouldShowRoundupRow` in
`apps/mobile/src/lib/commerce-bill.ts` returns false only for the ticked-but-zero case, so the row
is suppressed rather than rendered as 0.00, and the unticked checkbox stays visible and tappable.
The client derives the bill in paise mirroring the edge function statement for statement and reads
`gst_percent` as a fraction, so there is no PRICE_MISMATCH trap between the two.

## Clause 5, reservation lifecycle, all three exits witnessed

| exit | evidence |
|---|---|
| consumed | reservation `0dd83bb8` on intent `844951f4` went `held` to `consumed` at capture, raw stock 1 to 0 |
| released | reservation `6691d097` on intent `b8d7d687` released with the webhook's exact reason `payment.failed`; raw stock untouched at 8; availability restored 7 to 8; second call returned null, so idempotent |
| swept | reservation `c9676855` backdated past TTL, then cleared to `released` by the **scheduled cron**, run id 7 at 11:15:00, not by hand |

TTL confirmed at exactly 15 minutes (`11:13:20` created, `11:28:20` expires).

Track A's subtler claim independently confirmed: an expired hold is **already excluded from
availability before the sweep runs**. At 11:14:21 the reservation still read `held` while
`available_stock` already read 1. Correctness does not depend on cron latency; the sweep only makes
the row's status honest.

`razorpay-webhook`'s `handlePaymentFailed` is wired to `release_reservation` with reason
`payment.failed` for `domain === 'commerce'`, confirmed in source.

## Clause 6, AT-26 sweep

`cron.job` id 1, `expire-stale-holds`, `*/5 * * * *`, active, command `select public.expire_stale_holds();`.

`cron.job_run_details` shows runs 1 through 7 all `succeeded`. Run 1 started
`2026-07-20 10:45:00.041576`.

Sessions `4a64c535-57e1-4c69-a2a4-a07db338bd75` and `4ee5bca9-e336-4ead-ac9b-dd0f04ffd48e` are both
`cancelled`, reason "Payment was not started. This booking was released.", `updated_at`
`10:45:00.041626`. That is 50 microseconds after run 1 started, so they were cleared **by that run**,
not by hand. Track B's claim confirmed.

`expire_stale_holds()` source read in full. It covers **all three domains**:
`court_booking_expire_payment` for courts, `session_abandon_unpaid` for sessions, and
`release_expired_stock_reservations()` for commerce, returning a JSON tally of each.

## Clause 2, admin lifecycle (Track D claim)

Driven through the deployed `admin-order-advance` with a real admin JWT
(`d247e386-47b2-49cd-9b51-39f767830faf`) against `#ATL00008`.

Baseline: 1 timeline row, 0 audit rows, status `placed`.

- `placed` to `shipped` with a note: **200**. Timeline 1 to 2, audit 0 to 1. **Exactly one of each.**
- `shipped` to `delivered` (skips `in_transit`), note supplied: **409 `INVALID_TRANSITION`**,
  "order d20cff4c... cannot move from shipped to delivered"
- `shipped` to `placed`: 400 `VALIDATION`, "to_status must be one of shipped, in_transit, delivered."
- `shipped` to `cancelled`: 409 `CANCEL_NOT_AVAILABLE`, "Cancelling an order needs the refund path,
  which is not built yet."

After all three rejections: timeline still 2, audit still 1, status still `shipped`. **Zero rows
written by a rejected transition.** Track D's claim verified in full.

Note on method: an initial skip attempt without a note returned `VALIDATION` for the missing note
and never reached the state machine. A skip probe that omits the note therefore does not test what
it appears to test. The result above supplies the note so the rejection is the database's.

## RLS, non vacuously

`scripts/verify-commerce-rls.mjs`. Ids asserted to differ first (AT-62 lesson), then each side
seeded rows of its own through the real RPCs, then every table read **unscoped** with each
shopper's own JWT so the question is what RLS alone returns.

| table | A rows | B rows | non vacuous | A sees foreign | B sees foreign |
|---|---|---|---|---|---|
| `orders` | 3 | 0 | yes | 0 | 0 |
| `cart_items` | 1 | 1 | yes | 0 | 0 |
| `addresses` | 1 | 1 | yes | 0 | 0 |
| `product_wishlist_items` | 1 | 1 | yes | 0 | 0 |

Verdict: ISOLATED AND NON VACUOUS. Zero cross visibility in either direction on all four tables.

A first pass of this probe had the cart and wishlist RPC names wrong, so both tables returned zero
rows for both shoppers and "isolated" was true for the wrong reason. That is precisely the AT-62
shape, caught here only because the probe asserts non vacuity explicitly. Kept in the script.

## Clause 7, build and advisor

`pnpm turbo typecheck` **green, 12/12** (build tasks cached green in the same run).

Security advisor, 116 lints. Three are ERROR level, all `security_definer_view`:
`public_profiles`, `coach_profiles_public` (both pre existing, P2/P3 baseline) and
`product_variant_availability` (new in P4). The new one is **documented and intentional** in
`docs/architecture/RLS.md` line 218: the view must read `stock_reservations`, which no client may
read, and with `security_invoker = true` the reservation join would return zero rows for every
client, `held_qty` would silently compute as 0, and the view would report raw stock while claiming
to report available. That failure is invisible and it oversells. No new unexplained advisor.

Remaining WARN classes are the carried forward P2/P3 debt (`auth_allow_anonymous_sign_ins` 47,
`authenticated_security_definer_function_executable` 37, `function_search_path_mutable` 14, etc.).

## Findings, ranked by severity

### F1. HIGH. Order Detail renders the LIVE address, defeating the `ship_to_*` snapshot.

The database half is correct and I verified it directly: I edited address
`c8971c75-5b0f-4a8f-824f-3b90857fdfd0` to "77 Snapshot Test Road, Mysuru, 570001" and all three
orders continued to report `ship_to_line1` "12 Verification Lane", `ship_to_city` "Bengaluru",
`ship_to_pincode` "560001". Track B's snapshot claim is **true at the data layer**.

The presentation layer throws it away. `getOrder` in `packages/api/src/use-shop.ts` (around line
898) selects `addresses ( id, line1, line2, city, state, pincode, is_default )` — a live foreign key
join — and maps it to `OrderDetail.address`. `apps/mobile/src/app/shop/order/[id]/index.tsx` lines
202 to 208 render `order.address.line1` / `.city` / `.state` / `.pincode`.

**Nothing in `apps/` references `ship_to_line1` at all.** `grep -rn ship_to_line1 apps` returns
nothing.

So the founder-visible symptom the snapshot was built to fix is still live: editing a saved address
retroactively changes what a past order appears to have shipped to, on the actual screen a shopper
looks at. Worse, `address_id` is now nullable `ON DELETE SET NULL`, so once a shopper deletes an
address, `order.address` is null and the whole "Shipping to" block disappears from the past order
rather than showing the address it actually shipped to.

Track B's build notes state the requirement explicitly ("Order Detail renders `orders.ship_to_line1`
... `ship_to_pincode`, never the `address_id` join"). Track C did not pick it up. This is a data
correctness bug on a money adjacent record, not a cosmetic one. Not fixed here per the brief; it is
a small, contained change in `getOrder` plus the render block.

Reproduction: edit the default address in the address book, then open any past order.

### F2. HIGH. The web UI drive could not be run, so gate clause 1 is unverified and clause 7's light and dark evidence does not exist.

Four Chrome browsers are connected to this account. The browser tool requires the **user** to choose
which one, and a subagent has no channel to ask. The documented failure mode of guessing is that
clicks land in the wrong browser and silently no-op, which would have produced screenshots that look
like evidence while proving nothing. I judged fabricated evidence worse than a missing gate clause,
so I stopped.

Consequence: PRD-07 Journeys A to F have **not** been driven through the real UI by anyone. No track
has done this. The Expo web server was started successfully and serves 200 on
`http://localhost:8090`, so the drive is ready to run the moment a browser is selected. Everything
this track verified is backend and API level.

`docs/phases/evidence/p4-web/` therefore contains this document and no screenshots.

### F3. MEDIUM. The admin Order Detail shows no delivery address at all.

`apps/admin/src/pages/orders/show.tsx` line 58 selects `address_id` but never selects or renders any
address field, snapshot or joined. An admin advancing a parcel to `shipped` cannot see where it is
going. Track B's note that "Track D's admin Order Detail should read the snapshot too" was not
actioned. PRD-04 FR-21's Order Detail is thin here.

### F4. MEDIUM. The step 5 reserve refusal has never been observed through the deployed function.

See clause 4. Both deployed-path races exited at the step 3 pre check. The authoritative lock level
refusal is proven only at the RPC level by Track A. This is not a defect, and the invariant holds
either way, but the deployed function's narrow race window is untested and should be recorded as
such rather than assumed covered.

### F5. LOW. `addresses` has no recipient name or phone column.

Columns are `id, user_id, line1, line2, city, state, pincode, is_default, created_at`. A delivery
address with no recipient name and no contact number is not dispatchable in practice. PRD-07 FR-15's
address form cannot collect either. Flagging as a scope question for the founder rather than a bug,
since no FR names them.

### F6. LOW. Track B's documented `release_reservation` reason does not match the code.

The status doc says the reason `handlePaymentFailed` passes was exercised; the code passes the
literal string `payment.failed`, while the doc's narrative quotes a longer sentence. Cosmetic
documentation drift only; the code path is correct and was exercised with the real string.

## Fixture changes made by this track

- `p2-verify-athlete@atlitos.dev` password set to the standard demo password so a second real shopper
  JWT could be minted. Done in SQL via `crypt`, no credentials typed into any UI.
- Address `2a13256c-eec1-4627-b197-7d2873a9b406` created for that shopper.
- Order `#ATL00008` `d20cff4c` created and advanced to `shipped`, with its balanced ledger group.
- Address `c8971c75` was edited for the F1 snapshot test and **restored** to "12 Verification Lane,
  Bengaluru, 560001".
- Variant `30000000-...-0004` **restored to raw stock 1** so the AT-87 probe is re-runnable as seeded.
- All reservations opened by these probes were released; `held_qty` on the probe variant is 0.
