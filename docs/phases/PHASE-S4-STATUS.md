# Phase S4 status: ship

Status: SHIPPED, one human step open
Opened: 2026-09-19   Closed: 2026-09-19

Plan: `docs/PLAN-SHOP-SEARCH.md` Phase S4. Previous phase: `PHASE-S3-STATUS.md` (handoff notes read).
Branches: `prasanth/ui-uplift` (reconciliation, PR #1), `ship/s4-shop-search` (PR #2), both on `main`.

## Gate

> Production carries the five migrations in order, the four functions, the Voyage key and the
> two workflow secrets; the flag row reads false; the nightly sweep runs green; `ai-search`
> returns `vector: true` with the real model; admin and app web are redeployed from one
> reconciled `main`; one real retailer paste lands in production.

**Verdict:** every clause proven except the last, which needs an admin session (Kushlu, Amaeya
or the founder) and is the one open item.

## What shipped, in order

| Step | Proof |
|---|---|
| `main` reconciled with Prasanth's 16 Sep drop | PR #1 merged at `7be992b`; `git diff origin/main origin/prasanth/ui-uplift` empty |
| 0121 gear_search_vectors applied | `vector` installed, HNSW index present, anon cannot read `embedding` or execute `match_affiliate_products`, `title` still readable |
| 0122 app_config_owned_shop_flag applied | `shop.owned_enabled = false`; anon cannot execute `admin_set_app_config`; anon key REST read returns `false` |
| 0123 gear_ingest_health applied | 3 programmes with empty tags; 17 offers intact, `consecutive_failures = 0`; anon and authenticated cannot execute `system_auto_delist_affiliate_product`; anon cannot read `retailer_programmes` or `product_fetch_log` |
| 0124 product_images_bucket applied | bucket `product-images` public read |
| 0125 coach_trainee_video_path_lock applied | policy `with check` carries `storage_path IS NULL` |
| 0126 backfill_offer_retailer_keys applied | 8 amazon_in, 4 decathlon_in, 5 unmatched (tennishub.in, cricketstoreonline.in) |
| `gear-embed` v3, `gear-ingest` v1, `gear-recheck` v2, `ai-search` v9 deployed | `list_edge_functions`; every one `verify_jwt = true` |
| Nightly sweep green | run 35437700043: recheck 12 checked (4 ok, 5 gone, 3 blocked), 0 skipped, 0 auto delisted; embed 5 embedded 0 failed, mode voyage; 8 of 8 products embedded |
| `ai-search` hybrid in production | three guest queries return `vector: true`, `mode: llm`; after calibration a zero keyword overlap query recalls the beginner tennis racket by vector alone (`docs/qa/evidence/shop-search/s4-prod-hybrid-after-calibration.txt`) |
| Admin redeployed from `main` | `dpl_2ECTuqLsZUWH1MuMRP52TyzbPvPS`, atlitos-admin.vercel.app 200, `/gear/health` 200, bundle `index-gtpMWEgB.js` |
| App web redeployed from `main` | atlitos-app.vercel.app 200, `/shop` 200, `/shop/cart` 200 (SPA rewrite), bundle `entry-4f8768d7...js` |

## What production taught us (three bugs the first real run found)

1. **The sweep refused its own key.** `gear-recheck` compared the bearer token string to the
   runtime's `SUPABASE_SERVICE_ROLE_KEY`; the platform holds two valid service_role JWTs that
   differ by `iat`. `isServiceRoleToken` now also accepts a gateway verified payload with
   `role: service_role`; `verify-gear-embed` proves two forged claims are refused 401.
2. **Voyage's per minute limit ate 5 of 8 embeds.** One call per row; now one call per batch of
   64. Second sweep 5 of 5.
3. **The similarity floor was never cleared.** 0.75 was chosen before a real voyage-3 number
   existed. Measured on production (`s4-prod-similarity-measurement.md`): relevant 0.40 to
   0.57, unrelated at or under 0.36. Floor is 0.38. The vector path contributed nothing before
   this and contributes now.

And one found by reading the data before the first sweep: **17 hand entered offers had no
programme**, and a programme less offer counted as a strike, so the whole hand entered
catalogue would have been auto delisted after 7 nights without a single fetch. Skipped now,
born red scenario in `verify-gear-health` (7 fail on the old code, 35 of 35 on the new).

## Open items

| Item | Owner | Note |
|---|---|---|
| One real Amazon.in paste in production admin | founder or a data entry admin | Gear, New gear item, Add from a link. The last S2 defect. |
| The production affiliate catalogue is seed data | founder | All 8 products and 17 offers are the `b0000000` seed rows with fabricated Amazon ASINs (`B08KOOKKIDS`) and a fabricated tag `?tag=atlitos-21`. 5 Amazon offers are 404 and 3 are 503 in the sweep. Delist through the admin (never delete) before the store build, or replace with real pastes. |
| Decathlon soft 404 reads as `ok` | Prasanth | decathlon.in returns 200 with OG tags for an unknown slug; the extractor finds a title, no price, and the sweep records `ok`. A parsed page with `price null` against a priced offer should be `unparsed`. In DEBT. |
| Android walk of the shop | native QA lane | unchanged from S3 |
| Vector floor re-measurement | whoever adds the 20th real product | the 0.38 number comes from 8 seed rows and 3 queries |
