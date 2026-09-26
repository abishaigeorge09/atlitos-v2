# Plan: search accuracy to a measured bar, location as a place, gear and courts as link businesses

Single source of truth for this line of work. Architecture is
`docs/architecture/ADR-014-search-location-affiliate.md` (D1 to D8); this plan does not repeat
its reasoning, it cites decision ids. Anything not written here did not happen.

Status: DRAFT for the founder's Gate 2. Phase L0 can start on approval; L3 and L4 each carry a
design gate that needs founder references first (section 5).

Written 2026-09-26 against `main` at PR #20 (migrations to `0136`; `0130` and `0131` reserved by
`release/ios-2026-09-23`).

## 0. The founder's instruction and how this plan reads it

Verbatim: "keep working on the location and the AI Search till its not perplexity level accuracy
of the products, we have converted our strategy to affiliate links/links for both gear and
COURT. with the best UI/UX experience from selecting location or address to searching and to
showing options. Every scenario plan it"

Read as four commitments:

1. **Accuracy is a bar, not a feeling.** Section 1 defines it as ten metrics with thresholds,
   a committed evaluation set, and a harness that gates merges. "Done" is the harness green on
   the local fixture, then the same harness green on a human judged sample of the real
   catalogue once one exists.
2. **Gear and courts both end in a tracked outbound link.** Gear already does (0133). Courts
   get the same shape (ADR D5). In app court booking stays for venues that have windows; it is
   not removed.
3. **Location is a place the shopper chooses**: device, area, address, or a saved address, and
   it can change mid search (ADR D6).
4. **Every scenario is enumerated** with an expected behaviour and a check that can fail
   (section 2). If a scenario has no check, it is not planned, it is hoped.

Honesty up front: the production catalogue is 8 seed products with fabricated Amazon ASINs and
an unapproved tag. **The bar cannot be met on production data today.** It is met on a local
fixture catalogue that never ships (ADR D1), and then re-measured on the real catalogue as
ADR-013's data entry fills it. Nothing in this plan pads the catalogue to make a number look
better.

## 1. The bar: what "Perplexity level" means here, measurably

Perplexity's own pipeline is hybrid retrieval, a multi stage reranker, and an answer whose
citations are attached during generation rather than afterwards, so every claim points at a
source (ZipTie, "How Perplexity AI Answers Work"; LLM Pulse, "How Perplexity Works"). For a
catalogue of gear and courts the equivalent is: recall everything relevant (lexical plus
vector), order it so the best answer is first, refuse to pad, and make every sentence point at a
row. That is what the metrics below measure.

### 1.1 Evaluation set

`docs/search-eval/queries.jsonl`, one line per query, schema in ADR D1. Initial size: 160
queries, distributed so every scenario class in section 2 has at least 6 queries, the
gear classes at least 10. The ids in section 2 are the query ids.

`docs/search-eval/judgments.jsonl`: graded 0 to 3.

| Grade | Meaning, gear | Meaning, courts |
|---|---|---|
| 3 | exactly what was asked: right sport, right noun, every constraint met, best fit on skill and age | a venue with a free slot inside the window at or under any ceiling, or the named venue |
| 2 | right noun and sport, constraints met, weaker fit (adult racket for a kids query) | a venue with a slot in the window but at the top of the price range, or a link venue for an untimed query |
| 1 | related but not what was asked (shuttlecocks for a racket query) | a link venue for a timed query, or a slot venue outside the radius |
| 0 | wrong sport, wrong noun, violates a constraint, or off catalogue | wrong sport, no availability and no link, unverified |

**Who grades.** The first 160 queries are graded by hand against the fixture catalogue (the
fixture is small and its attributes are known, so grade 3 and grade 0 are derivable; grade 1
and 2 are judgment and are written with a `note`). Growth: `scripts/search-eval-harvest.mjs`
pulls frequent and zero result queries from `search_query_log` (ADR D4) into
`candidates.jsonl`; `scripts/search-eval-judge.mjs` proposes grades with Claude Haiku as
`judgedBy: "llm"`; only a human editing the row to `judgedBy: "human"` counts. The unjudged
rate gate (<= 10% of top 10 hits unjudged) forces grading to keep pace with the catalogue.

**Fixed clock.** Court queries carry no fixed clock because the edge function reads the real
clock; their expectations are predicates (slot inside `parsedIntent.when`, ordering) rather
than ids, and the fixture windows cover every day of the week 06:00 to 23:00 so "tonight" always
has slots except after 22:30 IST, when the harness skips the tonight cases and says so.

### 1.2 Fixture catalogue

`supabase/seed/local_seed_search_eval.sql`, ids `e0000000-…`, applied only by
`scripts/seed-search-eval.mjs` (refuses production). Composition, so every scenario has data
to be right or wrong about:

| Gear group | Count | Purpose |
|---|---|---|
| Badminton rackets: Yonex 6 (beginner to advanced, one junior), Li Ning 3, Victor 2 | 11 | brand, model, skill, age, typo (`yonx`, `lining`) |
| Tennis rackets: Babolat 4, Wilson 3, Head 2 (one junior 25 inch) | 9 | brand plus price, comparison anchors |
| Cricket bats: SG 4, Kookaburra 3 (one size 4 kids), Gray Nicolls 2 | 9 | Hinglish (`bachon ke liye`), multi word brand |
| Footballs: Nivia 3, Adidas 2, Cosco 2 | 7 | product type only, price only |
| Shoes: Asics 3 (indoor non marking), Nike 3 (court), Puma 2 (football) | 8 | vague need (`shoes for indoor court`), trap word `court` in a title |
| Shuttlecocks 3, tennis balls 2, cricket gloves 2, helmets 2, grips 2, bags 3 | 14 | noun coverage, related but wrong noun (grade 1) |
| Sold out everywhere 2 (one Yonex racket, one SG bat) | 2 | GEAR-12 |
| Total | 60 | |

Offers: 150 across `amazon_in`, `flipkart`, `decathlon_in` and a fourth retailer with no
programme row (`Tennis Hub`, plain URL): 12 products on one retailer, 30 on two, 14 on three,
4 on four; 9 products with one out of stock offer; every URL on `example.test`; no `tag=` on
any URL (the `no-fake-affiliate-tag` invariant). Price spread 199 to 21,990 so every ceiling in
the set splits the catalogue.

Venues: 12. Hyderabad 9 across areas Gachibowli, Kondapur, Madhapur, Jubilee Hills,
Kukatpally, Secunderabad, Uppal (two venues in Gachibowli); Bengaluru 3 (Koramangala,
Indiranagar, Whitefield). Sports: badminton 7, cricket 3, tennis 3, football 2 (some venues
carry two sports). Availability: 9 venues with windows every day 06:00 to 23:00, 60 minute
slots, one with peak pricing 18:00 to 22:00 at 1.5x; one venue **link only** (`booking_url`
on `example.test`, no windows); one venue **both** (windows plus link); one venue `pending`
with a link (must never appear). Two venues have blackouts on a fixed weekday so "this
weekend" and "next Wednesday" differ.

