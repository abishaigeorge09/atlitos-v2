# Phase S2 status: ingest and health

Status: AWAITING APPROVAL
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

Integrated at e1c35de (C), 544519b (D), 23e3e37 (E); fixes e91119c (checkout deno casts, pre-existing),
4e650a7 (offer outcome type), ef37184 (save response shape, found by the browser walk).
Automated gate re-derived from a clean reset on 2026-09-18 (`~/.claude/jobs/8ea01d2a/tmp/s2-gate.sh`, log `s2-gate.log`).

| Claim | Proof | Where |
|---|---|---|
| 120 base migrations + four `XXXX_` apply clean | reset exit 0, four "applied" | s2-gate.log 1, 2 |
| Invariants incl. `embedding-column-grant`, `auto-delist-actor-null` | 11 of 11 PASS | step 4 |
| S1 scripts still green | rls 17, embed 10, hybrid 10 (STUB), flag 9/9 | step 5, 5b |
| AC-11-3 (fixture) | `verify-gear-ingest.mjs` 19 PASS, 0 FAIL | step 5 |
| AC-11-4 | `verify-gear-health.mjs` 29 PASS, 0 FAIL | step 5 |
| `deno check` whole functions tree | Check on gear-ingest, gear-recheck, gear-embed, ai-search, checkout | after e91119c |
| Gate | `pnpm turbo typecheck lint` 20/20 | after 4e650a7 |
| **Browser half of the gate, integrated tree** | admin@atlitos.dev in Playwright: Fetch leaves row count 0; Save lands on `/gear/show/<id>`; `image_url` = `http://127.0.0.1:54321/storage/v1/object/public/product-images/walkthrough_fixture/24147f79f3061e6b.jpg`, GET 200 image/jpeg; Catalog health shows ok; fixture switched to 404, counter at 6, one Re-check now click: `active=false`, `health_status=gone`, `auto_delisted_at` set, one `audit_log` row `affiliate_product.auto_delist` with `actor_id null`; Delisted filter shows it | `docs/qa/evidence/shop-search/s2-01..05.png`, `walkthrough-s2.mjs` |
| Track E's own captures (health states, AI suggestion card) | 8 PNGs from seeded states | `docs/qa/evidence/shop-search/0*.png` |

## Deviations from plan

- `product_offers.last_check_outcome` has five values; `unparsed` exists only on `product_fetch_log.outcome` (ADR D4 wording). The PLAN's contract line listed six for the offer; corrected in code (4e650a7).
- `gear-ingest` save returns the contract fields AND the full rows (ef37184).
- The FR-52 AI suggestion is proven only on the "no key, stays null, no error" path; a populated suggestion needs `ANTHROPIC_API_KEY` in the function secrets (production has it).
- The GitHub Actions nightly workflow is unexecuted until the branch reaches GitHub and the two repo secrets exist.
- Security red team runs once on the S1+S2 diff (below), not per phase.

## Open defects

| Defect | Severity | Deferred to | Ticket |
|---|---|---|---|
| No live retailer ever fetched (fixtures only); a real Amazon.in page must be tried once by a person before S4 | P1 | S4 ship gate, founder pastes one real URL in production admin after deploy | tracker |
| Nightly workflow needs `SUPABASE_FUNCTIONS_URL` and `SUPABASE_SERVICE_ROLE_KEY` repo secrets | P1 | S4, founder sets secrets | tracker |
| `retailer_programmes.affiliate_tag_template` empty for all three seeds | P1 | founder's affiliate approvals | docs/ops/AFFILIATE-APPLICATIONS.md |

## Handoff notes for the next planner

_Written at close._
