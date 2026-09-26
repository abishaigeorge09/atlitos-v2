# Search evaluation set

The measured bar for search accuracy: docs/PLAN-SEARCH-LOCATION-AFFILIATE.md section 1 and
ADR-014 D1. Everything here was produced in Phase L0 (2026-09-26) and is FROZEN: later phases
do not edit `queries.jsonl` or `judgments.jsonl` to make a number move. A grade that is wrong is
corrected by a human editing that one row to `judgedBy: "human"` with a `note`, reviewed at merge.

## Files

| File | What it is |
|---|---|
| `queries.jsonl` | 160 queries, one per line. Schema below. |
| `judgments.jsonl` | 8,070 graded pairs: every fixture product for every gear query, every fixture court for every court query, both for home queries. |
| `candidates.jsonl` | Empty. `scripts/search-eval-harvest.mjs` (L1) appends harvested real queries here for grading. |
| `baseline.json` | Result ids per query from the run recorded before the L0-T2 refactor, plus that run's metrics. `--baseline-diff` compares against it. |
| `fixtures/embeddings.b64.json` | NOT YET PRESENT. Real Voyage vectors for the 60 products and 160 queries, from `scripts/search-eval-embed.mjs`. Until it exists every run prints `vector path not exercised: no committed embeddings`. |
| `generate.mjs` | The one time generator that wrote the queries, the judgments and `supabase/seed/local_seed_search_eval.sql` from the fixture data and grading rules it contains. Kept as the audit trail of how every grade was derived. Do not rerun it to change a grade. |

## The fixture

`supabase/seed/local_seed_search_eval.sql`, applied only by `scripts/seed-search-eval.mjs`, which
refuses any target that is not loopback before psql is spawned.

- 60 affiliate products (ids `e0000000-0000-0000-0001-...`): 11 badminton rackets, 9 tennis rackets,
  9 cricket bats, 7 footballs, 8 shoes, 14 accessories, and 2 sold out everywhere (a Yonex racket and
  an SG bat), per plan section 1.2.
- 130 offers across Amazon (`amazon_in`), Flipkart, Decathlon and Tennis Hub (no programme row):
  12 products on one retailer, 30 on two, 14 on three, 4 on four. 9 products have one out of stock
  offer. Prices 199 to 21,990. Every URL is on `example.test`; no URL has a tag or aff parameter.
- 12 venues, 15 courts: Hyderabad 9 (Gachibowli 2, Kondapur 2, Madhapur, Jubilee Hills, Kukatpally,
  Secunderabad, Uppal), Bengaluru 3. Sports: badminton 7 venues, cricket 3, tennis 3, football 2.
  9 venues have windows only, Madhapur Shuttle Point has windows and a link, Jubilee Hills Tennis
  Centre is link only, Uppal Sports Village is `pending` with windows and a link and must never
  appear. Smash Arena prices 18:00 to 22:00 at 1.5x. Shuttle House's tennis court is blacked out
  every Wednesday and Whitefield Football Arena's football court every Saturday and Sunday, for the
  next 8 weeks from the day the seed runs (IST).

Two deliberate deviations from plan section 1.2, both arithmetic or determinism, not scope:

1. **130 offers, not 150.** The plan's own distribution (12 x 1 + 30 x 2 + 14 x 3 + 4 x 4) sums to
   130. The distribution was kept, since it is what GEAR-13 and GEAR-14 test.
2. **The second court of a two sport venue opens at 06:30, not 06:00.** With identical windows two
   courts at one venue tie on "soonest free slot", Postgres picks either, and the per venue court id
   would flip between runs, which makes `--baseline-diff` flaky for reasons unrelated to code.
   The plan's "Hyderabad 9" lists seven areas with two venues in Gachibowli (eight); Kondapur has two
   venues to make nine, which also gives LOC-08 a real centroid.

Traps planted on purpose, because a fixture with nothing to be wrong about measures nothing:
a Yonex racket whose description says "Head heavy" (brand `head` is a substring match today);
a Babolat racket bag titled "Pure Drive" (Hit@1 for "babolat pure drive"); a sold out Nanoflare
1000Z beside the Nanoflare 700; an out of stock offer that is the cheapest offer on 3 products, so
"cheapest in stock" and "cheapest" differ; Nike "Court" shoes for "shoes for indoor court".

## Query schema (ADR-014 D1, extended)

```
{ id, query, surface: "shop" | "courts" | "home", scenario, class, entityTypes?, override?,
  place: { lat?, lng?, city } | null,
  expect: { kind: "results" | "empty", broadenMentions?, courtPredicate?,
            answer?: true,           // the response must carry a grounded answer
            hit1?: true,             // specific item: Hit@1 applies
            flagsOnly?: { mode, vector, maxWallMs },   // GEAR-17 keystrokes: flags, not relevance
            constraints: { entityTypes?, gear?: { brand?, sport?, priceMax?, excludeIds? },
                           court?: { sport?, priceMax?, city? } } },
  tonight?: true }                   // skipped after 22:30 IST, and the run says so
```