Embeddings: `docs/search-eval/fixtures/embeddings.b64.json`, generated once by
`scripts/search-eval-embed.mjs` with a real `VOYAGE_API_KEY` (about 210 vectors, under 1 MB),
model tagged. The harness loads product vectors into `affiliate_products.embedding` and query
vectors into `query_embedding_cache` right before each run, so the vector path runs with no key
and no network on real geometry.

### 1.3 Metrics and thresholds

The table in ADR D1 is the contract. Restated as the gate the integrator runs:

```
node scripts/verify-search-eval.mjs                # thresholds, per class and overall
node scripts/verify-search-eval.mjs --baseline-diff   # id level diff vs docs/search-eval/baseline.json
node scripts/verify-search-eval.mjs --degraded        # spend guard forced over budget, the lexical floor
```

| Metric | Gate |
|---|---|
| Constraint precision | 1.00 |
| NDCG@10 | >= 0.85 overall, >= 0.75 per class |
| P@5 (browse classes) | >= 0.80 |
| Hit@1 (specific item classes) | >= 0.90 |
| Recall@5 (typo, Hinglish) | >= 0.80 |
| Honest empty accuracy | 1.00 |
| Court window accuracy | 1.00 |
| Answer grounding | 1.00 |
| Unjudged rate | <= 0.10 |
| Degraded floor (`--degraded`) | NDCG@10 >= 0.70, constraint precision 1.00 |

Latency is measured on production by `scripts/probe-search-latency.mjs` at the L1, L4 and L5
gates: typing path p95 <= 1,500 ms from an Indian client, submit path p95 <= 3,500 ms (ADR D7).
The harness records local wall time per query and flags any over 3,000 ms as a regression.

### 1.4 What the bar does not claim

It does not claim the real catalogue is good. When ADR-013 entry begins, the first 50 real
products get judged against the first 40 harvested real queries, and the same harness runs
against the local stack seeded with a copy of the real catalogue (read only export, embeddings
regenerated). That run is the L5 gate. Until then every green is a green on the fixture, and
the status doc says so in those words.

## 2. Every scenario

Columns: id (also the eval query id prefix), scenario, expected behaviour, acceptance check.
Checks name a script and an assertion, or a Maestro flow, or a real device pass recorded in
`docs/qa/evidence/search/`. Copy shown in quotes is the user visible string and obeys house
style.

### 2.1 Location

