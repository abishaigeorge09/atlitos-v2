# ADR-014: Search accuracy as a measured bar, courts and gear as link businesses, and location as a place

Status: Proposed. Blocks on the founder answers in Open questions 1 and 2 only for Phase L3
(location); every other decision is implementable on the current stack with no new vendor.

Date: 2026-09-26. Relates to `docs/PLAN-SEARCH-LOCATION-AFFILIATE.md` (the phased plan this ADR
is the architecture for), ADR-011 (hybrid search, ingest, health), ADR-013 (bulk catalogue
entry, review before live), migrations `0133` to `0136`, `supabase/functions/ai-search/*`,
`apps/mobile/src/store/location-store.ts`.

## Context and Problem Statement

The founder's instruction, verbatim: "keep working on the location and the AI Search till its not
perplexity level accuracy of the products, we have converted our strategy to affiliate links/links
for both gear and COURT. with the best UI/UX experience from selecting location or address to
searching and to showing options. Every scenario plan it."

Three problems sit inside that sentence.

1. **"Perplexity level accuracy" is not a number.** Nothing in the repo can say whether search
   got better or worse after a change. `scripts/verify-ai-search.ts` proves a handful of
   deterministic cases against a 12 row pool; `verify-gear-recall.mjs` proves recall at 500
   rows; `verify-court-search-e2e.mjs` proves the time parser end to end. None of them grades
   relevance, none measures ordering, and none can fail because a ranking change made the third
   result worse. Without a graded evaluation set and a harness that gates merges, "done" can
   never be proven, which the house rule forbids.
2. **Both verticals are now outbound link businesses, and courts are only half built for it.**
   Gear already leaves through `record_affiliate_click` (0133). Courts have
   `venues.booking_url` (0120) but nothing reads it: `search_court_slots` (0134) only returns
   courts that carry in app availability windows, so a venue that books on its own site or on a
   third party is invisible to search, the court detail still shows only the in app slot picker,
   and no court click is recorded (`docs/DEBT.md`, 2026-09-17).
3. **Location is a status, not a place.** `location-store.ts` resolves to one of six statuses
   and a city string. There is no way to name an area, type an address, reuse a saved address,
   or change location mid search; a shopper far from every venue is sorted from a fixed
   Hyderabad point.

Constraints that shape every decision: never invent a product, price, rating, availability or
count; 10,000 users and a database in ap-south-1 with a measured 4.5 to 8 s per keystroke
before the September latency work; no affiliate programme is approved yet
(`retailer_programmes.affiliate_tag_template` is null for all three); the production catalogue
is 8 seed products with fabricated ASINs; parallel builders share one local Postgres.

## Decision Drivers

- Verify, never assert. A quality bar the harness cannot fail is not a bar.
- Every answer text, price and count must be traceable to a row Atlitos holds.
- Latency is correctness at 10,000 users. Budget per stage, degrade in a fixed order.
- Reuse the shapes already trusted here: spend guard, `audit_log`, `has_role` SECURITY DEFINER
  RPCs, the `affiliate_clicks` pattern, `app_config`, the honesty gate.
- Prefer the boring option. No new search vendor, no new database, no paid geocoder unless the
  founder chooses one (Open question 1).
- RLS is a floor. Every new read carries its own explicit filter; every new user owned table
  names its ownership column.
- The fixture catalogue that measures the bar never reaches production.

## Considered Options

1. **Measured bar plus targeted upgrades to the existing function** (chosen): a committed
   evaluation set with graded judgments, a fixture catalogue with committed real embeddings, a
   harness that computes NDCG and constraint precision and gates merges; lexical fusion, fuzzy
   and Hinglish understanding, comparison intent, a deterministic grounded answer layer;
   link venues in court search with their own click table; a place model for location built on
   on device geocoding and venue derived localities.
2. **Do nothing further to ranking; ship the courts link and the location picker only.** Keep
   `verify-ai-search.ts` as the proof, keep the additive four signal score, keep the city
   string location model.
3. **Replace retrieval with a managed AI search product** (Algolia NeuralSearch, Typesense
   Cloud, Vertex AI Search) and a paid geocoding API (Google Places) for every location input.
4. **Put an LLM on the request path for every query**: Claude parses, retrieves via tool calls
   and writes the answer, Perplexity style, with citations extracted from its output.

## Decision Outcome

Chosen: **1**. Each decision below names its alternatives and its own Confirmation; all are
collected in the top level Confirmation section.

### D1. The bar is a committed evaluation set, graded judgments and a gating harness

Files under `docs/search-eval/`:

- `queries.jsonl`: one line per query. `{ id, query, surface: "shop" | "courts" | "home",
  scenario, entityTypes, override?: { sport?, priceMax? }, place?: { lat, lng, city } | null,
  expect: { kind: "results" | "empty", broadenMentions?: string[], minResults?: number,
  courtPredicate?: "slots_in_window" | "link_after_slots" | "nearest_first" } }`.
- `judgments.jsonl`: `{ queryId, entity: "gear:affiliate:<fixture id>" | "court:<fixture id>",
  grade: 0 | 1 | 2 | 3, judgedBy: "human" | "llm", note }`. Only `human` rows count for the
  gate; `llm` rows are advisory candidates awaiting confirmation.
- `fixtures/embeddings.b64.json`: real `voyage-3` embeddings for every fixture product and
  every query, float32 base64, tagged with the model name. Generated once by
  `scripts/search-eval-embed.mjs` with a real key, committed, regenerated only when
  `VOYAGE_MODEL` changes (the harness refuses a tag mismatch).
- `baseline.json`: the harness's last accepted per query result ids and metrics, so a
  ranking change shows as a diff, not only as a threshold.

