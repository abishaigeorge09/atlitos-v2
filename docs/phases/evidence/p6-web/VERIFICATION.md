# Phase 6 (Empower / Atlitos Life) — Track F Verification

**Verifier:** Track F (AT-126, AT-127, AT-128). **Date:** 2026-07-22.
**Project:** syzzfgaudpifwvbpycyi. **Branch:** main @ 6960c91.
**Method:** SQL against the live DB, real HTTP against the deployed `donate` /
`verify-payment` edge functions with a real fixture donor JWT, real authenticated
PostgREST calls, and the deployed `apps/portal-life` driven in a browser. Every
builder claim was treated as a hypothesis to disprove. No claim below is taken
from re-reading code alone.

Evidence scripts (committed): `scripts/verify-f-donation.mjs` (independent donation
re-proof), `scripts/verify-f-rls.mjs` (client-write refusals + non-vacuous isolation).

---

## VERDICT: PASS with advisories. No blocking money finding.

All money-critical clauses re-proven independently. The item-3 fixture inconsistency
is a **fixture artifact, not a product bug** (funded_amount/status are provably NOT
client-writable). No HIGH finding. Two LOW notes + carried advisories below.

---

## Gate clauses (PHASE-6-STATUS.md "Gate definition")

| # | Clause | Result | Evidence |
|---|--------|--------|----------|
| 1 | Apply + verify state machine | **VERIFIED** | Legal chain submitted→under_review→verified succeeds; illegal verified→submitted raises `INVALID_TRANSITION`; `/status` renders rejected + reapply-cooldown branch (screenshot). |
| 2 | Wishlist + funding, Realtime | **VERIFIED (data)** | Partial donation bumped item `976221c9` funded_amount 2000→2100 atomically, item stayed `open`. Realtime UI not re-driven (carried, web-verifiable). |
| 3 | Donate real, both shapes + errors | **VERIFIED** | See "Donation money re-proof". |
| 4 | Roundup real + allocated | **VERIFIED** | See "Roundup allocation re-proof". |
| 5 | My Impact ledger-scoped + empty state | **VERIFIED** | `get_my_impact_summary` donor A: 6 donations, total_given 5428.18; donor B (never donated): empty list, total 0. |
| 6 | Gratitude (funded item, UNIQUE, immutable) | **NOT DRIVEN** | Verified-UPA session unavailable (no UPA fixture user with a known password). Carried. |
| 7 | Isolation + verified gate, non-vacuous | **VERIFIED** | A_uid 58756043 ≠ B_uid 5b262cf1 asserted first; My Impact scoped; unverified UPA → `public_upa_profile` NULL; verified visible to both; all client money writes 42501. |
| 8 | typecheck/build/lint, RLS advisor, evidence, approve | **PARTIAL** | Portal boots + renders light/dark; RLS advisor not re-diffed this pass (carried). |

---

## Priority 1 — Donation money, independently re-proven (did NOT trust Track B)

Fresh donations to verified UPA `4f7616f4-f43f-4dd9-b2cb-f166ec268081`, driven through
the LIVE `donate` + `verify-payment` gate with a real donor JWT (player@atlitos.dev,
uid 58756043) and a real HMAC-signed capture callback:

- **Item-specific** (ground-rental item `976221c9`, 100.00): captured, donation
  `894ba954`. Ledger group `bd01acb2`: `debit platform 100.00` / `credit upa_fund(4f7616f4) 100.00`,
  **NO fee leg**, nets **0.00**. `funded_amount` 2000→2100, item stayed `open`.
- **General** (no item, 75.00): captured, donation `74c4d605`. Group `f18330bc`:
  `debit platform 75.00` / `credit upa_fund(4f7616f4) 75.00`, nets **0.00**.
- **Idempotent redelivery**: replaying the item capture → `already_processed`, only
  **1** donation row and **2** ledger legs (no double).
- **Error paths, all BEFORE any Razorpay order** (no `razorpay_order_id` returned):
  `MIN_AMOUNT` → **422**; `PRICE_MISMATCH` (expected_total≠amount) → **409**;
  `ITEM_FUNDED` (already-funded cricket item) → **409**.
- **Whole-DB ledger balance**: **0** unbalanced groups after the donations.

## Priority 2 — Roundup allocation, re-proven (the money-critical piece)

- **Platform nets to ZERO on roundup legs**: over all `platform` legs tagged roundup,
  credit 1.18 = debit 1.18, **net 0.00**. No roundup rupee stranded on platform. The
  forward-path order parks nothing on platform at all (credits General Fund directly).
