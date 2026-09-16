# Mobile: shop, Empower donations, Learn

Part of the verified workflow map, see [README.md](README.md). 20 workflows, 43 screens.

## Contents

1. Browse, search and filter gear (guest)
2. Find gear or an athlete through AI search (guest)
3. Product detail, select size, out of stock, add to cart (shopper)
4. Cart (shopper)
5. Checkout, bill summary, roundup checkbox, pay, order success (shopper, money)
6. Add or select shipping address at checkout (shopper)
7. My Orders, order detail timeline, refund and feedback (shopper)
8. Wishlist (save gear, My wishlist, Move to cart) (shopper)
9. Address book (add, edit, set default, delete) (shopper)
10. Affiliate product and Buy on retailer click out (guest)
11. Razorpay pay sheet (shared) with processing, success, failed and retry (shopper, money)
12. Empower hub, browse and filter athletes (guest)
13. Athlete (UPA) public profile and wishlist item funding (guest)
14. Donate (presets, custom amount, minimum, confirm overlay, pay, processing, success, failed) (donor, money)
15. My Impact (donor)
16. Learn home (XP, stage, milestones entry, drills preview) (player)
17. Roadmap (player)
18. Drills library with sport and difficulty filters (player)
19. Drill detail and Mark complete (player)
20. Milestones (player)

---

## 1. Browse, search and filter gear

Category: SPORTS GEAR. Persona: guest. Money: no.

Shop entry. Home's sport category circles and the Recently viewed rail route into the category browse grid at /shop/category/[sport]; bare /shop redirects to /shop/category/all. Search filters by title client side, chips switch category via router.setParams, a Recommended gears rail sits above the grid. Guests browse freely; the heart saves locally for guests and never gates. Category chips come from the admin created categories table (no migration seeds them); a sport slug with no matching category row shows the title Gear and the empty category state.

Release note: RELEASE-TODO task 6 (data entry path for products, Sept 9 to 11) and downstream row 3 (Add equipment, affiliate links) are open, so the live catalog is seed data. UI-UPLIFT-PROPOSAL Designer item 22: product tile drops the 100pt colored blob placeholder for a real cutout; Premium item 29: empty cart and wishlist icon in accentTint circle with secondary CTA. Founder walkthrough BUG-06 (imagery placeholders) recorded in TEST-SUITE-ATHLETE-APP SH-02. RELEASE-TODO G-23, S-01.

After success: Product tap lands on /shop/product/[id]. Back returns to Home.

### Screens