The fixture catalogue is `supabase/seed/local_seed_search_eval.sql` (60 gear products,
150 offers, 12 venues with courts, windows, one link only venue, one venue with both), applied
by `scripts/seed-search-eval.mjs`, which calls `assertWritableTarget` so it can never run
against production. Fixture ids live in the `e0000000-` uuid range; every URL is on
`example.test`. Committed embeddings are loaded into `affiliate_products.embedding` and, for
the queries, into `query_embedding_cache` immediately before each run, so the vector path runs
on real Voyage geometry with no key and no network (`recallByVector` reads the cache first and
never calls `embedTexts` on a fresh cache row).

Metrics, computed by `scripts/lib/search-eval-metrics.mjs` and reported per scenario class and
overall by `scripts/verify-search-eval.mjs`:

| Metric | Definition | Gate |
|---|---|---|
| Constraint precision | share of returned hits that satisfy every parsed hard constraint (brand, price ceiling against cheapest in stock offer, sport, entity type) | 1.00, overall and per class |
| NDCG@10 | graded gain `2^grade - 1`, log2 discount, ideal from human judgments; unjudged hit counts 0 | >= 0.85 overall, >= 0.75 every class |
| P@5 | judged grade >= 2 among the top 5, browse classes only | >= 0.80 |
| Hit@1 | top result has grade 3, specific item classes (brand plus model, venue name) | >= 0.90 |
| Recall@5 | share of grade 3 items in the top 5, typo and Hinglish classes | >= 0.80 |
| Honest empty accuracy | `expect.kind = empty` queries return zero results and a `broaden` naming every `broadenMentions` term; `expect.kind = results` queries never return empty | 1.00 |
| Court window accuracy | every court hit with a `slot` has date and start inside `parsedIntent.when`, price within any ceiling; link hits follow slot hits when `hasTime` | 1.00 |
| Answer grounding | every numeric token in `answer.text` equals a field on a cited row; every citation id is in `results` | 1.00 |
| Unjudged rate | share of top 10 hits across the set with no human judgment | <= 0.10 |
| Degraded floor | the whole set re-run with `ai_spend_daily` forced over budget (no vector, no rerank) | NDCG@10 >= 0.70, constraint precision 1.00 |

Class thresholds exist so one strong class cannot hide a weak one. The unjudged rate is what
makes the set grow with the catalogue: a new product that starts appearing in top 10 results
fails the gate until a human grades it. `scripts/search-eval-harvest.mjs` pulls the most
frequent and the zero result queries from `search_query_log` (D4) into
`docs/search-eval/candidates.jsonl`; `scripts/search-eval-judge.mjs` proposes grades for
unjudged pairs with Claude Haiku and writes them as `judgedBy: "llm"`, never `human`. The
human confirms by editing the row. This follows the LLMJudge finding that LLM judges label
about 26% more documents as perfectly relevant than humans do, so an LLM grade is a proposal,
not a verdict (Arabzadeh et al., SIGIR 2025; Rahmani et al., LLMJudge 2025).

Production latency is measured separately by `scripts/probe-search-latency.mjs` (anon key,
read only, 20 queries times 3 runs, typing and submit paths, p50 and p95, JSON to
`docs/qa/evidence/search/latency-<date>.json`). It is a phase gate, not a merge gate, because
a merge gate must not depend on the network.

Alternatives: grading by hand only, rejected because it cannot keep up with a growing
catalogue; grading by LLM only, rejected on the over labelling evidence above; measuring on
production data, rejected because production holds 8 fabricated products and the bar must be
provable today without shipping fake data; a stub embedding for the vector path, rejected
because the sha256 stub has no semantics and would measure nothing.

**Confirmation**: `scripts/verify-search-eval.mjs` exits 1 on any threshold above; it is
born red by running it before Phase L1 lands (the current scorer fails NDCG on the typo and
Hinglish classes and answer grounding has no `answer` field to check).
`scripts/verify-search-eval.mjs --baseline-diff` prints the per query id diff against
`baseline.json`. `scripts/seed-search-eval.mjs` refuses a non local target (planted:
`SUPABASE_URL=https://syzzfgaudpifwvbpycyi.supabase.co` must exit 1 before any write).

### D2. Query understanding stays deterministic first; fuzzy, Hinglish and comparison intent are added to it

`search-core.ts` keeps `parseIntent` as the single parse on the request path. It gains:

- `lexicon.ts`: a curated map of Hinglish and colloquial tokens to canonical ones
  (`joota`, `juta` to shoe; `gend` to ball; `sasta` to a cheapness flag that sorts price
  ascending; `bachon`, `bacche`, `bachcha`, `kids`, `junior` to `ageGroup: "kids"`; `ke liye`,
  `chahiye`, `wala` dropped as filler). Pure data, no network, unit tested by the harness's
  Hinglish class.
- Fuzzy tokens through Postgres: migration `XXXX_search_fuzzy_vocabulary.sql` enables
  `pg_trgm`, adds `search_vocabulary (term text primary key, kind text check (kind in
  ('brand','noun','title')), weight real)` maintained by a trigger on `affiliate_products`
  (brand and title tokens) plus a seeded noun list, and `search_fuzzy_terms(p_terms text[])
  returns table (input text, term text, kind text, similarity real)` using `similarity()`
  with a 0.4 floor and at most 2 expansions per input. Called only for tokens that produce
  zero FTS matches, so a correctly spelled query costs nothing extra.
- Comparison intent in `parseIntent`: `cheaper than X`, `under the price of X`, `like X`,
  `similar to X`, `alternative to X`. `X` is resolved by `search_affiliate_product_ids` to
  one product (top rank, must clear a title match); `cheaper than` sets `priceMax` to that
  product's cheapest in stock price minus one and keeps its sport; `like` and `alternative`
  set `anchorProductId`, and recall uses `match_affiliate_products` with the anchor's own
  embedding (no Voyage call), excluding the anchor. An unresolved `X` yields the honest
  broaden `We do not list "<X>", so we cannot compare against it.`
