# Phase S3 status: the shop

Status: IN FLIGHT
Opened: 2026-09-18   Closed:

Plan: `docs/PLAN-SHOP-SEARCH.md` Phase S3. Design: `docs/design/DIRECTION-SHOP.md` direction C (approved),
`docs/design/IA-SHOP.md`. Previous phase: `PHASE-S2-STATUS.md` (read its handoff first). Branch: `integration/shop-search`.

## Gate

> On the iPhone 16 Pro Max Release build pinned to local (`scripts/assert-build-target.sh ... local`),
> the founder's cold-start path in `docs/design/IA-SHOP.md` completes: type the badminton query, tap
> a card, see three prices, tap Buy, the retailer opens. Maestro `native-shop-search.yaml`,
> `native-shop-compare.yaml`, `native-shop-flag-off.yaml` green with `--udid`. Light and dark
> screenshots in `docs/qa/evidence/shop-search/`.

**Gate type:** founder gate. **Verdict:** pending.

## The hard decisions

1. **The shop stays where it is in navigation.** IA-SHOP.md said `/(tabs)/shop`; the app has no
   shop tab and adding one two weeks before submission moves every tab. `/shop` (reached from Home's
   categories row and Recently viewed) becomes the search-first screen itself, and
   `/shop/category/[sport]` redirects to `/shop?sport=<sport>`. IA-SHOP.md is corrected in this phase.
2. **No strikethrough price in S3.** `product_offers` stores `last_price_change_at` but not the
   previous price, so `OfferRow`'s `previousPrice` stays unused until a later migration adds
   `previous_price`. First item on the plan's cut list, cut now rather than faked.
3. **Empty query = the catalogue, newest first, through the existing read**; a typed query goes
   through `ai-search` (the hybrid path from S1). One grid component serves both.
4. **The owned shop is hidden by the flag, not deleted.** `getAppConfig('shop.owned_enabled')` is read
   once per app start through a new `useAppConfig` hook; when false, owned products are excluded
   from the grid and from Home rails, the cart and wishlist controls do not render, and the owned
   routes (`/shop/cart`, `/shop/checkout/*`, `/shop/orders*`, `/shop/order/*`, `/shop/product/*`)
   redirect to `/shop`.

## Scope

| # | Deliverable | Requirement | Track | Done |
|---|---|---|---|---|
| 1 | `packages/api`: `useAppConfig(client)` with `get(key)` (public `app_config` read, cached); `AffiliateProduct` gains `imageUrl`, `retailerCount`, `cheapest: { price, retailer, lastCheckedAt } \| null`; offers gain `retailerKey`, `lastCheckedAt`; `listAffiliateProducts` ordered newest first, explicit `active = true` | FR-40, FR-41, FR-53 | F | |
| 2 | `/shop` rebuilt: `SearchBar variant="ai"` at the top (focused on tap, not on open), sport chips and an "Under INR" price ceiling chip, `GearResultTile` two-column grid, empty state with the broaden line from `ai-search`, loading skeletons; category route redirects here | FR-40, FR-41, FR-42 | F | |
| 3 | Flag gating: owned products excluded, cart and wishlist hidden, owned routes redirect, Home rails adjust | FR-53, AC-11-5 | F | |
| 4 | Compare screen `/shop/affiliate/[id]`: `OfferRow dense` per offer with freshness, "Cheapest" on the cheapest in-stock row, image from `imageUrl` on a flat white tile, the FR-38 disclosure line, "Buy on X" click-out unchanged | FR-35 to FR-38, FR-41, FR-46 | G | |
| 5 | `scripts/seed-shop-search.mjs`: 12 affiliate products with 30 offers across the four sports and skill tags, embedded through `gear-embed` (stub locally), idempotent, local only (guard-target) | supports the gate | H | |
| 6 | Maestro `.maestro/native-shop-search.yaml`, `native-shop-compare.yaml`, `native-shop-flag-off.yaml`, each asserting the post-action screen positively, pinned by `--udid` | gate | H | |
| 7 | Evidence: Release build pinned to local, `assert-build-target.sh` output, three Maestro runs, light and dark screenshots of `/shop` (results), the compare screen, and the empty state | gate | integrator | |
| 8 | Docs: `IA-SHOP.md` corrected, `API-MAPPING.md` rows, `DESIGN-LANGUAGE.md` note on the shop tile | docs duty | F (IA, API), G (design) | |

## Tracks

### Track F: shop home and flag (sonnet)

Owns: `apps/mobile/src/app/shop/index.tsx`, `apps/mobile/src/app/shop/category/[sport].tsx` (redirect only),
`apps/mobile/src/app/shop/_layout.tsx` (route guard for the flag), `apps/mobile/src/app/shop/cart.tsx`,
`orders.tsx`, `order-success.tsx`, `checkout/**`, `order/**`, `product/**` (only the redirect-when-flag-false
guard at the top of each, nothing else), `apps/mobile/src/components/organisms/home/CategoriesRow.tsx`,
`RecentlyViewedRail.tsx`, `packages/api/src/use-shop.ts`, `packages/api/src/use-app-config.ts` (new),
`packages/api/src/index.ts` (exports), `docs/design/IA-SHOP.md`, `docs/architecture/API-MAPPING.md`.
Must not touch: `apps/mobile/src/app/shop/affiliate/[id].tsx`, `.maestro/**`, `scripts/**`.
First commit: the `packages/api` changes (scope row 1), so G and H can build against them.

### Track G: compare screen (sonnet)

Owns: `apps/mobile/src/app/shop/affiliate/[id].tsx`, `apps/mobile/src/components/ui/offer-row.tsx`
(only if a prop is missing), `docs/design/DESIGN-LANGUAGE.md` (one section).
Must not touch: anything else. Starts after F's first commit is on the branch; until then codes
against the field names in scope row 1.

### Track H: fixtures and flows (haiku)

Owns: `scripts/seed-shop-search.mjs`, `.maestro/native-shop-search.yaml`, `.maestro/native-shop-compare.yaml`,
`.maestro/native-shop-flag-off.yaml`.
Must not touch: any app or api file. TestIDs it may rely on, which F and G must set:
`shop-search-input`, `shop-sport-chip-<sport>`, `shop-price-chip`, `gear-tile-<index>`, `shop-empty`,
`shop-broaden`, `compare-offer-<index>`, `compare-buy-<index>`, `compare-cheapest`, `shop-cart-button`
(must be ABSENT when the flag is false).

**Dependency order:** F's api commit first; then F (screens), G, H in parallel. Integration: F, G, H,
then the integrator builds Release, runs the flows, screenshots, and the founder gates.

## Evidence

| Claim | Proof | Where |
|---|---|---|

## Deviations from plan

## Open defects

| Defect | Severity | Deferred to | Ticket |
|---|---|---|---|

## Handoff notes for the next planner

_Written at close._