**01 Home (entry)**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx (CategoriesRow in apps/mobile/src/components/organisms/home/CategoriesRow.tsx, RecentlyViewedRail in apps/mobile/src/components/organisms/home/RecentlyViewedRail.tsx, AppBar in apps/mobile/src/components/ui/app-bar.tsx)`
- See: AI search bar, location row, a horizontal row of circular sport icons (one per SPORTS enum value: Goal, CircleDot, Feather, Target with the label under each), promo carousel, Recently viewed rail (h3 Recently viewed, or Shop when nothing was viewed) with See all, Clutch preview, Donate to Empower rail. AppBar brand variant carries an unlabelled ShoppingCart icon with a mono cart count badge (9+ cap).
- Do: Tap a sport circle, or the cart icon, or See all on Recently viewed, or a product card in the rail
- Tap targets: `Football`, `Cricket`, `Badminton`, `Tennis`, `ShoppingCart`, `See all`, `See all gear`, `Product card (accessibilityLabel = title)`
- Then: Sport circle pushes /shop/category/[sport]. Recently viewed See all (accessibilityLabel See all gear) pushes /shop which redirects to /shop/category/all. Rail card pushes /shop/product/[id]. Cart icon pushes /shop/cart for signed in users, opens LoginGateModal for guests.

**02 Category browse (All gear)**  
Route `atlitos://shop/category/all`, source `apps/mobile/src/app/shop/category/[sport].tsx (card apps/mobile/src/components/ui/product-card.tsx)`
- See: Header row with ChevronLeft back (Go back), h1 title (All gear, or the category name), Heart icon (My wishlist) and ShoppingCart icon (My cart). SearchBar plain variant placeholder Search gear. Horizontal filter chips: All gear then one chip per categories row. RECOMMENDED GEARS overline with a horizontal rail of row variant ProductCards. Two column grid of ProductCards (image or Package placeholder labelled Product photo coming soon, title, mono price, heart, ghost Add to cart button). Pull to refresh.
- Do: Type in Search gear, tap a category chip, tap a product card or Add to cart, tap the heart
- Tap targets: `Go back`, `My wishlist`, `My cart`, `Search gear`, `All gear`, `Add to cart`, `Save to wishlist`, `Remove from wishlist`
- Then: Search filters the grid by title client side (shop.filterBySearch). Chip tap calls router.setParams({sport}) and reloads. Card tap and Add to cart both push /shop/product/[id] (the grid's Add to cart does not add, it opens the PDP). Heart toggles wishlist: guest saves locally via useGuestWishlist, signed in calls toggle_product_wishlist with optimistic rollback. My wishlist pushes /account/wishlist, My cart pushes /shop/cart.

**03 Category browse (sport filtered)**  
Route `atlitos://shop/category/[sport]`, source `apps/mobile/src/app/shop/category/[sport].tsx`
- See: Same layout, title is the category name resolved from categories by slug (falls back to Gear), that chip selected.
- Do: Tap All gear to clear, or a product
- Tap targets: `All gear`, `Add to cart`
- Then: Returns to whole catalog or opens the PDP.

### States

- loading: Category browse. Trigger: Open the screen before listProducts, listRecommended and listCategories resolve Source: apps/mobile/src/app/shop/category/[sport].tsx state === 'loading': Skeleton line 45% height 28, Skeleton line height 44, two rows of two Skeleton cards 200
- error: Category browse. Trigger: Any of the three reads throws (airplane mode) Source: apps/mobile/src/app/shop/category/[sport].tsx state === 'error': TriangleAlert, Couldn't load gear, error message or Something went wrong. Please try again., Button Retry with RefreshCw
- empty: Category browse (no matches for search). Trigger: Type a search term that matches no title Source: apps/mobile/src/app/shop/category/[sport].tsx ListEmptyComponent EmptyState icon ShoppingBag title No gear matches that search body Try a different word, or clear the search to see everything. cta Clear search
- empty: Category browse (empty category). Trigger: Open a category with zero active products, or a sport slug with no category row Source: apps/mobile/src/app/shop/category/[sport].tsx EmptyState title No gear in this category yet body New gear lands here regularly. Browse the full catalog in the meantime. cta Browse all gear (setParams sport all); Recommended rail still renders if non empty
- loading: Home Recently viewed rail. Trigger: Open Home before getRecentlyViewedProductIds and listProducts resolve Source: apps/mobile/src/components/organisms/home/RecentlyViewedRail.tsx state === 'loading': Skeleton line 40% and two Skeleton cards width 200; the rail returns null on an empty catalog or a failed read

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/07-shop-catalog.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png
- docs/phases/evidence/p4-web/web-shop-01-browse-all-gear-light.jpg
- docs/phases/evidence/p4-web/web-shop-01-browse-all-gear-dark.jpg
- docs/phases/evidence/p4-web/web-shop-02-browse-search-cricket-light.jpg
- docs/phases/evidence/p4-web/web-shop-02-browse-search-cricket-dark.jpg
- docs/phases/evidence/p4-web/web-shop-03-browse-category-cricket-light.jpg
- docs/phases/evidence/p4-web/web-shop-03-browse-category-cricket-dark.jpg


## 2. Find gear or an athlete through AI search

Category: SPORTS GEAR. Persona: guest. Money: no.

Entry into the shop and Empower surfaces from Home's AI search bar. /home/search calls the ai-search edge function; a gear hit opens the owned PDP at /shop/product/[id], an athlete hit opens the UPA profile at /home/upa/[id]. ai-search prefixes affiliate product ids with affiliate: but openHit routes every gear hit to /shop/product/[id], so an affiliate hit lands on the owned PDP's This gear is no longer listed state. Guest visible; nothing on the search screen gates.

Release note: BUG-LEDGER BUG-006 / WS4 records the affiliate search results verified on device (s-babolat.png, s-wilson.png, not committed), but the client routing of an affiliate hit to the compare screen is not implemented: no caller of /shop/affiliate/[id] exists. UI-UPLIFT-PROPOSAL Designer item 26 (suggestion chips as a 2 column grid) and Premium item 26 (field border and result animation). No committed native screenshot of a results page.

After success: Lands on /shop/product/[id] (owned PDP) or /home/upa/[id] (athlete profile). Back returns to Search with the results intact.

### Screens

**01 Search**  
Route `atlitos://home/search`, source `apps/mobile/src/app/home/search.tsx (results apps/mobile/src/components/organisms/SearchResults.tsx)`
- See: AppBar backTitle Search. SearchBar ai variant autofocused, caption Searching near <city>. Idle: label Suggested with chips Courts near me, Badminton gear, Coaches under 500, Athletes to support, a Recent list (Clock rows) when any, then SearchX with h3 Find coaches, courts, gear, athletes and clips and callout Try "badminton coach near me" or "cricket bat under 1500". Results render in SearchResults with segments (coaches, courts, gear, athletes, clips).
- Do: Type a query and submit, or tap a suggestion chip, then tap a gear or athlete hit
- Tap targets: `Back`, `Courts near me`, `Badminton gear`, `Coaches under 500`, `Athletes to support`, `Result row (SearchHit)`
- Then: openHit: gear pushes /shop/product/[id] with hit.entityId; athlete pushes /home/upa/[id]; coach and court leave this surface. An affiliate gear hit (entityId affiliate:<id>) lands on the owned PDP not found state.

### States

- loading: Search. Trigger: Submit a query before ai-search returns Source: apps/mobile/src/app/home/search.tsx state === 'loading': centered ActivityIndicator in accent
- error: Search error. Trigger: ai-search throws (airplane mode) Source: apps/mobile/src/app/home/search.tsx state === 'error': TriangleAlert, Couldn't run that search, message, Retry with RefreshCw
- empty: No matches. Trigger: Query with no hits (e.g. Wilson racket under 2000 against the seed) Source: apps/mobile/src/app/home/search.tsx SearchResults emptyLabel = broaden (server FR-16 honest string) or No matches for "<query>" near <city>. Try another search.
- error: Affiliate hit misroute. Trigger: Search a seeded affiliate product (Babolat racket under 2000) and tap the hit Source: apps/mobile/src/app/home/search.tsx openHit case 'gear' pushes /shop/product/[id] for every gear hit; supabase/functions/ai-search/index.ts line 309 entityId affiliate:<id>; apps/mobile/src/app/shop/product/[id].tsx state === 'notFound' This gear is no longer listed

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 3. Product detail, select size, out of stock, add to cart

Category: SPORTS GEAR. Persona: shopper. Money: no.

Owned product detail page. Every variant row shows its own price and AVAILABLE stock (product_variant_availability). Selecting a zero stock variant disables Add to cart and shows an inline out of stock notice. Add to cart is the guest gate (LoginGateModal); the heart never gates for a guest (a signed_out session, not guest, does gate the heart). Add to cart calls the add_to_cart RPC which caps at available stock and reports it.

Release note: UI-UPLIFT-PROPOSAL Premium item 8 asks for a drag handle on the LoginGate sheet; walkthrough finding 2 (and Developer item 3) notes LoginGateModal persists across deep link navigation. RELEASE-TODO G-24 and S-02, S-03 cover this screen. No native PDP capture is committed; the guest sheet only shows the gate copy over other screens.

After success: After a successful add the shopper stays on the PDP with the green notice Added to your cart. and can tap Go to cart (/shop/cart). After the guest gate, Login lands on /login with the PDP still on the stack.

### Screens

**01 Product detail**  
Route `atlitos://shop/product/[id]`, source `apps/mobile/src/app/shop/product/[id].tsx`
- See: AppBar back variant (ChevronLeft, accessibilityLabel Back, no visible label). Gallery: horizontal paged images at 260 high, or a Package glyph placeholder labelled Product photo coming soon. h2 title with a Heart button on the right, category name, mono numericLg price of the selected variant (falls back to priceFrom). Overline Select a size then one VariantRow per variant (radio role): label from variantLabel, stock line (Out of stock in danger, N in stock in warning when 3 or fewer, else secondary), mono price, Check when selected. Sold out rows at 0.6 opacity. Overline Details with description. Sticky footer: primary Add to cart (ShoppingCart icon) and secondary Go to cart.
- Do: Tap a size row, then Add to cart
- Tap targets: `Back`, `Save to wishlist`, `Remove from wishlist`, `Select a size (VariantRow radio rows)`, `Add to cart`, `Go to cart`
- Then: First in stock variant preselected on load. Add to cart: not signed in opens LoginGateModal; signed in calls shop.addToCart(variantId, 1), then shows a success notice and reloads availability. Go to cart pushes /shop/cart. Viewing records to the local Recently viewed ring buffer (recordProductView).

**02 Product detail, out of stock variant selected**  
Route `atlitos://shop/product/[id]`, source `apps/mobile/src/app/shop/product/[id].tsx`
- See: Danger tint banner with PackageX icon: This size is out of stock. Pick another size, or check back soon. Add to cart disabled.
- Do: Pick another size
- Tap targets: `Select a size (VariantRow radio rows)`
- Then: Notice clears, CTA re-enables when the selected variant has stock.

**03 Login gate (guest Add to cart)**  
Route `atlitos://shop/product/[id]`, source `apps/mobile/src/components/organisms/LoginGateModal.tsx and apps/mobile/src/components/organisms/LoginGateSheet.tsx`
- See: Portal rendered bottom sheet over a scrim (not a native Modal): X close, h2 Want to hit the spotlight?, callout Sign in to book sessions, track progress and join the community., primary Login, secondary Register.
- Do: Tap Login or Register, or Close
- Tap targets: `Login`, `Register`, `Close`
- Then: Login pushes /(auth)/login, Register pushes /(auth)/register; the PDP stays mounted underneath so the shopper returns to it after auth (PRD-01 FR-4).

### States

- loading: Product detail. Trigger: Open before getProduct resolves Source: apps/mobile/src/app/shop/product/[id].tsx state === 'loading': Skeleton card 260, line 70% 24, line 35%, line 90%, line 80%
- empty: Product detail not found. Trigger: Open a delisted or unknown product id (or an affiliate id via search) Source: apps/mobile/src/app/shop/product/[id].tsx state === 'notFound': TriangleAlert, This gear is no longer listed, It may have sold out or been delisted. Browse the rest of the catalog., Button Back to gear (pushes /shop/category/all)
- error: Product detail load error. Trigger: getProduct throws Source: apps/mobile/src/app/shop/product/[id].tsx state === 'error': Couldn't load this gear, error.message or Something went wrong. Please try again., Button Back to gear
- empty: Product detail no variants. Trigger: Product with zero variant rows Source: apps/mobile/src/app/shop/product/[id].tsx product.variants.length === 0: No sizes listed for this gear yet.
- error: Out of stock variant selected. Trigger: Select a variant with availableStock 0 Source: apps/mobile/src/app/shop/product/[id].tsx outOfStock banner PackageX: This size is out of stock. Pick another size, or check back soon.; Add to cart disabled
- success: Added to cart notice. Trigger: Add to cart succeeds Source: apps/mobile/src/app/shop/product/[id].tsx addNotice successTint Check: Added to your cart. or Only N left, so your cart has M. when result.capped
- error: Add to cart failed. Trigger: add_to_cart RPC rejects (OUT_OF_STOCK race or other) Source: apps/mobile/src/app/shop/product/[id].tsx addError: That size just sold out. Pick another size. for OUT_OF_STOCK, else addError.message or Could not add this to your cart.
- gate: Login gate on Add to cart. Trigger: Tap Add to cart while status is not signed_in Source: apps/mobile/src/app/shop/product/[id].tsx handleAddToCart: if (!isSignedIn) setGateVisible(true); LoginGateModal rendered at bottom
- processing: Add to cart pending. Trigger: Tap Add to cart, before the RPC returns Source: apps/mobile/src/app/shop/product/[id].tsx Button loading={adding}; apps/mobile/src/components/ui/button.tsx renders ActivityIndicator in place of children while loading

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-04-pdp-per-variant-availability-light.jpg
- docs/phases/evidence/p4-web/web-shop-04-pdp-per-variant-availability-dark.jpg
- docs/phases/evidence/p4-web/web-shop-05-pdp-out-of-stock-clean-message-light.jpg
- docs/phases/evidence/p4-web/web-shop-05-pdp-out-of-stock-clean-message-dark.jpg
- docs/phases/evidence/p4-web/web-shop-06-pdp-wishlist-toggled-on-light.jpg
- docs/phases/evidence/p4-web/web-shop-06-pdp-wishlist-toggled-on-dark.jpg
- docs/phases/evidence/p4-web/web-shop-08-pdp-added-to-cart-light.jpg
- docs/phases/evidence/p4-web/web-shop-08-pdp-added-to-cart-dark.jpg
- docs/phases/evidence/p4-web/web-shop-10a-pdp-capped-notice-light.jpg
- docs/phases/evidence/p4-web/web-shop-10a-pdp-capped-notice-dark.jpg
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png


## 4. Cart

Category: SPORTS GEAR. Persona: shopper. Money: no.

Persisted cart_items lines with a quantity stepper that revalidates available stock server side (update_cart_item caps and reports), a per line remove with ConfirmSheet, a subtotal summed from live prices, and a Proceed to buy button blocked while any line exceeds available stock. The Plus button is also disabled client side once qty reaches the stock loaded with the cart.

Release note: UI-UPLIFT-PROPOSAL Designer item 25: stepper drops to 32pt ghost buttons and delete becomes a swipe action, price gets numericLg; Premium item 29 empty cart treatment. ConfirmSheet ships on native Modal with the a11y containment risk noted in LoginGateModal.tsx. RELEASE-TODO S-04 to S-07 cover cart persistence, stepper and blocked lines.

After success: Proceed to buy lands on /shop/checkout. After the last line is removed the empty state shows with Browse gear (pushes /shop/category/all).

### Screens

**01 Your cart**  
Route `atlitos://shop/cart`, source `apps/mobile/src/app/shop/cart.tsx`
- See: AppBar backTitle Your cart. One card per line: 72px image or ShoppingBag placeholder (Product photo coming soon), title, variant label, mono unit price, Trash2 remove button, Minus and Plus stepper with mono qty, mono line total. Lines exceeding stock get a danger border and inline caption. Footer: Subtotal label with mono numericLg amount and primary Proceed to buy.
- Do: Tap Plus or Minus, tap Trash2, tap Proceed to buy
- Tap targets: `Back`, `Reduce quantity`, `Increase quantity`, `Remove from cart`, `Proceed to buy`
- Then: Stepper calls shop.updateCartItem then reloads; capped result shows a warning caption. Minus disabled at qty 1, Plus disabled at qty >= availableStock. Trash2 opens ConfirmSheet. Proceed to buy pushes /shop/checkout (disabled if any line is blocked or cart empty).

**02 Remove confirm sheet**  
Route `atlitos://shop/cart`, source `apps/mobile/src/components/organisms/ConfirmSheet.tsx (called from apps/mobile/src/app/shop/cart.tsx)`
- See: Native Modal sheet, Trash2 icon in dangerTint, title Remove this from your cart?, body <title> will be taken out of your cart. You can add it back any time., destructive Remove and secondary Keep it.
- Do: Tap Remove or Keep it
- Tap targets: `Remove`, `Keep it`
- Then: Remove calls shop.removeCartItem and reloads the cart; Keep it (also the scrim, labelled Keep it) closes.

### States

- gate: Cart as guest. Trigger: Open /shop/cart while not signed in (the category screen cart icon and the PDP Go to cart push it directly; Home's cart icon opens LoginGateModal instead) Source: apps/mobile/src/app/shop/cart.tsx !isSignedIn: EmptyState ShoppingBag title Sign in to see your cart body Your cart follows your account, so it is waiting for you on every device. cta Browse gear (no sign in button here)
- loading: Cart. Trigger: Open before getCart resolves Source: apps/mobile/src/app/shop/cart.tsx state === 'loading': three Skeleton cards 110
- error: Cart load error. Trigger: getCart throws Source: apps/mobile/src/app/shop/cart.tsx state === 'error': TriangleAlert Couldn't load your cart, message, Retry
- empty: Cart empty. Trigger: Signed in with zero cart lines Source: apps/mobile/src/app/shop/cart.tsx state === 'empty': EmptyState ShoppingBag Your cart is empty body Find gear built for your game and it will show up right here. cta Browse gear
- error: Line exceeds stock (blocked). Trigger: Stock drops below a line's qty (another shopper buys, or admin stock edit) before the cart is read Source: apps/mobile/src/app/shop/cart.tsx line.exceedsStock: caption Out of stock now. Remove it to continue. or Only N left. Reduce this line to continue.; banner Some gear is no longer available in the quantity you picked. Reduce or remove those lines to continue.; Proceed to buy disabled
- error: Stepper capped or sold out notice. Trigger: Stock drops between the cart read and a Plus tap (the button is disabled once qty >= the stock loaded), so update_cart_item caps or returns OUT_OF_STOCK Source: apps/mobile/src/app/shop/cart.tsx handleQuantityChange notices: Only N left, so this line is set to M. (warning) or This one just sold out. Remove it to continue.
- processing: Stepper busy. Trigger: Tap Plus or Minus before the RPC returns Source: apps/mobile/src/app/shop/cart.tsx busyVariantId disables both stepper buttons at 0.5 opacity
- processing: Removing. Trigger: Tap Remove on the confirm sheet before removeCartItem returns Source: apps/mobile/src/app/shop/cart.tsx ConfirmSheet loading={removing}

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p4-web/web-shop-09-cart-populated-light.jpg
- docs/phases/evidence/p4-web/web-shop-09-cart-populated-dark.jpg
- docs/phases/evidence/p4-web/web-shop-10b-cart-stepper-capped-light.jpg
- docs/phases/evidence/p4-web/web-shop-10b-cart-stepper-capped-dark.jpg
- docs/phases/evidence/p4-web/web-shop-12-cart-remove-confirmsheet-light.jpg
- docs/phases/evidence/p4-web/web-shop-12-cart-remove-confirmsheet-dark.jpg
- docs/phases/evidence/p4-web/web-shop-13-cart-after-remove-light.jpg
- docs/phases/evidence/p4-web/web-shop-13-cart-after-remove-dark.jpg


## 5. Checkout, bill summary, roundup checkbox, pay, order success

Category: SPORTS GEAR. Persona: shopper. Money: yes.

Checkout renders Your order lines, the shipping address card, the shared BillSummary (Subtotal, Delivery charges, GST and others, optional Support a Rising Athlete in Need checkbox row, Total) and a Continue to pay button. Continue calls the checkout edge function, opens the shared Razorpay checkout (react-native-razorpay native sheet on iOS/Android, checkout.js on web), then verify-payment, then replaces to /shop/order-success. PRICE_MISMATCH reloads and requires reconfirm; OUT_OF_STOCK routes back to cart. The client never writes orders, payment_intents or ledger rows.

Release note: RELEASE-TODO task 7: switch Razorpay to a live key, blocked on founder row 22 (Zaakpay or Razorpay). Note the task's wording is stale: apps/mobile/eas.json carries no env block at all (build.production.env was stripped, RELEASE-READINESS-2026-09-07 row 18, production builds fail closed); the rzp_test key lives in apps/mobile/.env and scripts/check-release-config.sh guards the swap. Task 8: 8 pending migrations and 2 missing edge functions must be deployed and each money path smoke tested. UI-UPLIFT-PROPOSAL Developer item 8: pending state on money buttons with label Confirming and a toast on a dismissed Razorpay sheet (today the error is an inline row, no toast). p9-native README: react-native-razorpay failure path (dismiss vs decline) still unproven natively; the P3 success path proof is a deleted harness (docs/phases/evidence/p3-native/native-checkout-*.png), not a checkout screen capture. Scenarios S-08 to S-14 and D-18, D-19.

After success: Success replaces the checkout with /shop/order-success; from there Track my order lands on /shop/order/[id] (order detail with timeline) and Explore more lands on /shop/category/all. A dismissed or failed payment leaves the shopper on /shop/checkout with an inline error and the same Continue to pay button to retry.

### Screens

**01 Checkout**  
Route `atlitos://shop/checkout`, source `apps/mobile/src/app/shop/checkout/index.tsx (bill derivation apps/mobile/src/lib/commerce-bill.ts, BillSummary apps/mobile/src/components/molecules/BillSummary.tsx)`
- See: AppBar backTitle Checkout. Card Your order listing each line (title, variant label, mono xN, mono line total). Card Shipping address: MapPin, line1 and line2, city and state, mono pincode, text button Change address; or No address found. Add an address to continue. with secondary Add address (card border turns danger). Card with BillSummary rows Subtotal, Delivery charges (flat 50.00), GST and others (18 percent of subtotal), then a checkbox row Support a Rising Athlete in Need with the derived roundup amount (distance to the next multiple of 10 on the post GST total, unchecked by default), divider, Total in mono. Footer primary button Continue to pay <mono total>.
- Do: Confirm address, optionally tick the roundup checkbox, tap Continue to pay
- Tap targets: `Back`, `Change address`, `Add address`, `Support a Rising Athlete in Need`, `Continue to pay`, `Confirm and pay`
- Then: Ticking the checkbox (haptic) adds the roundup to Total; when the total already sits on a multiple of 10 the row is suppressed and a caption explains it. Continue to pay: shop.checkout(items, addressId, donationRoundupOptedIn, bill) then openRazorpayCheckout then shop.verifyOrderPayment then router.replace('/shop/order-success', {orderId, orderNumber}).

**02 Razorpay checkout sheet**  
Route `atlitos://shop/checkout (native sheet over it)`, source `apps/mobile/src/lib/razorpay-checkout.native.ts (react-native-razorpay RazorpayCheckout.open) and apps/mobile/src/lib/razorpay-checkout.web.ts (checkout.js script); types apps/mobile/src/lib/razorpay-checkout.types.ts`
- See: Razorpay's own native checkout sheet with name Atlitos, description Gear order, amount in paise from the server, prefilled name and contact from the session.
- Do: Complete or dismiss the Razorpay sheet
- Tap targets: `Razorpay sheet controls (third party UI)`
- Then: Success resolves razorpay_order_id, razorpay_payment_id, razorpay_signature. Dismiss or SDK failure rejects with RazorpayCheckoutCancelledError (default message Payment was not completed.).

**03 Order successfully placed**  
Route `atlitos://shop/order-success?orderId=[id]&orderNumber=[n]`, source `apps/mobile/src/app/shop/order-success.tsx`
- See: Centered CheckCircle2 in a success tint circle, h1 Order successfully placed, mono order number (fetched via getOrder if not passed), callout Your gear is on its way. Track it any time from My Orders. Primary Track my order, secondary Explore more. No AppBar or back header.
- Do: Tap Track my order or Explore more
- Tap targets: `Track my order`, `Explore more`
- Then: Track my order replaces to /shop/order/[id]. Explore more replaces to /shop/category/all. Opening the route with no orderId redirects to /shop/orders.

### States

- gate: Checkout as guest. Trigger: Open /shop/checkout while not signed in Source: apps/mobile/src/app/shop/checkout/index.tsx !isSignedIn: h3 Sign in to check out and secondary Sign in (pushes /(auth)/login)
- loading: Checkout. Trigger: Open before getCart, listAddresses and getCommerceFeeConfig resolve (reloads on every focus) Source: apps/mobile/src/app/shop/checkout/index.tsx state === 'loading': Skeleton cards 120, 100, 180
- error: Checkout load error. Trigger: Any of the three reads throws Source: apps/mobile/src/app/shop/checkout/index.tsx state === 'error': Couldn't load checkout, message, Retry
- empty: Checkout with empty cart. Trigger: Open checkout with zero lines Source: apps/mobile/src/app/shop/checkout/index.tsx load: if (cart.length === 0) router.replace('/shop/cart')
- empty: No shipping address. Trigger: Signed in shopper with no saved addresses Source: apps/mobile/src/app/shop/checkout/index.tsx !selectedAddress: No address found. Add an address to continue. + Button Add address; canContinue false, card border danger
- empty: Roundup suppressed (zero roundup). Trigger: Tick the checkbox when the post GST total is already a multiple of 10 Source: apps/mobile/src/app/shop/checkout/index.tsx roundupOptedIn && !showRoundupRow: Your total is already a round figure, so there is nothing to round up this time.; shouldShowRoundupRow in apps/mobile/src/lib/commerce-bill.ts
- processing: Paying. Trigger: Tap Continue to pay, until verify-payment returns Source: apps/mobile/src/app/shop/checkout/index.tsx Button loading={paying} disabled={!canContinue}; the button label is replaced by an ActivityIndicator (apps/mobile/src/components/ui/button.tsx). No separate processing screen.
- failed: Payment not completed or not verified. Trigger: Dismiss the Razorpay sheet, or verify-payment returns INVALID_SIGNATURE Source: apps/mobile/src/app/shop/checkout/index.tsx error row TriangleAlert: Payment could not be verified. Please try again. for INVALID_SIGNATURE, else error.message (RazorpayCheckoutCancelledError default Payment was not completed.) or Payment was not completed.; button returns to Continue to pay for retry
- error: Prices changed (PRICE_MISMATCH). Trigger: Server re-derived bill disagrees with the client bill (admin price edit mid checkout) Source: apps/mobile/src/app/shop/checkout/index.tsx needsReconfirm warningTint banner: Prices changed while you were here. Nothing was charged. Check the updated total and confirm again.; CTA label becomes Confirm and pay <total>
- error: Out of stock at checkout (OUT_OF_STOCK). Trigger: A line's stock is gone when the checkout function runs Source: apps/mobile/src/app/shop/checkout/index.tsx apiError.code === 'OUT_OF_STOCK': router.replace('/shop/cart') where the blocked lines are flagged from live availability
- success: Order successfully placed. Trigger: verify-payment returns an order id Source: apps/mobile/src/app/shop/order-success.tsx CheckCircle2, Order successfully placed, order number, Track my order, Explore more

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-11-checkout-billsummary-roundup-SHOWN-light.jpg
- docs/phases/evidence/p4-web/web-shop-11-checkout-billsummary-roundup-SHOWN-dark.jpg
- docs/phases/evidence/p4-web/web-shop-14-checkout-billsummary-roundup-SUPPRESSED-light.jpg
- docs/phases/evidence/p4-web/web-shop-14-checkout-billsummary-roundup-SUPPRESSED-dark.jpg
- docs/phases/evidence/p4-web/web-shop-15-checkout-razorpay-sheet-light.jpg
- docs/phases/evidence/p4-web/web-shop-15-checkout-razorpay-sheet-dark.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-02-order-success-light.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-02-order-success-dark.jpg


## 6. Add or select shipping address at checkout

Category: SPORTS GEAR. Persona: shopper. Money: no.

Checkout's Change address and Add address both push /shop/checkout/address. Saved addresses render as radio cards; tapping one sets it as default and pops back, so checkout preselects it on focus. The shared AddressForm (line 1, line 2, city, state, 6 digit pincode, default checkbox) is open by default when there are no addresses. No signed in guard on this screen; a guest reaching it by deep link gets whatever listAddresses returns under RLS.

Release note: UI-UPLIFT-PROPOSAL Developer item 16: keyboard avoidance on the Address form is unverified; Developer item 15 asks for validate on blur (today the pincode validates on every keystroke once touched). RELEASE-TODO S-08 and S-09. No native capture of this screen exists; the address book captures share the same AddressForm.

After success: Selecting an address pops back to /shop/checkout, which reloads on focus and shows the chosen address. Saving a new address stays on the address screen with the form closed; the shopper taps it to select or Back.

### Screens

**01 Shipping address**  
Route `atlitos://shop/checkout/address`, source `apps/mobile/src/app/shop/checkout/address.tsx (form apps/mobile/src/components/organisms/AddressForm.tsx)`
- See: AppBar backTitle Shipping address. Overline Saved addresses with one MapPin radio card per address (line1 and line2, city and state, mono pincode, Check on the default with an accent border). Below: overline New address with AddressForm fields Address line 1 (required, placeholder House and street), Address line 2 (Area or landmark), City, State, Pincode (maxLength 6, placeholder 600001), checkbox Use this as my default address, primary Save address, secondary Cancel (only when addresses exist); or a secondary Add a new address button when the form is collapsed.
- Do: Tap a saved address to select it, or fill the form and tap Save address
- Tap targets: `Back`, `Saved address radio card`, `Add a new address`, `Address line 1`, `Address line 2`, `City`, `State`, `Pincode`, `Use this as my default address`, `Save address`, `Cancel`
- Then: Tapping a card calls shop.setDefaultAddress then router.back() to checkout. Save address calls shop.createAddress (first address forced default), collapses the form and reloads the list.

### States

- loading: Shipping address. Trigger: Open before listAddresses resolves Source: apps/mobile/src/app/shop/checkout/address.tsx state === 'loading': two Skeleton cards 96
- error: Shipping address load error. Trigger: listAddresses throws Source: apps/mobile/src/app/shop/checkout/address.tsx state === 'error': Couldn't load your addresses, message, Retry
- empty: No saved addresses (form open). Trigger: Shopper has zero addresses Source: apps/mobile/src/app/shop/checkout/address.tsx setFormOpen(rows.length === 0); no Cancel button when addresses.length === 0
- error: Invalid pincode. Trigger: Type a pincode that is not 6 digits, or the server CHECK rejects (PINCODE_INVALID) Source: apps/mobile/src/components/organisms/AddressForm.tsx pincodeError: Enter a valid 6 digit pincode. or error.message when error.field === 'pincode'; Save address disabled until valid
- error: Address save failed. Trigger: createAddress throws a non pincode error (setDefaultAddress failures are also stored in saveError) Source: apps/mobile/src/components/organisms/AddressForm.tsx error && error.field !== 'pincode': TriangleAlert + error.message or Could not save this address. Please try again.
- processing: Saving address. Trigger: Tap Save address before the insert returns Source: apps/mobile/src/components/organisms/AddressForm.tsx Button loading={saving}

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-18-address-book-light.jpg
- docs/phases/evidence/p4-web/web-shop-18-address-book-dark.jpg


## 7. My Orders, order detail timeline, refund and feedback

Category: SPORTS GEAR. Persona: shopper. Money: no.

Order history list newest first with status pills, order detail with the read only OrderTimeline (admin driven order_transition), frozen snapshot items, the shipped to address snapshot, the BillSummary recap from stored columns, an optional refund card, and a one time feedback form that opens only once the order is delivered.

Release note: No Settings or You tab row links to My orders (SettingsContent Account section has only Edit profile, Blocked accounts, Become a coach, Sign out, Delete account) and no backend notification carries a /shop/order deep link (only 0043 clutch, 0054/0067 donation to the UPA owner, 0066/0075 verification, 0120, 0123 insert notifications), so order history is reachable only via order success or deep link; RELEASE-TODO A-35 (tap a notification about a specific order) will not find one. Admin advances orders via admin-order-advance (AD-24, AD-25). No shopper side cancel exists (AD-27 looks for an admin Cancel). RELEASE-TODO S-15 to S-17.

After success: After submit the same screen flips to read only (Thanks for the feedback) with Back to order; order detail then shows the Your feedback card. There is no in app menu entry to /shop/orders: it is reached from order-success (Track my order goes to the detail, whose not found state offers My orders), from order-success without an orderId (Redirect to /shop/orders), or by deep link.

### Screens

**01 My orders**  
Route `atlitos://shop/orders`, source `apps/mobile/src/app/shop/orders.tsx (labels apps/mobile/src/lib/order-display.ts, pills apps/mobile/src/components/ui/status-pill.tsx)`
- See: AppBar backTitle My orders. One card per order: mono order number, date (en-IN, d MMM yyyy), StatusPill (Placed, Shipped, In transit, Delivered, Cancelled), mono total, item count, ChevronRight. Pull to refresh.
- Do: Tap an order card
- Tap targets: `Back`, `Order card (accessibilityRole button)`, `Browse gear`, `Retry`
- Then: Pushes /shop/order/[id].

**02 Order detail and tracking**  
Route `atlitos://shop/order/[id]`, source `apps/mobile/src/app/shop/order/[id]/index.tsx (timeline apps/mobile/src/components/molecules/OrderTimeline.tsx, refund copy apps/mobile/src/lib/refund-display.ts)`
- See: AppBar backTitle Order. Mono order number, Placed on <date>, StatusPill. Card Tracking with OrderTimeline rows (date, event text from note or ORDER_STATUS_EVENT: Order placed, Order has been shipped, Order is in transit, Order delivered, Order cancelled, plus location); card hidden when the timeline is empty. Card Items with snapshot title, variant, xN, mono line total. Card Shipping to (ship_to snapshot). Card Payment summary via BillSummary (Subtotal, Delivery charges, GST and others, plus Support a Rising Athlete in Need only if the order carried a roundup, Total). Optional refund card headed Refunded, Refund on its way or Refund pending with a PriceText amount and caption. Either a Your feedback card (StarRating display, remarks, Submitted on) or a secondary Write feedback button (MessageSquarePlus) when delivered and no feedback yet.
- Do: Read the timeline; tap Write feedback when delivered
- Tap targets: `Back`, `Write feedback`, `My orders`, `Retry`
- Then: Write feedback pushes /shop/order/[id]/feedback. Screen reloads on focus so returning from feedback shows the read only card.

**03 Order feedback**  
Route `atlitos://shop/order/[id]/feedback`, source `apps/mobile/src/app/shop/order/[id]/feedback.tsx (stars apps/mobile/src/components/ui/star-rating.tsx)`
- See: AppBar backTitle Order feedback. h3 How did this order go? with mono order number. Card Your rating with StarRating input (5 lucide Star, size 28, each labelled Rate N out of 5) and a multiline Input labelled Anything else (placeholder Tell us what worked and what did not). Primary Submit feedback (disabled until a star is chosen).
- Do: Tap a star, type remarks, tap Submit feedback
- Tap targets: `Back`, `Rate 1 out of 5`, `Rate 5 out of 5`, `Anything else`, `Submit feedback`, `Back to order`
- Then: shop.submitOrderFeedback then reloads into the read only view: h3 Thanks for the feedback, StarRating display, remarks, Submitted on <date>, secondary Back to order.

### States

- gate: My orders as guest. Trigger: Open /shop/orders while not signed in Source: apps/mobile/src/app/shop/orders.tsx load: if (!isSignedIn) setState('empty') so the guest sees the No orders yet empty state (no sign in prompt)
- loading: My orders. Trigger: Open before listMyOrders resolves Source: apps/mobile/src/app/shop/orders.tsx state === 'loading': three Skeleton cards 92
- error: My orders load error. Trigger: listMyOrders throws Source: apps/mobile/src/app/shop/orders.tsx state === 'error': Couldn't load your orders, message, Retry
- empty: No orders yet. Trigger: Account with zero orders Source: apps/mobile/src/app/shop/orders.tsx EmptyState PackageSearch No orders yet body Gear you buy shows up here, with live tracking from placed to delivered. cta Browse gear
- loading: Order detail. Trigger: Open before getOrder resolves Source: apps/mobile/src/app/shop/order/[id]/index.tsx state === 'loading': Skeleton line 40% 24, cards 160, 140, 180
- empty: Order not found. Trigger: Open an order id not on the account Source: apps/mobile/src/app/shop/order/[id]/index.tsx state === 'notFound': Order not found, This order is not on your account. Check My Orders for the full list., Button My orders (replace /shop/orders)
- error: Order detail load error. Trigger: getOrder throws Source: apps/mobile/src/app/shop/order/[id]/index.tsx state === 'error': Couldn't load this order, message, Retry
- success: Refund card. Trigger: Admin issues a refund on the order (refunds row exists) Source: apps/mobile/src/app/shop/order/[id]/index.tsx refund card; apps/mobile/src/lib/refund-display.ts headings Refunded / Refund on its way / Refund pending with captions
- gate: Feedback blocked (not delivered). Trigger: Open /shop/order/[id]/feedback for an order not yet delivered Source: apps/mobile/src/app/shop/order/[id]/feedback.tsx state === 'blocked': Feedback opens once your order arrives, Track this order and come back after it is delivered., Button Back to order
- success: Feedback read only. Trigger: Open feedback for an order that already has feedback, or after submitting Source: apps/mobile/src/app/shop/order/[id]/feedback.tsx state === 'readOnly': Thanks for the feedback, StarRating display, remarks, Submitted on, Back to order
- error: Feedback load or submit error. Trigger: getOrder returns null or throws, or submitOrderFeedback throws Source: apps/mobile/src/app/shop/order/[id]/feedback.tsx state === 'error': Couldn't load this order + This order is not on your account. + Button My orders; submit error row error.message or Could not submit your feedback. Please try again.
- loading: Order feedback. Trigger: Open before getOrder resolves Source: apps/mobile/src/app/shop/order/[id]/feedback.tsx state === 'loading': Skeleton line 55% 22, line 40%, card 120
- processing: Submitting feedback. Trigger: Tap Submit feedback before the insert returns Source: apps/mobile/src/app/shop/order/[id]/feedback.tsx Button loading={submitting}

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-16-my-orders-light.jpg
- docs/phases/evidence/p4-web/web-shop-16-my-orders-dark.jpg
- docs/phases/evidence/p4-web/web-shop-17-order-detail-shipto-timeline-light.jpg
- docs/phases/evidence/p4-web/web-shop-17-order-detail-shipto-timeline-dark.jpg
- docs/phases/evidence/p4-web/web-shop-19-order-detail-before-address-edit-light.jpg
- docs/phases/evidence/p4-web/web-shop-21-order-detail-shipto-UNCHANGED-light.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-03-order-detail-light.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-03-order-detail-dark.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-04-feedback-empty.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-04-feedback-submitted.jpg


## 8. Wishlist (save gear, My wishlist, Move to cart)

Category: SPORTS GEAR. Persona: shopper. Money: no.

Heart on the browse card or PDP toggles product_wishlist_items (guests save to a local AsyncStorage store with no gate). My wishlist at /account/wishlist shows live price and available stock per saved item with a Move to cart action; a product with several buyable sizes opens a Pick a size sheet first. The profile page (You tab) also has a My wishlist tab (view and remove only, no Move to cart). Guest local saves are never merged into the account on sign in.

Release note: UI-UPLIFT-PROPOSAL Developer item 11: wishlist heart should show a toast on rollback (today it reverts silently). Premium item 29: empty wishlist icon in accentTint circle with a secondary CTA. Premium item 8: drag handle on the variant picker sheet. RELEASE-TODO S-18, S-19.

After success: Move to cart keeps the shopper on My wishlist with the notice Moved to your cart. (item stays wishlisted). Card tap lands on /shop/product/[id].

### Screens

**01 Save from browse or PDP**  
Route `atlitos://shop/category/all or atlitos://shop/product/[id]`, source `apps/mobile/src/app/shop/category/[sport].tsx and apps/mobile/src/app/shop/product/[id].tsx (store apps/mobile/src/store/guest-wishlist.ts)`
- See: Heart icon on each ProductCard and on the PDP title row; filled danger colour when saved.
- Do: Tap the heart
- Tap targets: `Save to wishlist`, `Remove from wishlist`, `My wishlist`
- Then: Guest: useGuestWishlist.toggle (local). Signed in: wishlist.toggle (toggle_product_wishlist RPC) with optimistic UI and rollback on failure. The category screen's Heart header icon (My wishlist) pushes /account/wishlist.

**02 My wishlist**  
Route `atlitos://account/wishlist`, source `apps/mobile/src/app/account/wishlist.tsx (grid apps/mobile/src/components/organisms/WishlistGrid.tsx)`
- See: AppBar backTitle My wishlist. Two column WishlistGrid product variant: square image with a filled Heart remove button top right, title, mono price, stock line (N in stock or Out of stock in danger), primary sm Move to cart (disabled when sold out). Optional accent tint notice bar (Check icon) at the top after an action.
- Do: Tap a card to open the PDP, tap the heart to remove, tap Move to cart
- Tap targets: `Back`, `Remove from wishlist`, `Move to cart`, `Wishlist card (accessibilityLabel = title)`
- Then: Card pushes /shop/product/[id]. Remove toggles and reloads. Move to cart: one buyable variant adds qty 1 via add_to_cart; several buyable variants open the Pick a size modal; none shows an out of stock notice.

**03 Pick a size sheet**  
Route `atlitos://account/wishlist`, source `apps/mobile/src/app/account/wishlist.tsx (RN Modal)`
- See: Bottom sheet: h3 Pick a size, product title, a scroll list of in stock variant rows (label, N in stock, mono price), secondary Cancel.
- Do: Tap a variant row
- Tap targets: `Variant row`, `Cancel`, `Close`
- Then: addVariantToCart(variant) then a notice Moved to your cart. or the capped or sold out message. Close is the scrim's accessibilityLabel.

**04 Profile My wishlist tab**  
Route `atlitos://you (tab My wishlist) or atlitos://profile`, source `apps/mobile/src/app/profile/index.tsx tab === 'wishlist' (mounted by apps/mobile/src/app/(tabs)/you.tsx)`
- See: Same WishlistGrid under the profile header, remove heart only, empty copy Nothing saved yet. Tap the heart on any gear to keep it here. with a Bookmark icon. Pull to refresh.
- Do: Tap a card or remove
- Tap targets: `My wishlist`, `Remove from wishlist`
- Then: Card pushes the PDP; remove toggles and reloads. No Move to cart on this tab.

### States

- gate: My wishlist as guest. Trigger: Open /account/wishlist while not signed in Source: apps/mobile/src/app/account/wishlist.tsx load: if (!isSignedIn) setState('empty') so guests see Nothing saved yet even if they hearted items locally (guest hearts live only in the local store shown on browse and PDP)
- loading: My wishlist. Trigger: Open before listWishlist resolves Source: apps/mobile/src/app/account/wishlist.tsx state === 'loading': two rows of two Skeleton cards 200
- error: My wishlist load error. Trigger: listWishlist throws (a failed remove toggle also lands here) Source: apps/mobile/src/app/account/wishlist.tsx state === 'error': Couldn't load your wishlist, message, Retry
- empty: Nothing saved yet. Trigger: No wishlist rows Source: apps/mobile/src/app/account/wishlist.tsx EmptyState HeartOff Nothing saved yet body Tap the heart on any gear and it waits for you here, with live prices. cta Browse gear
- success: Moved to cart notice. Trigger: Move to cart succeeds Source: apps/mobile/src/app/account/wishlist.tsx notice Moved to your cart. or Only N left, so your cart has M.
- error: Out of stock on Move to cart. Trigger: No buyable variant, or the RPC returns OUT_OF_STOCK Source: apps/mobile/src/app/account/wishlist.tsx notices This gear is out of stock right now. / That one just sold out. Try another size. / Could not move this to your cart.; WishlistGrid ProductActions disables Move to cart and shows Out of stock when availableStock is 0

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-06-pdp-wishlist-toggled-on-light.jpg
- docs/phases/evidence/p4-web/web-shop-06-pdp-wishlist-toggled-on-dark.jpg
- docs/phases/evidence/p4-web/web-shop-07-wishlist-light.jpg
- docs/phases/evidence/p4-web/web-shop-07-wishlist-dark.jpg
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 9. Address book (add, edit, set default, delete)

Category: SPORTS GEAR. Persona: shopper. Money: no.

Standalone address book at /account/addresses using the same AddressForm as checkout. Delete uses ConfirmSheet; an address on an in flight order (ADDRESS_IN_USE) or a past order (ADDRESS_ON_PAST_ORDER) cannot be deleted and the reason renders inline on that card. No signed in guard on this screen.

Release note: UI-UPLIFT-PROPOSAL Designer item 28: Edit / Set default / Delete text links to be replaced by an overflow menu with Default as a chip. No in app entry point from Settings or You (deep link only). RELEASE-TODO S-20, S-21.

After success: All actions keep the shopper on /account/addresses with the list reloaded. There is no in app Settings or You tab row to this screen; it is reached by deep link only (checkout uses /shop/checkout/address instead).

### Screens

**01 Address book**  
Route `atlitos://account/addresses`, source `apps/mobile/src/app/account/addresses.tsx (form apps/mobile/src/components/organisms/AddressForm.tsx)`
- See: AppBar backTitle Address book. One card per address: MapPin, lines, city and state, mono pincode, a StatusPill Verified on the default, then a row of text buttons Edit, Set default (Star icon, hidden on the default) and a Trash2 delete button. Below: the New address or Edit address form (fields as on checkout address; submit label Save address or Save changes, plus Cancel), or a secondary Add a new address button.
- Do: Tap Edit, Set default, Trash2, or Add a new address and Save address
- Tap targets: `Back`, `Add address`, `Edit`, `Set default`, `Delete address`, `Add a new address`, `Save address`, `Save changes`, `Cancel`, `Use this as my default address`
- Then: Edit opens the form prefilled and updateAddress on save. Set default calls setDefaultAddress and reloads. Trash2 opens ConfirmSheet. Save creates (first address forced default) or updates then collapses the form.

**02 Delete confirm sheet**  
Route `atlitos://account/addresses`, source `apps/mobile/src/components/organisms/ConfirmSheet.tsx via apps/mobile/src/app/account/addresses.tsx`
- See: Trash2 icon, Delete this address?, body <line1>, <city> will be removed from your address book., destructive Delete, Keep it.
- Do: Tap Delete or Keep it
- Tap targets: `Delete`, `Keep it`
- Then: Delete calls deleteAddress and reloads, or writes the guard message onto the card.

### States

- loading: Address book. Trigger: Open before listAddresses resolves Source: apps/mobile/src/app/account/addresses.tsx state === 'loading': two Skeleton cards 110
- error: Address book load error. Trigger: listAddresses throws (a failed Set default also lands here) Source: apps/mobile/src/app/account/addresses.tsx state === 'error': Couldn't load your addresses, message, Retry
- empty: No saved addresses. Trigger: Zero addresses and the form not open Source: apps/mobile/src/app/account/addresses.tsx EmptyState MapPinOff No saved addresses body Save an address once and every order after this one ships in a tap. cta Add address (opens the form)
- error: Delete blocked by an order. Trigger: Delete an address referenced by an in flight or past order Source: apps/mobile/src/app/account/addresses.tsx deleteErrors: This address is on an order that is still on the way, so it cannot be deleted yet. (ADDRESS_IN_USE) / This address is kept on a past order, so it cannot be deleted. (ADDRESS_ON_PAST_ORDER) / Could not delete this address.
- error: Invalid pincode or save failure. Trigger: Non 6 digit pincode, or createAddress or updateAddress throws Source: apps/mobile/src/components/organisms/AddressForm.tsx Enter a valid 6 digit pincode. / Could not save this address. Please try again.
- processing: Deleting. Trigger: Tap Delete before the request returns Source: apps/mobile/src/app/account/addresses.tsx ConfirmSheet loading={deleting}

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-18-address-book-light.jpg
- docs/phases/evidence/p4-web/web-shop-18-address-book-dark.jpg
- docs/phases/evidence/p4-web/web-shop-20-address-book-EDITED-light.jpg
- docs/phases/evidence/p4-web/web-shop-22-address-book-restored-light.jpg
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 10. Affiliate product and Buy on retailer click out

Category: SPORTS GEAR. Persona: guest. Money: no.

The second product model (affiliate_products with product_offers). No variants, no stock ceiling, no cart, no in app payment: the screen compares retailer offers cheapest in stock first, highlights the cheapest, and Buy on <retailer> opens the offer's affiliate_url with Linking.openURL. Guests can click out without a gate.

Release note: RELEASE-TODO task 5 builds COURTS as an affiliate click out modelled on this screen (courts booking hidden for release); row 3 Add equipment (affiliate links) is downstream data entry. This screen has NO in app entry point: category browse only lists owned products (listProducts), packages/api/src/use-shop.ts listAffiliateProducts has no caller, and apps/mobile/src/app/home/search.tsx openHit routes every gear hit to /shop/product/[id] even though supabase/functions/ai-search/index.ts prefixes affiliate entityIds with affiliate:, so an affiliate search hit lands on the owned PDP not found state, never here. Reachable today only by deep link atlitos://shop/affiliate/[id]. BUG-LEDGER WS4 completion note: retailers are illustrative seeds and the affiliate programmes, commission accounting and ingestion pipeline are open founder decisions (PRD-07 10.4/10.5). RELEASE-TODO G-25, G-26, S-22 to S-27. No screenshot exists.

After success: The shopper lands in the external browser on the retailer page; returning to the app leaves them on the same affiliate screen. No order, cart or success screen exists for this path.

### Screens

**01 Affiliate product (compare prices)**  
Route `atlitos://shop/affiliate/[id]`, source `apps/mobile/src/app/shop/affiliate/[id].tsx`
- See: AppBar back variant. Hero image at 260 or Package placeholder (Product photo coming soon). Brand overline in accent, h2 title, attribute line (category, skill level, age range joined by a dot), From <mono best price> across N retailers. Overline Details with description. Overline Compare prices: one OfferRow card per retailer (retailer name, a Cheapest chip on the cheapest in stock offer with an accent border, In stock or Out of stock caption, mono price, a button Buy on <retailer> with ExternalLink icon: primary on the cheapest, secondary otherwise, disabled and dimmed when out of stock). Footer caption: Prices are updated regularly. You complete the purchase on the retailer site. Atlitos may earn a commission.
- Do: Tap Buy on <retailer>
- Tap targets: `Back`, `Buy on Amazon`, `Buy on Decathlon`, `Buy on Tennis Hub`, `Buy on Cricket Store`, `Back to gear`
- Then: Linking.openURL(offer.affiliateUrl) leaves the app for the retailer site (monetised click out). Nothing is written in app. Retailer names come from scripts/seed-affiliate-catalog.mjs (Amazon, Tennis Hub, Decathlon, Cricket Store).

### States

- loading: Affiliate product. Trigger: Open before getAffiliateProduct resolves Source: apps/mobile/src/app/shop/affiliate/[id].tsx state === 'loading': Skeleton card 260, line 70% 24, line 35%, two cards 64
- empty: Affiliate product not found. Trigger: Open an inactive or unknown affiliate id Source: apps/mobile/src/app/shop/affiliate/[id].tsx state === 'notFound': This gear is no longer listed, It may have been delisted. Browse the rest of the catalog., Button Back to gear
- error: Affiliate product load error. Trigger: getAffiliateProduct throws Source: apps/mobile/src/app/shop/affiliate/[id].tsx state === 'error': Couldn't load this gear, message, Back to gear
- empty: No retailer offers. Trigger: Affiliate product with zero product_offers rows Source: apps/mobile/src/app/shop/affiliate/[id].tsx product.offers.length === 0: No retailer offers listed yet. Check back soon.
- error: Out of stock offer. Trigger: An offer row with in_stock false Source: apps/mobile/src/app/shop/affiliate/[id].tsx OfferRow opacity 0.6, caption Out of stock in danger, Buy button disabled


## 11. Razorpay pay sheet (shared) with processing, success, failed and retry

Category: PAYMENT. Persona: shopper. Money: yes.

One shared wrapper openRazorpayCheckout is used by shop checkout, Empower donate and the courts, coaching and group membership pay screens. Native iOS/Android uses react-native-razorpay's bundled checkout sheet (RazorpayCheckout.open, requires the custom dev client, not Expo Go); web loads https://checkout.razorpay.com/v1/checkout.js. Every surface follows create intent on the server, open the sheet, verify-payment on the server; the client never writes money rows.

Release note: RELEASE-TODO task 7 (live Razorpay key, blocked on row 22; the rzp_test key lives in apps/mobile/.env, eas.json carries no env block) and task 8 (deploy pending migrations and edge functions, smoke test each money path). p9-native README: the react-native-razorpay failure path is still unproven natively; the P3 success path proof is docs/phases/evidence/p3-native/native-checkout-*.png, a deleted throwaway harness printing the resolved keys, not a screen capture. UI-UPLIFT-PROPOSAL Developer item 8 wants a Confirming label and a toast on dismissal.

After success: Failed or dismissed payments return the user to the originating screen with an inline error and the same CTA available to retry (shop: Continue to pay; donate: Donate <amount> with the amount preserved).

### Screens

**01 Select and review (shop)**  
Route `atlitos://shop/checkout`, source `apps/mobile/src/app/shop/checkout/index.tsx`
- See: BillSummary with Total and the button Continue to pay <amount>.
- Do: Tap Continue to pay
- Tap targets: `Continue to pay`, `Confirm and pay`
- Then: shop.checkout creates the Razorpay order server side, then the sheet opens.

**02 Select and review (donate)**  
Route `atlitos://home/donate/[id]`, source `apps/mobile/src/app/home/donate/[id].tsx and apps/mobile/src/components/organisms/DonationSheet.tsx`
- See: DonationSheet BillSummary (Donation row, Total) and button Donate <amount>, then ConfirmSheet Confirm your donation with Donate now.
- Do: Tap Donate <amount> then Donate now
- Tap targets: `Donate`, `Donate now`, `Cancel`
- Then: empower.donate creates the intent server side, then the sheet opens.

**03 Razorpay sheet**  
Route `native sheet over the calling screen`, source `apps/mobile/src/lib/razorpay-checkout.native.ts, apps/mobile/src/lib/razorpay-checkout.web.ts, apps/mobile/src/lib/razorpay-checkout.types.ts (bare apps/mobile/src/lib/razorpay-checkout.ts re-exports native for tsc only)`
- See: Razorpay standard checkout with name Atlitos, description Gear order or Donation / Donation for <item>, amount in paise, currency INR, prefilled name and contact.
- Do: Pay or dismiss
- Tap targets: `Razorpay sheet controls (third party UI)`
- Then: Resolves the three razorpay ids on success; rejects with RazorpayCheckoutCancelledError (Payment was not completed., or the SDK description) on dismiss or failure.

**04 Processing**  
Route `same screen`, source `apps/mobile/src/app/shop/checkout/index.tsx (button spinner) and apps/mobile/src/app/home/donate/[id].tsx phase === 'processing'`
- See: Shop: the Continue to pay button shows an ActivityIndicator and is disabled; no dedicated screen. Donate: a full screen with ActivityIndicator large in accent and Completing your donation. Please do not close this screen. (the AppBar Back stays active).
- Do: Wait
- Then: verify-payment (shop.verifyOrderPayment or empower.verifyDonationPayment) confirms the signature server side.

**05 Success**  
Route `atlitos://shop/order-success or atlitos://home/donate/[id] (phase success)`, source `apps/mobile/src/app/shop/order-success.tsx and apps/mobile/src/app/home/donate/[id].tsx phase === 'success'`
- See: Shop: CheckCircle2, Order successfully placed, order number, Track my order, Explore more. Donate: CheckCircle2 56, Thank you for giving, Your donation moves <item> closer to its goal. or Your donation supports <headline>., View My Impact, Back to athlete.
- Do: Tap the CTA
- Tap targets: `Track my order`, `Explore more`, `View My Impact`, `Back to athlete`
- Then: Shop lands on /shop/order/[id] or /shop/category/all; donate lands on /account/impact or /home/upa/[id].

### States

- processing: Shop paying. Trigger: Tap Continue to pay Source: apps/mobile/src/app/shop/checkout/index.tsx Button loading={paying}
- processing: Donate processing. Trigger: Tap Donate now on the confirm sheet Source: apps/mobile/src/app/home/donate/[id].tsx phase === 'processing': ActivityIndicator + Completing your donation. Please do not close this screen.
- failed: Shop payment failed. Trigger: Dismiss the sheet or INVALID_SIGNATURE Source: apps/mobile/src/app/shop/checkout/index.tsx error row Payment could not be verified. Please try again. / Payment was not completed.
- failed: Donation payment failed. Trigger: Dismiss the sheet, MIN_AMOUNT, PRICE_MISMATCH or any other error Source: apps/mobile/src/app/home/donate/[id].tsx phase === 'failed': The minimum donation is <min>. / The amount changed. Nothing was charged. Please review and try again. / error.message or Payment was not completed. Your amount is preserved.
- success: Order successfully placed. Trigger: verify-payment succeeds for a gear order Source: apps/mobile/src/app/shop/order-success.tsx
- success: Thank you for giving. Trigger: verify-payment succeeds for a donation Source: apps/mobile/src/app/home/donate/[id].tsx phase === 'success'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-15-checkout-razorpay-sheet-light.jpg
- docs/phases/evidence/p4-web/web-shop-15-checkout-razorpay-sheet-dark.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-02-order-success-light.jpg
- docs/phases/evidence/p4-web/web-shop-EPAY-02-order-success-dark.jpg


## 12. Empower hub, browse and filter athletes

Category: EMPOWER (donations). Persona: guest. Money: no.

Home's Donate to Empower rail (See all) pushes /home/empower. The hub shows a ledger derived stats banner (Raised so far, Athletes supported) that never moves with filters, combinable sport and region chips derived from the verified set, and a stack of hub variant UPACards with a progress bar and Donate / View profile buttons. Guest visible; only the pay step gates.

Release note: Founder decision row 24 (Apple commission on donations; Empower donations go through an Atlitos held fund, not a registered charity) is Open and blocks App Store submission tasks 14 and 16. UI-UPLIFT-PROPOSAL Designer items 7 and 8: blank campaign photo box needs a deterministic cover, and title duplicates description on seed cards; Premium item 22: two tone progress bar. The 2026-09-14 capture shows one sport chip (Cricket) and one region (Mumbai) because the seed has one verified UPA region. RELEASE-TODO G-27, D-01 to D-03, D-17.

After success: Donate lands on /home/donate/[id]; View profile lands on /home/upa/[id].

### Screens

**01 Home Empower rail (entry)**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/EmpowerRail.tsx (card apps/mobile/src/components/ui/upa-card.tsx)`
- See: h3 Donate to Empower with See all and ChevronRight, horizontal UPACards (w-72, first 8 verified UPAs) each with Donate and View profile.
- Do: Tap See all, Donate or View profile
- Tap targets: `See all`, `See all Empower athletes`, `Donate`, `View profile`
- Then: See all (accessibilityLabel See all Empower athletes) pushes /home/empower; Donate pushes /home/donate/[id]; View profile pushes /home/upa/[id]. The rail renders nothing when there are no verified UPAs or the read fails.

**02 Empower hub**  
Route `atlitos://home/empower`, source `apps/mobile/src/app/home/empower.tsx (card apps/mobile/src/components/ui/upa-card.tsx, chips apps/mobile/src/components/ui/chip.tsx)`
- See: AppBar backTitle Empower. Two StatTiles: Raised so far (mono INR, HeartHandshake icon) and Athletes supported. FILTER overline with SlidersHorizontal, a horizontal row of sport chips (SPORT_LABEL of sports present in the verified set) and a row of region chips (regions present). Then UPACards: photo or HeartHandshake placeholder, name, headline <Sport>, <region>, accent progress bar, mono <raised> raised and of <goal>, primary Donate and secondary View profile.
- Do: Toggle a sport chip or region chip, tap Donate or View profile
- Tap targets: `Back`, `Sport chip (data derived, e.g. Cricket)`, `Region chip (data derived, e.g. Mumbai)`, `Donate`, `View profile`, `Clear filters`, `Retry`
- Then: Chips filter the card grid client side (tap again to clear). Donate pushes /home/donate/[id]; View profile pushes /home/upa/[id].

### States

- loading: Empower hub. Trigger: Open before getStats and listUpas resolve Source: apps/mobile/src/app/home/empower.tsx state === 'loading': Skeleton cards 96, 200, 200
- error: Empower hub load error. Trigger: Either read throws (airplane mode, RELEASE-TODO D-17) Source: apps/mobile/src/app/home/empower.tsx state === 'error': Couldn't load Empower, message, Retry
- empty: No athletes match (filters active). Trigger: Pick a sport and region combination with no verified UPA Source: apps/mobile/src/app/home/empower.tsx EmptyState HeartHandshake No athletes match body No verified athletes match these filters right now. Clear them to see everyone. cta Clear filters
- empty: No athletes yet. Trigger: Zero verified UPAs (filter rows hidden too) Source: apps/mobile/src/app/home/empower.tsx EmptyState No athletes yet body Verified athletes will appear here as they publish their wishlists. (no CTA)
- loading: Home Empower rail. Trigger: Open Home before listUpas resolves Source: apps/mobile/src/components/organisms/home/EmpowerRail.tsx state === 'loading': Skeleton line 50% and two Skeleton cards width 288

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/09-empower-hub.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 13. Athlete (UPA) public profile and wishlist item funding

Category: EMPOWER (donations). Persona: guest. Money: no.

Verified only read through public_upa_profile; a non verified id resolves to Athlete not found. Header with photo, Verified athlete badge, headline, sport, region, state, story body, a Raised to date card and a Donate to this athlete button, then a WishlistGrid upa variant (progress bar, funded of cost, Fund this or a Funded marker), then supporters and thank you notes. Also reachable from an athlete hit on /home/search.

Release note: Same founder row 24 dependency as the hub. UI-UPLIFT-PROPOSAL Designer item 7 covers the blank athlete photo. RELEASE-TODO D-04 to D-07. No screenshot of this screen exists in the repo.

After success: Lands on /home/donate/[id] (general) or /home/donate/[id]?itemId=[itemId] (item).

### Screens

**01 Athlete profile**  
Route `atlitos://home/upa/[id]`, source `apps/mobile/src/app/home/upa/[id].tsx (grid apps/mobile/src/components/organisms/WishlistGrid.tsx upa variant)`
- See: AppBar backTitle Athlete. Photo 220 or HeartHandshake placeholder. BadgeCheck Verified athlete, h1 headline, <Sport>, <region>, <state>, body text. Card Raised to date with mono total. Primary button Donate to this athlete (HeartHandshake). Overline Wishlist then two column cards: image, title, accent progress bar, mono <funded> of <cost>, primary sm Fund this or a green Funded marker. Footer: Users icon N supporters with rows (Heart, display name or A Sponsor, mono amount), and Thank you notes with Quote cards.
- Do: Tap Donate to this athlete, or Fund this on an item, or an item card
- Tap targets: `Back`, `Donate to this athlete`, `Fund this`, `Wishlist item card (accessibilityLabel = title)`, `Back to Empower`, `Retry`
- Then: Donate pushes /home/donate/[id]; Fund this and the item card push /home/donate/[id]?itemId=[itemId]. Funded items show the Funded marker instead of a button (the card press still opens the donate screen, which then shows This item is fully funded).

### States

- loading: Athlete profile. Trigger: Open before getUpaProfile resolves Source: apps/mobile/src/app/home/upa/[id].tsx state === 'loading': Skeleton cards 220, 120, 160
- empty: Athlete not found. Trigger: Open an unverified, deactivated or unknown UPA id (RELEASE-TODO D-07) Source: apps/mobile/src/app/home/upa/[id].tsx state === 'notfound': EmptyState SearchX Athlete not found body This profile is not available. Browse verified athletes on the Empower hub. cta Back to Empower (replace /home/empower)
- error: Profile load error. Trigger: getUpaProfile throws Source: apps/mobile/src/app/home/upa/[id].tsx state === 'error': Couldn't load profile, message, Retry
- empty: No wishlist items. Trigger: Verified UPA with zero items Source: apps/mobile/src/app/home/upa/[id].tsx emptyComponent: No wishlist items yet. You can still support this athlete with a general donation above.
- empty: No supporters / no thank you notes. Trigger: UPA with no donations or no gratitude posts (D-06) Source: apps/mobile/src/app/home/upa/[id].tsx No supporters yet. Be the first to fund this athlete. and No thank you notes yet.
- success: Funded item marker. Trigger: Item status funded or delivered (D-05) Source: apps/mobile/src/components/organisms/WishlistGrid.tsx UpaProgress item.funded: successTint block labelled Funded replaces Fund this


## 14. Donate (presets, custom amount, minimum, confirm overlay, pay, processing, success, failed)

Category: EMPOWER (donations). Persona: donor. Money: yes.

Donation flow at /home/donate/[id] with optional ?itemId=. DonationSheet offers preset chips 200, 500, 1000, 2500 (first preselected) and a Custom amount field, gates the button below the platform minimum (fee_config donations.min_amount, seeded 10), renders the shared BillSummary (Donation row and Total, no fee row) and a Donate <amount> button. Tapping it as a guest opens LoginGateModal; signed in opens ConfirmSheet Confirm your donation. Donate now runs the donate edge function, the shared Razorpay sheet, then verify-payment. The client writes no donations, ledger or payment_intents rows.

Release note: Founder decision row 24 (Apple commission on donations) blocks tasks 14 and 16. Task 7 live Razorpay key. UI-UPLIFT-PROPOSAL Developer item 8 (pending state on Donate) and Premium item 8 (drag handle on Confirm sheet). ConfirmSheet still ships on native Modal with the a11y containment risk noted in LoginGateModal.tsx. The Back button stays active on the processing screen. record_donation (supabase/migrations/0054, 0067) notifies only the UPA owner (deep link /wishlist/<item> or /dashboard); the donor gets no notification, so RELEASE-TODO D-20 finds nothing on the donor account. RELEASE-TODO D-08 to D-13, D-20. No screenshot of this flow exists in the repo.

After success: Success stays on the donate route in its success phase; View My Impact lands on /account/impact and Back to athlete on /home/upa/[id]. A failed payment returns to the select phase with an inline error and the chosen amount preserved for retry.

### Screens

**01 Donate (select amount)**  
Route `atlitos://home/donate/[id] or atlitos://home/donate/[id]?itemId=[itemId]`, source `apps/mobile/src/app/home/donate/[id].tsx (sheet apps/mobile/src/components/organisms/DonationSheet.tsx)`
- See: AppBar backTitle Donate. Overline Donate, h2 cause title (item title or athlete headline). When funding an item: a card with the item label, mono cost and <remaining> left to reach this goal. Preset pill chips with mono amounts (200, 500, 1000, 2500), TextField Custom amount (placeholder Enter amount, number pad). Danger caption The minimum donation is <min>. when below minimum. BillSummary rows Donation and Total. Primary Donate <mono amount> (disabled below minimum).
- Do: Tap a preset or type a custom amount, tap Donate <amount>
- Tap targets: `Back`, `Preset amount chips (200, 500, 1000, 2500)`, `Custom amount`, `Donate`
- Then: Guest: LoginGateModal opens (route params keep the UPA and item so the donor returns intact). Signed in: ConfirmSheet opens.

**02 Confirm your donation (overlay)**  
Route `atlitos://home/donate/[id]`, source `apps/mobile/src/components/organisms/ConfirmSheet.tsx via apps/mobile/src/app/home/donate/[id].tsx`
- See: HeartHandshake icon in accentTint, title Confirm your donation, body You are donating <amount> to <item or headline>., primary Donate now, secondary Cancel.
- Do: Tap Donate now or Cancel
- Tap targets: `Donate now`, `Cancel`
- Then: Donate now sets phase processing and calls empower.donate({upaId, itemId, amount, expectedTotal}) then openRazorpayCheckout (name Atlitos, description Donation or Donation for <item>) then empower.verifyDonationPayment. Cancel dismisses and keeps the amount (D-11).

**03 Processing**  
Route `atlitos://home/donate/[id]`, source `apps/mobile/src/app/home/donate/[id].tsx phase === 'processing'`
- See: AppBar Donate, centered large ActivityIndicator in accent and callout Completing your donation. Please do not close this screen.
- Do: Wait (Razorpay sheet appears over it)
- Tap targets: `Back`
- Then: On verify success phase becomes success; on error phase becomes failed (or select with the item funded block).

**04 Thank you for giving**  
Route `atlitos://home/donate/[id]`, source `apps/mobile/src/app/home/donate/[id].tsx phase === 'success'`
- See: CheckCircle2 56 in success, h2 Thank you for giving, callout Your donation moves <item> closer to its goal. or Your donation supports <headline>., primary View My Impact, secondary Back to athlete. Back header replaces to the athlete profile.
- Do: Tap View My Impact or Back to athlete
- Tap targets: `View My Impact`, `Back to athlete`, `Back`
- Then: View My Impact replaces to /account/impact; Back to athlete and Back replace to /home/upa/[id].

### States

- loading: Donate. Trigger: Open before getUpaProfile and getMinDonation resolve Source: apps/mobile/src/app/home/donate/[id].tsx state === 'loading': Skeleton cards 120, 200
- error: Couldn't start donation. Trigger: Profile null (This athlete is not available.) or a read throws Source: apps/mobile/src/app/home/donate/[id].tsx state === 'error': Couldn't start donation, message, Retry
- error: Below minimum. Trigger: Type a custom amount under the minimum (D-09) Source: apps/mobile/src/components/organisms/DonationSheet.tsx belowMin: The minimum donation is <min>.; canDonate false
- gate: Login gate on Donate. Trigger: Tap Donate <amount> while not signed in (G-28) Source: apps/mobile/src/app/home/donate/[id].tsx requestDonate: if (!isSignedIn) setGateVisible(true); LoginGateModal
- processing: Completing your donation. Trigger: Tap Donate now Source: apps/mobile/src/app/home/donate/[id].tsx phase === 'processing'
- success: Thank you for giving. Trigger: verifyDonationPayment succeeds (D-12) Source: apps/mobile/src/app/home/donate/[id].tsx phase === 'success'
- failed: Payment not completed. Trigger: Dismiss the Razorpay sheet or an edge function error Source: apps/mobile/src/app/home/donate/[id].tsx phase === 'failed' && error: The minimum donation is <min>. (MIN_AMOUNT) / The amount changed. Nothing was charged. Please review and try again. (PRICE_MISMATCH) / error.message or Payment was not completed. Your amount is preserved.
- error: This item is now funded (ITEM_FUNDED mid flow). Trigger: Someone else completes the item between confirm and charge Source: apps/mobile/src/app/home/donate/[id].tsx itemFundedBlock warning card: This item is now funded, Someone completed this item before your payment. Nothing was charged. You can still support this athlete with a general donation., Button Donate to the general fund (replace /home/donate/[id])
- gate: This item is fully funded (opened already funded). Trigger: Open ?itemId= for a funded or delivered item Source: apps/mobile/src/app/home/donate/[id].tsx itemAlreadyFunded: This item is fully funded, You can support this athlete with a general donation instead., Button Donate to the general fund (replaces the DonationSheet)


## 15. My Impact

Category: EMPOWER (donations). Persona: donor. Money: no.

Donor's giving summary at /account/impact read exclusively from get_my_impact_summary scoped to auth.uid(): Total given, Athletes supported, Items funded, a Donation history list (UPA name or General Fund for checkout roundups, item title, date, amount) and Gratitude received posts. A never donated user sees the empty state, not zero rows.

Release note: UI-UPLIFT-PROPOSAL Premium item 24: total given becomes the hero, history rows carry the campaign cover; Designer item 9 names Impact's hero stat as total given; Developer item 10: Impact lacks pull to refresh. No in app entry point besides donate success (deep link otherwise). TEST-SUITE-ATHLETE-APP Correction 3 and E-04 confirm the total is server derived. RELEASE-TODO D-13 to D-16, D-19.

After success: Reached from the donate success screen (View My Impact replaces to it) or by deep link; there is no Settings or You tab row to it. Back returns to the previous screen.

### Screens

**01 My Impact**  
Route `atlitos://account/impact`, source `apps/mobile/src/app/account/impact.tsx`
- See: AppBar backTitle My Impact. StatTile Total given (mono INR, HeartHandshake), then Athletes supported and Items funded side by side. Overline Donation history with cards: UPA name or General Fund, item title, mono date, mono amount. Overline Gratitude received with MessageSquareHeart cards (athlete name or A verified athlete, item, body) when any exist.
- Do: Read only; tap Back
- Tap targets: `Back`, `Explore Empower`, `Sign in`, `Retry`
- Then: No edit or delete actions on past donations (D-15). Explore Empower pushes /home/empower.

### States

- gate: My Impact as guest. Trigger: Open /account/impact while not signed in Source: apps/mobile/src/app/account/impact.tsx !isSignedIn: h3 Sign in to see your impact + secondary Sign in (pushes /(auth)/login)
- loading: My Impact. Trigger: Open before getMyImpact resolves Source: apps/mobile/src/app/account/impact.tsx state === 'loading': Skeleton cards 96, 160, 120
- error: My Impact load error. Trigger: getMyImpact throws Source: apps/mobile/src/app/account/impact.tsx state === 'error': Couldn't load My Impact, message, Retry
- empty: No donations yet. Trigger: Account that has never donated (D-14) Source: apps/mobile/src/app/account/impact.tsx impact.donations.length === 0: EmptyState HeartHandshake No donations yet body Support a verified athlete and your giving will show up here. cta Explore Empower

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 16. Learn home (XP, stage, milestones entry, drills preview)

Category: LEARN. Persona: player. Money: no.

Learn home at /learn. Entered from the Trainings tab's Milestones and rewards rail (Open Learn) or deep link; Home has no Learn tile (the Finish setting up card mentions Learn but routes to onboarding). All XP, stage and milestone numbers come from get_learn_home() server side. A player with no primary sport (including every guest) sees the Pick a sport to start empty state.

Release note: UI-UPLIFT-PROPOSAL Designer item 9: Learn hero stat should be XP to next milestone; Designer item 24 roadmap bar to 8pt pill; Premium item 27 completed tick becomes a filled success circle; Designer item 1 notes Learn uses 32 section gaps. State matrix row Learn: skeleton, Pick a sport, section tier errors, cached offline. No entry from Home (only the Trainings shell rail or deep link). RELEASE-TODO A-24 to A-26, AD-34, AD-35.

After success: Sub screens push on top of Learn; Back returns to Learn, then to Trainings.

### Screens

**01 Trainings tab Milestones rail (entry)**  
Route `atlitos://trainings`, source `apps/mobile/src/components/organisms/trainings/MilestonesRail.tsx (mounted in apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx)`
- See: h3 Milestones and rewards with a text button Open Learn; horizontal milestone chips (earned first, icon or Lock), or an EmptyState Trophy No milestones yet body Complete drills in Learn to earn XP and unlock milestones. with CTA Open Learn.
- Do: Tap Open Learn
- Tap targets: `Open Learn`
- Then: Pushes /learn. Guests never reach this rail (Trainings tab shows the Set up your profile to train gate with Get started opening LoginGateModal).

**02 Learn**  
Route `atlitos://learn`, source `apps/mobile/src/app/learn/index.tsx (card apps/mobile/src/components/ui/drill-card.tsx, progress apps/mobile/src/lib/learn-display.ts)`
- See: AppBar backTitle Learn. StatTiles Total XP (Zap) and Milestones (Trophy). Card with overline <SPORT> ROADMAP, h2 current stage name (or Getting started), accent progress bar, caption <mono N> XP to <next stage>. or Top stage reached. Keep training to earn more milestones., secondary View roadmap (Map). Secondary button Milestones, N of M earned (Trophy). Section Drills (Dumbbell) with text button See all (ChevronRight) and up to 4 DrillCards (title, sport and skill category, difficulty pill, Zap mono XP, CircleCheck when completed).
- Do: Tap View roadmap, Milestones, See all or a drill
- Tap targets: `Back`, `View roadmap`, `Milestones, N of M earned`, `See all`, `Open <drill title>`, `Retry`
- Then: View roadmap pushes /learn/roadmap; Milestones pushes /learn/milestones; See all pushes /learn/drills; DrillCard pushes /learn/drill/[id].

### States

- loading: Learn. Trigger: Open before getLearnHome, listDrills and getCompletedDrillIds resolve Source: apps/mobile/src/app/learn/index.tsx state === 'loading': Skeleton cards 96, 120, 96, 96
- error: Learn load error. Trigger: Any read throws Source: apps/mobile/src/app/learn/index.tsx state === 'error': Couldn't load Learn, message, Retry
- empty: Pick a sport to start. Trigger: No primary sport or no seeded ladder for it; every guest (A-24) Source: apps/mobile/src/app/learn/index.tsx home.sport === null: EmptyState Map Pick a sport to start body Choose your primary sport to unlock a roadmap, drills and milestones tuned to it. (no CTA)
- empty: No drills yet. Trigger: Sport with zero active drills Source: apps/mobile/src/app/learn/index.tsx previewDrills.length === 0: EmptyState Dumbbell No drills yet body Drills for your sport will appear here as they are published.

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/08-learn.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 17. Roadmap

Category: LEARN. Persona: player. Money: no.

The stage ladder for the player's sport at /learn/roadmap: progress header then one row per stage with Check (reached) or Lock (locked), Stage N (You are here on the current stage, accent tint background), stage name and mono XP threshold. Read only; the screen computes no XP.

Release note: UI-UPLIFT-PROPOSAL Designer item 24: roadmap progress bar to 8pt pill with the XP numeral on the bar end (the bar is already 8pt in roadmap.tsx). No roadmap capture exists in the repo: the 2026-09-14 contact sheet tile labelled learn-roadmap actually captured the Learn home. TEST-SUITE-ATHLETE-APP LN-02, LN-03 passed against this screen.

After success: Back returns to /learn.

### Screens

**01 Roadmap**  
Route `atlitos://learn/roadmap`, source `apps/mobile/src/app/learn/roadmap.tsx (progress math apps/mobile/src/lib/learn-display.ts stageProgress)`
- See: AppBar backTitle Roadmap. Header card overline <Sport>. <mono XP> XP total, accent progress bar, caption <N> XP to <next>. or Top stage reached. Then stage rows with a 40px circle (Check on accent when reached, Lock on muted when not), overline Stage <n> plus You are here on the current stage, h3 name, mono threshold over caption XP.
- Do: Scroll; tap Back
- Tap targets: `Back`, `Retry`
- Then: No actions; read only ladder.

### States

- loading: Roadmap. Trigger: Open before getLearnHome resolves Source: apps/mobile/src/app/learn/roadmap.tsx state === 'loading': Skeleton cards 80, 72, 72, 72
- error: Roadmap load error. Trigger: getLearnHome throws Source: apps/mobile/src/app/learn/roadmap.tsx state === 'error': Couldn't load roadmap, message, Retry
- empty: No roadmap yet. Trigger: No primary sport or zero stages Source: apps/mobile/src/app/learn/roadmap.tsx EmptyState Map No roadmap yet body Pick a primary sport to unlock a roadmap tuned to it.


## 18. Drills library with sport and difficulty filters

Category: LEARN. Persona: player. Money: no.

Full active drill catalog at /learn/drills with combinable sport chips (all SPORTS) and difficulty chips (Beginner, Intermediate, Advanced). Each DrillCard opens the drill detail; completed drills carry a CircleCheck. Reads are filtered active = true in the hook.

Release note: UI-UPLIFT-PROPOSAL Premium item 27: completed tick becomes a filled success circle with a white check. Admin can deactivate drills (RELEASE-TODO AD-35) which removes them here. TEST-SUITE-ATHLETE-APP LN-05 passed (31 drills).

After success: Lands on /learn/drill/[id].

### Screens

**01 Drills**  
Route `atlitos://learn/drills`, source `apps/mobile/src/app/learn/drills.tsx (card apps/mobile/src/components/ui/drill-card.tsx, labels apps/mobile/src/lib/learn-display.ts)`
- See: AppBar backTitle Drills. FILTER overline with SlidersHorizontal, sport chip row (Football, Cricket, Badminton, Tennis) and difficulty chip row (Beginner, Intermediate, Advanced). DrillCards: h3 title, caption <Sport>. <skill category>., difficulty pill, Zap mono XP, CircleCheck when completed.
- Do: Toggle chips, tap a drill
- Tap targets: `Back`, `Football`, `Cricket`, `Badminton`, `Tennis`, `Beginner`, `Intermediate`, `Advanced`, `Open <drill title>`, `Clear filters`, `Retry`
- Then: Chips reload the list with the filter (tap again to clear). DrillCard pushes /learn/drill/[id].

### States

- loading: Drills. Trigger: Open or change a filter before listDrills resolves Source: apps/mobile/src/app/learn/drills.tsx state === 'loading': three Skeleton cards 96 under the filters
- error: Drills load error. Trigger: listDrills or getCompletedDrillIds throws Source: apps/mobile/src/app/learn/drills.tsx state === 'error': Couldn't load drills, message, Retry
- empty: No drills match (filters active). Trigger: Filter combination with no active drills Source: apps/mobile/src/app/learn/drills.tsx EmptyState Dumbbell No drills match body No active drills match these filters right now. Clear them to see everything. cta Clear filters
- empty: No drills yet. Trigger: Zero active drills with no filters Source: apps/mobile/src/app/learn/drills.tsx EmptyState No drills yet body Drills will appear here as they are published.

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 19. Drill detail and Mark complete

Category: LEARN. Persona: player. Money: no.

Drill instructions at /learn/drill/[id] with the one client write in the XP path: Mark complete inserts the caller's own drill_completions row and a server trigger grants XP and unlocks milestones. Guests get the LoginGateModal; signed in players confirm through ConfirmSheet. A completed drill shows a Completed banner and cannot be redone (A-26 resolves to the completed state, never a crash).

Release note: RELEASE-TODO A-25 (XP total updates) and A-26 (second completion). TEST-SUITE-ATHLETE-APP LN-06 NOT RUN (write path). ConfirmSheet on native Modal carries the a11y containment risk recorded in LoginGateModal.tsx. No screenshot of this screen exists.

After success: Stays on the drill with the Completed banner; Back to Drills or Learn shows the CircleCheck on the card and the updated Total XP (A-25). Milestones may show newly Earned rows.

### Screens

**01 Drill**  
Route `atlitos://learn/drill/[id]`, source `apps/mobile/src/app/learn/drill/[id].tsx`
- See: AppBar backTitle Drill. Overline <Sport>. <skill category>. <Difficulty>., h1 title, Zap with mono XP value and XP on completion. Card overline How to do it with the description. Then either a success tint banner (CircleCheck, Completed, XP is added to your total. Drills count once, so there is nothing more to do here.) or a primary button Mark complete (CircleCheck).
- Do: Tap Mark complete
- Tap targets: `Back`, `Mark complete`, `Back to drills`, `Retry`
- Then: Guest or not signed in: LoginGateModal opens. Signed in: ConfirmSheet opens.

**02 Mark this drill complete? (confirm)**  
Route `atlitos://learn/drill/[id]`, source `apps/mobile/src/components/organisms/ConfirmSheet.tsx via apps/mobile/src/app/learn/drill/[id].tsx`
- See: CircleCheck icon in accentTint, title Mark this drill complete?, body This adds the drill's XP to your total and cannot be undone. Drills count once., primary Mark complete, secondary Not yet.
- Do: Tap Mark complete or Not yet
- Tap targets: `Mark complete`, `Not yet`
- Then: learn.markDrillComplete(id) inserts the completion; the sheet closes and the Completed banner replaces the button. Not yet closes (ignored while submitting).

### States

- loading: Drill. Trigger: Open before getDrill and getCompletedDrillIds resolve Source: apps/mobile/src/app/learn/drill/[id].tsx state === 'loading': Skeleton line 70%, cards 120, 56
- error: Drill load error. Trigger: getDrill or getCompletedDrillIds throws Source: apps/mobile/src/app/learn/drill/[id].tsx state === 'error': Couldn't load drill, message, Retry
- empty: Drill not available. Trigger: getDrill returns null (inactive or unknown id) Source: apps/mobile/src/app/learn/drill/[id].tsx !drill: EmptyState Dumbbell Drill not available body This drill is no longer active. Browse the library for the current drills. cta Back to drills (replace /learn/drills)
- gate: Login gate on Mark complete. Trigger: Tap Mark complete while status is not signed_in Source: apps/mobile/src/app/learn/drill/[id].tsx onMarkCompletePress: if (requiresAuthGate) setGateVisible(true); LoginGateModal
- processing: Submitting completion. Trigger: Tap Mark complete on the confirm sheet Source: apps/mobile/src/app/learn/drill/[id].tsx ConfirmSheet loading={submitting}; onCancel ignored while submitting
- success: Completed banner. Trigger: markDrillComplete succeeds, or open an already completed drill Source: apps/mobile/src/app/learn/drill/[id].tsx completed: successTint banner Completed + XP is added to your total. Drills count once, so there is nothing more to do here.
- error: Completion failed. Trigger: markDrillComplete throws Source: apps/mobile/src/app/learn/drill/[id].tsx submitError caption in danger above the Mark complete button


## 20. Milestones

Category: LEARN. Persona: player. Money: no.

Every milestone from get_learn_home() at /learn/milestones, rendered Earned (accent tint, the milestone's lucide icon_name resolved via milestoneIcon, fallback Medal) or Locked (Lock icon, 0.72 opacity), with StatTiles Earned and Total XP.

Release note: Also surfaced as chips on the Trainings tab Milestones and rewards rail (MilestonesRail). UI-UPLIFT-PROPOSAL Designer item 23: earned versus locked needs more than tint. TEST-SUITE-ATHLETE-APP LN-04 passed (3 of 3).

After success: Back returns to /learn.

### Screens

**01 Milestones**  
Route `atlitos://learn/milestones`, source `apps/mobile/src/app/learn/milestones.tsx (icon lookup apps/mobile/src/lib/learn-display.ts)`
- See: AppBar backTitle Milestones. StatTiles Earned (Trophy) and Total XP. One row per milestone: 44px circle with the lucide icon (flag, target, rocket, crown, flame, star, zap, heart, award, medal, trophy, sparkles) on accent when earned or Lock when locked, label name, caption description, overline Earned or Locked (rendered uppercase by the overline style).
- Do: Scroll; tap Back
- Tap targets: `Back`, `Retry`
- Then: Read only.

### States

- loading: Milestones. Trigger: Open before getLearnHome resolves Source: apps/mobile/src/app/learn/milestones.tsx state === 'loading': Skeleton cards 96, 72, 72, 72
- error: Milestones load error. Trigger: getLearnHome throws Source: apps/mobile/src/app/learn/milestones.tsx state === 'error': Couldn't load milestones, message, Retry
- empty: No milestones yet. Trigger: Zero milestone definitions for the sport (or no sport) Source: apps/mobile/src/app/learn/milestones.tsx EmptyState Trophy No milestones yet body Milestones unlock as you complete drills and earn XP. Start with a drill to get going.

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png

