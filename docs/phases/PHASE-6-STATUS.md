# Phase 6 Status: Empower and Atlitos Life

**Status: APPROVED at gate (2026-07-22), pending phase-close.** Stories AT-108 through AT-128 built and merged to main. Integrator pass green, biased approver cycle 1 verdict APPROVE (see the two sections at the end of this doc). Phase-close still owes the checklist tick-off, Jira reconciliation, and the P7 handoff note. This doc is the P6 contract and phase memory.

Gate (docs/PLAN.md P6): "UPA apply/verify/wishlist/gratitude portal, donate + roundup real, My Impact. GATE: Journey 5 end to end."

Scope ceiling: `docs/prd/PRD-05-upa-life.md` (the Atlitos Life web portal, `apps/portal-life`, FR-1 through FR-27) and `docs/prd/PRD-06-sponsor.md` (the consumer app Empower surfaces, `apps/mobile`, FR-1 through FR-20). Plus the single admin piece P6 depends on to reach the "verify" half of its own gate: extending the existing `admin_approve_verification_request` RPC (0007) to the `applicant_type='upa'` branch that PRD-05 section 1 delegates to the admin app. Nothing else. No Learn, no sponsor payout/Route to UPAs (payments PRD, deferred), no tax receipts, no recurring donations, no coupon or refund flows.

This is a MONEY phase: it adds the fourth payment domain (`donation`) and it settles the inherited P4 roundup ledger debt. Every constraint in CLAUDE.md's Financial invariant applies and the biased approver blocks on any violation.

## The inherited P4 debt this phase must honor (the single most important money design)

The P4 commerce donation roundup (founder decision 2026-07-20: round the cart total up to the next multiple of 10) already accrues its own `platform` ledger leg per order, tagged "donation roundup held for Empower allocation, order <id>" (PHASE-4-STATUS.md D1, lines 41 to 49). It was deliberately NOT credited to a real `upa_fund` account because `ledger_entries.account_ref` is not nullable for non-platform accounts and the checkout roundup targets no specific UPA. **P6 owes moving those rupees off `platform` and onto a real `upa_fund` account_ref, as a balanced reconciling movement, without re-reading order rows (the leg is queryable directly by its tag and by `domain='commerce'`).**

### The general fund account, decided here so builders do not each invent one

The roundup is a "platform general fund" donation (PRD-06 FR-11), not a specific UPA's. But `upa_fund` needs a non-null `account_ref`. So P6 defines ONE reserved sentinel account_ref, the **General Fund**, a fixed seeded constant UUID `00000000-0000-4000-a000-0000000f0000`, recorded in SCHEMA.md and PAYMENTS.md. `ledger_entries.account_ref` carries no FK, so this is a pure ledger anchor, not a fake UPA row. Fund balances then derive uniformly:

- A specific UPA's total raised = `sum(amount) FILTER (direction=credit) - sum(amount) FILTER (direction=debit) WHERE account_type='upa_fund' AND account_ref = <upa_application_id>`.
- The platform general fund balance = the same query with `account_ref = '00000000-0000-4000-a000-0000000f0000'`.

No denormalized balance column, ever (CLAUDE.md, SCHEMA.md line 961).

### The allocation mechanism (balanced, two arms)

