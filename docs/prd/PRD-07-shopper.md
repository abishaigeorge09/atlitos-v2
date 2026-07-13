# PRD-07: Shopper (Native Commerce, Consumer App)

Status: draft for P0 gate
Owner: Atlitos v2 build
Depends on: PRD identity/roles, PRD payments (BillSummary, edge functions), PRD empower (donation roundup fund)

## 1. Purpose and stakeholder definition

Purpose: let an athlete buy real sports gear inside the Atlitos consumer app, end to end, with no external checkout or affiliate redirect. Commerce funds the platform (order margin, delivery, GST pass through) and feeds the Empower donation pool through a checkout roundup.

Stakeholders:
- Shopper: any authenticated athlete or guest browsing the consumer app who buys gear. Primary actor for every flow in this PRD.
- Guest user: can browse, view PDP, and add to wishlist locally, but must authenticate before cart checkout (guest gate).
- Admin (back office, PRD-04): owns product catalog, stock, and drives the order lifecycle forward. Admin write paths are out of scope here and specified in PRD-04; this PRD only reads the lifecycle admin produces.
- Atlitos platform: collects GST and delivery pass through, and receives the donation roundup which is routed to the Empower fund (PRD-06).
- UPA fund recipients: indirect beneficiary of the donation roundup checkbox; no direct interaction in this PRD.

## 2. Jobs to be done

- JTBD-1: As a shopper, I want to browse gear by sport/category so I can find what I need for my game.
- JTBD-2: As a shopper, I want to see size, price, and stock on a product before I buy so I do not order something unavailable.
- JTBD-3: As a shopper, I want to save gear I am not ready to buy so I can find it again later.
- JTBD-4: As a shopper, I want a cart that reflects real stock so my checkout does not fail at the last step.
- JTBD-5: As a shopper, I want to pay once, confidently, with a clear breakdown of what I am charged, including the option to round up for a cause.
- JTBD-6: As a shopper, I want to track my order after paying so I know when it will arrive.
- JTBD-7: As a shopper, I want to tell Atlitos how the order went so my feedback is on record.
- JTBD-8: As a shopper, I want one place to see all my past and current orders.

## 3. Surfaces and screens

All screens live in the consumer Expo app under the shop and account route groups. Every screen ships four states: loading (skeleton), empty, populated, error, unless noted otherwise.

1. `/shop/category/[sport]` — Category Browse
   - Loading: skeleton grid of ProductCard.
   - Empty: no products in this category, "Recommended Gears" rail still shown if available, else empty illustration with copy directing back to Home.
   - Populated: ProductCard grid (variant grid), sport/category chips, search bar (plain variant), Recommended Gears rail.
   - Error: retry state on fetch failure.

2. `/shop/product/[id]` — Product Detail (PDP)
   - Loading: skeleton gallery + title block.
   - Empty: not applicable (404 routes to Error).
   - Populated: image gallery, title, price, variant selector (size), stock indicator per variant, Add to Cart, wishlist heart, description.
   - Error: product not found (404) or fetch failure, both route to a not found state with back to category.
   - Sub state: selected variant OUT_OF_STOCK disables Add to Cart and shows inline notice, does not block viewing the PDP.

3. `/shop/cart` — Cart
   - Loading: skeleton cart lines.
   - Empty: "Your cart is empty" with Browse Gear CTA.
   - Populated: ProductCard (variant cartLine) per item with qty stepper, subtotal, Proceed To Buy.
   - Error: fetch/update failure with retry.
   - Sub state: any line whose live stock is below requested qty shows inline OUT_OF_STOCK or qty capped, and blocks Proceed To Buy until resolved.

4. `/shop/checkout` — Checkout / Order Summary
   - Loading: skeleton summary.
   - Empty: not applicable (cart empty routes back to cart).
   - Populated: item list, BillSummary (subtotal, delivery, GST, donation roundup checkbox row, total), Shipping Address block (empty: "No address found. Add Address"; filled: selected address with change option), Continue to pay.
   - Error: PRICE_MISMATCH or OUT_OF_STOCK surfaced inline per FR-19/FR-20, NO_ADDRESS blocks Continue.

5. `/shop/checkout/address` — Add / Select Address
   - Loading: skeleton address list.
   - Empty: no saved addresses, form open by default.
   - Populated: address list with select, Add New Address form.
   - Error: PINCODE_INVALID inline field error, save failure toast.

6. `/shop/order-success` — Order Success
   - Single state (populated only, reached only after a paid order): "Order Successfully Placed!! #ATL39284" style confirmation, Track My Order, Explore More.