- Locality tokens for court queries: tokens that match `localities` (D6) become
  `place: { lat, lng, label, radiusKm: 8 }` and leave the keyword list, the same way time
  words already do.

Claude parses intent only on the submit path (`rerank: true`), only when the deterministic
parse is low confidence (no sport, no noun, no brand, and three or more content keywords),
with a 1,200 ms timeout, and cached 24 hours by query hash in `query_parse_cache` (service
role only, same shape as `query_embedding_cache`). The merge is over, never replacing:
Claude may add `sport`, `nounHint`, `skillLevel`, `ageGroup`; it may not add a brand the
deterministic pass did not see (a hallucinated brand would become a hard constraint).

Alternatives: an LLM parse on every request, rejected on the 2 s production measurement that
removed it on 2026-09-19; a fuzzy match inside the edge function over an in memory vocabulary,
rejected because the vocabulary is the catalogue and lives in Postgres already;
Elasticsearch style fuzzy queries, rejected as a new vendor for one feature `pg_trgm` covers.

**Confirmation**: `scripts/verify-search-fuzzy.mjs`: `yonx racket` recalls the Yonex fixture
rackets with `parsedIntent.brand = "yonex"`; `sasta badminton racket bachon ke liye` parses to
sport badminton, noun racket, ageGroup kids, cheap flag; `cheaper than <fixture title>` returns
only products priced strictly below that fixture's cheapest in stock offer and none of the
anchor; `like <fixture title>` excludes the anchor and returns only its sport; a planted
`search_vocabulary` row with `similarity < 0.4` to the input is never expanded to. The
Hinglish and typo classes of `verify-search-eval.mjs` carry the thresholds.

### D3. Ranking fuses lexical rank and vector similarity by reciprocal rank fusion, then applies constraints and boosts

Today `scoreCandidates` uses a substring hit fraction for text and discards the
`ts_rank_cd` that `search_affiliate_product_ids` already computes. New `rank.ts`:

1. Two ranked lists per gear query: FTS order from `search_affiliate_product_ids` (rank
   carried through `fetch-gear.ts`) and vector order from `match_affiliate_products`.
2. RRF with `k = 60`: `score = sum(1 / (k + rank_i))` over the lists a candidate appears in.
3. Hard constraints (`passesHardConstraints`, unchanged semantics) remove, never demote.
4. Boosts, additive and bounded: skill match plus 0.05, age group match plus 0.05, in stock
   somewhere plus 0.05, sold out everywhere minus 0.15, cheapness flag sorts by cheapest in
   stock price within equal RRF buckets, more than one in stock retailer plus 0.02.
5. `rankReason` names the top real contributor, as today; a vector only hit keeps
   `similar to your query`.
6. Optional Claude rerank over the top 8 on submit only (exists, unchanged).

Courts are not fused: they are answered from `search_court_slots` (soonest first when timed,
nearest first when not) and, from D5, link venues are appended by distance.

Alternatives: keep the four signal additive score, rejected because rating and distance are
neutral for gear and the text term is a substring fraction that cannot tell "Yonex Astrox 99
Pro" from a description that mentions Yonex once; learn a ranker, rejected until there are
enough judged queries to fit anything; weight tuning by hand, rejected because RRF needs no
weights and the harness would only be tuning to itself.

**Confirmation**: the Hit@1, P@5 and NDCG thresholds in `verify-search-eval.mjs`, plus
`--baseline-diff` reviewed at merge; `verify-gear-recall.mjs` (exists) still passes, which
proves fusion did not lose exact match recall on 500 rows.

### D4. A grounded answer is a template over rows, and every number in it is checked mechanically

`SearchResponse` gains `answer?: { text: string; citations: Array<{ entityType, entityId,
offerId?: string }> }`. `answer.ts` builds it deterministically, only when the parse carried a
constraint that makes a one line answer meaningful (brand, price ceiling, comparison anchor,
or a court time window), and never on a plain browse:

- Gear, results: `Cheapest {brand} {noun} under ₹{ceiling} we list: {title}, ₹{price} at
  {retailer}, checked {n} h ago.` Every field is read from the cited product and offer rows.
- Gear, empty: the existing broaden line, already grounded, moves into `answer.text` with
  the cited alternative when one exists.
- Courts, timed: `{count} venues have a free {sport} court {label}. Soonest: {venue} at
  {time}, ₹{price}.` where `count` is the number of slot hits returned.

No LLM writes the answer in this ADR. A future phrasing pass may rewrite the sentence only
if it passes the same grounding check, which is the mechanical rule below; it is not planned
here.

Also in this decision: `search_query_log (id, query text, surface text, entity_types text[],
result_count int, empty boolean, mode text, vector boolean, latency_ms int, created_at)`, no
user id, written by `ai-search` under the service role off the response path
(`EdgeRuntime.waitUntil`), RLS on with zero policies, read only through
`admin_search_query_stats(p_days)` (`has_role('admin')`), pruned to 30 days by a
`pg_cron` job in the same migration (`pg_cron` is installed in production;
`expire-stale-holds` already runs on it). This is the only way the evaluation set can grow
from real questions rather than invented ones.

Alternatives: an LLM written answer with citations extracted afterwards, rejected because a
number that is not in a row cannot be caught by reading prose; no answer at all, rejected
because a compare grid alone does not say which one is cheapest under the ceiling, which is
the question the shopper asked; storing the user id in the query log, rejected, the eval set
needs queries, not people.

