# Shop search build plan: Google Shopping for Atlitos

Single source of truth for PRD-07 section 11. Anything not written here did not happen.
The product-wide plan stays `docs/PLAN.md`; this is the plan for one feature, STANDARD tier.

Status: APPROVED at Gate 2 on 2026-09-17 ("Approve, start S1 now"). Gate 1 approved the same day on direction C.

## Context

The shop today is an owned-inventory store with an affiliate catalog bolted beside it. The
founder wants the affiliate catalog to be the shop, found through an AI search that returns
the retailer links, grown by pasting retailer URLs, and kept honest by a nightly check and a
review page where dead products get delisted. Vector search over pgvector with Voyage
embeddings makes "light racket for a 12 year old" findable without a brand in the query.

It ships before store submission: target 26 September, submission 30 September. That
window holds only because most of the substrate exists: `ai-search` with its spend guard,
the 0086 tables, the 0120 admin RPCs, the compare screen. Architecture is
`docs/architecture/ADR-011-shop-search-ingest-health.md`; each decision names a runnable
check and those checks are the phase gates below.

## Scope contract

| # | Feature | Requirement | Surface |
|---|---|---|---|
| 1 | pgvector, embedding column, HNSW index, `match_affiliate_products` | FR-40, FR-43, AC-11-7 | db |
| 2 | `gear-embed` function, service role, null-tolerant | FR-43 | edge |
| 3 | Hybrid ranking in `ai-search`, query embedding cached, spend-guarded | FR-40, FR-42, AC-11-1, AC-11-2 | edge |
| 4 | `retailer_programmes`, `product_fetch_log`, offer health columns | FR-45, FR-48, FR-49 | db |
| 5 | `gear-ingest`: fetch, extract (JSON-LD, OG, selectors), image copy, draft | FR-44, FR-46, FR-47, AC-11-3 | edge + storage |
| 6 | Admin "Add from a link" on `/gear/create`, review then save via 0120 RPCs | FR-44, FR-45 | admin |
| 7 | `gear-recheck` nightly sweep, outcomes, 7-strike auto-delist, AI suggestion | FR-48, FR-51, FR-52, AC-11-4 | edge + db |
| 8 | Admin Catalog health `/gear/health`, Gear list health columns, Re-check now | FR-49, FR-50 | admin |
| 9 | Shop home rebuilt as search first, `GearResultTile` (direction C) grid, chips | FR-40, FR-41 | mobile |
| 10 | Compare screen: `OfferRow dense` with freshness and strikethrough, our image | FR-41, FR-46 | mobile |
| 11 | `app_config` + `shop.owned_enabled`, mobile and `checkout` honour it | FR-53, AC-11-5 | db + edge + mobile |
| 12 | RLS, grants, column-level grant on `embedding`, security invariant | AC-11-6, AC-11-7 | db + scripts |

**Explicitly out of scope:** commission attribution and ledger; official retailer APIs;
price history charts; retailers outside `retailer_programmes`; agentic ordering; any
retailer management UI; ratings or reviews of any kind.

## What this product can honestly claim

Every price shown is the value the nightly check last saw, stamped with when. The app never
claims a product is in stock beyond that timestamp, never shows a rating, never shows
delivery terms, and never shows a retailer count that is not the live count of offers.
"Cheapest" means cheapest among the retailers we list, and the copy says so.

## Design direction

Gate 1 APPROVED 2026-09-17 on direction C (Amazon card) after A and B were rejected; see
`docs/design/DIRECTION-SHOP.md`. Tokens: `packages/theme`. Kitchen sink: `/kitchen`, section
"Shop search, direction C". Locked: flat white photo tiles with no corners or border; brand,
title, 18px mono price in ink, store line, freshness, in that order; three type sizes on a
tile; the store glyph is the one accent; no stars, no delivery lines.

## Phases

### Phase S1: substrate

- **Delivers:** the two S1 migrations from ADR-011 D7 (vectors, app_config) applied locally
  and replaying clean; `gear-embed`; hybrid ranking in `ai-search`; `app_config` with the flag;
  RLS and grants; the four S1 `verify-*.mjs` scripts exist and are born red then green (the
  ingest and health scripts belong to S2).
