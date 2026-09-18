# Phase S1 status: shop search substrate

Status: IN FLIGHT
Opened: 2026-09-17   Closed:

Plan: `docs/PLAN-SHOP-SEARCH.md`. Architecture: `docs/architecture/ADR-011-shop-search-ingest-health.md`.
Branch: `integration/shop-search`. Track branches `integration/shop-search-s1a`, `integration/shop-search-s1b`.

## Gate

> `scripts/verify-search-hybrid.mjs`, `verify-gear-embed.mjs`, `verify-owned-shop-flag.mjs`
> and `verify-gear-search-rls.mjs` all pass against the local stack, and `supabase db reset`
> replays every migration. AC-11-1, AC-11-2, AC-11-5, AC-11-6, AC-11-7 proven.

**Verdict:** pending.

## The hard decision

Voyage may not have a key during this phase. Decision: `gear-embed` and `ai-search` read
`VOYAGE_API_KEY`; when it is absent OR `VOYAGE_STUB=1`, both use a deterministic local
embedder (a seeded hash of the normalised text projected to 1024 dims, unit length) so every
verify script runs green on any machine, and `verify-search-hybrid.mjs` marks AC-11-2 as
`STUB` rather than `PASS` when the stub was used. The gate for AC-11-2 is only PASS with the
real key. Alternative rejected: mocking the Voyage HTTP endpoint, because it hides the exact
failure mode (key absent) the ADR's D2 confirmation must prove.

## Scope

| # | Deliverable | Requirement | Track | Done |
|---|---|---|---|---|
| 1 | `XXXX_gear_search_vectors.sql`: extension, `embedding vector(1024)`, HNSW cosine index, `match_affiliate_products`, `query_embedding_cache` (service role only) | FR-40, FR-43 | A | |
| 2 | `XXXX_app_config_owned_shop_flag.sql`: `app_config`, RLS public read of `public = true`, `admin_set_app_config` audited, seed `shop.owned_enabled = false` | FR-53 | A | |
| 3 | Column-level grant removing `embedding` from anon/authenticated selects; SQL invariant in `scripts/security-invariants.sh` | AC-11-6, AC-11-7 | A | |
| 4 | `scripts/verify-gear-search-rls.mjs`, `scripts/verify-owned-shop-flag.mjs` (flag half: config read + `checkout` refusal) | AC-11-5, AC-11-6 | A | |
| 5 | `checkout` edge function refuses with `OWNED_SHOP_DISABLED` when the flag is false, before any pricing | FR-53 | A | |
| 6 | `supabase/functions/gear-embed/index.ts` + `_shared/embeddings.ts` (Voyage client, stub, 1024 dims) | FR-43, AC-11-7 | B | |
| 7 | `ai-search`: query embedding (cached), `match_affiliate_products` recall folded into candidates, `VECTOR_SIMILARITY_FLOOR`, `vector: boolean` in the response, spend guard covers Voyage | FR-40, FR-42 | B | |
| 8 | `scripts/verify-search-hybrid.mjs`, `scripts/verify-gear-embed.mjs` | AC-11-1, AC-11-2 | B | |
| 9 | Docs: SCHEMA.md, RLS.md, API-MAPPING.md rows for everything above | CLAUDE.md docs duty | A (schema, RLS), B (API) | |

## Tracks

### Track A: schema, policies, flag, invariants (sonnet)

Owns: `supabase/migrations/XXXX_gear_search_vectors.sql`, `supabase/migrations/XXXX_app_config_owned_shop_flag.sql`,
`scripts/security-invariants.sh` (one new check), `scripts/verify-gear-search-rls.mjs`,
`scripts/verify-owned-shop-flag.mjs`, `supabase/functions/checkout/index.ts` (the flag check only),
`docs/architecture/SCHEMA.md`, `docs/architecture/RLS.md`, `packages/types/src/db/rows.ts` (AppConfigRow).
Must not touch: `supabase/functions/ai-search/**`, `supabase/functions/gear-embed/**`, `_shared/embeddings.ts`.

### Track B: embeddings and hybrid ranking (sonnet)

Owns: `supabase/functions/gear-embed/**`, `supabase/functions/_shared/embeddings.ts`,
`supabase/functions/ai-search/**`, `scripts/verify-search-hybrid.mjs`, `scripts/verify-gear-embed.mjs`,
`docs/architecture/API-MAPPING.md`, `apps/admin/src/pages/gear/api.ts` (one call to `gear-embed` after upsert, nothing else in admin).
Must not touch: any migration, `security-invariants.sh`, `checkout`.
Depends on Track A's vectors migration existing locally to run its scripts; writes code before that.

**Dependency order:** A's migration 1 first (B's scripts need the column and the function);
everything else in parallel. Integration: A merges first, then B rebases on it.

## Evidence

| Claim | Proof | Where |
|---|---|---|

## Deviations from plan

## Open defects

| Defect | Severity | Deferred to | Ticket |
|---|---|---|---|

## Handoff notes for the next planner

_Written at close._
