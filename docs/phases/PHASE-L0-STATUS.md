# Phase L0 status: the search bar, a refactor that changes nothing, three invariants

Plan: `docs/PLAN-SEARCH-LOCATION-AFFILIATE.md` section 6 L0. Architecture: ADR-014 D1, D8.
Branch `l0/search-bar` off `integration/search-l0`, 2026-09-26. Not merged, nothing deployed,
production untouched.

**Every green in this phase is a green on the local fixture.** No human has graded anything, no
vector has been measured on real geometry, and the production catalogue is still 8 seed products.

## What was built

| Track | Files | Gate | Result |
|---|---|---|---|
| L0-T1 harness | `docs/search-eval/` (README, `queries.jsonl` 160, `judgments.jsonl` 8,070, `candidates.jsonl` empty, `baseline.json`, `generate.mjs`); `supabase/seed/local_seed_search_eval.sql`; `scripts/seed-search-eval.mjs`, `search-eval-embed.mjs`, `verify-search-eval.mjs`, `lib/search-eval-metrics.mjs` (+ `.test.ts`), `probe-search-latency.mjs` | harness fails against the current function; seed refuses production with zero writes; NDCG unit against a hand computed example | met: red with 21 failed gates (typo NDCG 0.100, Hinglish NDCG 0.000, grounding 0.000); seed refusal proven with a fake psql; unit 19 of 19, born red |
| L0-T2 refactor | `ai-search/index.ts`, new `fetch-gear.ts`, `fetch-courts.ts`, `fetch-people.ts`; `search-core.ts` and `packages/types` type additions only | `--baseline-diff` zero id changes; e2e, gear recall, hybrid still pass | met: 0 of 160 changed; all named proofs pass (hybrid only on a catalogue without the fixture, see below) |
| L0-T3 invariants | `scripts/security-invariants.sh` (3 checks), `scripts/seed-affiliate-catalog.mjs`, `docs/qa/verify/GATES-BORN-RED.md` | each check red on a plant, green clean | met, and `no-fake-affiliate-tag` widened after it went green over 9 `aff=atlitos` parameters |
| Orchestrator add | `apps/mobile/src/app/home/search.tsx` | GLB-01: affiliate hits open `/shop/affiliate/[id]` | typecheck and lint clean; NOT device verified |

Evidence for every red and green run: `docs/qa/verify/GATES-BORN-RED.md`, section "Search Phase L0".

## The red baseline (the current function, before any search change)

Recorded 21:02 IST on a fixture only stack. `docs/search-eval/baseline.json` holds the ids.

| Class | CP | NDCG@10 | P@5 | Hit@1 | R@5 | Honest empty | Court | Grounding |
|---|---|---|---|---|---|---|---|---|
| gear_brand | 1.000 | 0.848 | 0.900 | | | 0.900 | | |
| gear_typo | 1.000 | **0.100** | | | **0.100** | 0.100 | | |
| gear_type | 0.908 | 0.764 | 0.820 | | | 1.000 | | |
| gear_price | 0.872 | 0.923 | 0.955 | | | 1.000 | | 0.000 |
| gear_brand_price | 0.952 | 0.886 | 0.850 | | | 0.900 | | 0.000 |
| gear_age_skill | 1.000 | 0.480 | | | | 0.900 | | |
| gear_vague | 1.000 | 0.631 | | | | 0.800 | | |
| gear_hinglish | n/a (no hits) | **0.000** | | | **0.000** | 0.000 | | |
| gear_comparison | 0.474 | 0.090 | | | | 1.000 | | 0.000 |
| gear_specific | 1.000 | 0.795 | | 0.700 | | 1.000 | | |
| gear_empty | 1.000 | 1.000 | | | | 0.400 | | |
| gear_sport | 1.000 | 1.000 | 1.000 | | | 1.000 | | |
| gear_keystroke | flags 1.000 (mode keyword, vector false, under 400 ms) | | | | | | | |
| crt_timed | 1.000 | 0.990 | | | | 1.000 | 1.000 | 0.000 |
| crt_place | 1.000 | 0.831 | | | | 0.833 | 0.667 | |
| crt_venue | 1.000 | 0.659 | | 0.833 | | 0.750 | 1.000 | |
| crt_empty | 1.000 | 1.000 | | | | 0.833 | 1.000 | |
| home | 0.979 | 0.644 | | | | 1.000 | 1.000 | 0.000 |
| **overall** | 0.952 | 0.637 | | | | 0.779 | 0.917 | 0.000 |

Unjudged rate 0.000 (every fixture pair is judged). Local wall p50 25 ms, p95 37 ms. LOC-13 (gear
ignores the place) held on 120 of 120 shop queries. `--degraded`: NDCG 0.637, CP 0.952, red.

What the per query findings say, for L1 and L2 to fix (all measured, all in the harness output):

- Every typo query is empty ("No matches for "yonx""); "li ning" and "li ning under 3000" are empty
  too, because `search_affiliate_product_ids` strips the space and queries `lining:*`.
- Every Hinglish query is empty: `bachon`, `liye`, `sasta`, `joota`, `gend`, `chahiye` are required
  keywords.
- The comparison anchor is returned as its own answer ("cheaper than yonex astrox 99 pro" returns
  the Astrox 99 Pro), and "like X" returns X.
- A sold out product passes a price ceiling (the fallback price is the cheapest offer overall):
  "under ₹2000" and "sg bat under 5000" return SG Hi Score Xtreme, sold out everywhere.
- "under ₹2000" and "under 1.5k" parse no ceiling at all, so they return everything.
- Brand is a substring match: "protect my head while batting" reads brand Head and returns empty.
- "racket and shuttlecocks" returns tennis rackets and a tennis overgrip.
- Near me court results are not nearest first (2.2, 12.9, 3, 1.6 km); far from everything
  (Panaji) returns venues 500 km away instead of the LOC-11 empty line.