**Confirmation**: `scripts/verify-search-answer-grounding.mjs`: for every query in the eval
set with an `answer`, tokenises the numbers in `answer.text` and asserts each equals a field on
a cited row (`price`, `count`, hours since `last_checked_at` rounded the same way), and that
every `citations[i].entityId` is in `results`; planted: a template edit that adds `+1` to the
price must fail. `scripts/verify-search-query-log.mjs`: a search writes one row with no
`user_id` column at all (asserted via `information_schema.columns`), anon and authenticated
`select` are refused, `admin_search_query_stats` is `FORBIDDEN` for a non admin, and a row
older than 30 days planted with `created_at = now() - interval '31 days'` is gone after the
cron function `prune_search_query_log()` is called directly.

### D5. Courts under the link strategy: link venues are search candidates, every court click out is recorded, and admins can set the link on an existing venue

Migration `XXXX_venue_link_search.sql`:

```sql
create or replace function public.search_venues_by_link(
  p_sport public.sport default null, p_city text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_radius_km double precision default null, p_terms text[] default null, p_limit int default 20
) returns table (venue_id uuid, venue_name text, city text, address text, booking_url text,
                 booking_host text, sports public.sport[], distance_km double precision,
                 has_slots boolean)
-- security definer, stable; verified venues with booking_url not null; sport filtered through
-- courts; has_slots = exists a court_availability_windows row for any court of the venue;
-- p_terms matched with ilike against venue name; ordered by distance nulls last, name.
```

`admin_set_venue_booking_url(p_venue_id uuid, p_url text)`: `has_role('admin')`, same
`^https?://` check as `admin_create_venue`, audited (`venue.booking_url_set`), null clears.

Migration `XXXX_venue_booking_clicks.sql`: `venue_booking_clicks (id, venue_id, user_id,
surface check in ('search','detail','home'), target_url, created_at)`, RLS on, zero
policies, service role grant only; `record_venue_booking_click(p_venue_id, p_surface)`
returns `{ click_id, url, recorded }` with the exact 0133 semantics (no session: plain URL,
nothing written; 10 second dedupe per user and venue; `NOT_FOUND` for an unverified venue or
a null link); `admin_venue_click_stats(p_days)`. A separate table rather than widening
`affiliate_clicks`, because that table's foreign keys are offer and product and a nullable
pair of FKs with a check constraint is the kind of shape that passes review and fails in
an aggregate.

`ai-search/fetch-courts.ts` merges: slot hits first (unchanged), then link venues not already
present as a slot hit, each a `Candidate` with `booking: { url, host }` and no `slot`,
`rankReason: "Availability on <host>"`. For a timed query, link venues are appended after
every slot hit and the response carries `courts: { slotVenues: n, linkVenues: m }` so the
client can head the second group honestly. For an untimed query the two groups interleave
by distance. A venue with both carries both `slot` and `booking`. The broaden line for an
empty court search names a link venue when no slot venue exists in range.

Client: `Court` gains `bookingUrl: string | null`; `useCourts().bookingUrlForVenue(venueId,
surface)` calls the RPC and falls back to the stored URL; `CourtSlotResult` gets a link
variant; the court detail shows the in app picker when the venue has windows, the external
button when it has only a link, and both when both. The external button copy is
`Book on <host>`; the disclosure line is `You book on <host>'s site.` No commission claim,
because no court programme exists.

Alternatives: hide link venues from search until they have in app windows, rejected because
that is the strategy the founder just reversed; put `booking_url` on `courts` rather than
`venues`, rejected because the link is the venue's booking page (0120 already chose
`venues`); one generic `outbound_clicks` table with a polymorphic `target_kind`, rejected for
the FK reason above.

**Confirmation**: `scripts/verify-venue-link-search.mjs`: a verified venue with
`booking_url` and no windows is returned by `search_venues_by_link` and by `ai-search` with
`booking.host` set and no `slot`; a `pending` venue with a link is never returned (planted);
for `badminton tonight after 7` every hit with `slot` precedes every hit without one; an
untimed query orders both kinds by `distance_km`. `scripts/verify-venue-clicks.mjs`: the
0133 assertions rewritten for venues, including two distinct shopper ids asserted different
before any dedupe assertion, no session records nothing, a shopper cannot `select` or
`insert`, an admin cannot read raw rows, `admin_venue_click_stats` matches the raw count.
`scripts/verify-court-search-e2e.mjs` gains cases 5 and 6 for the two orderings.

### D6. Location is a Place, resolved from GPS, a locality derived from venues, an on device geocoded address, or a saved address

`location-store.ts` becomes a place store with one shape:

```ts
export type PlaceKind = 'gps' | 'city' | 'locality' | 'address' | 'saved' | 'fallback';
export interface Place {
  kind: PlaceKind;
  label: string;          // "Kondapur, Hyderabad", "Plot 12, Jubilee Hills", "Hyderabad"
  city: string;
  lat: number | null;     // null for kind 'city' and 'fallback' when no coords are honest
  lng: number | null;
  radiusKm: number;       // 8 for locality and address, 25 for gps, 50 for city, 50 fallback
  source: 'device' | 'profile' | 'user' | 'default';
}
```

Statuses stay (`idle | loading | granted | denied | unavailable | manual`) and keep their
deadlines; `manual` now carries a full `Place`. The place persists in AsyncStorage
(`atlitos.place.current`) and the last five user chosen places in `atlitos.place.recent`.
Distances are shown only for `gps`, `locality`, `address` and `saved` (kinds with honest
coordinates) and are labelled `from <label>` when the kind is not `gps`.

Sources of candidate places, in the picker:

1. Device location (the existing three deadlines).
2. Localities: migration `XXXX_venue_localities.sql` adds `venues.area text` (admin entered,
   nullable, `admin_create_venue` and `admin_set_venue_area` gain it) and a view
   `localities (city, area, lat, lng, venue_count)` over verified venues with coordinates,
   exposed through `list_localities(p_city text default null, p_query text default null)`
   (anon and authenticated; `p_query` matched with `ilike` and trigram similarity) and
   `nearest_locality(p_lat double precision, p_lng double precision)` (the closest row of the
   view with its distance, used by the web client that has no reverse geocoder and by the far
   away copy). Only places that actually have venues appear, which is honest: an area with no
   venues is answered by the nearest venue rule, not by an empty list.
