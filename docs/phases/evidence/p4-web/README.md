# Phase 4 shopper UI evidence (gate clause 1, and clause 7's light and dark)

Run 2026-07-20 against the live project `syzzfgaudpifwvbpycyi`, branch `main` at
`3e18960`. This closes the gap `VERIFICATION.md` recorded as **F2**: PRD-07
Journeys A through F had never been driven through the real UI by anyone. They
have now, by clicking, as a shopper.

## How this was driven

`apps/mobile` served by `npx expo start --web --port 8090`. Port 8081 untouched.

The shopper session was minted **by script** with `signInWithPassword` against
the documented fixture `player@atlitos.dev` / `AtlitosDemo!2026` (the same
constant `scripts/verify-commerce-rls.mjs` uses) and injected into
`localStorage` under `sb-syzzfgaudpifwvbpycyi-auth-token`. **No password, card
number, or other credential was ever typed into the browser.**

Drivers, committed alongside this evidence:

- `scripts/verify-shopper-ui-lib.mjs` — session mint, browser open, theme control, capture
- `scripts/verify-shopper-ui.mjs` — Journeys A through F (`--dark` for the dark pass)
- `scripts/verify-shopper-ui-address-snapshot.mjs` — the address snapshot proof

They drive Chrome through Playwright's `channel: 'chrome'` (no browser
download) so that each capture can be written to disk. Every interaction below
is a real click or keystroke on the real screen; nothing here was produced by
calling an API and screenshotting the result.

### Light and dark

Confirming P3's finding, restated in `p3-web-cycle2/README.md`: real app screens
do **not** follow the system dark preference on web. Dark was therefore set the
way the app's own tooling sets it, by clicking the `ThemeToggle` in
`apps/mobile/src/app/dev/gallery.tsx` (which calls nativewind's
`colorScheme.set()`), then reaching the target screen by `history.pushState` +
a dispatched `popstate` rather than a fresh URL load. No CSS was injected.

**New this pass:** the override survives client side transitions only up to a
point. Several expo router web transitions reload the document and silently drop
it, which on the first dark run produced light screenshots carrying `-dark`
filenames. The driver now re-asserts the override through the app's own toggle
before **every** screen, and `shot()` asserts
`documentElement.classList.contains('dark')` matches the filename before writing,
so a mislabelled capture throws instead of shipping. All 19 dark captures below
passed that assertion.

## The four things nobody had witnessed on screen

### 1. The zero roundup case, both sides of it

The rule `VERIFICATION.md` derived (roundup is zero exactly when the subtotal is
a multiple of ₹500) is now visible in the UI, and the two carts differ by one
cart line removal, driven by clicking.

| capture | cart | subtotal | pre roundup | roundup row |
|---|---|---|---|---|
| `web-shop-11-checkout-billsummary-roundup-SHOWN-{light,dark}.jpg` | bat x2 + gloves x1 | ₹3,350 | ₹4,003 | **APPEARS**, checkbox ticked, derived **₹7**, total ₹4,010 |
| `web-shop-14-checkout-billsummary-roundup-SUPPRESSED-{light,dark}.jpg` | bat x2 | ₹3,000 | ₹3,590 | **SUPPRESSED ENTIRELY**, not rendered as 0.00 |

The suppressed capture is self evidencing. The line "Your total is already a
round figure, so there is nothing to round up this time." renders only when
`roundupOptedIn && !showRoundupRow`, so its presence on screen proves the box was
ticked **and** the row was removed rather than zeroed. `₹3,000` is a multiple of
₹500, which is the edge exactly.

`web-shop-12-cart-remove-confirmsheet-{light,dark}.jpg` and
`web-shop-13-cart-after-remove-{light,dark}.jpg` are the click that moves the
cart between those two states, and incidentally show AT-84's `ConfirmSheet`
("Remove this from your cart?", Remove / Keep it) doing the job `Alert.alert`
could not do on web.

### 2. The address snapshot fix (3e18960) holding on screen

Driven in the UI, in order:

1. `web-shop-19-order-detail-before-address-edit-light.jpg` — order `#ATL00008`,
   SHIPPING TO `12 Verification Lane, Flat 3 / Bengaluru, Karnataka / 560001`