- "jubilee hills tennis centre" (link only venue) and "indoor badminton court" return empty, the
  second with a self contradicting broaden ("No badminton courts have a free slot this week. The
  soonest is Smash Arena, today at 10:00 PM"). Logged in `docs/DEBT.md`.
- No response has an `answer` field (grounding 0.000 on all 34 queries that must carry one).

## Decisions made in this phase, and deviations from the plan

1. **Judgment labels.** 7,273 `derived` (grades 0 and 3), 797 `agent` (grades 1 and 2, each with a
   rule in `note`), 0 `human`. ADR-014 D1 says only human rows count; the harness counts every
   non `llm` row instead and prints the split on every run. This is the orchestrator's instruction
   and it is the only way the bar can be measured at L0.
2. **130 offers, not 150.** The plan's distribution sums to 130; the distribution was kept.
3. **Hyderabad has 9 venues with Kondapur twice**, since the plan lists 7 areas and 8 venues.
4. **Second court at a two sport venue opens at 06:30**, so the per venue court id is deterministic.
5. **`--degraded` saturates the harness user's own throttle** instead of pushing the shared daily
   budget over, so parallel agents on the same Postgres are not degraded too. Same gate outcome
   (`mode: keyword`, `vector: false`), asserted on every response.
6. **Constraint precision uses ground truth constraints** (`expect.constraints`, what was asked),
   not the parsed intent, which would make a missed brand pass vacuously. A sold out product fails
   any price ceiling.
7. **Queries with no positive judgment (15 expected empty) are excluded from NDCG** and scored by
   honest empty accuracy; the harness prints the count. Coach, athlete and clip hits are outside
   graded scope and removed before ranking metrics; the harness prints how many.
8. **`generate.mjs` is committed in `docs/search-eval/`** as the audit trail of how every grade was
   derived. It is not in the plan's file list. It must not be rerun to change a grade.
9. **`background()` moved into `fetch-gear.ts`** (its first user is the vector cache write) and is
   imported by `index.ts`; `numberOrUndefined` is duplicated privately in `fetch-gear.ts`. The
   unused `haversineKm` import was dropped from `index.ts`. No other change to moved code: it was
   extracted by line range from the original file.

## Not done, and why

- **Embeddings.** `fixtures/embeddings.b64.json` does not exist: no Voyage key was available, and
  none was sought. Loader, tag check and clearing are proven with a synthetic blob that was deleted.
  Founder: key in `~/.config/atlitos/voyage.env`, then `node scripts/search-eval-embed.mjs`.
- **Latency probe on production.** Not run. It needs the production anon key, which lives in
  `.env` files this track may not read, and ai-search writes its own bookkeeping per request (rate
  limit token, query cache row, and on the submit path a Claude spend record), so "read only" holds
  for the client but not for the server. Run it at the L1 gate with `--confirm-production --from`.
- **Device proof of the GLB-01 fix.** No Release build, no Maestro (memory budget, no simulator in
  this track). L4-T3 owns the `search-domains.yaml` tap through.
- **`lib/search-routes.ts` extraction and its tsx unit** belong to L4-T2 and were not done here; the
  fix is inline in `openHit`.

## Existing proofs after the refactor

| Proof | Result |
|---|---|
| `scripts/verify-court-search-e2e.mjs` | ALL CHECKS PASSED (fixture venues now appear in its results) |
| `scripts/verify-gear-recall.mjs` | ALL CHECKS PASSED |
| `scripts/verify-court-slots.mjs` | ALL CHECKS PASSED |
| `scripts/verify-affiliate-clicks.mjs` | ALL CHECKS PASSED (needs `seed_p4_commerce.sql` categories, then `seed-affiliate-catalog.mjs` with `SUPABASE_URL` set local) |
| `scripts/verify-manual-payouts.mjs` | ALL CHECKS PASSED (leaves two verified badminton coaches and a venue behind) |
| `scripts/verify-search-hybrid.mjs` | FAILED (b) with the fixture and the affiliate seed loaded (a Babolat under 2000 exists); PASSED 10 of 10 on a clean catalogue after the refactor |
| `tsx scripts/verify-ai-search.ts`, `verify-court-search.ts` | ALL PASS |

## Traps the next agent will hit

- The stack is shared and nothing is isolated. `--baseline-diff` is only meaningful on the catalogue
  state the baseline saw (fixture only). `seed_p2.sql`, `seed-affiliate-catalog.mjs` and the rows
  `verify-manual-payouts.mjs` leaves behind all change results; the harness prints `sharing` counts.
- `verify-search-hybrid.mjs` kills `supabase_edge_runtime_atlitos`. Stop your own serve first
  (match it by your env file path, not by `pkill -f "functions serve"`, which kills other agents').
- Loading embeddings is an UPDATE, which reorders heap rows. The L0 diff survived a load and clear,
  but L1 should record its own baseline after the first real embedding load.
- `seed-affiliate-catalog.mjs` defaults to the PRODUCTION URL (guarded). Always set `SUPABASE_URL`.
- The harness skips `tonight` queries after 22:30 IST and says so; run it earlier for a full diff.

## Handoff to L1

L1-T1 owns `lexicon.ts` and fuzzy terms: the typo and Hinglish classes are at 0.100 and 0.000.
L1-T2 owns fusion and `answer.ts`: grounding is 0.000 on 34 queries; wire `answer` and the
comparison anchor. `index.ts` is wiring only now. Update `baseline.json` in the merge commit
after reviewing `--baseline-diff`, as the plan says.