3. Address: `expo-location`'s `geocodeAsync` on device (Apple and Google geocoders under the
   hood), deadline 6 s, up to 5 candidates. Not available on web; the web picker offers 1, 2
   and 4 only and says so.
4. Saved addresses: `addresses` gains nullable `lat`, `lng` (migration `XXXX_addresses_geo.sql`),
   filled by the picker when a signed in user saves a place. `addresses` is user owned,
   ownership column `user_id`, RLS unchanged; the picker reads it with an explicit
   `.eq("user_id", user.id)`. Guests see a sign in prompt in that section and their recent
   places instead.

Far from everything: when the nearest court hit is beyond `place.radiusKm`, the courts screen
and the court broaden say `No courts within {radius} km of {label}. Nearest is {venue} in
{city}, {n} km away.` with a `Search in {city}` action that sets a `city` place.
`search_court_slots` and `search_venues_by_link` receive `p_radius_km` from the place; the
existing 3,000 km implausibility rule stays as the last guard.

Gear never reads the place: offers ship nationally and the shop shows no location row.

Alternatives: Google Places Autocomplete for every input, deferred to Open question 1 (a
paid key on the client, a new dependency, and it does not work offline; on device geocoding
is free and already in the bundle); a bundled pincode dataset, rejected at 150,000 rows for
an app bundle; storing places in a new `saved_places` table, rejected because `addresses`
already is the user's saved address book and a second table would drift from it.

**Confirmation**: `scripts/verify-location-store.ts` (tsx, the store against a stubbed
`expo-location`, the same harness shape proven on 2026-08-14 and now kept): thirteen
assertions for the status machine plus: a `locality` place carries the view's centroid; a
`city` place has null coordinates; `setPlace` clears stale coordinates; recent places cap at
five. `scripts/verify-localities.mjs`: the view lists only verified venues with coordinates
(planted: a pending venue with an area must not appear), `list_localities('Hyd')` matches
`Hyderabad`, a locality's centroid equals the average of its venues' coordinates, and
`nearest_locality` for a point 200 m from a fixture venue returns that venue's locality.
`scripts/verify-addresses-geo.mjs`: two users with asserted different ids; user A cannot read
user B's address with coordinates; a `lat` without `lng` is refused by the check constraint.
Device: `.maestro/native-location-*.yaml` flows driven with `xcrun simctl location`, per
`docs/PLAN-SEARCH-LOCATION-AFFILIATE.md` section 6.

### D7. Latency budget per stage and the degradation order

Measured on production 2026-09-19: 4.5 to 8.0 s per keystroke before the fixes, 0.3 s for a
plain REST read from the same client. The budget, at the edge in ap-south-1:

| Stage | Budget | Runs when | On overrun |
|---|---|---|---|
| Deterministic parse plus lexicon | 5 ms | always | n/a |
| Spend gate RPCs (parallel with reads) | 300 ms | query >= 3 chars | keyword mode |
| FTS recall `search_affiliate_product_ids` | 80 ms | gear | error to client (data path) |
| Fuzzy expansion `search_fuzzy_terms` | 60 ms | only for zero match tokens | skip expansion |
| Query embedding cache read | 30 ms | gear, >= 3 chars | skip vector |
| Voyage embed (uncached only) | 400 ms, abort at 800 | gear, gate allowed | skip vector, `vector: false` |
| `match_affiliate_products` | 60 ms | vector | skip vector |
| `search_court_slots` | 300 ms (60 courts times 14 days cap) | courts | error to client |
| `search_venues_by_link` | 60 ms | courts | courts without link venues |
| Hydrate gear rows | 80 ms | gear | error to client |
| Fusion, constraints, answer template | 5 ms | always | n/a |
| Claude parse (submit, low confidence, uncached) | 1,200 ms abort | submit only | deterministic parse |
| Claude rerank over top 8 | 2,000 ms abort | submit only | deterministic order |
| Query log, cache writes, spend records | off path | always | dropped |

Targets: typing path (`rerank: false`) p95 <= 1,200 ms at the edge and <= 1,500 ms at an
Indian client; submit path p95 <= 3,500 ms. Degradation order when over budget or on
failure: rerank, then Claude parse, then Voyage, then fuzzy expansion, then everything else
is a data path and returns an error the client renders with retry. The client keeps the
previous grid on screen during a typing search (exists), shows `Still searching` at 3 s, and
the `packages/api` 15 s deadline yields the error state with retry.

Alternatives: caching whole result pages by query hash, rejected because court availability
changes by the minute and a cached gear page would show a price the nightly check has since
changed; moving search into Postgres entirely, rejected because the vector call and the
rerank are external anyway.

**Confirmation**: `scripts/probe-search-latency.mjs` against production at each phase gate
(section 6 of the plan states which); locally, `verify-search-eval.mjs` records per query
wall time and fails a query over 3,000 ms on the local stack as a regression signal, not as
the production number.

### D8. Migration numbering

Per `docs/BRANCHING.md` rule 4, files are `XXXX_<name>.sql` on a branch and take the next free
number at merge. Highest on `main` is `0136`; `0130` and `0131` are owned by
`release/ios-2026-09-23` in the production ledger and must not be reused. One concern per
file:

| Provisional file | Phase | Contents |
|---|---|---|
| `XXXX_search_fuzzy_vocabulary.sql` | L1 | `pg_trgm`, `search_vocabulary`, trigger, `search_fuzzy_terms` |
| `XXXX_query_parse_cache.sql` | L1 | `query_parse_cache`, service role only |
| `XXXX_search_query_log.sql` | L1 | `search_query_log`, `admin_search_query_stats`, `prune_search_query_log`, cron |
| `XXXX_venue_link_search.sql` | L2 | `search_venues_by_link`, `admin_set_venue_booking_url` |
| `XXXX_venue_booking_clicks.sql` | L2 | `venue_booking_clicks`, `record_venue_booking_click`, `admin_venue_click_stats` |
| `XXXX_venue_localities.sql` | L3 | `venues.area`, `localities` view, `list_localities`, `nearest_locality`, `admin_set_venue_area`, `admin_create_venue` gains `p_area` |
| `XXXX_addresses_geo.sql` | L3 | `addresses.lat`, `addresses.lng`, paired check |
| `XXXX_search_facets.sql` | L4 | `list_search_facets()` (brands, sports, categories with live counts) |

Expected numbers at merge, in this order: `0137` to `0144`. Parallel builders share one local
Postgres, so each track applies only its own `XXXX_` files with `psql` after `db reset` and
names them in its handoff; a track never applies another track's file.

## Consequences

Good:

- "Perplexity level" becomes ten numbers with thresholds, a diff against a baseline, and a
  fixture that never touches production. A ranking change that makes result three worse fails
  a merge.
- Every price, count and hour in an answer is checked against a row by a script, so the
  honesty rule is enforced by a gate rather than by copy review.
- Courts and gear share one click out pattern (definer function, zero policy table, admin
  aggregate), so the second one was proven by the first.
- Location is one shape across GPS, area, address and saved address, with distances shown
  only when the coordinates are honest.
- No new vendor. `pg_trgm` and `pg_cron` are already in the Supabase image; on device
  geocoding is already in the bundle.

Bad:

- The eval set is only as good as its judgments, and judging is human work that never ends;
  the unjudged rate gate will block merges when the catalogue grows faster than grading. That
  is the intended pressure, and it is still a cost.
- Committed embeddings (about 1 MB of base64) are a binary blob in git that must be
  regenerated whenever the embedding model changes, or the vector path is measured on stale
  geometry. The model tag check catches a mismatch but not a silently drifted model version
  under the same name.
- `pg_trgm` expansions can pull in a wrong brand for a very short token; the 0.4 floor and
  the zero FTS match precondition limit it, and the typo class of the eval measures it.
- A raw query log is free text a shopper typed; it carries no user id but could carry what a
  shopper chose to type. Thirty day retention and admin only aggregates are the mitigation,
  and the privacy page needs one line (Open question 2).
- Link venues in a timed search cannot promise availability. Placing them after slot venues
  with an explicit heading is honest but it is also a second group the eye has to parse;
  the design gate has to judge it.
- On device geocoding is unavailable on web and its quality varies by platform; the web
  picker is honestly narrower, which is a real gap for the web app.
- `search_court_slots` is still courts times days function calls; adding a radius shrinks
  the candidate set but a city with 300 courts will need the bounding box index that
  `SCALE-CLIENT.md` P2 already names. Not solved here.

## Confirmation

1. `scripts/verify-search-eval.mjs` (D1, D3): thresholds table, `--baseline-diff`, the
   degraded floor run, per query wall time; born red before L1.
2. `scripts/seed-search-eval.mjs` refuses a production target (D1): planted
   `SUPABASE_URL=https://syzzfgaudpifwvbpycyi.supabase.co`, exit 1, zero writes.
3. `scripts/verify-search-fuzzy.mjs` (D2).
4. `scripts/verify-search-answer-grounding.mjs` (D4): planted `+1` on a price must fail.
5. `scripts/verify-search-query-log.mjs` (D4): no `user_id` column, refused reads, prune.
6. `scripts/verify-venue-link-search.mjs` and `scripts/verify-venue-clicks.mjs` (D5);
   `scripts/verify-court-search-e2e.mjs` cases 5 and 6.
7. `scripts/verify-location-store.ts`, `scripts/verify-localities.mjs`,
   `scripts/verify-addresses-geo.mjs` (D6).
8. `scripts/probe-search-latency.mjs` (D7) at the L1, L4 and L5 gates, JSON committed under
   `docs/qa/evidence/search/`.
9. `scripts/verify-search-facets.mjs` (D8, the facets migration): every count equals a live
   `count(*)` over the public predicate; a delisted product is not counted; anon can call.
10. `scripts/security-invariants.sh` gains three checks, each born red: `no-fake-affiliate-tag`
    (no `atlitos-21` or any `tag=` literal in `scripts/`, `supabase/seed/`, `docs/search-eval/`;
    fails today on `scripts/seed-affiliate-catalog.mjs`), `search-log-no-user` (a SQL
    invariant: `search_query_log` has no column named `user_id`), and `clicks-zero-policy`
    (`pg_policy` has zero rows for `affiliate_clicks` and `venue_booking_clicks`).
11. `supabase db reset` replays every numbered migration clean (D8), run at every phase gate.

Every script is born red: plant the violation, watch it fail with its output recorded in
`docs/qa/verify/GATES-BORN-RED.md`, then make it pass.

## Pros and Cons of the Options

| Option | Good | Bad |
|---|---|---|
| **1 (chosen)**: measured bar, targeted upgrades, link venues, place model | Provable; no new vendor; reuses every trusted shape; degrades in a fixed order | Judging is ongoing human work; committed embeddings are a blob; link venues add a second result group |
| **2**: do nothing to ranking, ship links and picker only | Smallest diff; ships courts strategy fast | The founder's bar can never be shown met; typo and Hinglish queries keep returning empty; the answer stays a grid the shopper has to read |
| **3**: managed AI search plus paid geocoder | Vendor handles fuzzy, synonyms, typo tolerance and geocoding out of the box | Contradicts "no new database"; catalogue truth would be mirrored into a vendor index that can drift from `product_offers`; a client side Places key and a per request cost at 10,000 users; the spend guard would have a second budget to police |
| **4**: an LLM on every request path writing the answer | Closest to Perplexity's shape | 2 to 4 s per keystroke measured here; every number in prose is unverifiable without the exact grounding check D4 needs anyway; cost scales with keystrokes not with questions |