`class` groups queries for per class thresholds. `constraints` is the ground truth for
constraint precision: what the shopper asked, not what the parser happened to read, so a missed
brand cannot make the metric pass vacuously.

| Class | n | Scenarios |
|---|---|---|
| gear_brand | 10 | GEAR-01, GEAR-25 |
| gear_typo | 10 | GEAR-02 |
| gear_type | 10 | GEAR-03, GEAR-26 |
| gear_price | 10 | GEAR-04, GEAR-19, GEAR-27 |
| gear_brand_price | 10 | GEAR-05 |
| gear_age_skill | 10 | GEAR-06 |
| gear_vague | 10 | GEAR-07 |
| gear_hinglish | 10 | GEAR-08 |
| gear_comparison | 10 | GEAR-09, GEAR-10 |
| gear_specific | 10 | GEAR-15 |
| gear_empty | 10 | GEAR-05, GEAR-11, GEAR-20, GEAR-25, EMPTY-01 to 03 |
| gear_sport | 10 | GEAR-16 |
| gear_keystroke | 6 | GEAR-17 |
| crt_timed | 8 | CRT-01, CRT-04, CRT-17 |
| crt_place | 6 | CRT-02, CRT-03, LOC-11 |
| crt_venue | 8 | CRT-05, CRT-06, CRT-07, CRT-14 |
| crt_empty | 6 | CRT-09, LOC-11 |
| home | 6 | GLB-01, GLB-02, GLB-03 |

## Judgments

`{ queryId, entity: "gear:affiliate:<id>" | "court:<court id>", grade: 0..3, judgedBy, note? }`

| judgedBy | Rows | Meaning |
|---|---|---|
| `derived` | 7,273 | Grade 3 or 0, following mechanically from fixture attributes (brand, sport, noun, in stock price against the ceiling, venue status, windows, blackouts, city, radius). |
| `agent` | 797 | Grade 1 or 2. A judgment call encoded as a rule by the L0 agent, with the rule in `note` (adult item for a kids query, adjacent skill level, same sport different noun, link venue for a timed query, sold out caps at 2). |
| `human` | 0 | Nobody has graded anything by hand yet. |
| `llm` | 0 | Reserved for `search-eval-judge.mjs` proposals (L1). Never counted. |

Metrics use every row that is not `llm`, and every harness run prints these counts. ADR-014 D1
says only human rows count for the gate; at L0 there are none, so the bar is measured on derived
and agent grades and the run says so in those words. A human pass over the 797 agent rows is owed
(docs/DEBT.md, 2026-09-26).

Rules worth knowing before disagreeing with a grade: a sold out everywhere product fails any price
ceiling (it has no in stock price); a product of the right brand and sport but another noun is 1;
kids query plus adult item loses one grade, a skill level two steps away (beginner against
advanced) is 0; "sasta" keeps only the cheapest third at 3; a link only venue is 2 for an untimed
query and 1 for a query that names a day or time; a venue outside the place's radius is 1.

## Running it

```
export PATH=/opt/homebrew/bin:$PATH
supabase status                                    # the local stack is up
node scripts/seed-demo-users.mjs                   # partner@atlitos.dev owns the fixture venues
node scripts/seed-search-eval.mjs                  # the fixture, idempotent
supabase functions serve --env-file <file with ANTHROPIC_API_KEY= and VOYAGE_API_KEY= empty>

node scripts/verify-search-eval.mjs                # thresholds, exit 1 on any miss
node scripts/verify-search-eval.mjs --baseline-diff   # 0 id changes expected for a refactor
node scripts/verify-search-eval.mjs --degraded        # the lexical floor, vector=false asserted
node scripts/verify-search-eval.mjs --class gear_typo # one class
apps/portal-court/node_modules/.bin/tsx scripts/lib/search-eval-metrics.test.ts
```

The stack is shared. Any active affiliate product or verified venue outside the fixture shows up in
results and counts as an unjudged hit; the run prints how many exist under `sharing`. For a clean
measurement, and always for `--baseline-diff`, run on the catalogue state the baseline was recorded
on (fixture only: no `seed_p2.sql` venues, no `seed-affiliate-catalog.mjs` products, no rows left
behind by other verify scripts). `baseline.json` records the sharing counts it was taken with.

## Embeddings

```
# ~/.config/atlitos/voyage.env holds VOYAGE_API_KEY=...
node scripts/seed-search-eval.mjs
node scripts/search-eval-embed.mjs --check     # key and fixture present, no network call
node scripts/search-eval-embed.mjs             # writes fixtures/embeddings.b64.json
```

The harness loads product vectors into `affiliate_products.embedding` (fixture rows only) and query
vectors into `query_embedding_cache` right before each run, and refuses a blob whose `model` differs
from `VOYAGE_MODEL` (default `voyage-3`). Regenerate whenever the model changes. With no blob, the
harness clears any embedding on fixture rows (a stub vector measured as real geometry would lie) and
says how many it cleared.
