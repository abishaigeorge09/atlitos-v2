# Phase S1 status: shop search substrate

Status: AWAITING APPROVAL
Opened: 2026-09-17   Closed:

Plan: `docs/PLAN-SHOP-SEARCH.md`. Architecture: `docs/architecture/ADR-011-shop-search-ingest-health.md`.
Branch: `integration/shop-search`. Track branches `worktree-agent-abe97105e2af71925` (A), `worktree-agent-ad9432ebd7261ee09` (B), merged with --no-ff at de0f3a6 and 506eb12.

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

Re-derived by the integrator from a clean `supabase db reset` on 2026-09-18 (script
`~/.claude/jobs/8ea01d2a/tmp/s1-gate.sh`, log `s1-gate.log`), not taken from the builders' reports.

| Claim | Proof | Where |
|---|---|---|
| 120 base migrations replay clean | `supabase db reset` exit 0 | s1-gate.log step 1 |
| Both `XXXX_` migrations apply on top | psql `-v ON_ERROR_STOP=1`, both "applied" | step 2 |
| Security invariants | 10 of 10 PASS including new `embedding-column-grant` and `db-dual-policy-drift` (list fixed, 8942b28) | step 4, re-run after fix |
| AC-11-6, AC-11-7 | `verify-gear-search-rls.mjs` 17/17, exit 0 | step 5 |
| AC-11-5, FR-53 | `verify-owned-shop-flag.mjs` 9/9 with `supabase functions serve` up; checkout returns 403 `OWNED_SHOP_DISABLED` | re-run after step 5 (first run hit 503 because the runtime was down) |
| FR-43, AC-11-7 | `verify-gear-embed.mjs` 10/10: embed writes, anon 401, bad key leaves null and keyword path still finds it | step 5 |
| AC-11-1, FR-42 | `verify-search-hybrid.mjs` (b) broaden line with zero Babolat hits, (c) over budget gives `mode: keyword`, `vector: false`, (d) `vector: true`. The brand and price hard match itself is unchanged code, still covered by the pre-existing `scripts/verify-ai-search.ts` tests A, D, E. The 1.5 s p95 clause is NOT measured until S4 against the production catalog. | step 5 |
| AC-11-2 | **STUB**: top 3 contains a beginner or junior badminton racket under the deterministic embedder; PASS requires `VOYAGE_API_KEY` (founder) | step 5 |
| Gate | `pnpm turbo typecheck lint` 20/20 | step 6 |

## Deviations from plan

- `app_config` built as `(key, value jsonb, public)` rather than the ADR's `enabled boolean`; ADR updated (86f253f).
- `ai-search` keeps `mode` meaning "did Claude run"; the vector path is reported by the new `vector` field, so no existing caller's reading of `mode` changes.
- `supabase db reset` cannot replay `XXXX_` files; they get numbers when `main` is reconciled and are psql-applied after every reset until then.
- Builders were dispatched twice: the builder agent's own worktree isolation cut from stale `main`; fixed by a `git reset --hard integration/shop-search` step 0.

## Open defects

| Defect | Severity | Deferred to | Ticket |
|---|---|---|---|
| AC-11-2 unproven with real embeddings | P1 | founder sets `VOYAGE_API_KEY`, then re-run `verify-search-hybrid.mjs` before S4 | tracker |
| `supabase/functions/.env.local` for local serving must be created by hand (`VOYAGE_STUB=1`); the sandbox cannot write `.env*` | P3 | docs/qa/CURRENT-STATE.md environment traps | none |

## Handoff notes for the next planner

_Written at close._