## Component design

### Component boundaries

| Component | Owns |
|---|---|
| `supabase/functions/ai-search/index.ts` | Request parsing, the gate, parallel reads, response assembly. After L0 it wires modules and holds no fetch code. |
| `ai-search/search-core.ts` (pure) | `parseIntent`, constraints, honesty gate, broaden copy, `Candidate` and `ScoredHit` types. Gains `booking?`, `anchorProductId?`, `ageGroup?`, `cheap?`, `place?`. |
| `ai-search/lexicon.ts` (pure, new) | Hinglish and colloquial token map. |
| `ai-search/rank.ts` (pure, new) | RRF fusion, boosts, `rankReason`. |
| `ai-search/answer.ts` (pure, new) | Grounded answer templates and citation assembly. |
| `ai-search/fetch-gear.ts` (new, moved) | FTS and vector recall, hydration, fuzzy expansion call. |
| `ai-search/fetch-courts.ts` (new, moved) | `search_court_slots`, `search_venues_by_link`, merge, court broaden. |
| `ai-search/fetch-people.ts` (new, moved) | Coaches, athletes, clips, unchanged behaviour. |
| `ai-search/llm.ts` | Claude parse (submit only, cached) and rerank. |
| `ai-search/parse-cache.ts` (new) | `query_parse_cache` read and write. |
| `ai-search/query-log.ts` (new) | `search_query_log` write, off path. |
| `packages/api/src/hooks.ts` `useSearch`, `useCourts` | Contract relay; `bookingUrlForVenue`. |
| `packages/types/src/domain/index.ts` | `SearchHit.booking`, `SearchResponse.answer`, `SearchResponse.courts`, `Court.bookingUrl`, `Place`. |
| `apps/mobile/src/store/location-store.ts` | The place store, deadlines, persistence. |
| `apps/mobile/src/lib/geocode.ts` (new) | On device forward and reverse geocoding with deadlines, platform gated. |
| `apps/mobile/src/app/location/pick.tsx` and `components/organisms/PlacePicker/*` (new) | The picker: device, localities, address, saved, recent. Design gate. |
| `apps/mobile/src/components/molecules/CourtSlotResult.tsx` | Slot, link, and both variants. |
| `apps/mobile/src/app/(tabs)/courts/court/[id].tsx` | Picker, external button, or both. |
| `apps/mobile/src/app/shop/index.tsx`, `home/search.tsx`, `(tabs)/courts/index.tsx` | Surfaces: suggestions, recent, answer strip, states. |
| `apps/admin/src/pages/venues/*` | Booking link and area on create and show. |
| `scripts/verify-*.mjs`, `scripts/lib/search-eval-metrics.mjs`, `docs/search-eval/*` | The bar. |

### Data model deltas and the security boundary

| Table or object | Change | Owned by | Read | Write |
|---|---|---|---|---|
| `search_vocabulary` (new) | term, kind, weight | system | service role and the definer RPC only | trigger on `affiliate_products`, seed |
| `query_parse_cache` (new) | query_hash pk, intent jsonb, created_at | system | service role only | `ai-search` service role |
| `search_query_log` (new) | id, query, surface, entity_types, result_count, empty, mode, vector, latency_ms, created_at; **no user column by design** | system | `admin_search_query_stats` only | `ai-search` service role; `prune_search_query_log` cron |
| `venue_booking_clicks` (new) | id, venue_id, user_id nullable, surface, target_url, created_at | system (operational) | `admin_venue_click_stats` only; RLS on, zero policies | `record_venue_booking_click` definer only |
| `venues` | `area text` nullable | partner (`partner_user_id`), unchanged RLS | public where `status = 'verified'` | `admin_create_venue`, `admin_set_venue_area`, `admin_set_venue_booking_url` |
| `localities` (view) | city, area, lat, lng, venue_count over verified venues | system | anon, authenticated via `list_localities` and `nearest_locality` | n/a |
| `addresses` | `lat`, `lng` nullable, `check ((lat is null) = (lng is null))` | **user owned, ownership column `user_id`**, RLS `user_id = auth.uid()` unchanged; every client read carries `.eq("user_id", user.id)` | own rows | own rows (existing policies) |
| `affiliate_products.embedding` | fixture load only, local | unchanged | unchanged column level grant (D6 of ADR-011) | service role |

Tables with a public browse policy that this ADR reads (`venues`, `courts`,
`affiliate_products`, `product_offers`) are read through RPCs that restate the public
predicate inside (`status = 'verified'`, `active`) or through client selects that carry it
explicitly, per CLAUDE.md. `addresses` is the one user owned table touched; its isolation
proof asserts two distinct user ids before asserting the refusal.

### Interface signatures crossing a component boundary

