# PRD-06: Sponsor and Donor Surfaces (Empower, in the consumer app)

Status: draft for founder review
Owner: Empower + Life epic
Depends on: PRD schema domains `empower`, `payments`, `commerce`, `identity/roles`
Related: PRD-05 Atlitos Life (UPA profile and verification, the portal side of Empower, out of scope here except where the consumer app reads UPA data)

## 1. Purpose and stakeholder definition

Empower is the giving layer of Atlitos, threaded through the consumer app. Verified Underprivileged Athletes (UPAs) publish gear wishlists on Atlitos Life; any consumer app user can browse them, fund a specific item or make a general donation, and see the collective and personal impact of their giving. This PRD covers only the consumer app side: the empower hub, UPA public profile, donate flow, checkout roundup, and My Impact. UPA application, verification, and gratitude authoring live in the Atlitos Life portal (separate PRD) and are read only surfaces here.

Stakeholders:
- Sponsor. Any authenticated user who donates. Not a distinct account type or onboarding path, a role a user acquires the moment their first donation succeeds.
- UPA (Underprivileged Athlete). Verified profile whose wishlist and story are shown to sponsors. Managed and verified elsewhere, read only in this PRD.
- Guest browsing user. Can browse the empower hub and UPA profiles but must authenticate before donating.
- Admin. Verifies UPAs and moderates content elsewhere; this PRD assumes only verified UPAs are ever visible in the consumer app.
- Atlitos platform. Owns the ledger, roundup mechanics, and payout routing to UPAs or their guardians via Razorpay Route (payments PRD).

## 2. Jobs to be done

- As a sponsor, I want to discover athletes who need support so I can decide who to help.
- As a sponsor, I want to see exactly what an athlete needs (a specific pair of boots, a racket) so my money buys something concrete.
- As a sponsor, I want to give without friction, in a standalone flow or folded into something I was already buying.
- As a sponsor, I want to see the outcome of my giving, individually and as part of a larger movement, so I keep giving.
- As a sponsor, I want a receipt and a record I can find again for every donation.
- As a browsing user not ready to donate, I want to look around without being forced into an account or a payment screen.

## 3. Surfaces and screens

### 3.1 Empower Hub (`/home/empower`)
Entry from the Home donate cards ("View All") and from bottom nav or account menu.
States:
- Loaded: aggregate impact banner (total raised, athletes supported, mono numerals), sport filter chips, region filter chips, UPACard grid (variant hub, includes funding progress bar per card).
- Filtered empty: filters applied, zero verified UPAs match. Empty state copy plus a clear filters action.
- Loading: skeleton grid, skeleton stat banner.
- Error: fetch failed, retry action, no partial stale data shown as if live.