7. `/shop/order/[id]` — Order Detail / Tracking
   - Loading: skeleton timeline.
   - Empty: not applicable.
   - Populated: OrderTimeline (placed, shipped, in transit, delivered, or cancelled), order items, BillSummary recap, Write Feedback action (enabled once delivered).
   - Error: 404 or fetch failure.

8. `/shop/orders` — My Orders
   - Loading: skeleton list.
   - Empty: "No orders yet" with Browse Gear CTA.
   - Populated: order cards with status chip, date, total, tap through to order detail.
   - Error: retry state.

9. `/shop/order/[id]/feedback` — Order Feedback
   - Loading: skeleton form (rating + text).
   - Empty: not applicable.
   - Populated: rating input, free text, submit.
   - Error: submit failure toast, feedback already submitted shows read only view.

10. `/account/wishlist` — My Wishlist (product)
    - Loading: skeleton WishlistGrid.
    - Empty: "Nothing saved yet" with Browse Gear CTA.
    - Populated: WishlistGrid (variant product), Move to Cart per item.
    - Error: retry state.

11. `/account/addresses` — Address Book
    - Loading: skeleton list.
    - Empty: "No saved addresses" with Add Address CTA.
    - Populated: address cards, edit, delete, set default.
    - Error: retry state.

## 4. Functional requirements

FR-1. Category Browse displays products filtered by sport/category, reading from `products` and `product_variants` with live stock, sorted by a default relevance order.

FR-2. Category Browse shows a Recommended Gears rail sourced from a recommendation field on the product read (heuristic in v1, LLM ready contract preserved from v1 SPEC).

FR-3. Category Browse search bar filters products by query string against product title and category.

FR-4. PDP displays all variants (size) for a product with per variant price and live stock count or in stock / out of stock state.

FR-5. PDP Add to Cart is disabled when the selected variant has zero stock, and shows inline OUT_OF_STOCK messaging.

FR-6. PDP wishlist heart toggles the product in the shopper's wishlist idempotently (on/off), persisted per authenticated user.

FR-7. Guest users may browse category and PDP screens and use client side wishlist, but Add to Cart and Checkout require authentication; attempting either triggers the guest gate (auth prompt) per existing guest-gate flow.

FR-8. Cart reflects the authenticated shopper's persisted cart lines (product, variant, qty) read from `orders` in draft state or an equivalent cart table, not local only state, so it survives app restarts.

FR-9. Adding to cart, or updating cart qty, revalidates live stock server side; a request that exceeds available stock returns OUT_OF_STOCK and the cart line is capped to available stock, never silently rounded up.

FR-10. Removing a cart line removes it immediately and recomputes subtotal.

FR-11. Cart subtotal is computed server side from live product prices at read time, not from client cached prices.

FR-12. Proceed To Buy is disabled while any cart line is in an OUT_OF_STOCK or qty capped state; the shopper must resolve each line (reduce qty or remove) before proceeding.

FR-13. Checkout displays BillSummary with rows: Subtotal, Delivery Charges, GST, Donation line ("Support a Rising Athlete in Need" with checkbox, unchecked by default), bold Total. This is the same BillSummary component used on every money surface in the app.

FR-14. Checkout requires a selected shipping address before Continue is enabled; if none exists, "No address found. Add Address" routes to the address screen.

FR-15. Address form validates pincode format client side and server side; an invalid pincode returns PINCODE_INVALID and blocks save.

FR-16. Checkout donation roundup checkbox, when checked, adds a fixed roundup amount (config driven, not user typed) to the Total and is included in the payload sent to the checkout edge function.

FR-17. Checkout submission calls the `checkout` edge function with the full computed bill (items, addressId, donationRoundup, subtotal, deliveryCharges, gstAndOthers, total); the client never writes the order row directly.

FR-18. The checkout edge function is authoritative: it re-fetches current prices and stock for every line server side and recomputes the bill before charging.

FR-19. If the server recomputed total differs from the client submitted total, the edge function rejects with PRICE_MISMATCH and the client re-displays the corrected BillSummary for shopper confirmation before retrying; no charge occurs on mismatch.

FR-20. If any line is out of stock at the moment of checkout, the edge function rejects the whole checkout with OUT_OF_STOCK and identifies the offending line(s); the client returns the shopper to cart with those lines flagged, no charge occurs.

FR-21. On successful payment confirmation, stock decrement for every purchased variant and order row creation happen in a single transactional unit inside the edge function (service role); a payment success with a failed stock decrement is not a reachable state.

FR-22. Order placement uses Razorpay test mode checkout invoked from the checkout edge function's created order; on payment success the order is created in `placed` state, on payment failure no order is created and the shopper returns to checkout with a retry option.

FR-23. Order Success screen displays the order id and confirmation only after the order row exists in `placed` state; it is not reachable by direct navigation without a completed order.