- **Gate:** `scripts/verify-search-hybrid.mjs`, `verify-gear-embed.mjs`,
  `verify-owned-shop-flag.mjs` and `verify-gear-search-rls.mjs` all pass against the local
  stack, and `supabase db reset` replays every migration. AC-11-1, AC-11-2, AC-11-5,
  AC-11-6, AC-11-7 proven.
- **Gate type:** automated.
- **Depends on:** nothing. Starts on Gate 2.

| Track | Slice | Model | Effort | Why this tier |
|---|---|---|---|---|
| A | migrations (vectors, app_config, RLS, grants), `match_affiliate_products`, security invariant | sonnet | high | highest blast radius, once |
| B | `gear-embed`, `ai-search` hybrid path, query cache, spend guard extension, the two verify scripts | sonnet | high | ranking logic with an honesty threshold |

Tracks A and B are disjoint by file (`supabase/migrations/`, `scripts/security-invariants.sh`
vs `supabase/functions/`). B waits for A's migration to exist locally before its verify
script can run; B writes code in parallel. Migration files are `XXXX_` named, one per concern.

### Phase S2: ingest and health

- **Delivers:** `gear-ingest`, `gear-recheck`, the GitHub Actions cron, the
  `product-images` bucket, the extended 0120 RPCs, the auto-delist RPC, and the admin
  "Add from a link" and Catalog health pages.
- **Gate:** `verify-gear-ingest.mjs` (fixture page) and `verify-gear-health.mjs` (dead
  offer, 7 strikes) pass locally; an admin, in a real browser against the local stack,
  pastes a fixture URL, sees the draft, saves, and the image is served from our bucket;
  the health page shows the product going from ok to gone to delisted. Screenshots in
  `docs/qa/evidence/shop-search/`. AC-11-3, AC-11-4 proven.
- **Gate type:** automated, plus one founder look at the admin pages (not blocking).
- **Depends on:** S1.

| Track | Slice | Model | Effort | Why this tier |
|---|---|---|---|---|
| C | `gear-ingest`, extraction, image copy, migration for `retailer_programmes` + `product_fetch_log` + bucket | sonnet | high | untrusted input parsing, storage writes |
| D | `gear-recheck`, outcomes, auto-delist RPC, AI suggestion, Actions cron | sonnet | medium | scheduled job with a kill switch |
| E | admin pages: Add from a link, Catalog health, Gear list columns | sonnet | medium | composition on the 0120 pattern |

C and D share `supabase/functions/_shared/` helpers: C owns `fetch-page.ts`, D imports it.
D starts after C's helper lands. E is disjoint (`apps/admin/`).

### Phase S3: the shop

- **Delivers:** Shop home as search first with the `GearResultTile` grid and chips; compare
  screen with `OfferRow`, freshness and our image; owned shop hidden by the flag; Maestro
  flows for search, compare, click-out and the flag.
- **Gate:** on the iPhone 16 Pro Max Release build pinned to local
  (`scripts/assert-build-target.sh ... local`), the founder's cold-start path in
  `docs/design/IA-SHOP.md` completes: type the badminton query, tap a card, see three
  prices, tap Buy, the retailer opens. Maestro `native-shop-search.yaml`,
  `native-shop-compare.yaml`, `native-shop-flag-off.yaml` green with `--udid`. Light and
  dark screenshots in `docs/qa/evidence/shop-search/`.
- **Gate type:** founder gate (first of its kind surface).
- **Depends on:** S1 for search, S2 only for real images.

| Track | Slice | Model | Effort | Why this tier |
|---|---|---|---|---|
| F | `/(tabs)/shop` rebuild, chips, grid, empty and broaden states, flag gating of owned routes | sonnet | high | the founder-facing surface |
| G | compare screen `OfferRow` integration, freshness, image path, click-out copy | sonnet | medium | bounded change to an existing screen |
| H | Maestro flows, seed fixtures for local search (12 products, 30 offers, embeddings) | haiku | low | mechanical |

### Phase S4: ship

- **Delivers:** migrations applied to production in order, three functions deployed,
  `VOYAGE_API_KEY` set, `product-images` bucket created, Actions cron enabled, admin and app
  redeployed, the flag confirmed false.