| Id | Scenario | Expected behaviour | Acceptance check |
|---|---|---|---|
| LOC-01 | First run, never asked | No OS prompt on app open. Home location row reads "Set your location" and opens the picker. The OS prompt fires only from the picker's "Use my location" or the first Courts open, after a one line rationale ("Distances and free slots near you") per PRD-01 FR-12. | `.maestro/native-location-first-run.yaml` with `clearState: true`: assert rationale text visible before the system dialog; `verify-location-store.ts` asserts `requested = false` until `requestLocation` is called |
| LOC-02 | Permission granted, fix received | Place kind `gps`, label from reverse geocode (`subLocality, city` when present, else city), radius 25 km. Courts sorted by distance, distances shown with no "from" qualifier. | Maestro after `xcrun simctl location set 17.4435,78.3772`: assert "km" visible on the first court card and the row reads "Near Gachibowli, Hyderabad" (fixture reverse geocode may vary on a simulator; the assertion is on the presence of a locality or city and a km readout, never on the exact name) |
| LOC-03 | Denied, can ask again | Status `denied`; row "Location is off, so distances are hidden." with "Try again" and "Choose a place". Sorting uses the profile city if known, else the fallback point; distances hidden. | Maestro deny path asserts both actions; `verify-location-store.ts` asserts `status = denied`, `coords = null` when a profile city exists |
| LOC-04 | Denied permanently | "Open settings" replaces "Try again"; tapping it opens Settings. | Maestro asserts "Open settings"; real device screenshot of Settings after the tap (simulator cannot prove the deep link) |
| LOC-05 | Unavailable or timed out | After 12 s with no fix: "We could not get your location in time." plus retry and picker. | `verify-location-store.ts` stubbed never settling fix: `status = unavailable, timedOut = true, elapsedMs < 12,500` |
| LOC-06 | Web | Browser geolocation through the same store; no reverse geocode on web, so the label is the nearest locality from `list_localities` by distance (RPC `nearest_locality(lat,lng)` added in the same migration) or "Your location"; address search hidden with the line "Type an area or city on the web". | `apps/e2e/specs/location.spec.ts` (Playwright, `context.setGeolocation`) asserts the label and the absence of the address field |
| LOC-07 | Manual city | Picker "Search a place" with a typed city: suggestions from `list_localities` (cities that have venues) plus "Use 'Vizag' as typed". A typed city with no venues sets kind `city`, coords null, distances hidden, courts filtered by `venues.city ilike`. | Maestro: type "Hyd", tap "Hyderabad", assert row "Showing courts in Hyderabad"; `verify-localities.mjs` asserts the suggestion list for "Hyd" |
| LOC-08 | Area or locality | Pick "Kondapur, Hyderabad": kind `locality`, coords = view centroid, radius 8 km; distances shown "2.1 km from Kondapur". | `verify-localities.mjs`: centroid equals the mean of Kondapur fixture venues; Maestro asserts "from Kondapur" |
| LOC-09 | Full address | Type "Plot 12, Jubilee Hills, Hyderabad": on device forward geocode returns up to 5 candidates within 6 s; choosing one sets kind `address`, label = the typed text, radius 8 km. No result: "No match for that address. Try an area or a city." | Real device pass (geocoder needs the network and the platform service); simulator Maestro asserts the candidate list renders for a well known address; `geocode.ts` deadline proven in `verify-location-store.ts` with a never settling stub |
| LOC-10 | Saved addresses | Signed in: "Saved" section lists `addresses` rows that have coordinates; picking one sets kind `saved`. Saving the current place writes an `addresses` row with lat and lng. Guest: "Sign in to save places" and the recent five places. | `verify-addresses-geo.mjs`: user A and B ids asserted distinct, A cannot read B's row, `lat` without `lng` refused; Maestro guest path asserts the sign in line |
| LOC-11 | Travelling, far from every venue | Place in Panaji; nearest court 600 km: courts list and court search both read "No courts within 50 km of Panaji. Nearest is Smash Arena in Hyderabad, 620 km away." with "Search in Hyderabad". | `verify-court-search-e2e.mjs` case 7 with `lat: 15.49, lng: 73.83`: results empty, broaden names a fixture venue and its city, no dashes; Maestro with `simctl location set 15.49,73.83` |
| LOC-12 | Change location mid search | On court results, tap the place row, pick another place: the same query re-runs with the new place, header updates, a late response from the old place is discarded. | Maestro: search "badminton tonight", change place, assert the header text changed and the first card differs; the request sequence guard is asserted in `verify-location-store.ts` companion test of `runSearch` ordering (tsx harness over the courts screen's search function extracted to `lib/court-search.ts`) |
| LOC-13 | Location and gear | The shop never asks for location and shows no location row; gear results do not depend on place. | Maestro `native-shop-search.yaml` asserts no "Near" text on `/shop`; `verify-search-eval.mjs` runs every gear query twice, with and without `lat/lng`, and asserts identical result ids |
| LOC-14 | Profile city fallback | Signed in with `me.city = Chennai`, permission denied: place kind `city`, label "Chennai", source `profile`, coords null. | `verify-location-store.ts` (exists, kept) |
| LOC-15 | Place persists across launches | Chosen place restored from AsyncStorage on next launch without a new prompt. | Maestro: pick Kondapur, `stopApp`, `launchApp`, assert "Kondapur" in the row |
| LOC-16 | Granted later in Settings | Returning to the app after enabling in Settings re-requests once on foreground and resolves to `gps`. | Real device pass, screenshot pair |
| LOC-17 | Fallback point | No profile city, denied: sorting by the fixed Hyderabad point, never shown as a distance, row says distances are hidden. | `(tabs)/courts/index.tsx` `showDistances` false; Maestro asserts no "km" text |

### 2.2 Gear queries

All run on the shop surface (`entityTypes: ['gear']`) unless stated. Every gear query has
`answer` grounded per ADR D4 when a constraint is present.

| Id | Scenario | Expected behaviour | Acceptance check |
|---|---|---|---|
| GEAR-01 | Brand only, "yonex" | Every Yonex product and nothing else; in stock before sold out; no answer (no ceiling). | eval: constraint precision 1.0, P@5 >= 0.8 |
| GEAR-02 | Brand typo, "yonx", "babolt", "kokaburra" | `search_fuzzy_terms` expands to the brand; `parsedIntent.brand` is the canonical brand; results as GEAR-01. | `verify-search-fuzzy.mjs`; eval typo class Recall@5 >= 0.8 |
| GEAR-03 | Product type only, "shoes", "joota" | Every shoe across sports, sorted by fusion score then cheapest in stock. | eval; lexicon maps `joota` |
| GEAR-04 | Price only, "under 1500" | Everything with a cheapest in stock offer <= 1500, cheapest first; answer "{n} items under ₹1,500, cheapest is {title} at ₹{price} on {retailer}." | eval; `verify-search-answer-grounding.mjs` |
| GEAR-05 | Brand plus price, "yonex under 2000" | Only Yonex <= 2000. If none: empty plus "No Yonex products under 2000. The cheapest Yonex we list is {title} at ₹{price}. Try raising to {rounded}, or removing the brand." | eval honest empty accuracy; grounding on the price in the broaden |
| GEAR-06 | Age and skill, "racket for a 10 year old beginner" | `ageGroup: kids`, `skillLevel: beginner`; junior beginner rackets grade 3 first, adult beginner grade 2, advanced 0. | eval NDCG per class |
| GEAR-07 | Vague need, "shoes for indoor court" | Vector path recalls the non marking indoor shoes; `court` is not routed to the court entity on the shop surface; top 3 contains an Asics indoor shoe. | eval (AC-11-2 style); `vector: true` asserted |
| GEAR-08 | Hinglish, "sasta badminton racket bachon ke liye" | sport badminton, noun racket, kids, cheap flag: kids badminton rackets cheapest first. | `verify-search-fuzzy.mjs`; eval Hinglish class |
| GEAR-09 | Comparison, "cheaper than yonex astrox 99 pro" | Anchor resolved; `priceMax` = anchor's cheapest in stock minus 1; same sport; anchor excluded; answer "Cheaper than Yonex Astrox 99 Pro (₹{anchor price}): {title} at ₹{price}." | `verify-search-fuzzy.mjs` comparison cases; grounding |
| GEAR-10 | Similar, "like babolat pure drive" or "alternative to" | Vector neighbours of the anchor's embedding, anchor excluded, `rankReason: "similar to Babolat Pure Drive"`. | `verify-search-fuzzy.mjs` |
| GEAR-11 | Out of catalogue, "golf clubs", "swimming goggles" | Empty; broaden "We do not list golf gear yet. We list football, cricket, badminton and tennis." | eval honest empty accuracy; copy lint |
| GEAR-12 | Sold out everywhere | Product still shown (its cheapest offer price with "Sold out at every store we list"), ranked below in stock peers, no Buy on any row. | eval boost assertion (grade 2 max); Maestro `native-shop-compare.yaml` variant asserts "Sold out" and no `compare-buy-0` |
| GEAR-13 | Single retailer | Tile "1 store"; compare shows one row and no "Cheapest" marker. | Maestro compare flow on a one offer fixture product |
| GEAR-14 | Many retailers | Every offer listed cheapest in stock first; count equals the live offer count. | Maestro on a four offer product asserts four `compare-offer-*` rows |
| GEAR-15 | Model number, "astrox 99 pro" | Hit@1 on the exact product. | eval specific item class |
| GEAR-16 | Sport only, "badminton" | Newest first listing for the sport (existing behaviour), no answer. | eval P@5 (grade 2 for any badminton product) |
| GEAR-17 | Keystroke, "ba" | Deterministic only: no gate RPCs, no Voyage, no Claude; `mode: keyword`, `vector: false`. | `verify-search-eval.mjs` asserts the flags for 2 char queries and local wall time < 400 ms |
| GEAR-18 | Empty query | Catalogue newest first (existing). | Maestro asserts `gear-tile-0` before typing |
| GEAR-19 | Ceiling met at one retailer only | Product passes (cheapest in stock <= ceiling), compare shows both offers. | existing Babolat proof kept in the fixture (1,799 and 2,149) |
| GEAR-20 | Chip conflicts with text, badminton chip plus "cricket bat" | Override wins: empty, "No cricket bats in Badminton. Try All sports." | eval with `override.sport` |
| GEAR-21 | Answer strip | For a constrained query the strip cites the offer; every number equals a row. | `verify-search-answer-grounding.mjs` |
| GEAR-22 | Unapproved programme tags | The URL opened is the stored `affiliate_url`; no `tag=` is fabricated anywhere; when a programme is approved its template is applied at ingest, never at click. | `security-invariants.sh` `no-fake-affiliate-tag`, born red on `scripts/seed-affiliate-catalog.mjs`; `verify-affiliate-clicks.mjs` (exists) |
| GEAR-23 | Owned catalogue off | No owned product in any result while `shop.owned_enabled = false`. | `verify-gear-recall.mjs` (exists) |
| GEAR-24 | Product in the catalogue but unapproved (post ADR-013) | Never returned, never cited. | `verify-catalogue-review.mjs` (ADR-013) plus one eval query against a planted `submitted` fixture row |
| GEAR-25 | Same brand, wrong sport, "yonex tennis racket" | Only Yonex tennis; badminton Yonex absent. | eval constraint precision |
| GEAR-26 | Two nouns, "racket and shuttlecocks" | Both nouns recalled; rackets and shuttlecocks both in top 10. | eval P@5 |
| GEAR-27 | Price with rupee forms, "₹1500", "1500 rs", "1.5k" | All parse to 1500. | `verify-ai-search.ts` extended (pure) |

### 2.3 Court queries

Courts surface (`entityTypes: ['court']`) with the place from section 2.1.

| Id | Scenario | Expected behaviour | Acceptance check |
|---|---|---|---|
| CRT-01 | Sport plus time, "badminton tonight after 7" | Slot hits inside the window, soonest first, price after peak rules. | `verify-court-search-e2e.mjs` 1a to 1f (exist) |
| CRT-02 | Near me | Within the place radius, distance in `rankReason` and on the card. | e2e case with `lat/lng` asserts every `distance_km <= radius` |
| CRT-03 | Area name in the query, "badminton in gachibowli" | `gachibowli` resolved through localities to a place (8 km), removed from keywords; results within 8 km of the centroid; header "in Gachibowli". | e2e case 8: `parsedIntent.place.label = "Gachibowli"`, keywords empty, both Gachibowli fixture venues present |
| CRT-04 | Price, "under 500" | Slot price after peak rules <= 500. | e2e 2a (exists) |
| CRT-05 | Indoor or outdoor | No column exists. The word is a keyword against venue and court names; when nothing matches: "We do not list indoor or outdoor yet. Here is what is free {label}." followed by the unfiltered results. | e2e case 9; Open question 4 |
| CRT-06 | Venue name, "smash arena" | That venue first with its next free slot, or its link if link only. | eval Hit@1 court class |
| CRT-07 | Link only venue | Appears with "Availability on example.test", no time, distance shown; below slot venues in a timed query. "Book on example.test" records a click and opens the link. | `verify-venue-link-search.mjs`; `verify-venue-clicks.mjs`; Maestro `native-court-link-out.yaml` |
| CRT-08 | Both in app and link | Slot hit with the free time, plus "Or book on {host}" on the card and on the detail. | `verify-venue-link-search.mjs` asserts both fields; Maestro asserts both buttons on the detail |
| CRT-09 | Nothing nearby | Empty with one real alternative (existing court broaden), naming a link venue when no slot venue is in range. | e2e 4a to 4c (exist) plus case 10 |
| CRT-10 | No slot this week, has a link | Returned as a link venue, not dropped. | `verify-venue-link-search.mjs` |
| CRT-11 | Time already passed today | Rolls to tomorrow (exists). | `verify-court-search.ts` E (exists) |
| CRT-12 | Ordering across kinds | Timed: all slot hits, then link hits; untimed: interleaved by distance. `courts.slotVenues` and `courts.linkVenues` counts are correct. | e2e cases 5 and 6 |
| CRT-13 | Court click tracking | One row per tap, 10 s dedupe, no session records nothing, admin aggregate matches. | `verify-venue-clicks.mjs` |
| CRT-14 | Unverified venue with a link | Never returned. | `verify-venue-link-search.mjs` planted `pending` venue |
| CRT-15 | Malformed link at admin entry | `admin_set_venue_booking_url('ftp://…')` is `VALIDATION`. | `verify-venue-link-search.mjs` |
| CRT-16 | Tap a slot hit | Detail opens on that date with the slot preselected (exists). | Maestro `native-ct-01.yaml` extended |
| CRT-17 | Weekend and weekday names | "this weekend", "next wednesday" honour blackouts in the fixture. | `verify-court-slots.mjs` (exists) plus a blackout fixture case |

### 2.4 Global search, sessions, network, spend, empty states

| Id | Scenario | Expected behaviour | Acceptance check |
|---|---|---|---|
| GLB-01 | Mixed types from Home, "badminton" | Segments for courts, gear, coaches. A gear hit with an `affiliate:` id routes to `/shop/affiliate/[id]`, never to the owned PDP. **Defect today**: `home/search.tsx` line 190 sends every gear hit to `/shop/product/[id]`. | Maestro `search-domains.yaml` extended: tap a gear result, assert "Prices at" visible; a tsx unit over the route mapper `lib/search-routes.ts` (extracted) asserts the prefix mapping |
| GLB-02 | Two intents, "badminton court and racket" | Both segments present; the court segment uses the place, the gear segment ignores it. | eval home class |
| GLB-03 | Place typed in a global query, "courts in kondapur" | Same locality parse as CRT-03 on the home surface. | e2e case 8 on the home surface |
| GLB-04 | Answer strip on Home | Shown only when results are a single segment and a constraint was parsed. | Maestro asserts absence on a mixed query and presence on "yonex under 2000" |
| AUTH-01 | Guest versus signed in | Identical result ids for the same query and place (no per user ranking). | `verify-search-eval.mjs` runs the set as anon and as a signed in user and diffs ids |
| AUTH-02 | Guest click out | Anonymous session still records a click (every visitor has one); no session at all records nothing and gets the plain URL. | `verify-affiliate-clicks.mjs` 1a, 1b (exist); `verify-venue-clicks.mjs` |
| AUTH-03 | Saved places need sign in | Guest sees the sign in prompt in the picker. | Maestro guest picker flow |
| NET-01 | Slow network during typing | Previous grid stays, small spinner (exists); at 3 s the line "Still searching" appears under the field. | Web e2e with `route.fulfill` delay 4 s asserts the line; real device with Network Link Conditioner (screenshot) |
| NET-02 | Timeout | At the `packages/api` 15 s deadline: error state "Search did not go through. Check your connection and try again." with retry; the retry clears the last searched guard. | Web e2e with a 20 s delay; existing error state assertions |
| NET-03 | Offline | Immediate error state with retry; place picker still works for localities already cached in memory. | Real device airplane mode pass |
| NET-04 | Stale response | A slower earlier response never overwrites a newer one. | existing `requestSeq` guard; tsx unit over the extracted search runner |
| SPEND-01 | Spend guard over budget | `mode: keyword`, `vector: false`; results still meet the degraded floor; the UI shows nothing different except deterministic `rankReason`. | `verify-search-eval.mjs --degraded` |
| SPEND-02 | Per user throttle | 11th request in 60 s takes the keyword path, HTTP 200. | `verify-search-hybrid.mjs` (exists) |
| EMPTY-01 | Brand empty | "No {Brand} {nouns}. Try removing the brand." | eval honest empty class |
| EMPTY-02 | Price empty with a relaxable price | "…Try raising to {rounded}…" where rounded is derived from a real row. | eval plus grounding |
| EMPTY-03 | Keyword empty | "No matches for "{keywords}". Try removing {last keyword}." | eval |
| EMPTY-04 | Time empty | Court broaden names one real alternative; never "remove tonight". | e2e 4b (exists) |
| EMPTY-05 | Copy style | No emoji, no dash, no hyphen in any broaden or answer string. | `verify-ai-search.ts` G (exists) extended to `answer.text`; `security-invariants.sh` `copy-dashes` |
| EMPTY-06 | Shop empty query, empty catalogue | "New gear lands here regularly. Check back soon." (exists). | Maestro against an emptied local catalogue |

## 3. Courts under the link strategy

What a court result is, under ADR D5:

| Venue has | Search result | Detail screen | Click out |
|---|---|---|---|
| Windows only | `CourtSlotResult` slot variant: "Free today at 7:00 PM", venue, slot price, distance, "{n} more courts free here" | Calendar and slot picker, "Book this slot" (Razorpay, unchanged) | none |
| Link only | `CourtSlotResult` link variant: venue, distance, "Availability on {host}", button "Book on {host}" | No picker. Sports, address, photos, rating, then "Book on {host}" and the line "You book on {host}'s site." | `record_venue_booking_click(venue, 'search' or 'detail')`, then `Linking.openURL(url)` |
| Both | Slot variant plus a secondary text link "Or book on {host}" | Picker first, then a secondary "Book on {host}" below the primary button | as above with `surface` |
| Neither | Not a search candidate; still browsable on the courts list as today | Picker shows "No open slots on this date" (exists) | none |

Rules the builders must keep:

- A link venue never shows a time, a price, or a slot count. Nothing about its availability is
  known and the card says so in the words "Availability on {host}".
- In a timed query, link venues come after every slot venue, under a heading rendered from
  `courts.linkVenues > 0`: "Also nearby, availability on their site" (Open question 3).
- The host is derived from the URL (`new URL(url).host` minus `www.`) at render time; there is
  no provider table and no provider logo.
- No commission line for courts. The compare screen's disclosure is gear only.
- `booking_url` is set by admins only (`admin_create_venue`, `admin_set_venue_booking_url`);
  the partner portal does not edit it in this plan.

Admin data entry: `apps/admin/src/pages/venues/create.tsx` already has the field; `show.tsx`
gains an inline edit for the link and for `area` (L3), each calling its RPC and showing the
audited value back. Bulk entry of venues is not in this plan (ADR-013 covers gear only).

## 4. Retrieval and ranking, in one page

Full detail in ADR D2, D3, D4, D7. The shape:

```
query ─┬─ parseIntent (deterministic, lexicon, localities, comparison anchor)          5 ms
       ├─ gate RPCs ∥ FTS recall ∥ vector cache read ∥ court slots ∥ link venues   80 to 300 ms
       ├─ zero match tokens → search_fuzzy_terms → second FTS pass                   60 ms
       ├─ Voyage embed only on a cache miss and only when the gate allows          400 ms
       ├─ RRF fusion (FTS rank, vector rank) → hard constraints → boosts             5 ms
       ├─ honesty gate → broaden, or results
       ├─ answer template over cited rows                                             1 ms
       ├─ submit only: cached Claude parse when low confidence; Claude rerank top 8  ≤ 3.2 s
       └─ off path: query log, cache writes, spend records
```

Query understanding is deterministic first and always. The LLM parse runs only on submit, only
when the deterministic parse is weak, and is cached 24 hours; it may add fields, never a brand.
The answer is a template; every number in it is checked by a script against the row it cites.
Degradation order: rerank, Claude parse, Voyage, fuzzy expansion; everything else is a data
path and errors honestly with retry.

Caching: query embeddings 10 minutes (exists), Claude parses 24 hours (new), nothing else.
Result pages are never cached because court availability and nightly prices change under them.

## 5. The UX flow, screen by screen

Direction C (`docs/design/DIRECTION-SHOP.md`) is locked for every shop surface: flat white
photo tile, brand, title, 18 px mono price in ink, store line, freshness. The court card shape
(`CourtSlotResult`) exists and is extended, not redesigned. Two elements are genuinely new and
are **design gates**: the place picker and the answer strip. Per the house rule, neither is
designed cold; the founder supplies references first, then a kitchen sink section is rendered
and judged.

### 5.1 Home

- Location row under the search bar: "Set your location" (never asked), "Finding your
  location…" (loading), the place label (resolved), "Location is off, showing {label}"
  (denied or unavailable). Tapping any state opens the picker. Nothing else on Home sorts by
  place, so no actions live here (existing decision, kept).
- Search bar opens `/home/search`.

### 5.2 Place picker `/location/pick` (design gate 1)

Reached from Home's row, the courts header row, and the court search results header. Sections,
in order, each with its own state:

1. **Use my location**: one row. States: idle (tap to request), loading (spinner, "Finding
   your location…"), denied ("Location is off" plus "Open settings" or "Try again"), resolved
   (the label, a check).
2. **Search a place**: one field. Typing 2 or more characters lists localities from
   `list_localities` (in memory after the first fetch, filtered client side; no per keystroke
   network call), then address candidates from the device geocoder after a 400 ms pause, then
   "Use '{typed}' as a city". Empty: "No match for that address. Try an area or a city."
   Web: the address group is absent and the field's helper reads "Type an area or city on the
   web".
3. **Saved**: signed in, `addresses` with coordinates, each one row; "Save current place"
   action when the current place has coordinates. Guest: "Sign in to save places".
4. **Recent**: last five chosen places, local.

Choosing a place pops back to the caller and re-runs whatever was on screen. The picker never
shows a map (no map dependency in this plan).

### 5.3 Shop `/shop`

Exists. Adds:

- **Suggestions when the field is empty**: chips from `list_search_facets()` (real brand and
  sport names with live counts, top 8), plus recent searches (exists on Home; moved into a shared
  `RecentSearches` molecule). No location row (LOC-13).
- **Typing**: 400 ms debounce, previous grid stays, spinner (exists); "Still searching" at 3 s.
- **Submit**: the answer strip appears above the grid when `answer` is present (design gate 2):
  one sentence, the cited product name tappable to its compare screen, tertiary text. Never
  more than one sentence, never a number the grid does not also show.
- **Empty and broaden**: exists (`shop-empty`, `shop-broaden`).
- **Error and timeout**: exists plus the timeout copy.
- **Tile**: unchanged; a sold out everywhere product carries "Sold out at every store we list"
  on the store line.

### 5.4 Compare `/shop/affiliate/[id]`

Exists. Changes: no "Cheapest" marker when fewer than two in stock offers; the disclosure line
stays; a `RelatedRail` is **not** added (would need a design gate and vector budget, deferred).

### 5.5 Courts `/(tabs)/courts`

Exists. Changes:

- The `LocationStatusRow` becomes a tappable place row that opens the picker; its manual city
  input is removed in favour of the picker.
- Court search results: slot variant (exists), link variant (new), the "Also nearby,
  availability on their site" heading when timed and `courts.linkVenues > 0`.
- Far away: the LOC-11 line with "Search in {city}".
- The list under no query: `CourtCard` gains a small "Books on {host}" line for link venues
  (no button on the card; the detail owns the click out).

### 5.6 Court detail `/(tabs)/courts/court/[id]`

Section 3 table. The external button uses the primary style only when it is the only way to
book; when both exist it is secondary under the primary "Book this slot".

### 5.7 Home search `/home/search`

Exists. Changes: affiliate routing defect fixed (GLB-01); answer strip on single segment
constrained results; the place row above results for court segments; suggestions from facets
replace the four hardcoded chips.

### 5.8 States every surface must render

loading, populated, empty (honest broaden), error (retry), timeout (retry), degraded (no visible
difference), guest (no saved places), far away (LOC-11), permission denied (LOC-03), permission
permanently denied (LOC-04), web (LOC-06). Each is in the Maestro or e2e list in section 6.

## 6. Phases

Every phase ends with `scripts/dod.sh` green, the phase's scripts born red then green with the
output in `docs/qa/verify/GATES-BORN-RED.md`, `supabase db reset` replaying clean, and a
`docs/phases/PHASE-L{n}-STATUS.md` handoff. Builders each get a worktree and the file list
below; a file not on a track's list is not that track's to edit. Migrations are `XXXX_` on the
branch and numbered at merge (ADR D8). Each track applies only its own `XXXX_` files with
`psql` after `supabase db reset` and runs `scripts/seed-demo-users.mjs` after every reset
(`CURRENT-STATE.md` 2026-09-18).

### L0. The bar, and a refactor that changes nothing

Delivers the evaluation set, fixture, embeddings, harness, latency probe, and the split of
`ai-search/index.ts` into modules with identical output.

| Track | Owns | Gate |
|---|---|---|
| L0-T1 harness | `docs/search-eval/README.md`, `queries.jsonl`, `judgments.jsonl`, `candidates.jsonl` (empty), `fixtures/embeddings.b64.json`, `baseline.json`; `supabase/seed/local_seed_search_eval.sql`; `scripts/seed-search-eval.mjs`, `scripts/search-eval-embed.mjs`, `scripts/verify-search-eval.mjs`, `scripts/lib/search-eval-metrics.mjs`, `scripts/probe-search-latency.mjs` | harness runs end to end against the current function and **fails** (born red: typo and Hinglish classes under threshold, no `answer` field); `seed-search-eval.mjs` exits 1 against a production URL with zero writes; the metrics module has a tsx unit for NDCG against a hand computed example |
| L0-T2 refactor | `supabase/functions/ai-search/index.ts`, new `fetch-gear.ts`, `fetch-courts.ts`, `fetch-people.ts`; `search-core.ts` (types only: `booking?`, `ageGroup?`, `cheap?`, `anchorProductId?`, `place?`); `packages/types/src/domain/index.ts` (`SearchHit.booking`, `SearchResponse.answer`, `SearchResponse.courts`) | `verify-search-eval.mjs --baseline-diff` shows zero id changes against the baseline T1 recorded before the refactor; `verify-court-search-e2e.mjs`, `verify-gear-recall.mjs`, `verify-search-hybrid.mjs` all still pass |
| L0-T3 invariants | `scripts/security-invariants.sh` (three checks), `scripts/seed-affiliate-catalog.mjs` (remove `tag=atlitos-21`, plain URLs), `docs/qa/verify/GATES-BORN-RED.md` | `no-fake-affiliate-tag` fails on the unmodified seed script and passes after; `search-log-no-user` and `clicks-zero-policy` fail against a planted policy or column and pass clean |

T1 records `baseline.json` first; T2 starts in parallel and cannot merge before T1.
Acceptance: all three gates; `docs/PLAN.md` gains one line pointing here; `DEBT.md` entry
"production catalogue is seed data with a fabricated tag" gains the note that the seed script
no longer carries it and that production delisting is still owed to the founder.

### L1. Gear understanding, fusion, answer, query log

Depends on L0. Runs in parallel with L2.

| Track | Owns | Gate |
|---|---|---|
| L1-T1 understanding | `ai-search/lexicon.ts`, `search-core.ts` (parse: lexicon, comparison, price forms), `XXXX_search_fuzzy_vocabulary.sql`, `scripts/verify-search-fuzzy.mjs`, `scripts/verify-ai-search.ts` (GEAR-27 cases) | `verify-search-fuzzy.mjs` green; typo and Hinglish classes of the eval at threshold |
| L1-T2 fusion and answer | `ai-search/rank.ts`, `ai-search/answer.ts`, `ai-search/fetch-gear.ts`, `ai-search/index.ts` (wiring only), `scripts/verify-search-answer-grounding.mjs` | eval NDCG, P@5, Hit@1, grounding at threshold; `--baseline-diff` reviewed and `baseline.json` updated in the merge commit; planted `+1` price fails grounding |
| L1-T3 LLM parse cache and query log | `ai-search/llm.ts`, `ai-search/parse-cache.ts`, `ai-search/query-log.ts`, `XXXX_query_parse_cache.sql`, `XXXX_search_query_log.sql`, `scripts/verify-search-query-log.mjs`, `scripts/search-eval-harvest.mjs`, `scripts/search-eval-judge.mjs` | `verify-search-query-log.mjs` green; a submit query with a low confidence parse hits Claude once and is served from cache the second time (asserted by `ai_spend_daily` delta of zero on the repeat); `--degraded` floor holds |

`index.ts` is owned by T2 alone. T3 exposes `llmParseIntentCached` and `logQuery` with the
signatures in ADR D8; T2 wires them. T1 exposes `parseIntent` changes behind the same signature
plus the optional `localities` argument, unused until L3.

Acceptance: `verify-search-eval.mjs` fully green on the fixture (every threshold in 1.3);
`probe-search-latency.mjs` run against production after deploy of `ai-search` and the three
migrations, JSON committed; API-MAPPING.md search section updated with `answer`, `courts`, the
new RPCs; SCHEMA.md and RLS.md updated for the three tables.

### L2. Courts under links

Depends on L0. Runs in parallel with L1.

| Track | Owns | Gate |
|---|---|---|
| L2-T1 database | `XXXX_venue_link_search.sql`, `XXXX_venue_booking_clicks.sql`, `scripts/verify-venue-link-search.mjs`, `scripts/verify-venue-clicks.mjs`, `docs/architecture/SCHEMA.md`, `RLS.md`, `API-MAPPING.md` (courts sections) | both scripts green; planted `pending` venue never returned; two shopper ids asserted distinct before the dedupe assertion |
| L2-T2 function | `ai-search/fetch-courts.ts`, `scripts/verify-court-search-e2e.mjs` (cases 5, 6, 7, 9, 10) | e2e green including the two orderings and the far away case |
| L2-T3 mobile | `packages/api/src/hooks.ts` (`COURT_SELECT` gains `booking_url`, `Court.bookingUrl`, `bookingUrlForVenue`), `packages/types` (`Court`), `apps/mobile/src/components/molecules/CourtSlotResult.tsx`, `apps/mobile/src/components/ui/court-card.tsx`, `apps/mobile/src/app/(tabs)/courts/court/[id].tsx`, `apps/mobile/src/app/(tabs)/courts/index.tsx` (heading only), `.maestro/native-court-link-out.yaml`, `.maestro/native-court-both.yaml` | Maestro green with `--udid` on the Release build pinned to local; screenshots light and dark in `docs/qa/evidence/search/l2/` |
| L2-T4 admin | `apps/admin/src/pages/venues/show.tsx`, `apps/admin/src/pages/venues/api.ts` (or the file that holds the venue RPC wrappers; the builder names it in the handoff) | an admin sets and clears a link in a real browser against the local stack; screenshot; the audit row exists (SQL) |

T2 waits for T1's RPC to exist locally; T3 waits for T2's response fields. T3's edit to
`courts/index.tsx` is limited to the heading; L3 owns the rest of that file later.

Acceptance: CRT-07, 08, 10, 12, 13, 14, 15 checks green; the court click out seen on the
iPhone 16 Pro Max Release build with `main.jsbundle` verified present and
`scripts/assert-build-target.sh … local` run first; DEBT.md "Courts affiliate click-out not
built" closed.

### L3. Location as a place

Depends on L2 (link venues appear under a place). **Design gate 1 first**: founder references
for the picker, then a kitchen sink section `/kitchen` "Place picker", then build.

| Track | Owns | Gate |
|---|---|---|
| L3-T1 store and geocoding | `apps/mobile/src/store/location-store.ts`, `apps/mobile/src/lib/geocode.ts`, `apps/mobile/src/lib/court-search.ts` (search runner extracted from the courts screen), `scripts/verify-location-store.ts` | thirteen existing assertions plus the place assertions in ADR D6 green; never settling geocode stub resolves within 6,500 ms |
| L3-T2 database | `XXXX_venue_localities.sql`, `XXXX_addresses_geo.sql`, `scripts/verify-localities.mjs`, `scripts/verify-addresses-geo.mjs`, `packages/api/src/hooks.ts` (`useLocalities`), `packages/api/src/use-shop.ts` (`saveWithCoordinates`, `listAddresses` gains lat and lng), `packages/types` (`Place`, `Locality`, `AddressRecord`) | both scripts green; planted pending venue absent from the view |
| L3-T3 picker and surfaces | `apps/mobile/src/app/location/pick.tsx`, `apps/mobile/src/components/organisms/PlacePicker/*`, `apps/mobile/src/components/molecules/LocationStatusRow.tsx`, `apps/mobile/src/components/organisms/home/LocationRow.tsx`, `apps/mobile/src/app/(tabs)/courts/index.tsx`, `apps/mobile/src/app/home/search.tsx` (place row only), `.maestro/native-location-*.yaml` (first run, granted, denied, permanent, manual city, locality, saved guest, change mid search, persist, far away) | ten Maestro flows green on the Release build, driven with `xcrun simctl location` and `simctl privacy`; screenshots light and dark |
| L3-T4 admin and web | `apps/admin/src/pages/venues/create.tsx`, `show.tsx` (area field), `apps/e2e/specs/location.spec.ts` | admin sets an area and it appears in `list_localities`; Playwright geolocation spec green |

Real device pass (not simulator): LOC-04 Settings deep link, LOC-09 forward geocode on a real
address, LOC-16 foreground re-request, NET-03 airplane mode. Recorded as screenshots with the
device name in `docs/qa/evidence/search/l3/`.

Acceptance: every LOC scenario check green; API-MAPPING.md, SCHEMA.md, RLS.md updated;
`docs/design/DESIGN-LANGUAGE.md` gains the picker's component notes.

### L4. Search UX: suggestions, answer strip, states, the routing defect

Depends on L1 and L3. **Design gate 2 first** for the answer strip (references, kitchen sink,
judgment), because a one line answer above a grid is a new element on an approved surface.

| Track | Owns | Gate |
|---|---|---|
| L4-T1 facets | `XXXX_search_facets.sql`, `packages/api/src/hooks.ts` (`useSearch().facets()`), `scripts/verify-search-facets.mjs` | counts equal live `count(*)` per brand and sport over `active` (and `approved` once ADR-013 lands); anon can call; a delisted product is not counted |
| L4-T2 surfaces | `apps/mobile/src/app/shop/index.tsx`, `apps/mobile/src/app/home/search.tsx`, `apps/mobile/src/lib/search-routes.ts` (new, the entity to route mapper), `apps/mobile/src/components/molecules/AnswerStrip.tsx`, `apps/mobile/src/components/molecules/RecentSearches.tsx`, `apps/mobile/src/components/organisms/SearchResults.tsx`, `apps/mobile/src/app/shop/affiliate/[id].tsx` (cheapest marker rule) | tsx unit for `search-routes.ts` (`affiliate:` prefix to compare); "Still searching" and timeout copy present |
| L4-T3 proofs | `.maestro/native-shop-search.yaml` (extend), `native-shop-compare.yaml` (sold out, single retailer, four retailers variants), `search-domains.yaml` (GLB-01 tap through), `native-search-answer.yaml`, `apps/e2e/specs/search-network.spec.ts` (NET-01, NET-02) | all green with `--udid`; screenshots light and dark in `docs/qa/evidence/search/l4/` |

Acceptance: GLB, AUTH, NET, EMPTY, GEAR-12 to 14, 18, 21 checks green; `probe-search-latency.mjs`
re-run after deploy and committed; `docs/design/IA-SHOP.md` updated for the strip and
suggestions.

### L5. The real catalogue and ship

Depends on L1 to L4 and on ADR-013 having produced at least 50 approved real products.

1. Export the real catalogue read only (`scripts/export-catalogue-snapshot.mjs`, service role,
   production URL, SELECT only, guarded by a `--read-only` assertion that the script never
   constructs a write client), load it into the local stack, regenerate embeddings with the
   real key, harvest the first 40 real queries from `search_query_log`, grade them by hand,
   run `verify-search-eval.mjs --set docs/search-eval/real/` against the thresholds.
2. Recalibrate `VECTOR_SIMILARITY_FLOOR` on the real catalogue the way it was calibrated on
   2026-09-19 (measurement recorded in `search-core.ts`'s comment and in
   `docs/qa/evidence/search/`), and rerun the fixture harness to prove the fixture still
   passes at the new floor.
3. Deploy: migrations in merge order via the Supabase MCP after local replay; `ai-search`
   deployed; admin and app redeployed per `docs/architecture/DEPLOY-RUNBOOK.md`;
   `probe-search-latency.mjs` committed; `verify-court-search-e2e.mjs` style production smoke
   read only.
4. Founder actions, recorded not assumed: delist the 8 seed products through the admin
   (audited), set `affiliate_tag_template` and `subid_param` for any approved programme by
   migration, add the Voyage payment method (DEBT 2026-09-19).

Acceptance: the real set passes the thresholds, or the status doc records exactly which
metric failed and by how much, with the harvested queries that failed. A partial pass is
reported as a partial pass.

### Real device checklist across phases

| Check | Phase | Why the simulator is not enough |
|---|---|---|
| Court link opens the external site and returns to the app | L2 | `Linking.openURL` to a real host, the OS app switch |
| Settings deep link from "Open settings" | L3 | simulator has no Settings location pane behaviour to prove |
| Forward geocode of a real Hyderabad address | L3 | platform geocoder quality differs from the simulator |
| Foreground re-request after enabling in Settings | L3 | app lifecycle |
| Airplane mode search and picker | L4 | simulator network toggling is unreliable |
| Network Link Conditioner "3G" typing path | L4 | the "Still searching" line and the 15 s timeout |
| Keyboard over the answer strip and the picker field | L4 | safe area and keyboard avoidance on a notch device |
| Dark mode on every new screen, cold launch | L3, L4 | `CURRENT-STATE.md` dark mode finding |

## 7. Risks, open questions, out of scope

### Risks

| Risk | Early signal | Mitigation in the plan |
|---|---|---|
| The fixture bar is met and the real catalogue still feels wrong | the L5 real set fails a class the fixture passes | the real set is a separate gate; class thresholds make the failing class visible; harvesting keeps the queries real |
| Grading falls behind entry | unjudged rate above 10% at a merge | the LLM judge proposes, a human confirms; the gate blocks rather than hides |
| `pg_trgm` expands a short token to the wrong brand | typo class recall fine but constraint precision drops | 0.4 floor, zero FTS match precondition, two expansions max; the eval catches it |
| Voyage entry tier rate limit at launch traffic | `vector: false` rising in the query log | DEBT 2026-09-19 payment method; cache; the degraded floor keeps results usable |
| `search_court_slots` cost grows with venues | local wall time over 300 ms on the courts fixture | radius from the place shrinks candidates; the bounding box index stays on the SCALE list |
| Link venues confuse a timed search | founder rejects the second group at design gate 2 | Open question 3; hiding them from timed queries is a one line change in `fetch-courts.ts` |
| On device geocoder quality on Android | LOC-09 real device pass fails on Pixel | Open question 1 decides whether Places is worth its cost |
| Two builders touch `index.ts` | merge conflict | one owner per phase, signatures fixed in ADR D8 |
| The eval blob drifts from the model | tag mismatch refusal | regeneration command in the README; the harness refuses to run silently |
| Free text in the query log | a query containing personal text | no user id, 30 days, admin aggregates only; Open question 2 |

### Open questions for the founder

1. **Address search engine.** On device geocoding (free, no web support) or Google Places (paid
   key, works on web, consistent candidates)? The plan builds on device; changing this changes
   L3-T1 and adds a dependency.
2. **Query log retention.** Raw query text, no user id, 30 days, admin aggregates only, one
   line on the privacy page. Confirm.
3. **Link venues in a timed search.** Show them after slot venues under "Also nearby,
   availability on their site", or hide them when the query names a time?
4. **Indoor or outdoor.** Add `courts.indoor` to admin entry now, or leave the words as
   keywords with the honest line in CRT-05?
5. **Design references** for the place picker (before L3) and the answer strip (before L4).

### Explicitly out of scope

- Agentic ordering, retailer APIs, commission attribution or ledger, price history.
- Any commission or partner programme for court bookings.
- Health checks of court booking links.
- Partner portal editing of `booking_url` or `area`.
- Personalised ranking, search history on the server tied to a user, or recommendations.
- A map in the picker; Google Places (pending question 1); pincode centroids.
- Coaches, athletes and clips ranking; they pass through the refactor unchanged and get smoke
  queries only.
- Voice search, multi language UI, and an LLM written answer (templates only, ADR D4).
- Bulk venue entry; venue photos or amenities in search.

## 8. Contracts settled before any UI

- `SearchResponse` gains `answer?`, `courts?`, and `SearchHit.booking?`; everything else is
  unchanged, so `home/search.tsx` and the courts screen keep working through L0 to L2.
- `record_venue_booking_click` has the exact semantics of `record_affiliate_click`
  (`{ click_id, url, recorded }`, no session records nothing, 10 s dedupe, `NOT_FOUND`).
- `Place` is the one location shape; `SearchInput` gains `radiusKm` only.
- `search_query_log` has no user column, by schema, checked by an invariant.
- Every new RPC restates its public predicate inside; every new client read of a public table
  carries its own filter; `addresses` reads carry `.eq("user_id", user.id)`.
- The fixture catalogue never leaves the local stack; the seed script refuses production.
- No copy string carries an emoji, an em dash, or a hyphen.

## Sources consulted

- Perplexity's retrieval, ranking and inline citation pipeline: [ZipTie, How Perplexity AI Answers Work](https://ziptie.ai/blog/how-perplexity-ai-answers-work/); [LLM Pulse, How Perplexity Works](https://llmpulse.ai/blog/how-perplexity-works/).
- LLM relevance judges over label relevance versus humans, and preserve system ordering: [Arabzadeh et al., Benchmarking LLM based Relevance Judgment Methods, SIGIR 2025](https://arxiv.org/pdf/2504.12558); [LLMJudge](https://ceur-ws.org/Vol-3752/paper8.pdf); [JudgeBlender](https://arxiv.org/pdf/2412.13268).
- Zero result and search UX guidance: [Design Studio UI UX, Search UX best practices](https://www.designstudiouiux.com/blog/search-ux-best-practices/).
- Playo's location first venue booking flow (select a location, then venues near you, recently visited): [Playo help, Can I search by venues on the app](https://playo.zendesk.com/hc/en-us/articles/360008337433-Can-I-search-by-venues-on-the-app); [Playo UX case study](https://medium.com/design-bootcamp/what-is-playo-a480dcb12f5d).
- Amazon Associates price freshness and disclosure rules already recorded in `docs/ops/AFFILIATE-APPLICATIONS.md`.
