# Phase S2 status: ingest and health

Status: IN FLIGHT
Opened: 2026-09-18   Closed:

Plan: `docs/PLAN-SHOP-SEARCH.md` Phase S2. Architecture: `docs/architecture/ADR-011-shop-search-ingest-health.md` D3, D4, D6.
Previous phase: `PHASE-S1-STATUS.md` (read its handoff notes first). Branch: `integration/shop-search`.
Founder decisions in force: PRD-07 Q12 yes (fetch retailer pages server side), Q13 yes (copy images, takedown on request).

## Gate

> `verify-gear-ingest.mjs` (fixture page) and `verify-gear-health.mjs` (dead offer, 7 strikes)
> pass locally; an admin, in a real browser against the local stack, pastes a fixture URL, sees
> the draft, saves, and the image is served from our bucket; the health page shows the product
> going from ok to gone to delisted. Screenshots in `docs/qa/evidence/shop-search/`. AC-11-3,
> AC-11-4 proven.

**Verdict:** pending.

## The hard decision

Track C and Track D both need a page fetcher, and D's nightly sweep is the riskier consumer
(hundreds of fetches, retailer rate limits). Decision: Track C owns
`supabase/functions/_shared/fetch-page.ts` (UA, timeout, size cap, robots.txt) AND
`supabase/functions/_shared/extract-product.ts` (JSON-LD, Open Graph, retailer selectors), and
lands them in its FIRST commit before anything else, so D can import them from the shared base
within the hour. D starts after C's first commit exists on `integration/shop-search` (the
integrator merges C's helper commit early). E is fully disjoint and starts at once.

Fixture pages for both verify scripts live under `scripts/fixtures/gear/` as static HTML served
by a tiny local `node:http` server the scripts start themselves; no verify script ever fetches
a live retailer.

## Scope

| # | Deliverable | Requirement | Track | Done |
|---|---|---|---|---|
| 1 | `_shared/fetch-page.ts`, `_shared/extract-product.ts` (first commit) | FR-44, FR-47 | C | |
| 2 | `XXXX_gear_ingest_health.sql`: `retailer_programmes` (seed Amazon.in, Flipkart, Decathlon India, tag templates EMPTY until approval), `product_fetch_log`, new columns on `affiliate_products` (`source_image_url`, `image_path`, `health_status`, `health_checked_at`, `auto_delisted_at`) and `product_offers` (`canonical_url`, `retailer_key`, `last_check_outcome`, `consecutive_failures`, `last_price_change_at`), extended 0120 RPCs with trailing defaulted params, `system_auto_delist_affiliate_product` (service role only), RLS: admin read only on `product_fetch_log` and `retailer_programmes`, no client writes | FR-45, FR-48, FR-49, FR-51 | C | |
| 3 | `XXXX_product_images_bucket.sql`: bucket `product-images`, public read, service-role write | FR-46 | C | |
| 4 | `gear-ingest` function: `fetch` (nothing written) and `save` (image copy hash-deduped, catalogue writes through the extended RPCs with the admin's forwarded JWT) | FR-44 to FR-47, AC-11-3 | C | |
| 5 | `scripts/verify-gear-ingest.mjs` + fixtures | AC-11-3 | C | |
| 6 | `gear-recheck` function: sweep grouped by retailer with `fetch_policy.maxPerMinute`, outcomes, `consecutive_failures`, 7-strike auto-delist via the RPC, AI suggestion only on unparsed 200 under the spend guard | FR-48, FR-51, FR-52, AC-11-4 | D | |
| 7 | `.github/workflows/gear-nightly.yml` curling `gear-recheck` and `gear-embed` sweeps; `docs/DEBT.md` entry for the pg_net replacement | FR-48 | D | |
| 8 | `scripts/verify-gear-health.mjs`; invariant `auto-delist-actor-null` in `security-invariants.sh` | AC-11-4 | D | |
| 9 | Admin `/gear/create` "Add from a link" section (URL, Fetch, draft review with image preview, Save through `gear-ingest` save) above the manual form | FR-44, FR-45 | E | |
| 10 | Admin `/gear/health` page (every product, worst first, Attention / Delisted / All, bulk Delist / List, Re-check now per product) and health columns on `/gear` | FR-49, FR-50 | E | |
| 11 | Admin `/gear/show/:id`: per-offer last outcome, checked at, Re-check now, AI suggestion box | FR-50, FR-52 | E | |
| 12 | Docs: SCHEMA.md, RLS.md, API-MAPPING.md, storage section; `docs/qa/evidence/shop-search/` screenshots | docs duty | C (schema, RLS), D (API recheck), E (API ingest UI, evidence) | |

## Tracks

### Track C: ingest (sonnet)

Owns: `supabase/functions/_shared/fetch-page.ts`, `supabase/functions/_shared/extract-product.ts`,
`supabase/functions/gear-ingest/**`, `supabase/migrations/XXXX_gear_ingest_health.sql`,
`supabase/migrations/XXXX_product_images_bucket.sql`, `scripts/verify-gear-ingest.mjs`,
`scripts/fixtures/gear/**`, `docs/architecture/SCHEMA.md`, `docs/architecture/RLS.md`,
`packages/types/src/db/rows.ts` (new rows and columns).
Must not touch: `gear-recheck`, `.github/**`, `security-invariants.sh`, anything under `apps/`.

### Track D: health (sonnet)

Owns: `supabase/functions/gear-recheck/**`, `.github/workflows/gear-nightly.yml`,
`scripts/verify-gear-health.mjs`, `scripts/security-invariants.sh` (one new check), `docs/DEBT.md`
(one entry), `docs/architecture/API-MAPPING.md` (recheck rows).
Must not touch: migrations (the RPC and columns come from C), `gear-ingest`, `_shared/fetch-page.ts`
(import only), anything under `apps/`. Starts after C's helper commit is on the branch.

### Track E: admin surfaces (sonnet)

Owns: `apps/admin/src/pages/gear/**` (create.tsx gains the link section; new health.tsx; show.tsx gains
outcomes and suggestion; api.ts gains the calls), `apps/admin/src/App.tsx` (one route), the Gear
sidebar entry, `docs/architecture/API-MAPPING.md` (ingest UI rows), `docs/qa/evidence/shop-search/**`.
Must not touch: anything under `supabase/`, `scripts/`, `.github/`. Builds against the contracts in
`docs/PLAN-SHOP-SEARCH.md` "Contracts settled before any UI"; until C's function exists locally,
E's Fetch button targets a local stub response it documents, then switches to the real function
before its screenshots.

**Dependency order:** C's helper commit, then D in parallel with the rest of C; E from the start.
Integration: C, then D, then E.

## Evidence

| Claim | Proof | Where |
|---|---|---|

## Deviations from plan

## Open defects

| Defect | Severity | Deferred to | Ticket |
|---|---|---|---|

## Handoff notes for the next planner

_Written at close._