- **General Fund == sum of checkout_roundup donations, exactly**: balance at
  `00000000-0000-4000-a000-0000000f0000` = **3.18** = sum of the 2 `checkout_roundup`
  donations (**3.18**). Backfill donation `73c8159d` (1.18, order c4c8fcca, separate
  reclass group) + forward donation `ff3835be` (2.00, order 1babf841, credited inside
  the order's own commerce group — `upa_fund:credit:2.00`).
- **Backfill idempotent**: migration `0055` loops only over platform roundup legs with
  no `checkout_roundup` donation yet; the guard now yields **0 remaining candidates**,
  so a re-run writes nothing. Guard read + confirmed empirically.
- **Forward arm**: the forward order (1babf841) credits the General Fund directly in
  its order transaction and has its `donations` row — verified via the group query.

## Priority 3 — Item-3 fixture reconciliation

**VERDICT: FIXTURE ARTIFACT, not a product bug. NOT a HIGH money finding.**

Item 3 (`ce0a9124`, First aid kit): `funded_amount` 2500 / cost 2500, `status=funded`,
but **0 backing donations**. A second item (ground rental `976221c9`) likewise carries
2000 of hand-set funded_amount with no donation. Impact analysis:

- The authoritative money numbers are **ledger-derived and CORRECT**, excluding the
  fictitious 2500: `upa_fund_balance(4f7616f4)` = 5250.00 (now 5425 after my donations),
  `public_upa_profile.total_raised` = 5425, `get_empower_stats.total_raised` = 5253.18.
  None include item-3's unbacked 2500. `funded_amount` sum (9500) diverges from the
  ledger (5250) but is never used as a displayed money total.
- **Why it cannot happen in production**: `upa_wishlist_items.funded_amount` and
  `.status` are **not client-writable** — a direct PATCH returns **42501** (proven,
  both columns). They are written ONLY by `record_donation_from_draft` atomically with
  the ledger credit. Track E reached this state via a service-role seed, bypassing the
  handler; no sanctioned path can diverge funded_amount from the ledger.
- **Only visible effect (cosmetic)**: the item card renders as `funded` with a full
  progress bar on the public profile, and `get_empower_stats.items_funded` counts it
  (=2 vs 1 truly-backed). No fund balance, total-raised, or My Impact total is wrong.

## Priority 4 — State machine + RLS

- **State machine**: illegal `verified→submitted` raises `INVALID_TRANSITION`; legal
  `submitted→under_review→verified` succeeds. `verified→deactivated` correctly raises
  `INVALID_TRANSITION` — migration `0052` makes `verified` terminal per FR-27 (this is
  Track C divergence (b), an intended edge, not a bug).
- **Client writes all refused (42501)**: `donations` INSERT, `upa_wishlist_items`
  funded_amount PATCH, status PATCH, `upa_applications` status PATCH, `ledger_entries`
  INSERT — every one **403 / 42501**.
- **Isolation, non-vacuous**: A_uid (58756043) ≠ B_uid (5b262cf1) asserted BEFORE
  trusting the result (AT-62 lesson). My Impact for B is empty; never returns A's rows.
  Unverified UPA → `public_upa_profile` returns **NULL** (tested on a throwaway
  submitted application, rolled back); verified UPA visible to both A and B.

## Priority 5 — Web structural pass (apps/portal-life)

Booted `next dev` (port 3001), driven in browser with a script-minted player session
cookie (never typed credentials):

- Landing, **apply wizard** (Step 1 of 4, draft headline persisted), and **status
  roadmap** (rejected application + rejection reason + reapply cooldown "21 Aug 2026",
  mono tabular numerics) all render.
- **Dark toggle WORKS** (unlike the mobile-web gap): clicking flips `<html>` class
  dark↔light, body bg dark rgb(20,16,11) ↔ warm light rgb(251,246,239),
  `localStorage.theme` persists the explicit choice. Light AND dark both captured.
- **Console**: the only message is a hydration mismatch caused by a browser-extension
  attribute (`cz-shortcut-listen` injected on `<body>`); `<html>` has
  `suppressHydrationWarning`. React's own message lists extensions as a known false
  cause. **No nested-button / pressable-overlay errors.** Not an app defect.
- **NOT driven this pass** (carried): verified-UPA dashboard/wishlist/gratitude (needs a
  verified-UPA session — no UPA fixture user has a usable password); the mobile Empower
  hub/donate on Expo web. The expo-router manifest already contains the empower/upa/
  donate routes.

---

## Track C PRD divergences — dispositions (judged ACCEPTABLE for P6)

- **(a) Verified-UPA story editing not exposed** (0049 grants no client UPDATE) →
  read-only with contact-support. ACCEPTABLE: consistent with the financial/verified
  invariant; a verified profile is not client-mutable by design.
- **(b) Deactivate only submitted/under_review; verified terminal** (0052) vs FR-27's
  broader reading. ACCEPTABLE and CORRECT-BY-DESIGN: verified self-withdraw is an
  out-of-P6 admin action; confirmed live (`verified→deactivated` raises
  INVALID_TRANSITION).
- **(c) Sponsor names render "A Sponsor"** because no read contract respects
  `show_donor_name` under RLS. ACCEPTABLE for P6 but a real gap — see advisories.

---

## Findings ranked by severity

- **HIGH:** none.
- **MEDIUM — show_donor_name unwired**: the column was added (assumption 3) but no read
  contract surfaces it, so opted-in donors still render "A Sponsor". Cosmetic-only,
  no money impact, but the feature is inert. Carry to a follow-up.
- **LOW — items_funded counts the status flag, not ledger backing**:
  `get_empower_stats.items_funded` keys off `status='funded'`, so a divergent
  funded status (only reachable via service-role seed) inflates the count. Harmless in
  production (status not client-writable) but exposed by the item-3 fixture.
- **LOW — fixture funded_amount diverges from ledger on 2 items** (item 3 first-aid
  2500, ground-rental 2000): Track E hand-set funded_amount/status without donation
  backing. Fixture artifact only; recommend re-seeding these via a real donation so
  fixtures cannot mislead a future reader. Not a product bug.

## Carried advisories (none dropped, P1–P6 + this pass)

Route not enabled / `record_transfer` success path unproven (P8); AT-88; dark-mode
mobile-web gap (portals OK, mobile web still does not follow OS dark — use the in-app
toggle); native coverage debt + the P9 native-pass debt (native Razorpay donation
sheet, gestures/haptics deferred); `tmp-seed-demo-users` still deployed; TS skew;
RLS advisor WARN debt (not re-diffed this pass); PRD-02 assumptions; AT-73; the six
P6 PRD-05 + six PRD-06 resolved-by-assumption questions (esp. `show_donor_name`
needing founder ratification); the show_donor_name read-contract gap (MEDIUM above).

**Finish line: TestFlight** — P9 native pass (the founder's single native donation
round-trip through the real Razorpay sheet) + P10 ship, founder 2026-07-22.