### 3.2 UPA Public Profile (`/home/upa/[id]`)
States:
- Loaded: photo, story, verified badge, sport, region, total raised to date, WishlistGrid (variant upa, each item shows cost, funded progress, Fund This item), general Donate CTA.
- Fully funded wishlist: every item shows funded, item level Fund This buttons disabled, general Donate CTA remains active (goes to the athlete's general fund, not a specific item).
- Loading: skeleton profile.
- Not found or not verified: 404 style screen. Unverified UPAs are never resolvable by id in the consumer app regardless of how the id was obtained.

### 3.3 Donation Flow (`/home/donate/[id]`)
Standalone flow, entered from a UPA profile's Donate CTA or a wishlist item's Fund This.
States:
- Amount selection (DonationSheet): preset amounts, fund specific item (id carried from wishlist, item name and remaining amount shown), custom amount input.
- Review (BillSummary): single Donation line plus bold Total, no GST or platform fee rows on standalone donations, pay action.
- Processing: payment in flight, blocking spinner, no double submit.
- Success: confirmation, updated item funding progress if item specific, prompt to view My Impact.
- Failed: payment failed, retry action, amount preserved.
- Item already funded mid flow: if the targeted item was fully funded by someone else while this sponsor was on the amount or review screen, block submission and offer the general fund or a different item instead.

### 3.4 Checkout Roundup (inside Shop checkout, `/shop/checkout`)
Not a separate screen; a line item inside the existing checkout BillSummary.
States:
- Roundup unchecked (default off, per SPEC): donation line absent from total, checkbox visible with copy explaining the roundup ("Support a Rising Athlete in Need").
- Roundup checked: donation line appears in BillSummary with computed amount, included in total, persists through payment.
- Order placed with roundup: roundup amount recorded as a donation attributed to the order, general fund (not a specific UPA or item), reflected in My Impact after order confirmation.

### 3.5 My Impact (`/account/impact`)
States:
- Loaded: total given (mono numeral), athletes supported count, items funded count, donation history list (each row: UPA name, amount, date, item if applicable), gratitude posts received section.
- Empty: user has never donated. Empty state with a CTA into the empower hub, no fabricated zero rows.
- Loading: skeleton tiles and list.

## 4. Functional requirements

FR-1. The empower hub must show only UPAs whose verification status is verified. Under review or rejected UPAs are never queryable by any consumer app request, list or direct id.

FR-2. Empower hub filters (sport, region) must be combinable and must update the UPACard grid and the aggregate stat banner consistently (stats reflect the full verified UPA set regardless of filters; filters affect only the card grid).

FR-3. The aggregate impact banner values (total raised, athletes supported) must be computed from the payments ledger, not from a cached or client-maintained counter.

FR-4. A UPA public profile must render wishlist items with live funded amounts computed from the ledger, not from a denormalized field that can drift.

FR-5. A wishlist item that has reached its funding target must be visually marked funded and must reject further item specific donations with ITEM_FUNDED, even if the request race occurs between two sponsors.

FR-6. The donation flow must present a BillSummary with only a Donation row and a Total row for standalone donations. No GST, platform fee, or delivery rows may appear on a standalone donation.

FR-7. Donation amounts must enforce a minimum amount (MIN_AMOUNT error below it) and must be re-priced server side on submission; the client never determines the final charged amount.

FR-8. All money movement for donations must go through the `donate` edge function using service role, never a direct client write to any payments or empower table.

FR-9. A successful donation must produce a ledger entry, a Donation record, and, if item specific, an updated wishlist item funded amount, atomically. Partial failure (payment captured but ledger write fails) must not be possible; the edge function must reconcile or roll back.

FR-10. The checkout roundup checkbox must default unchecked on every checkout session. Checking it adds a Donation row to the existing checkout BillSummary and includes it in the order total charged in the same payment.

FR-11. A roundup donation from checkout must be attributed to the platform general fund, not to a specific UPA, and must appear in My Impact as a donation with no UPA name (or a generic "General Fund" label) distinct from targeted donations.

FR-12. My Impact must read exclusively from the payments ledger and empower tables scoped to the authenticated user (RLS enforced), never show another user's donations, and must never show a donation that has not been confirmed as paid.

FR-13. Any user who has never donated must see the My Impact empty state, not zero valued rows implying a real but empty history versus a state where no donations exist at all; these are visually the same empty state.

FR-14. Gratitude posts (authored by UPAs or guardians in the Life portal) must appear in the donor's My Impact only when linked to a donation made by that authenticated user; gratitude content is read only in the consumer app.

FR-15. Donating requires authentication. A guest attempting to reach the donation review or pay step must be routed to sign in or sign up first, with the donation context (UPA id, item id, amount) preserved across that interruption.

FR-16. The donate edge function must validate that the target UPA is verified at the moment of the donation request, independent of what the client last fetched, and reject with 404 if the UPA is no longer verified.

FR-17. Every money surface in this PRD (donation review, checkout with roundup) must render the shared BillSummary component; no ad hoc summary layouts are permitted.

FR-18. Donation history entries must be immutable from the client; refunds or corrections, if ever needed, happen through admin tooling outside this PRD's scope, never through a client-writable field.

FR-19. Preset donation amounts on the DonationSheet must be configurable (not hardcoded per screen) so the same component serves both general and item specific donation contexts without a UI fork.

FR-20. The empower hub, UPA profile, and My Impact must each independently handle loading, empty, error, and loaded states with no shared assumption that a prior screen already fetched the data.

## 5. Data touched

Schema domain `empower`:
- `upa_applications` — read only (consumer app never writes; used indirectly to confirm verification status via a verified UPA view/table).
- `upa_wishlist_items` — read for display and funded progress; write path is via `donate` edge function only (server side, service role), never direct client write.
- `donations` — write via `donate` edge function only; read (scoped to self) for My Impact and (aggregate, anonymized) for empower hub stats.

Schema domain `payments`:
- `payment_intents` — write via `donate` and `checkout` edge functions only; read scoped to self for receipt/status.
- `ledger_entries` — write via edge functions only (service role); read (aggregate) for impact stats, read (scoped to self) for My Impact.
- `payout_accounts`, `transfers`, `fee_config` — not touched by this PRD's consumer surfaces (Route payout to UPAs/guardians is Life portal and payments PRD territory).

Schema domain `commerce`:
- `orders` — read/write via existing `checkout` edge function; this PRD adds the donation roundup field to the existing checkout payload, no new table.

Schema domain `identity/roles`:
- `user_roles` — read only, to confirm authenticated user for donation attribution; sponsor is implicit and requires no role write.

## 6. Payment touchpoints

All money on every surface in this PRD moves exclusively through edge functions with service role keys:
- Standalone donation: `donate` edge function, Razorpay order creation, capture, and ledger write server side.
- Checkout roundup: existing `checkout` edge function, extended to accept a `donationRoundup` amount that is included in the single Razorpay order for the whole cart plus donation; no separate charge.

BillSummary is mandatory on every money surface this PRD defines:
- Donation review screen (Donation row, Total row only).
- Shop checkout (existing rows plus the optional Donation roundup row).

No client code in this PRD computes a final chargeable amount; the server re-prices on submission and returns PRICE_MISMATCH if the client's displayed total has drifted (stale wishlist funding, changed preset config, etc).

## 7. Acceptance criteria per journey

### Journey: Browse and discover (guest or authenticated)
- AC-1: Opening the empower hub with no filters shows all verified UPAs and an aggregate stat banner with non-zero values if any verified UPA exists.
- AC-2: Applying a sport filter reduces the UPACard grid to matching UPAs only; the stat banner values do not change when a filter is applied.
- AC-3: Tapping a UPACard opens that UPA's public profile with story, verified badge, wishlist, and total raised.
- AC-4: A guest can complete AC-1 through AC-3 without being prompted to authenticate.

### Journey: Fund a specific wishlist item
- AC-5: From a UPA profile, tapping Fund This on an unfunded item opens the donation flow with that item preselected and its remaining amount shown.
- AC-6: The review screen's BillSummary shows exactly a Donation row and a Total row, both equal to the entered amount.
- AC-7: On successful payment, the item's funded progress on the UPA profile updates to reflect the new amount without a manual refresh being required on next visit.
- AC-8: If the item reaches its target from this donation, it is marked funded and its Fund This action becomes disabled.
- AC-9: A second sponsor attempting to fund the same item after it is fully funded receives ITEM_FUNDED and cannot submit payment for that item.

### Journey: General donation (not item specific)
- AC-10: From a UPA profile's Donate CTA, the sponsor can choose a preset amount or enter a custom amount with no item attached.
- AC-11: Below the platform minimum, submission is blocked with MIN_AMOUNT shown before any payment attempt.
- AC-12: On success, My Impact shows the new donation with the correct UPA name, amount, and date within the same session.

### Journey: Checkout roundup
- AC-13: On any shop checkout, the roundup checkbox is unchecked by default and the BillSummary total excludes it.
- AC-14: Checking the roundup box adds a Donation row to BillSummary and increases the total by exactly the roundup amount.
- AC-15: Completing checkout with roundup checked charges the roundup amount in the same payment as the order, and a corresponding donation appears in My Impact attributed to the general fund, not a specific UPA.
- AC-16: Unchecking the roundup box before payment removes the Donation row and the total returns to the pre-roundup amount.

### Journey: My Impact
- AC-17: A user who has never donated sees the My Impact empty state with a CTA into the empower hub.
- AC-18: A user with donation history sees total given, athletes supported, items funded, and every individual donation listed with UPA name (or General Fund), amount, and date.
- AC-19: A gratitude post from a UPA the user donated to appears in My Impact linked to the correct donation; a gratitude post to a different sponsor never appears.
- AC-20: My Impact never shows another user's donation, verified by attempting the read as a second authenticated user and confirming an empty or unrelated result.

### Journey: Authentication gating
- AC-21: A guest who taps Donate or Fund This is routed to sign in or sign up before reaching the payment step, and upon successful authentication is returned to the donation flow with the original UPA and item context intact.

## 8. Explicitly out of scope

- UPA application submission and admin verification workflow (Atlitos Life portal PRD).
- Gratitude post authoring by UPAs or guardians (Atlitos Life portal PRD).
- Razorpay Route payout to UPAs or their guardians, KYC, and payout account setup (payments PRD).
- Recurring or subscription donations; every donation in this PRD is a one time payment.
- Donor leaderboards, public donor recognition, or social sharing of donations.
- Tax receipt generation or 80G style documentation.
- Refunds, donation cancellation, or correction flows.
- Corporate or bulk sponsorship programs, matched giving, or employer donation matching.
- Any UPA discovery outside the empower hub and profile (no separate search index, no cross-linking from Clutch or Learn in this PRD).
- Editing or moderating wishlist items; that is Life portal and admin territory.
- Currency other than INR.

## 9. Open questions for the founder

1. Resolved elsewhere: PRD-07 FR-16 and PAYMENTS.md's `fee_config` key `commerce.donation_roundup_flat` fix the roundup as a single config-driven flat amount, not sponsor-chosen and not a percentage of cart. No open decision remains here.
2. What is the platform minimum donation amount (MIN_AMOUNT), and does it differ between standalone and roundup donations?
3. Should the empower hub aggregate stat banner be platform-wide (all time) or windowed (e.g. this month), and should it be cached or always live?
4. When a wishlist item is fully funded by a roundup or general donation overflow (not a direct Fund This), does the system auto-allocate excess general funds to specific items, or does all general giving stay unallocated until Life portal admin action?
5. Does My Impact need a downloadable or shareable summary (even without formal tax receipts) for this phase, or is on-screen history sufficient for P6?
6. Are UPA minors (e.g. Ravi, age 12) shown with any additional consent or guardian attribution copy on the public profile, or does that live entirely in the Life portal application data with no consumer facing difference?