- **Gate:** production `ai-search` answers AC-11-1's query with a real product from the
  entered catalog in `mode: "llm"` or `"keyword"` with `vector: true` in the response; the
  live admin health page lists the catalog; `checkout` returns the flag refusal.
- **Gate type:** founder gate (production writes).
- **Depends on:** S1 to S3, and `main` re-reconciled so the deploy is from one line.

## Contracts settled before any UI

- `match_affiliate_products(query_embedding vector(1024), threshold float, limit int)`
  returns `(id uuid, similarity float)`; service role only; the threshold is 0.72 until
  `verify-search-hybrid.mjs` says otherwise, and the number lives in one constant.
- `ai-search` response gains `vector: boolean` and per-hit `rankReason` naming "similar to
  your query" when the vector path added the hit. Contract otherwise unchanged.
- `gear-ingest` POST `{ url }` returns `{ draft: {...}, retailer_key, warnings[] }`; writes
  nothing. Save is the client calling `admin_upsert_affiliate_product` and
  `admin_upsert_product_offer` (extended with trailing optional params, ADR D3).
- `product_fetch_log.outcome` enum: `ok`, `price_changed`, `out_of_stock`, `gone`,
  `blocked`, `unparsed`. `consecutive_failures` counts `gone` and `blocked` only.
- `app_config` rows are `(key text pk, value jsonb, public boolean)`; anon reads only
  `public = true`; writes through `admin_set_app_config` (audited).
- Storage path: `product-images/<affiliate_product_id>/<sha256-16>.<ext>`; max 2 MB; jpeg,
  png, webp only.
- No client writes to any table in this feature. Every write is an RPC or a service-role
  function, and every RPC checks `has_role('admin')` inside.

## Founder input needed

| Item | Unblocks | Owner |
|---|---|---|
| Gate 1 response in `DIRECTION-SHOP.md` | Phase S3 planning | Abishai |
| Gate 2: approve this plan | Phase S1 | Abishai |
| Voyage API key (create at voyageai.com, set as `VOYAGE_API_KEY` function secret) | S1 track B against real embeddings; until then a deterministic stub | Abishai |
| Which affiliate programmes are approved and their tag templates | `retailer_programmes` seed; until then plain URLs | Abishai |
| Answer to PRD-07 Q12 (server-side fetching at launch volume) and Q13 (image copying) | S2 goes ahead as designed, or ingest becomes manual only | Abishai |
| `main` re-reconciled and pushed | S4 | Abishai (push), session (merge) |

## Risks

- **Retailer blocking.** Amazon and Flipkart block datacentre fetches intermittently. Early
  signal: `blocked` outcomes above 20% on the first sweep. Mitigation in the design: an
  outcome that never delists on its own until 7 strikes, and manual entry always works.
- **Time.** Four phases in nine days beside the reconciliation and the store build. Early
  signal: S1 not green by 20 September. What falls out first, in order: the AI suggestion
  (FR-52), the strikethrough previous price, the Actions cron (run the sweep by hand until
  pg_net is on), then S2's health page (the Gear list columns alone carry the review).
- **Voyage cost and outage.** Cached query embeddings and the existing daily budget cap it;
  outage degrades to keyword, by design and by test.
- **Image rights.** Open question 13. If the answer is no, `image_url` keeps pointing at the
  retailer and FR-46 is deferred; nothing else changes.

## Ship

| Surface | Deploy | Proof |
|---|---|---|
| Database | migrations in order via the Supabase MCP after local replay | `select count(*) from pg_extension where extname='vector'` = 1; `match_affiliate_products` exists; anon `select embedding` refused |
| Edge functions | `supabase functions deploy gear-embed gear-ingest gear-recheck ai-search` | POST `ai-search` with the AC-11-1 query returns 200 with `"vector":true` |
| Admin | `vercel --prod --archive=tgz` from the repo root | GET `/gear/health` 200 with the text "Catalog health" |
| App web | prebuilt `dist` recipe | GET `/shop` 200 with the search field's placeholder in the HTML |
| Native | the next TestFlight build after this merges | Maestro green on the Release build |