FR-24. Order Detail's OrderTimeline reflects the order's current lifecycle state (placed, shipped, in_transit, delivered, or cancelled) as driven by admin actions in PRD-04; the shopper app never writes lifecycle transitions.

FR-25. Order Detail recaps the BillSummary exactly as charged at checkout time (not recomputed against current prices).

FR-26. Write Feedback is only available once an order reaches delivered state; submitting feedback is a one time action per order (idempotent, shows read only view after submit).

FR-27. My Orders lists all of the authenticated shopper's orders across all lifecycle states, newest first, with a status chip per lifecycle state.

FR-28. My Wishlist (product) lists all products the shopper has saved, reading live price and stock at display time.

FR-29. Move to Cart on a wishlist item adds it to cart at qty 1 (variant selection required if the product has multiple variants) subject to FR-9 stock revalidation.

FR-30. Address Book supports add, edit, delete, and set default address; delete of an address referenced by an in flight (non delivered, non cancelled) order is blocked with an inline explanation.

FR-31. Every screen in this PRD ships all four states specified in Section 3 (loading, empty, populated, error); no screen ships spinner only loading.

FR-32. All monetary values in this PRD render in JetBrains Mono with Indian rupee grouping, consistent with the design language token rules.

## 5. Data touched

Schema domain: commerce (per PLAN.md: products/variants/stock, orders admin-driven), plus reads into payments and empower domains.