**Forward (all NEW roundup orders, from P6 on):** `finalize-order-payment.ts` stops parking the roundup on `platform`. When `donation_roundup > 0` it writes, in the SAME transaction as the order and the rest of the group, a `donations` row (`method='checkout_roundup'`, `upa_id=NULL` meaning general fund, `order_id` set, `donor_id` = the order's user) AND credits the roundup leg to `upa_fund` at the General Fund account_ref instead of `platform`. The group still balances: `debit platform total = credit platform revenue + credit upa_fund(general) roundup`. No future backfill is ever needed.

**Backfill (the historical P4 platform roundup legs):** one reconciliation migration finds every existing `platform` roundup leg by its tag, and for each writes (a) the missing `donations` row and (b) a balanced reclassification group: `debit platform <roundup>` "reclassify roundup from platform clearing to UPA general fund, order <id>", `credit upa_fund(general) <roundup>` "roundup allocated to general fund, order <id>". Debit equals credit, so the group balances; the platform debit offsets the original P4 roundup credit so platform nets to zero on that roundup, and the general fund gains it. Idempotent: keyed so a re-run writes nothing twice (one reclass group per source order). This is a ledger movement, not a mutation of the P4 leg (P4 legs are immutable history).

**Distribution of general fund money to specific UPAs is OUT of P6** (PRD-06 open question 4, assumption below): general giving stays pooled at the General Fund account_ref until a future admin action. P6 builds the platform-to-general-fund movement only.

### funded_amount vs the ledger, reconciled

`upa_wishlist_items.funded_amount` is a per-item convenience and the FR-5 race guard, written ONLY by the donation finalize handler, atomically in the same transaction as the ledger credit, so it cannot drift within a transaction. It answers item-level progress. The authoritative money numbers (a UPA's total raised, the hub aggregate, My Impact totals) are ALWAYS ledger-derived per above, never a client sum and never a read of a mutable balance column (PRD-06 FR-3, FR-4). Verification asserts the two agree.

## The donation payment flow (reuse the finalize gate, do not fork it)

Donation is the fourth domain on the shared gate, following courts/sessions/commerce exactly (the stub is already in `_shared/finalize-payment.ts` at the `if (!intent.entity_id)` branch, and `payment_domain` already includes `donation`).

1. Consumer app calls the `donate` edge function `{ upa_id, item_id?, amount, method:'standalone' }` with the donor's JWT. `donate` re-validates the UPA is `status='verified'` and, if item-specific, `funded_amount < cost` at request time (not client cache), enforces `fee_config` `donations.min_amount` as `MIN_AMOUNT`, re-prices, and rejects `ITEM_FUNDED` / `404` / `MIN_AMOUNT` / `PRICE_MISMATCH` BEFORE Razorpay. It inserts `payment_intents` (`domain='donation'`, `entity_id=NULL`, the `donations` row does not exist yet) and creates the Razorpay order through the shared `_shared/razorpay.ts` helper. No client writes any money or empower row (PRD-06 FR-8).
2. Client pays via the existing `react-native-razorpay` wrapper (the same one P3/P4 verified, no second invocation, no `Platform.OS` fork).
3. Capture arrives at `verify-payment` (client callback) and/or `razorpay-webhook`; both call `finalizePaymentCaptured`, which flips the intent idempotently and dispatches a NEW `case "donation"` handled by `finalize-donation-payment.ts`, placed BEFORE the null `entity_id` check (like commerce, because donation's row is created by the handler). The handler, in one transaction: inserts the `donations` row, if item-specific applies `UPDATE upa_wishlist_items SET funded_amount = funded_amount + amount` and flips `status` to `funded` when `funded_amount >= cost` (re-checking the guard so a race loses with `ITEM_FUNDED` and no order-of-money bug), writes the balanced ledger group `debit platform <amt>` / `credit upa_fund(<upa_id>) <amt>` (no platform fee leg, PRD-06 FR-6), backfills `entity_id` = donation id, writes a `notifications` row. Idempotency is the gate's intent flip plus one-group-per-entity discipline.

Standalone donation BillSummary is a single Donation row plus Total, rendered through the shared `BillSummary` (PRD-06 FR-6, FR-17). The checkout roundup path already runs through `checkout` + `finalize-order-payment`; P6 only changes where its leg lands (above) and surfaces it in My Impact.

## Gate definition (the bar; Journey 5 end to end)

P6 passes when all of the following hold on the deployed stack:

1. **Apply and verify (PRD-05 Journeys A, B).** A signed-in user completes the 4-step `/apply` wizard on `apps/portal-life` (draft persists across reload), submit creates a `upa_applications` row `status='submitted'` plus a linked `verification_requests` row; admin approval drives it to `verified` through the extended `admin_approve_verification_request` (one audit row, upa role granted), and `/status` reflects each state including a `needs_info` branch that links back into the flagged `/apply` step.
2. **Wishlist and funding (PRD-05 Journey C).** A verified UPA adds an item (cost > 0, `open`, funded 0); a real test donation of part of the cost lands and `/wishlist/[itemId]` reflects the new funded amount without a manual refresh (Realtime); an item reaching its cost shows `funded` and can no longer be edited or removed.
3. **Donate real, both shapes (PRD-06 Journeys: fund item, general donation).** An item-specific donation and a general (no item) donation each complete through the `donate` edge function with a real Razorpay test payment, each writing a balanced ledger group (`debit platform` / `credit upa_fund` at the UPA's account_ref), summing to `0.00`, one group per donation. `MIN_AMOUNT` blocks below the floor before any charge; `ITEM_FUNDED` blocks a second sponsor on a filled item.
4. **Roundup real and allocated (the inherited debt).** Every historical P4 `platform` roundup leg is moved to the General Fund `upa_fund` account_ref via a balanced reclassification group, with its `donations` row created; a NEW checkout with roundup checked credits the General Fund directly and creates its `donations` row in the same transaction; the general fund balance equals the sum of both, with no double count and no orphan or unbalanced group.
5. **My Impact (PRD-06 Journey My Impact).** The donor sees total given, athletes supported, items funded, and every donation (item ones with the UPA name, the roundup one as General Fund), read exclusively from the ledger and empower tables scoped to the authenticated user; a never-donated user sees the empty state, not zero rows.
6. **Gratitude (PRD-05 Journey D).** A gratitude post can be composed only for a `funded`/`delivered` item with no existing post (UNIQUE enforced), is immutable except UPA soft-delete, and appears on the item detail and the public profile.
7. **Isolation and the verified gate hold, non-vacuously.** Two donor ids are asserted to DIFFER before the isolation result is trusted (AT-62 lesson); My Impact never returns another user's donations; an unverified UPA id is unresolvable in the consumer app by list or direct id (PRD-06 FR-1, FR-16); `donations` takes no client write and `upa_wishlist_items.funded_amount`/`status` are not client-writable (RLS `WITH CHECK` column exclusion plus grants).
8. `pnpm turbo typecheck build lint` green, RLS advisor run and diffed against the P5 baseline, light and dark web evidence captured, biased approver APPROVE.

**Not a gate clause, deliberately:** any Route payout to a UPA or guardian (payments PRD, deferred to P8 with the coach/partner payout proof), tax receipts, distribution of general fund money to specific UPAs, recurring donations.

## Web now, native later. What that means concretely here.

Consistent with the founder full-autonomy directive and the P4/P5 amendments.

**Verified on web in P6:**
- The ENTIRE `apps/portal-life` surface (PRD-05): it is a Next.js web app, so apply wizard, status roadmap, dashboard, wishlist manager, funding detail, gratitude, profile preview, account, all four states each, light and dark, are genuinely and fully web-verifiable. Nothing in PRD-05 is native.
- All backend and money design: the `donate` edge function, `finalize-donation-payment`, the gate wiring, the roundup reclassification and the General Fund derivation, the ledger balance proofs, the state machines, RLS isolation, the verified gate. Backend and platform independent, exercised by real scripted sessions and real HTTP/SQL against the live project (the P4/P5 pattern).
- The consumer app Empower screen LAYOUTS and states (hub, UPA profile, donation review, My Impact) on react-native-web, including the roundup checkbox inside the existing checkout BillSummary.
- A real end-to-end donation driven through the deployed `donate` and finalize path with a real test capture (scripted-but-real, standing in for the device, as accepted at the P4 and P5 gates).

**Deferred to the native pass (genuinely native, not exercisable on react-native-web):**
- The `react-native-razorpay` donation sheet on a real device (reuses the P3-verified wrapper through its existing shared contract; a fork is a rejectable finding).
- Native gestures and haptics on the mobile Empower screens.

The founder's single native action at the gate mirrors P4/P5: complete one real donation from the device through the native Razorpay sheet, then confirm the item funded progress and My Impact updated. Everything upstream and downstream is proven on web first.

## Founder decisions resolved by assumption (build does not stall; the assumption ships)

The founder will not answer mid-phase (full-autonomy directive). Each PRD-05 section 9 and PRD-06 section 9 open question is resolved as follows; each is a config change, not a rebuild, except where noted.

PRD-05:
1. **Staff for verification review.** ASSUMED the same `admin`/`moderator` role from `apps/admin` covers UPA review; no distinct Atlitos Life ops role in P6.
2. **Reapply cooldown after rejected.** ASSUMED admin-set per rejection via the existing `upa_applications.reapply_after` date; no hardcoded global period. `/status` shows the date if set, else offers immediate reapply.
3. **Sponsor name visibility opt-in (PRD-05 FR-17 / PRD-06 anonymization).** ASSUMED the setting does NOT already exist; P6 adds a boolean `show_donor_name` on `users`, default false, so donors render as "A Sponsor" unless opted in. Minimal additive column.
4. **Guardian/minor.** ASSUMED age alone on the profile is sufficient; no distinct relationship field. `upa_evidence.kind='guardian_consent'` already covers the document. No consumer-facing difference on minor profiles (PRD-06 q6 ASSUMED the same).
5. **Gratitude post moderation.** ASSUMED a post publishes immediately (`status='published'` default) with staff able to unpublish (`status='removed'`) post hoc, matching the schema. No pre-publish moderation queue.
6. **Item removal after partial funding (FR-13).** ASSUMED removal stays blocked once `funded_amount > 0`; the resolution path for an unwanted partially funded item is manual/admin outside P6 (no automated refund or fund-redirect built).
7. **Show reviewing staff on /status.** ASSUMED fully anonymized; `/status` never names a staff member.

PRD-06:
2. **MIN_AMOUNT.** ASSUMED a single `fee_config` `donations.min_amount` (seeded), applied to standalone donations; the roundup is derived and not floor-gated, so no separate roundup minimum.
3. **Hub aggregate banner window.** ASSUMED platform-wide, all-time, computed live from the ledger (FR-3), not cached and not windowed.
4. **Excess general funds auto-allocate to items.** ASSUMED NO auto-allocation; general giving stays pooled at the General Fund account_ref until a future admin action. (This is what scopes the allocation design above.)
5. **My Impact export.** ASSUMED on-screen history only for P6; no downloadable or shareable summary.
6. **Minor consent copy on public profile.** ASSUMED no consumer-facing difference; lives in the Life portal application data.

## Deliverables owed, by track

Every builder ticket carries, as **step 0 inside its worktree**, `git merge main --no-edit` to pull all current phase work before building (worktree stale-base has bitten this build twice; a stale base is missing prior migrations, types, and edge functions).

### Track A: schema, RLS, state machines (opus)
- [ ] AT-108 Empower schema migration: `upa_applications`, `upa_evidence`, `upa_wishlist_items`, `donations`, `gratitude_posts` per SCHEMA.md, plus the enums if not already present and the `users.show_donor_name` column; storage buckets `upa-evidence` (private), `upa-photos`, `gratitude-photos` (PRD-05 FR-1, FR-3, FR-11, FR-19; PRD-06 FR-1)
- [ ] AT-109 Empower RLS: permissive-OR public (verified `upa_applications`/`upa_wishlist_items`/`gratitude_posts` rows only) beside owner-scoped; `funded_amount`/`status` excluded from the `WITH CHECK` allowed columns; `donations` takes NO authenticated write; storage.objects policies per RLS.md (PRD-05 FR-3, FR-9, FR-12, FR-13, FR-24; PRD-06 FR-1, FR-12)
- [ ] AT-110 UPA application state machine + admin verify extension: submit/resubmit/reapply/deactivate RPCs raising `INVALID_TRANSITION`; extend `admin_approve_verification_request` for `applicant_type='upa'` (set `status='verified'`, `verified_at`, grant `upa` role, one audit row); wishlist item `open` to `funded` to `delivered` server-only transition RPC (PRD-05 FR-5, FR-6, FR-9, FR-10, FR-14, FR-27; PRD-04 verification)

### Track B: donation payments, ledger, allocation, read layer (opus)
- [ ] AT-111 `donate` edge function: re-price, validate verified + item not funded + `MIN_AMOUNT`, create `payment_intents` (`domain='donation'`), Razorpay order via `_shared/razorpay.ts` (PRD-06 FR-5, FR-7, FR-8, FR-15, FR-16, FR-19)
- [ ] AT-112 `finalize-donation-payment.ts` + wire `case "donation"` into `_shared/finalize-payment.ts` (before the null `entity_id` check) and `describeAlreadyProcessed`: create `donations` row, item `funded_amount`/`funded` transition, balanced `debit platform`/`credit upa_fund(upa_id)` group, notification, atomic and idempotent (PRD-06 FR-5, FR-9, FR-17, FR-18)
- [ ] AT-113 Roundup to General Fund allocation (the inherited P4 debt): define `GENERAL_FUND_ACCOUNT_REF` constant; forward-path change to `finalize-order-payment.ts` (credit General Fund + create `checkout_roundup` donation row in the order transaction); one-time idempotent reconciliation migration moving every historical `platform` roundup leg to the General Fund via a balanced reclass group with its donation row (PRD-06 FR-11; PHASE-4-STATUS.md D1)
- [ ] AT-114 Empower ledger-derived read layer: `get_empower_stats()` (hub aggregate), `get_my_impact_summary()` (scoped to caller), UPA total-raised and item funded-progress derivations, `public_upa_profile` view/RPC (verified-only), all agreeing with the ledger, no denormalized balance (PRD-05 FR-18, FR-23; PRD-06 FR-3, FR-4, FR-12, FR-13, FR-14)

### Track C: Atlitos Life portal, web (sonnet)
- [ ] AT-115 `apps/portal-life` auth, app shell, verified-route guard (non-verified routes redirect to `/status`), shadcn HSL token bridge, login/signup (PRD-05 FR-9, FR-24, FR-25; screen 1)
- [ ] AT-116 Apply wizard: 4 steps with per-step draft autosave, certificate/PDF upload to the private bucket, external video URL validation, submission guard (PRD-05 FR-1, FR-2, FR-3, FR-4, FR-5, FR-8; screen 2)
- [ ] AT-117 Verification Status roadmap: all states incl `needs_info` branch linking into the flagged `/apply` step and `rejected` with a reapply path, Realtime status update (PRD-05 FR-7, FR-8, FR-9, FR-10; screen 3)
- [ ] AT-118 Dashboard, Wishlist Manager, Funding Progress Detail with Realtime funding, add/edit/remove gated by `open` and funded 0, item sub-states (PRD-05 FR-11, FR-12, FR-13, FR-15, FR-16, FR-17, FR-18; screens 4, 5, 6)
- [ ] AT-119 Gratitude Posts (compose only for funded item without a post), Profile Preview (same query as the consumer public profile), Account Settings (PRD-05 FR-19, FR-20, FR-21, FR-22, FR-23, FR-26, FR-27; screens 7, 8, 9)

### Track D: consumer app Empower surfaces, mobile (sonnet)
- [ ] AT-120 Empower Hub + UPA Public Profile: verified-only, aggregate banner from the ledger, combinable sport/region filters (filters affect grid only, stats unchanged), WishlistGrid with funded progress, all four states (PRD-06 FR-1, FR-2, FR-3, FR-4, FR-5, FR-20; screens 3.1, 3.2)
- [ ] AT-121 Donation Flow: DonationSheet (configurable presets, custom, item preselect), `BillSummary` Donation + Total only, guest gate preserving UPA/item/amount context, processing/success/failed, `ITEM_FUNDED` mid-flow block; reuse the `react-native-razorpay` wrapper, no fork (PRD-06 FR-6, FR-7, FR-15, FR-17, FR-19; screen 3.3)
- [ ] AT-122 Checkout roundup surfacing (checkbox default off from P4, attribute to General Fund in My Impact) + My Impact: total given, athletes/items counts, history with UPA name or General Fund, gratitude received, empty state, all ledger-scoped (PRD-06 FR-10, FR-11, FR-12, FR-13, FR-14, FR-18; screens 3.4, 3.5)
- [ ] AT-123 `packages/api` `useEmpower` hooks: hub, profile, donate caller, My Impact, each independently handling loading/empty/error/loaded (PRD-06 FR-8, FR-20)

### Track E: fixtures and copy (haiku)
- [ ] AT-124 Empower seed fixtures: verified UPAs (varied sport/region), evidence, wishlist items across `open`/partial/`funded`/`delivered`, sample item and general donations, gratitude posts, one checkout-roundup General Fund donation; all seeds owner-scoped explicitly, and any isolation fixture uses two ids asserted to differ (PRD-05; PRD-06)
- [ ] AT-125 House-style copy pass across all P6 portal-life and mobile Empower screens: no emoji, lucide only, no hyphen/em-dash in copy strings, mono tabular numerics on every amount/total/progress/count, tokens only, four states present (CLAUDE.md; DESIGN-LANGUAGE.md; PRD-01 FR-70)

### Track F: verification (opus)
- [ ] AT-126 Donation money verification: real item-specific and general test donations, each a balanced `debit platform`/`credit upa_fund` group summing to 0.00, `funded_amount` updated atomically and reconciled with the ledger, `ITEM_FUNDED` race, `MIN_AMOUNT`, `PRICE_MISMATCH`, idempotency across `verify-payment` and `razorpay-webhook` (PRD-06 FR-5, FR-7, FR-9, FR-16, FR-17)
- [ ] AT-127 Roundup allocation verification (the inherited debt): every historical `platform` roundup leg moved to the General Fund via a balanced reclass group, `donations` rows created, general fund balance equals the sum, forward order credits General Fund directly, no double count, My Impact shows the General Fund donation (PRD-06 FR-11; PHASE-4-STATUS.md D1)
- [ ] AT-128 Non-vacuous RLS isolation and the verified gate: two donor ids asserted to DIFFER first, My Impact scoped to self, unverified UPA unresolvable by list or id, `donations` no client write, `funded_amount`/`status` not client-writable, gratitude only for funded items (PRD-05 FR-9, FR-24; PRD-06 FR-1, FR-12, FR-16)

## Dependency order

Track A first and strictly in order: AT-108 gates everything; AT-109 and AT-110 need AT-108. Track B next: AT-111 needs AT-108/AT-109; AT-112 needs AT-108 and the shared gate; AT-113 needs AT-108 and the P4 `finalize-order-payment.ts`; AT-114 needs AT-108 and AT-113 (the General Fund constant). Tracks C and D build on A and B in parallel, and both are blocked on AT-124's seed catalog before any screen renders populated; AT-123 (the shared api layer) lands early in D. Track E copy pass (AT-125) runs after screens land. Track F verifies at the end: AT-126 after AT-112, AT-127 after AT-113/AT-114, AT-128 after AT-109/AT-110.

## Traps this phase will hit

1. **Permissive-OR RLS on the empower public tables.** `upa_applications`, `upa_wishlist_items`, `gratitude_posts` each gain a `status='verified'` (or linked-verified) public policy beside owner and admin policies. An unscoped select returns other UPAs' or other states' rows. Every owner read carries its own explicit filter in app code, seeds, and tests; isolation tests assert the two party ids DIFFER before trusting the result (AT-62 lesson, this repo bitten four times).
2. **Do not fork the finalize gate.** Donation is one `case "donation"` before the null-`entity_id` check plus one `finalize-donation-payment.ts`, in the commerce/session/court shape. No parallel capture path, no divergence between `verify-payment` and `razorpay-webhook`.
3. **Clients never write money or empower status rows.** No client insert/update against `donations`, `payment_intents`, `ledger_entries`, `upa_wishlist_items.funded_amount`/`status`, `upa_applications.status`. Donations move only through `donate`; funded_amount and item status move only in the finalize handler.
4. **The zero-roundup edge still holds.** When a roundup is 0.00 no donation leg and no `donations` row is written (P4 invariant), so the reconciliation and the forward path must both skip zero, never write a 0.00 leg that balances while recording a donation that did not happen.
5. **Ledger is the only balance.** Hub aggregate, total raised, My Impact totals all derive from `ledger_entries`; `funded_amount` is item progress and a race guard only, never the source of a displayed money total (PRD-06 FR-3, FR-4).
6. **Every money total through `BillSummary`; mono tabular numerics; tokens; lucide; no emoji; no hyphen/em-dash in copy strings**, on every P6 surface, portal and mobile.

## Handoff notes owed at phase close

Phase close must record: whether the device donation round trip actually closed at the gate or is carried to the native pass; the state of the roundup reconciliation (how many historical legs moved, the general fund balance after, and that the forward path is live); confirmation that no denormalized balance column was added and funded_amount reconciles with the ledger; the disposition of each resolved-by-assumption founder question (whether any needs founder ratification later, e.g. the `show_donor_name` addition); and any Route-to-UPA payout surface owed to P8.

---

## Integrator note (2026-07-22)

Merged main is coherent and gate-ready.

- **Build:** `pnpm turbo typecheck build lint` GREEN, 24/24 tasks (24 cached). No route-type staleness hit this pass (the `.expo/types/router.d.ts` gotcha did not trigger; mobile typecheck passed on the empower/upa/donate routes).
- **Migrations:** 0048 through 0056 all applied to remote `syzzfgaudpifwvbpycyi` (list_migrations vs `supabase/migrations/` reconciled, versions 20260722052736 through 20260722060150).
- **Edge functions:** `donate` deployed (v1), `verify-payment` v7 and `razorpay-webhook` v10 both redeployed with the donation case wired through `_shared/finalize-payment.ts`. `finalize-donation` path live.
- **Tracks in HEAD:** A (0048-0052 schema/RLS/state), B (0053-0056 money/edge + donate/finalize), C (portal-life: shell, apply wizard, status, dashboard/wishlist/funding, gratitude/profile/account), D (mobile Empower AT-120..123), E (fixtures), F (evidence 1739fdb).
- **Evidence:** `docs/phases/evidence/p6-web/VERIFICATION.md` present. The committed evidence tree was MISSING the portal light/dark image files that VERIFICATION.md referenced; the integrator captured them this pass via Chrome DevTools Protocol against the booted `portal-life` dev server: `portal-signin-light.png`, `portal-signin-dark.png`. Dark toggle genuinely renders dark (warm near-black bg ~rgb(20,16,11) with preserved orange accent) vs light (warm cream ~rgb(251,246,239)), matching Track F's documented values.

## Biased approver verdict (cycle 1, 2026-07-22)

# VERDICT: APPROVE

All findings are advisory. The money proof is genuinely real and balanced, independently re-derived from the live DB (not trusting Track F's report). No blocking finding. Native razorpay sheet + native gestures are carried to P9 per PLAN.md and satisfied on web by the scripted-real donation, as accepted at the P4/P5 gates.

### Independent verification performed (read-only SQL against syzzfgaudpifwvbpycyi + captured screenshots)

1. **Donation ledger balances.** Whole DB: 16 ledger groups, **0 unbalanced**. All 5 donation-domain groups are `debit platform / credit upa_fund`, net **0.00**, **NO fee leg**. `funded_amount` bumped atomically (cricket item 5000.00 == 5000.00 in donations; ground-rental +100.00 real donation on top of seed). Idempotent redelivery proven by Track F (`already_processed`, 1 row / 2 legs); consistent with the intent-flip gate.
2. **Roundup allocation.** General Fund `00000000-0000-4000-a000-0000000f0000` balance = **3.18** == sum of all `checkout_roundup` donation rows **3.18** EXACTLY (2 rows: 1 backfill + 1 forward). Platform roundup legs net **0.00** (nothing stranded). Backfill guard yields **0 remaining candidates** (idempotent). Forward order credits the General Fund directly inside its own commerce group.
3. **funded_amount / status / donations NOT client-writable.** Ran under the `authenticated` role: `donations` INSERT, `ledger_entries` INSERT, `upa_applications.status` UPDATE, `upa_wishlist_items.funded_amount` UPDATE, `.status` UPDATE — **every one returns SQLSTATE 42501**. Column grants confirm authenticated has UPDATE only on wishlist `cost/title/updated_at`. **Item-3 fixture-artifact ruling HOLDS**: the unbacked funded_amount 2500 (first-aid item) is reachable only via a service-role seed, never a sanctioned client path.
4. **State machines + isolation.** `verified -> submitted` raises `INVALID_TRANSITION`; wishlist `funded -> open` raises `INVALID_TRANSITION`. `public_upa_profile`: two ids asserted to DIFFER first (non-vacuous), verified UPA resolves, unverified (under_review) and rejected both return NULL. Gratitude clause proven at the data layer: INSERT WITH CHECK requires `status='published'` + UPA ownership + item status in (funded,delivered) + no existing post; UNIQUE(wishlist_item_id); UPDATE limited to owner soft-delete; public SELECT gated on verified UPA.
5. **Advisors + storage.** Security advisors: 3 ERROR, all pre-existing non-empower `security_definer_view` (public_profiles, coach_profiles_public, product_variant_availability) identical to the P5 baseline. **No new empower ERROR.** All empower advisor entries are WARN/INFO (the carried RLS WARN debt). `upa-evidence` bucket is **private**.

### Advisory findings (none blocking; all carried to phase close, none dropped)

```
[advisory] show_donor_name-unwired — column added (assumption 3) but no read path; opted-in donors still render "A Sponsor" (MEDIUM)
  Ref: PRD-05 FR-17 / PRD-06 anonymization; PHASE-6-STATUS assumption 3
  Why: Feature is inert. Not a gate-clause violation (no clause requires donor-name display; the safe privacy-preserving default is correct). Wiring needs a finalize-time donation-row snapshot (a money-path change), deliberately deferred pre-gate. Carry to a later phase; the assumption also owes founder ratification.
[advisory] gratitude-ui-not-driven — clause 6 proven at schema+RLS layer, not via a verified-UPA UI session
  Ref: PRD-05 Journey D; gate clause 6
  Why: No UPA fixture user has a usable password, so the compose/immutable/public-render UI was not driven. The invariant itself is fully enforced in Postgres (verified independently), so code+schema evidence suffices for the gate; the UI happy-path render is web-verifiable and carried.
[advisory] realtime-ui-not-driven — wishlist funding Realtime and My Impact render not re-driven on web this pass (data layer proven)
  Ref: gate clauses 2, 5; PRD-05 FR-16, PRD-06 My Impact
[advisory] items_funded-keys-off-status — get_empower_stats.items_funded counts status='funded' not ledger backing (LOW)
  Ref: PRD-06 FR-3/FR-4
  Why: Only wrong for the hand-seeded fixture (item-3); correct in production since status moves atomically with the ledger and is not client-writable.
[advisory] fixture-funded_amount-divergence — 2 seed items (first-aid 2500, ground-rental 2000-of-2100) carry funded_amount without full donation backing (LOW)
  Why: Track E hand-set via service role. Fixture artifact only; recommend re-seeding via real donations so future readers are not misled.
[advisory] track-C-PRD-divergences — (a) verified-UPA story read-only (0049 grants no client UPDATE); (b) deactivate only submitted/under_review, verified terminal (0052); (c) sponsor names "A Sponsor"
  Ref: PRD-05 FR-27
  Why: All acceptable-by-design. (a) consistent with the verified/financial invariant; (b) verified self-withdraw is an out-of-P6 admin action, confirmed live (verified->deactivated blocked); (c) is the show_donor_name advisory above.
```

### Carried-forward open advisories from P1-P6 (none dropped)

```
[advisory] Route not enabled on test merchant (razorpay-route-* -> ROUTE_UNAVAILABLE); record_transfer success path unproven  [P4/P8]
[advisory] AT-88 refund not surfaced to athlete in shopper UI  [P4]
[advisory] dark-mode mobile-web gap: mobile web still does not follow OS dark; portals honor the in-app toggle (proven this pass)  [P3/P4/P5]
[advisory] native screen coverage deferred + P9 native-pass debt: native Razorpay donation sheet, gestures/haptics  [P3/P4/P5/P6]
[advisory] tmp-seed-demo-users edge function still deployed (ACTIVE) — remove before prod  [P4/P5/P6]
[advisory] TypeScript version skew across workspace  [P3/P4]
[advisory] accumulated RLS WARN debt (auth_rls_initplan, multiple_permissive_policies, function_search_path_mutable, anon_security_definer_function_executable, anon sign-ins) — grew with the empower tables/RPCs in P6  [P1-P6]
[advisory] the four PRD-02 coach assumptions the plan ships  [P2]
[advisory] AT-73 late-capture branch  [P4]
[advisory] PRD-01 assumptions: follow-graph list browse not built, no guest local persistence  [P5]
[advisory] the six PRD-05 + six PRD-06 P6 resolved-by-assumption questions (esp. show_donor_name needing founder ratification)  [P6]
```

No punch list (verdict is APPROVE, not REJECT). Finish line remains TestFlight: P9 native pass (the founder's single native donation round-trip through the real Razorpay sheet) + P10 ship.