2. `web-shop-20-address-book-EDITED-light.jpg` — the **same** address
   (`c8971c75`, the one that order used) edited through the address book form to
   `77 Snapshot Proof Road, Mysuru, 570001`
3. `web-shop-21-order-detail-shipto-UNCHANGED-light.jpg` — the same order re
   opened. SHIPPING TO still reads `12 Verification Lane, Flat 3 / Bengaluru /
   560001`. **The past order did not change.**
4. `web-shop-22-address-book-restored-light.jpg` — address restored, re read

This is F1's fix witnessed at the presentation layer, which is the layer the
original finding said was throwing the snapshot away. Order Detail is rendering
`orders.ship_to_*`, not the `address_id` join.

### 3. OUT_OF_STOCK as clean user facing copy, never raw Postgres

Seed variant `30000000-...-0005` (Leather Cricket Gloves, Large) has stock 0.

- `web-shop-05-pdp-out-of-stock-clean-message-{light,dark}.jpg` — selecting that
  size shows "This size is out of stock. Pick another size, or check back soon."
  and Add to cart is **disabled** (asserted programmatically, not eyeballed). The
  PDP stays fully viewable, per FR-5.
- `web-shop-10a-pdp-capped-notice-{light,dark}.jpg` — asking for a second unit of
  the Medium variant, whose available stock is 1, returns "Only 1 left, so your
  cart has 1." The cart is capped, never silently rounded up (FR-9).
- `web-shop-10b-cart-stepper-capped-{light,dark}.jpg` — in the cart, that line's
  Increase quantity control is disabled at the cap while the other line's is not
  (2 steppers, 1 disabled, asserted in the driver).

No raw Postgres text, no error code, no stack, on any of them.

### 4. Per variant stock on the PDP reading availability

`web-shop-04-pdp-per-variant-availability-{light,dark}.jpg` — one product, three
variants, three different readouts on one screen:

```
Large, Black    Out of stock   ₹350
Medium, Black   1 in stock     ₹350
Small, Black    12 in stock    ₹350
```

`VariantRow` reads `variant.availableStock` (the `product_variant_availability`
view), not `product_variants.stock`, per Track A's contract.

## Full capture index

Every file is `web-shop-<n>-<name>-<light|dark>.jpg`. All 19 numbered screens
exist in both themes; captures 19 through 22 are the address snapshot sequence
and are light only, since the proof is a data correctness one rather than a
theming one.

| # | capture | journey | what it proves |
|---|---|---|---|
| 01 | `browse-all-gear` | A | Category Browse populated, ProductCard grid, category chips, Recommended Gears rail (FR-1, FR-2) |
| 02 | `browse-search-cricket` | A | Search bar filters by query string (FR-3) |
| 03 | `browse-category-cricket` | A | Category chip filters the grid (FR-1) |
| 04 | `pdp-per-variant-availability` | A | **Proof 4.** Per variant price and availability (FR-4) |
| 05 | `pdp-out-of-stock-clean-message` | A | **Proof 3.** Clean OOS copy, Add to cart disabled, PDP still viewable (FR-5) |
| 06 | `pdp-wishlist-toggled-on` | B | Wishlist heart toggled on from the PDP, filled state (FR-6) |
| 07 | `wishlist` | B | My Wishlist populated with live prices and stock, Move to cart (FR-28, FR-29) |
| 08 | `pdp-added-to-cart` | C | "Added to your cart." confirmation on the PDP |
| 09 | `cart-populated` | C | Cart lines, qty steppers, server derived subtotal (FR-8, FR-11) |
| 10a | `pdp-capped-notice` | C | **Proof 3.** Cap notice, "Only 1 left, so your cart has 1." (FR-9) |
| 10b | `cart-stepper-capped` | C | **Proof 3.** Stepper disabled at the cap, per line (FR-9) |
| 11 | `checkout-billsummary-roundup-SHOWN` | D | **Proof 1.** BillSummary with all five rows, roundup ticked and derived ₹7 (FR-13, FR-16) |
| 12 | `cart-remove-confirmsheet` | C | AT-84 `ConfirmSheet` on a destructive action, not `Alert.alert` (FR-10) |
| 13 | `cart-after-remove` | C | Line removed, subtotal recomputed (FR-10) |
| 14 | `checkout-billsummary-roundup-SUPPRESSED` | D | **Proof 1.** Roundup row gone at a ₹500 multiple, with the explaining copy |
| 15 | `checkout-razorpay-sheet` | E | Razorpay **Test Mode** sheet opens at ₹3,590, matching the app total exactly |
| 16 | `my-orders` | F | My Orders list, status chips, dates, totals, item counts (FR-27) |
| 17 | `order-detail-shipto-timeline` | F | Order Detail: OrderTimeline, items with snapshots, SHIPPING TO, BillSummary recap (FR-24, FR-25) |
| 18 | `address-book` | F | Address Book populated, Edit / Set default / Add a new address (FR-30) |
| 19 | `order-detail-before-address-edit` | F | **Proof 2.** Baseline before the edit |
| 20 | `address-book-EDITED` | F | **Proof 2.** The order's own address changed in the address book |
| 21 | `order-detail-shipto-UNCHANGED` | F | **Proof 2.** The past order did not follow it |
| 22 | `address-book-restored` | F | **Proof 2.** Fixture restored |