```ts
// ai-search request, unchanged fields plus:
POST /ai-search { query, entityTypes?, sport?, priceMax?, lat?, lng?, city?, radiusKm?, limit?, rerank? }

// ai-search response
interface SearchResponse {
  query: string;
  parsedIntent: ParsedIntent & { ageGroup?: 'kids' | 'adult'; cheap?: boolean;
                                 anchorProductId?: string; place?: { label: string; lat: number; lng: number; radiusKm: number } };
  results: SearchHit[];               // SearchHit gains booking?: { url: string; host: string }
  broaden?: string;
  answer?: { text: string; citations: Array<{ entityType: SearchEntityType; entityId: string; offerId?: string }> };
  courts?: { slotVenues: number; linkVenues: number };
  mode: 'llm' | 'keyword';
  vector: boolean;
}

// search-core.ts (pure)
export function parseIntent(query: string, override?: IntentOverride, now?: Date, localities?: LocalityIndex): ParsedIntent;
// rank.ts (pure)
export function fuseAndScore(args: { fts: RankedId[]; vector: RankedId[]; candidates: Candidate[]; intent: ParsedIntent }): ScoredHit[];
// answer.ts (pure)
export function buildAnswer(intent: ParsedIntent, hits: ScoredHit[], rows: HydratedRows): SearchResponse['answer'] | undefined;
// fetch-courts.ts
export async function fetchCourts(supabase, intent, place?: PlaceArg): Promise<{ candidates: Candidate[]; counts: { slotVenues: number; linkVenues: number } }>;
// llm.ts
export async function llmParseIntentCached(svc, query: string, base: ParsedIntent): Promise<Partial<ParsedIntent> | null>; // submit only, 1200 ms
// query-log.ts
export function logQuery(svc, row: { query; surface; entityTypes; resultCount; empty; mode; vector; latencyMs }): void; // waitUntil

// packages/api
useCourts(client).bookingUrlForVenue(venueId: string, surface: 'search' | 'detail' | 'home'): Promise<string>;
useLocalities(client).list(query?: string, city?: string): Promise<Locality[]>;
useLocalities(client).nearest(lat: number, lng: number): Promise<(Locality & { distanceKm: number }) | null>;
useAddresses(client).saveWithCoordinates(input: AddressInput & { lat: number; lng: number }): Promise<AddressRecord>;
```

```sql
search_fuzzy_terms(p_terms text[]) returns table (input text, term text, kind text, similarity real)   -- anon, authenticated
search_venues_by_link(p_sport, p_city, p_lat, p_lng, p_radius_km, p_terms, p_limit)                   -- anon, authenticated
record_venue_booking_click(p_venue_id uuid, p_surface text default 'detail') returns jsonb          -- anon, authenticated
admin_venue_click_stats(p_days int default 30) returns table (...)                                   -- authenticated, FORBIDDEN unless admin
admin_set_venue_booking_url(p_venue_id uuid, p_url text) returns venues                              -- admin
admin_set_venue_area(p_venue_id uuid, p_area text) returns venues                                    -- admin
list_localities(p_city text default null, p_query text default null) returns setof localities        -- anon, authenticated
nearest_locality(p_lat double precision, p_lng double precision) returns table (city text, area text, lat double precision, lng double precision, distance_km double precision) -- anon, authenticated
admin_search_query_stats(p_days int default 30) returns table (query text, searches bigint, empties bigint, avg_latency_ms int) -- admin
prune_search_query_log() returns int                                                                -- service role, cron
list_search_facets() returns jsonb                                                                   -- anon, authenticated
```

### Failure modes

| Failure | Behaviour |
|---|---|
| Voyage unreachable or over budget | vector skipped, `vector: false`, fusion runs on FTS only, answer still built |
| Claude parse times out or returns a brand | parse ignored; brand never merged from the LLM |
| Claude rerank fails | deterministic fusion order |
| `search_fuzzy_terms` errors | expansion skipped, exact tokens only |
| `search_venues_by_link` errors | courts answered from slots alone, `courts.linkVenues = 0` |
| `search_court_slots` errors | court search error to the client with retry (data path) |
| A venue's `booking_url` is unreachable | Atlitos opens it anyway; there is no fetch of court sites in this ADR, so no health outcome exists for venues (named non goal) |
| `record_venue_booking_click` fails | client opens the stored URL, nothing recorded (same as gear) |
| On device geocoder returns nothing | `No match for that address. Try an area or a city.` and the localities list |
| Reverse geocode fails after a GPS fix | coordinates kept, label from `nearest_locality` when within its radius, else `Your location`; distances still shown |
| Permission dialog unanswered 20 s | `unavailable`, retry offered, picker offered |
| Query log write fails | dropped, never surfaced |
| Committed embeddings tag != `VOYAGE_MODEL` | harness refuses to run and names the regeneration command |
| Fixture seed pointed at production | `assertWritableTarget` exits 1 before any write |

### Non goals

- LLM written answer prose; only templates in this ADR.
- Health checks or nightly fetches of court booking sites; no `gone` state for a venue link.
- Any commission or programme for court bookings; the link is plain.
- A bounding box or PostGIS index for courts (SCALE-CLIENT.md P2 stands).
- Personalised or per user ranking; the eval asserts a guest and a signed in user get the
  same result ids.
- Partner portal editing of `booking_url` or `area` (admin only here; PRD-03 would need an FR).
- Indoor or outdoor filtering: no column exists on `courts`; the plan treats the words as
  keywords and says so honestly (Open question 4).
- Pincode centroids, Google Places, and web forward geocoding.
- Coaches, athletes and clips ranking changes beyond keeping them working through the
  refactor; the eval carries smoke queries for them, not graded sets.

## Open questions

1. **Geocoder for full addresses.** On device (`expo-location.geocodeAsync`, free, no web)
   is the default here. If the founder wants address search on the web app, or a consistent
   candidate list across platforms, that is Google Places with a client key and a per request
   cost; it changes D6 and adds a dependency. Decide before L3.
2. **Search query log.** Thirty day retention of raw query text, no user id, admin aggregates
   only. Confirm, and confirm one line on the privacy page.
3. **Link venues in a timed search.** Shown after every slot venue under a heading
   `Also nearby, availability on their site`. Confirm this is wanted, or hide them from timed
   queries.
4. **Indoor or outdoor.** No data exists. Add `courts.indoor boolean` to admin entry, or
   leave it as a keyword that mostly returns the honest empty line?
5. **Design references** for the place picker and the answer strip, before L3 and L4
   (`docs/PLAN-SEARCH-LOCATION-AFFILIATE.md` section 5 marks the two gates).