| Table | Read | Write |
|---|---|---|
| products | yes (browse, PDP, recommendations) | no |
| product_variants | yes (size, price, stock) | no (stock write only via checkout edge function transaction, service role) |
| categories | yes (browse filter) | no |
| product_wishlist_items | yes (my wishlist) | yes (toggle, client via RLS scoped to own user) |
| cart_items | yes | yes (add, update qty, remove, all scoped to own user via RLS; resolved as a dedicated persisted table, not a draft order row, per SCHEMA.md) |
| addresses | yes (checkout, address book) | yes (add, edit, delete, set default, own user via RLS) |
| orders | yes (order detail, my orders, order success) | write only via checkout edge function (service role); no direct client write |
| order_items | yes (order detail line items) | write only via checkout edge function (service role) |
| order_feedback | yes (order detail, read own submitted feedback) | yes (submit, own user via RLS, insert only, one row per order enforced) |
| payment_intents | no direct shopper read beyond order status | write only via checkout / razorpay edge functions (service role) |
| ledger_entries | no | no (edge function / service role only, not exposed to this PRD's surfaces) |
| donation roundup config (fee_config or equivalent) | yes (read fixed roundup amount for checkbox) | no |

## 6. Payment touchpoints

All money in this PRD flows through the `checkout` edge function and Razorpay test mode; no client code ever writes a payment_intent, ledger_entry, or order row directly.

- `/shop/checkout`: BillSummary shown before payment (subtotal, delivery, GST, donation roundup, total). Continue calls `checkout` edge function, which creates a Razorpay order, re-prices, and returns a payment handoff to the Razorpay test checkout UI (react-native-razorpay).
- Razorpay test checkout: shopper pays with test card; success/failure returned to app.
- `razorpay-webhook` edge function (service role, not shopper facing): confirms payment, triggers the transactional stock decrement plus order row creation from FR-21, writes ledger_entries and the donation roundup amount into the Empower fund ledger.
- `/shop/order/[id]`: BillSummary recap of the exact charged amount (FR-25), read only, no payment action.
- Failure paths: PAYMENT_FAILED (no order created, shopper retries from checkout), PRICE_MISMATCH (FR-19), OUT_OF_STOCK (FR-20). All three are non charging failure states; Razorpay is only called after server side re-pricing and stock validation succeed.

## 7. Acceptance criteria per journey

### Journey A: Browse to PDP
- AC-A1: Given a shopper on `/shop/category/football`, when the category has products, then a grid of ProductCard renders with image, title, price for each.
- AC-A2: Given a shopper opens a PDP, when the product has multiple size variants, then each variant's price and stock state are individually visible before adding to cart.
- AC-A3: Given a variant with zero stock, when the shopper selects it, then Add to Cart is disabled and an inline OUT_OF_STOCK message is shown.

### Journey B: Wishlist
- AC-B1: Given an authenticated shopper on a PDP, when they tap the wishlist heart, then the product appears in `/account/wishlist` without a page reload.
- AC-B2: Given a wishlisted product, when the shopper taps the heart again, then it is removed from `/account/wishlist`.
- AC-B3: Given a guest user, when they tap the wishlist heart, then it saves locally and does not require authentication (per FR-7).

### Journey C: Cart to stock revalidation
- AC-C1: Given a shopper adds 2 units of a variant with 5 in stock, when they view `/shop/cart`, then the line shows qty 2 and the correct line total.
- AC-C2: Given a cart line's variant stock drops to 1 (e.g. purchased by another shopper) before checkout, when the shopper opens `/shop/cart`, then the line is capped to 1 with an inline notice and Proceed To Buy is disabled until resolved.
- AC-C3: Given all cart lines are in stock, when the shopper taps Proceed To Buy, then they land on `/shop/checkout` with BillSummary populated.

### Journey D: Checkout and payment
- AC-D1: Given a shopper on `/shop/checkout` with no saved address, when the screen loads, then "No address found. Add Address" is shown and Continue is disabled.
- AC-D2: Given a shopper selects an address and checks the donation roundup box, when they view BillSummary, then Total includes the roundup amount as a separate line before the bold Total.
- AC-D3: Given a shopper taps Continue to pay, when the server recomputes the bill and it matches the client submission, then Razorpay test checkout opens with the confirmed total.
- AC-D4: Given the server recomputes a different total than the client submitted (e.g. price changed), when checkout is attempted, then no charge occurs, PRICE_MISMATCH is returned, and the client shows the corrected BillSummary for re-confirmation.
- AC-D5: Given a line goes out of stock between cart and checkout submission, when checkout is attempted, then no charge occurs, OUT_OF_STOCK is returned identifying the line, and the shopper is routed back to cart with that line flagged.
- AC-D6: Given a successful Razorpay test payment, when the webhook processes it, then exactly one order row is created in `placed` state and stock for every purchased variant is decremented by the purchased quantity, atomically (no partial state).
- AC-D7: Given a failed Razorpay test payment, when the shopper returns to the app, then no order row exists and checkout is retryable with a fresh price/stock check.

### Journey E: Order success and tracking
- AC-E1: Given a successful checkout, when the shopper lands on `/shop/order-success`, then the order id is displayed and Track My Order navigates to `/shop/order/[id]`.
- AC-E2: Given an order in `shipped` state (set by admin per PRD-04), when the shopper opens `/shop/order/[id]`, then OrderTimeline shows a shipped entry with date and location, and no delivered entry.
- AC-E3: Given an order reaches `delivered` state, when the shopper opens the order, then Write Feedback becomes available.
- AC-E4: Given a shopper submits feedback once, when they revisit the order, then the feedback form shows a read only view and cannot be resubmitted.

### Journey F: My Orders and Address Book
- AC-F1: Given a shopper with 3 orders in different lifecycle states, when they open `/shop/orders`, then all 3 appear newest first, each with its correct status chip.
- AC-F2: Given a shopper with zero orders, when they open `/shop/orders`, then the empty state with a Browse Gear CTA is shown, not a blank screen.
- AC-F3: Given a shopper tries to delete an address used by a `shipped` order, when they attempt delete in `/account/addresses`, then delete is blocked with an inline explanation.

## 8. Explicitly out of scope

- Product catalog CRUD, category management, and stock replenishment (admin side; PRD-04).
- Admin driven order lifecycle advancement UI (PRD-04); this PRD only reads the lifecycle.
- Affiliate or third party marketplace checkout of any kind; commerce is native only, per PLAN.md lock.
- Coupons, promo codes, and discount stacking logic (not in v1 scope; open question below).
- Multi item split shipping or multi vendor fulfillment; v1 assumes a single fulfillment path per order.
- Returns and refunds flow (not specified in v1 SPEC; separate PRD if founder wants it before P4 gate).
- Guest checkout without authentication; guests must authenticate before payment (FR-7).
- International addresses or non INR currency; India only, ₹ only, per v1 fixtures.
- Push notifications content for order status changes (covered in notifications domain PRD, not here).
- Gift cards, store credit, or wallet balance for shoppers (coach earnings wallet is a separate concern, not shopper facing).
- Real time inventory sync across concurrent carts beyond the checkout time revalidation in FR-9 and FR-18 to FR-20 (no optimistic locking UI beyond capping).

## 9. Open questions for the founder

1. Is a coupon/promo code system needed before the P4 commerce gate, or deferred to a later phase.
2. Should the donation roundup amount be a single fixed config value platform wide, or vary by cart total (e.g. round up to nearest 10)? PLAN.md and v1 SPEC do not specify the rounding rule.
3. Do we need a cancel order action from the shopper side before it ships, or is cancellation admin only in v1 (current v1 SPEC order state machine has no shopper initiated cancel).
4. Should delivery charges be flat, free above a threshold, or pincode dependent? Not specified in v1 fixtures beyond a flat pattern.
5. Is a returns/refunds journey required for the P4 gate, or can it be explicitly deferred to a post P8 PRD.
6. Should wishlist have a capacity limit or expiry, given it is meant to drive re-engagement.