## Not captured, and exactly why

**A completed Razorpay payment, and therefore Order Success (FR-23) and feedback
on a delivered order (FR-26).** Capture 15 reaches the real Razorpay Test Mode
sheet with the correct amount. The next step is the sheet's own "Contact
details" field, then card number, expiry and CVV. Entering card details is a
credential entry this agent will not perform. **This needs the founder to type
into the Razorpay sheet.** Everything up to the sheet is captured, in both
themes, and the money path behind it is already proven separately at the API
level in `VERIFICATION.md` (clause 3, three balanced orders including one placed
by Track F itself).

Consequently `/shop/order-success` and `/shop/order/[id]/feedback` have no UI
capture. They are the only two PRD-07 section 3 screens not represented here.

**`21-order-detail-shipto-UNCHANGED-dark`.** The Expo dev server exited during
the final dark capture. The light capture carries the proof; the dark pass of
that same screen exists as capture 17.

## Fixture state left behind

- Address `c8971c75` was edited for proof 2 and **restored** to
  `12 Verification Lane / Bengaluru / 560001`, confirmed by re read in SQL.
- Three `held` stock reservations on variant `30000000-...-0001` (the bat),
  qty 2 each, from the three checkout attempts that reached the Razorpay sheet
  and were abandoned. Raw stock is untouched at 8 and availability already
  excludes them. These are deliberately **left for the AT-26 sweep** rather than
  cleared by hand, since abandonment is exactly the third exit clause 5 names.
- The cart is left non empty (Professional Cricket Bat x2). No order was created
  by this pass, because no payment was completed.
- The wishlist gained Leather Cricket Gloves from capture 06.

## New defects found

### N1. LOW. An AT-71 verification fixture category is visible to shoppers.

`TrackB Verify` renders as a category chip on Category Browse, in every capture
of screen 01 and 03. Track B's build note states its fixtures "appear in no
shopper facing surface (the availability view filters on `products.active`)".
That holds for the **products**, and the chip leads to an empty grid, but the
**category row** itself has no `active` filter behind it, so the category
survives into the shopper UI carrying an internal track name. Confirmed in SQL:
the category has 0 active products.

Fix is either a soft delete on `categories`, or filtering the chip list to
categories that have at least one active product. The second is probably right
anyway, since an empty category chip is a dead end regardless of its name.

### N2. LOW. The dark override is silently lost on some route transitions.

Described under "Light and dark" above. This is a property of the evidence
harness rather than of the product, but it is worth recording because it is a
trap: the naive capture loop produces light screenshots named `-dark` and
nothing complains. Any future phase capturing web theme evidence should assert
the class, as the driver here now does. The underlying product issue (no theme
control on any real screen, no working system follow on web) is P3's deferred
defect, unchanged.

## Gate clause 1 status

PRD-07 Journeys **A** (browse), **B** (PDP, per variant stock, wishlist),
**C** (cart with stock capping), **D** (checkout with BillSummary and the
roundup row), and **F** (order tracking, Order Detail, My Orders, Address Book)
are driven end to end through the UI and captured in light and dark.

Journey **E** is captured up to the Razorpay sheet and no further, for the
credential reason above. Clause 1's phrase "a real Razorpay test payment"
therefore remains open on the UI path and needs the founder, or an explicit
decision that the API level proof in `VERIFICATION.md` clause 3 satisfies it.
