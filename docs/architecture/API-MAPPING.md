# v1 to v2 API Mapping

Every function in v1's `services/api.ts` contract (`PLAN-2-3-api-contract-and-llm.md`) mapped to its real v2 implementation. Screens and components never change, per PLAN.md; only what backs `services/api.ts` changes, from a mock to one of four lanes:

- **PostgREST** — a direct `packages/api` typed hook calling `supabase.from(...)`, secured entirely by an RLS policy in `RLS.md`. Used for reads and simple own-row writes that touch no money and no state machine.
- **RPC** — a `SECURITY DEFINER` Postgres function called via `supabase.rpc(...)`. Used for state-machine transitions, atomic multi-row writes, and any read that must hide other users' rows while exposing a derived value (busy slots, balances). Raises a Postgres exception with a code the client maps to the v1 error shape (`INVALID_TRANSITION`, `SLOT_TAKEN`, etc).
- **Edge Function** — a Deno function running with the `service_role` key. Used for anything touching Razorpay, anything writing `ledger_entries` or `payment_intents`, and Cloudflare Stream calls. This is the only lane allowed to move money, matching PLAN.md's financial invariant.
- **Supabase Auth** — the GoTrue client SDK directly (`supabase.auth.*`), not PostgREST or an edge function. v1's `auth` and part of `profile` map here; it is a fourth lane the v1 three-bucket description didn't need to name because v1 had no real backend.

`packages/api` wraps every row below in a typed hook with the same function name v1 used, so screens do not change when the mock swaps for the real call.

## auth

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `login` | POST `/auth/login` | Supabase Auth | `signInWithPassword` | email or phone, native GoTrue error maps to `401 INVALID_CREDENTIALS` |
| `register` | POST `/auth/register` | Supabase Auth + trigger | `signUp` then DB trigger `handle_new_user()` | trigger inserts the `public.users` row, copying `name`/`phone`/`dob` from `raw_user_meta_data` (`0073`); role stays unset until Role select calls `setupPlayer`/`setupCoach` |
| `resendSignupEmail` | (v2 only) | Supabase Auth | `auth.resend({ type: "signup" })` | register confirmation screen's Resend email; NOT `signInWithOtp`, which sends a login code an unconfirmed account cannot use |
| `requestOtp` | POST `/auth/otp/request` | Supabase Auth | `signInWithOtp` | phone or email OTP, GoTrue owns rate limiting (`429 RATE_LIMITED`) |
| `verifyOtp` | POST `/auth/otp/verify` | Supabase Auth | `verifyOtp` | returns a session; client treats it as the v1 `resetToken` |
| `resetPassword` | POST `/auth/password/reset` | Supabase Auth | `updateUser({ password })` | called on the session `verifyOtp` established |
| `continueAsGuest` | POST `/auth/guest` | Supabase Auth | `signInAnonymously` | anonymous auth user with zero `user_roles` rows is the guest state everywhere else in this doc |

## profile

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `getMe` | GET `/me` | PostgREST | `users` select, left join `coach_profiles` | RLS `id = auth.uid()` |
| `updateMe` | PATCH `/me` | PostgREST + RPC | `users` update; `set_athlete_sports` for the sports field | non-sports fields (bio, cover, handle, city, state, theme, notification prefs) are a plain owner-scoped `users` patch. The `sports` field is the exception: it is routed through `set_athlete_sports(sports, primary)` (0088), never a bare `users.sports` write, so `athlete_sports`/`is_primary` (which Learn and the coach-search default read) stay consistent with `users.sports`. `getMe` also returns `primarySport` from `athlete_sports.is_primary` (tie break `is_primary desc, created_at asc`, same as `get_learn_home`) |
| `setupPlayer` | POST `/me/setup/player` | RPC | `complete_player_setup(sports, avatar_url, city, state)` | writes `users` fields and the `player` `user_roles` row in one transaction; also dual-writes `athlete_sports`/`is_primary` (primary = first pick); raises `ALREADY_SETUP` if the role already exists |
| `setAthleteSports` | POST `/me/sports` | RPC | `set_athlete_sports(sports, primary)` | SECURITY DEFINER, owner-scoped to `auth.uid()`. Rewrites `users.sports` AND rebuilds `athlete_sports` (deletes dropped sports, upserts the rest, sets `is_primary` only on `primary`) in one transaction, so the two sport models never drift after onboarding. Validates non-empty `sports` and `primary IN sports`. `authenticated` only |
| `setupCoach` | POST `/me/setup/coach` | RPC | `submit_coach_verification(payload jsonb)` | writes `coach_profiles` and `coach_certificates``, `coach_availability_windows`, and the `verification_requests` row atomically; raises `ALREADY_SETUP` if a `pending_review` or `verified` profile exists |

**Correction, 0099.** The row above claimed `submit_coach_verification` writes `session_types` and `coach_availability_windows`. It never has. `0004_player_and_coach_setup_rpc.sql` predates `0018_coaching.sql`, which creates those two tables, so it preserves the wizard's step 4 pricing and step 5 availability verbatim in `verification_requests.payload` and writes only what it can write to real columns. 0004's own header promised a later migration would backfill from that payload; none did.

The consequence was not cosmetic. `sessions.session_type_id` is `NOT NULL`, and the athlete booking screen lists only `session_types` where `active`, so a coach who completed every step of onboarding and was approved had zero rows and could not receive a single booking request. `0099_backfill_coach_setup_from_verification_payload.sql` is the missing backfill, and the coach session types screen (below) is the durable fix, since a backfill cannot invent a type for a coach whose payload had none. (Renumbered from the originally authored `0088`: production had already applied three unrelated migrations at `0088` through other in-flight branches, so a fourth `0088` would have silently never run.)

Nothing about the RPC's behaviour changed; only this doc was wrong.

## home

| v2 lane | Function | Note |
|---|---|---|
| PostgREST | `useHome().listPromoBanners()` | Home promo carousel (PRD-01 3.2, Track B). Reads `promo_banners` (0071) `.eq("active", true)` ordered by `sort`, resolves `image_path` through the public `product-media` bucket's `getPublicUrl`, the same resolver `use-shop.ts`'s `resolveMediaUrls` uses. Public browse, no owner filter, same class as `categories`. Returns `[]` on an empty table or a read error rather than throwing; the carousel hides itself. Every other Home section (categories, recently viewed, Clutch preview, Empower rail) reads through its own existing domain hook (`useShop`, `useClutch`, `useEmpower`), nothing new there |

## search

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `aiSearch` | POST `/search` | Edge Function | `ai-search` | v1 heuristic (keyword to entityTypes, weighted distance/price/rating score) ported verbatim behind the same request/response contract; LLM re-rank is a drop-in swap inside this one function, per PLAN.md |

### `ai-search`, as built (AT-144 / AT-145)

`POST { query, entityTypes?, sport?, priceMax?, lat?, lng?, city?, limit? }` with the caller's own JWT (`verify_jwt` true). Search is public discovery, so a guest is a valid caller: it passes its anonymous session token, like `get-clip-playback-url`. Only `query` is required; every other field is an optional narrowing the client already holds (its location store, a tapped segment) and is advisory, the server re-derives intent from `query` regardless (`parseIntent`), so a field a client sets can never widen what it sees.

Response `{ query, parsedIntent, results: SearchHit[], mode: "llm" | "keyword" }` sorted `rankScore` desc. `parsedIntent` is `{ entityTypes, sport, priceMax?, timeWindow?, keywords }`. `mode` (LAUNCH Phase 3, P1-5) names which path this call actually took.

**Throttle + budget (LAUNCH Phase 3, CT-2/CT-3).** Before either LLM call (intent parse, rerank), a per-user token bucket (`ai-search-user`, 10 req/60s, `take_rate_limit_token`) and the day's LLM spend (`ai_spend_daily.est_usd` vs `ai_search_daily_budget()`, feature flag `ai_search_daily_budget_usd`, default $10) are checked once per request. Over either, the whole request stays on the deterministic keyword path, `mode: "keyword"`, HTTP 200, NEVER an error (Settled decision 5, PHASE-3-STATUS.md). After a real LLM call, `record_ai_spend` upserts today's token/USD totals. Both checks default to keyword mode on any RPC/read failure (the opposite fail-direction from the playback rate limit's fail-open, deliberately: an unreadable budget must not silently permit unmetered spend). Implementation in `supabase/functions/ai-search/spend-guard.ts`.

**Entity types.** The v1 `SearchEntityType` union named three: `gear` (products), `coach` (coach_profiles), `court` (courts). Track E (AT-3) extended it with two more, behind the identical `SearchHit` shape: `athlete` (verified `upa_applications`, the same view/filter `use-empower.ts`'s `listUpas` reads) and `clip` (published `clips`, the same explicit scope `hooks.ts`'s `getFeed` reads). Drills remain out of the contract, no PRD asks for them in search.

**Result shape (deviation, recorded).** The v1 `SearchResult` carried a full domain `snapshot` (a whole `Product | CoachProfile | Court`). The real endpoint returns a lean `SearchHit` (`entityType, entityId, title, subtitle, imageUrl?, sport?, price?, distanceKm?, rankScore, rankReason`) carrying exactly what a result card renders plus what routing needs, keeping the query cheap and the RLS surface small. Both types live in `packages/types` (`SearchHit`, `SearchResponse`, `SearchInput`); the heavy `SearchResult` is retained but unused.

**Scoring.** Per candidate, four signals combine to a 0..1 `rankScore`: text (fraction of content keywords present in the row's searchable blob, weight 0.40), rating (weight 0.25, real only for coaches and clips, courts/gear/athletes have no rating column so this stays neutral for them; a clip's `likes_count` is normalized onto the same 0..5 scale to stand in for a rating), price (weight 0.20, `priceMax`-relative when a ceiling was parsed else cheaper-is-better normalized within the entity type; athletes and clips carry no price so this stays neutral), distance (weight 0.15, haversine for courts from venue lat/lng, city-equality for coaches, gear/athletes/clips have no proximity axis so neutral). `rankReason` is the dominant *real* contributor, so a tag never claims a signal that did not apply.

**Visibility (the non-negotiable).** Two independent guards, per CLAUDE.md "RLS is a floor, not scoping": every table is read through the caller's own JWT client (`userScopedClient`, never `serviceRoleClient`, search has no money leg), AND every query carries its own explicit public filter, so even a privileged caller gets only the public set out of this endpoint: coaches from the `coach_profiles_public` view (`status = 'verified'` baked in), courts `active = true` with a `venues!inner` asserting `venues.status = 'verified'`, products `active = true`, athletes `upa_applications.status = 'verified'`, clips `clips.status = 'published'`. Proven live (AT-144): a guest search never returns an inactive product, and an active court placed under a `pending` venue (cheapest, would rank first if it leaked) is absent while the 5 public courts return.

**LLM re-rank seam.** `rerank(query, hits)` is a pure post-processing pass over the already heuristically scored, sorted candidates, today the identity function. Swapping in an LLM re-rank replaces only that one function body; the request/response contract and the visibility queries are untouched.

**Track E (athletes + clips extension).** Not yet redeployed; the integrator deploys `ai-search` via the Supabase MCP before this is live. Client side (`apps/mobile/src/app/home/search.tsx`, `SearchResults.tsx`) already routes `athlete` hits to `/home/upa/[id]` and `clip` hits to `/(tabs)/clutch/post/[id]`.

### `ai-search`, hybrid vector recall extension (Phase S1 Track B, PRD-07 FR-40/FR-42, ADR-011 D1)

Contract shape is otherwise unchanged (same request, same `SearchHit`); the response gains one field: `vector: boolean`, reporting whether the vector recall path actually ran for THIS request (spend gate allowed it AND the recall call itself succeeded), not whether it added a hit. `mode` keeps its pre-existing meaning ("did Claude actually parse/rerank this request"): it is decoupled from `vector`, so a request can be `mode: "keyword", vector: true` (no Anthropic key configured, Voyage ran fine) or `mode: "keyword", vector: false` (over budget or a Voyage failure), etc.

After the deterministic candidates load and before scoring, when the CT-2/CT-3 gate (extended to also cover Voyage, one shared `ai_spend_daily` ledger) allows it: the query is embedded (`_shared/embeddings.ts`, cached in `query_embedding_cache` by `sha256(lower(trim(query)))`, 10 minute TTL, service role only), then `match_affiliate_products(embedding, VECTOR_SIMILARITY_FLOOR = 0.75, 20)` recalls candidate ids, hydrated through the same `fetchAffiliateProducts` path and ADDED to the candidate set (never re-scored or removed, ADR-011 D1). A candidate recalled purely by similarity (zero keyword hits) still clears `passesHardConstraints`' relevance floor once its cosine similarity clears `VECTOR_SIMILARITY_FLOOR`; brand and price hard constraints are untouched. Its `rankReason` becomes `"similar to your query"`.

Over budget or on ANY Voyage failure (bad key, timeout, non-2xx): the vector step is skipped, `vector: false`, never an error (same fail-safe posture as the existing LLM gate). Scoped to `entityType: "gear"` only, over `affiliate_products` only (ADR-011's own non-goal excludes the owned catalogue from vector search).

### Affiliate click tracking (`0131`, 2026-09-26)

| RPC | Caller | Contract |
| --- | --- | --- |
| `record_affiliate_click` | mobile compare view Buy button, via `useShop().buyUrlForOffer` | `p_offer_id`, optional `p_surface` (`compare` default, `search`, `home`). Granted to `anon` and `authenticated`. Returns `{ click_id, url, recorded }`; the client opens `url`. No session: `recorded: false`, the stored URL, nothing written. `NOT_FOUND` for an offer on a delisted product, `VALIDATION` for an unknown surface. The client falls back to the offer's stored URL on ANY failure, so recording never blocks a shopper |
| `admin_affiliate_click_stats` | admin Gear list, "Buy taps, 30 days" | `p_days` (1 to 365). Per product and retailer: `clicks`, distinct `shoppers`, `with_subid`, `last_click_at`. `FORBIDDEN` for non-admins |

### Court search from real availability (`0132`, `0133`, 2026-09-26)

**The defect this fixes, verified in production 2026-09-26.** Any court query with a time word
("badminton court tonight", "cricket turf tomorrow evening", "at 7pm", "this weekend") returned ZERO
courts and told the shopper to remove the time. Time words stayed in the keyword list, and the
honesty gate requires a court's text (name, sport, venue, address) to contain a keyword.

**Now.** `ai-search/when.ts` parses the date and time window in IST (today, tonight, tomorrow, day
after tomorrow, weekday names, this weekend, mornings to nights, "at 7pm", "after 8", "before 9am",
"7 to 9pm", "19:00") and removes time and booking words from the keywords, for court queries only.
Courts are then fetched from `search_court_slots`, never by text:

| RPC | Contract |
| --- | --- |
| `search_court_slots` | `p_date_from`, `p_date_to` required; optional `p_time_from`, `p_time_to` (slot START bounds, `null` end means end of day), `p_sport`, `p_price_max`, `p_city`, `p_lat`, `p_lng`, `p_radius_km`, `p_limit` (max 50). Per court: its first free slot in the window and price, `min_price`, `matching_slots`, venue, distance. Verified venues only, slot price after peak rules, slots not yet started (IST), at most 14 days and 60 candidate courts. Built on `get_court_available_slots`, so search and booking agree. Granted to `anon` and `authenticated` |

`ai-search` response changes, additive: court hits carry `slot { date, start, end, price, label,
freeSlots, otherCourtsFree }`, one hit per VENUE (the soonest court there; the rest are counted),
`rankReason` is always `Free <label>` for a court even after the Claude rerank, and
`parsedIntent.when` carries the window. A courts only search with no result gets a broaden line that
relaxes ONE constraint and names a real alternative ("The cheapest tomorrow in the evening is ...").
With no time in the query, courts are searched over the coming week and show their next free slot.

`get_court_available_slots` (`0133`) no longer offers past dates or slots that have ENDED today
(IST); a slot in progress stays offered for walk ins. `book-court` accepts only slots this function
lists, so booking a past slot is now refused as `SLOT_TAKEN`. `book-session` refuses a start time
that has passed with `VALIDATION`.

Proof: `scripts/verify-court-search.ts` (parser, fixed clock), `scripts/verify-court-slots.mjs`
(SQL, adversarial fixtures), `scripts/verify-court-search-e2e.mjs` (through the function).

### `gear-embed`, as built (Phase S1 Track B, PRD-07 FR-43, ADR-011 D2)

`POST { productId: string }` (one row) or `POST { sweep: true, limit?: number }` (every row where `embedding is null`, capped at `limit`, default 200). Auth: a service-role bearer token, OR an authenticated caller holding the `admin` role (checked through their OWN JWT, the same `requireAdmin` pattern `admin-order-advance` uses); anon and any non-admin authenticated caller are refused with 401/403. Never called by `ai-search` (component boundary) and never on a read path.

Response `{ embedded: number; failed: number; mode: "voyage" | "stub" }`. Document text is `title, brand, sport, skill_level, age_range, description` (present fields only) joined with spaces, embedded via `_shared/embeddings.ts`, written to `affiliate_products.embedding` under the service role. On a per-row failure (empty document text, or a real Voyage error) the column is left `null`, the failure is reported to Sentry (`captureEdgeError`), and the row is counted in `failed`; the function itself never 500s for a single row's failure inside a sweep. Called by `apps/admin/src/pages/gear/api.ts`'s `upsertProduct` right after `admin_upsert_affiliate_product` resolves (fire-and-forget, failure ignored client side), and by the nightly backfill sweep (not yet wired to a scheduler in S1, see PHASE-S1-STATUS.md).

### `gear-recheck`, as built (Phase S2 Track D, PRD-07 FR-48, FR-51, FR-52, ADR-011 D4, AC-11-4)

`POST { sweep: true, limit?: number }` (every in-stock offer of an active product, oldest `last_checked_at` first, capped at `limit`, default 200, max 1000) or `POST { productId: string }` (every offer of that one product regardless of `in_stock`, the admin "Re-check now" button's own call, FR-50). Auth: a service-role bearer token, OR an authenticated caller holding the `admin` role checked through their OWN JWT, the identical `requireServiceRoleOrAdmin` shape `gear-embed` uses; anon is refused 401.

Offers are grouped by `retailer_key` and fetched through the shared `_shared/fetch-page.ts` (imported, never re-implemented) with each retailer group's own pacing from `retailer_programmes.fetch_policy.maxPerMinute` (an offer with no matching programme shares one conservative 10/minute default bucket). Outcome enum (`ok | price_changed | out_of_stock | gone | blocked`) is written to `product_offers.last_check_outcome`, with a `product_fetch_log` row appended on every attempt regardless of outcome. Only `gone`/`blocked` increment `consecutive_failures`; every other outcome resets it to 0. `blocked` covers `fetchPage`'s own robots.txt/size-cap/invalid-URL refusal AND an HTTP 403/429/5xx/network failure that still fails after one retry (robots-style blocks are never retried, a retry cannot change a static rule). A 200 no extraction strategy can parse logs `unparsed` on the `product_fetch_log` row specifically (the enum on `product_offers` itself has no `unparsed` value, so the offer's own `last_check_outcome` degrades to `gone`); when that happens and `ANTHROPIC_API_KEY` is set and the shared `ai_spend_daily` daily budget (the same ledger and `ai_search_daily_budget()` RPC `ai-search`'s D1 spend guard reads) is not exceeded, a capped 6&nbsp;KB read of the fetched text is sent to Claude Haiku for a `{ stillSold, price, reason }` suggestion stored on that log row's `ai_suggestion`, never applied to any table. `recordAiSpend` (imported from `ai-search/spend-guard.ts`) records the call's usage into the same ledger; a missing key, a timeout, or any Claude failure leaves `ai_suggestion` `null` without erroring the sweep.

After every offer in the request is processed, any product whose EVERY offer (queried fresh, not just the ones this call touched) now has `consecutive_failures >= 7` is delisted through `system_auto_delist_affiliate_product` under the service role (AC-11-4's "test with the counter set to 6, one more check delists"); `affiliate_products.health_status` is set to the worst outcome across that product's offers (`gone`/`blocked` worst, then `out_of_stock`, then `price_changed`, then `ok`) and `health_checked_at` to now, whether or not that product ends up delisted. One offer's fetch or extraction throwing is caught per-offer and recorded as `blocked`; it never stops the rest of the sweep.

Response `{ checked: number; outcomes: Array<{ offerId, outcome }>; autoDelisted: string[]; mode: "llm" | "keyword" }`, `mode` naming whether `ANTHROPIC_API_KEY` is present the same way `ai-search`'s `mode` names whether Claude ran. Called by `.github/workflows/gear-nightly.yml` nightly (interim trigger, `docs/DEBT.md`, pending `pg_net`) and by the admin Catalog health page's per-product "Re-check now" (`{ productId }`).

## coaches

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `list` | GET `/coaches` | PostgREST | `coach_profiles_public` select, filters as query params | RLS restricts the base table to `status = 'verified'`; the public view already narrows to that status so no client-side filter is needed |
| `get` | GET `/coaches/:id` | PostgREST + RPC | `coach_profiles` select + `get_coach_busy_slots(coach_id, from, to)` | busy slots must hide other players' session details, so it is a `SECURITY DEFINER` RPC returning only occupied `(date, slot_start)` pairs, never the session rows themselves |

**`useCoaching().listCoaches` keyset pagination (CT-5, P1-3, PHASE-3-STATUS.md Phase 3, Track D).** Prior to Phase 3 this issued one unbounded `select("*")` over `coach_profiles_public`, the P1-3 meltdown item at 1000 concurrent verified coaches. It now takes `{ sport?, city?, limit?, cursor? }` and returns `{ items, nextCursor }` instead of a bare array:

- Stable order `created_at desc, user_id desc` on every page, `limit` defaulting to 20 and clamped to a max of 50 (`.limit(limit + 1)` server side, the extra row decides `nextCursor` without a separate count query).
- `cursor` is base64 of the JSON tuple `[created_at_iso, user_id]`, the exact key the order sorts by; decoded and applied as `(created_at, user_id) < (cursorCreatedAt, cursorUserId)` via a PostgREST `.or()` predicate (`created_at.lt.X,and(created_at.eq.X,user_id.lt.Y)`), since the JS client has no native tuple comparison.
- `nextCursor` is `null` exactly on the last page. `CoachBrowseList` (`apps/mobile/src/components/organisms/coaching/CoachBrowseList.tsx`) paginates via `FlatList.onEndReached`, appending pages rather than refetching from the top; a sport/city filter change still resets to page 1 through the existing `load()` path.
- `sport`/`city` filtering and the same-city-first client sort are unchanged; the sort only reorders items already on a page, it never moves a row across a page boundary.

### session types and pricing (PRD-02 FR-4)

| `packages/api` call | v2 lane | Table / policy | Note |
|---|---|---|---|
| `useCoachSessionTypes().listMyTypes()` | PostgREST | `session_types` select, explicit `coach_id = auth.uid()` | active first, then by name |
| `useCoachSessionTypes().createType()` | PostgREST | `session_types` insert, `session_types_write_own` (0019) | `coach_id` comes from the caller's session, never from an argument |
| `useCoachSessionTypes().updateType()` | PostgREST | `session_types` update, same policy | omitted fields unchanged; never touches an already booked session, which stores its own price |
| `useCoachSessionTypes().setTypeActive()` | PostgREST | `session_types` update, same policy | deactivate, the only destructive-looking action; there is no delete because historical `sessions` reference the row by FK |

Plain table writes, no RPC, and that is not a financial invariant exception. `session_types.price` is a LIST price, not a money row and not a status field. The charge is derived and re-validated server side in `book-session` (`PRICE_MISMATCH`, see below), so the client's number is never what is charged. This is the same trust level 0080 records for a coach editing `training_groups.monthly_fee`.

**Online is a naming convention, deliberately.** There is no `is_online` column on `session_types` and no video call concept anywhere in the product. `isOnlineSessionTypeName` (read) and `applyOnlineSessionTypeName` (write, called only by the coach session types screen) are the two ends of it. When a real online session ships, add `session_types.is_online`, backfill it from that same predicate, and delete both functions together.

## sessions

State machine: `requested` to (`accepted` or `declined` or `cancelled`); `accepted` to (`completed` or `cancelled` or `rescheduled`); `completed` to `rated`. Every transition below is one `SECURITY DEFINER` RPC, `session_transition(session_id, action, ...)`, that checks caller identity and current status before writing, raising `INVALID_TRANSITION` (409) otherwise. `SLOT_TAKEN` on reschedule comes from the same partial unique index described in `SCHEMA.md`.

The `requested` to `cancelled` edge was added 2026-07-19 by founder-approved PRD amendment (PRD-02 FR-19 amended, FR-34, FR-35; PRD-01 FR-25, FR-26), in `0026_session_request_cancel_refund.sql`. It is athlete only and carries an automatic full refund; see the `cancel-session-refund` section below.

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `book` | POST `/sessions/book` | Edge Function | `book-session` | creates `payment_intents` + `sessions` (`requested`), re-prices server side (`PRICE_MISMATCH`), returns a Razorpay order for the client to open |
| `list` | GET `/sessions` | PostgREST | `sessions` select, joined to `users`/`coach_profiles` for hydrated names | RLS `coach_id = auth.uid() OR player_id = auth.uid()` |
| `get` | GET `/sessions/:id` | PostgREST | `sessions` select single | same RLS as `list` |
| `accept` | POST `/sessions/:id/accept` | RPC | `session_transition(id, 'accept')` | caller must be `coach_id`; `requested` to `accepted` only |
| `decline` | POST `/sessions/:id/decline` | Edge Function | `decline-session-refund` | coach only; `requested` to `declined`; refunds any captured payment in full automatically (CO-04); clients MUST call this, the bare RPC now raises `USE_EDGE_FUNCTION` (0085) |
| `complete` | POST `/sessions/:id/complete` | Edge Function | `complete-session` | wraps `session_transition_internal(coach, id, 'complete')` and writes the earnings accrual; clients MUST call this, the bare RPC now raises `USE_EDGE_FUNCTION` (AT-61) |
| `cancel` (from `accepted`) | POST `/sessions/:id/cancel` | RPC | `session_transition(id, 'cancel', reason)` | caller must be `coach_id` or `player_id`; reason required (`REASON_REQUIRED`); rejected once the session has started (`SESSION_STARTED`); NO automatic refund |
| `cancel` (from `requested`) | POST `/sessions/:id/cancel` | Edge Function | `cancel-session-refund` | athlete only (a coach gets `FORBIDDEN` and declines instead); no reason required; refunds in full automatically; clients MUST call this, the bare RPC now raises `USE_EDGE_FUNCTION` (AT-61) |
| `reschedule` | POST `/sessions/:id/reschedule` | RPC | `session_transition(id, 'reschedule', null, date, slot)` | re-checks the unique index, raises `SLOT_TAKEN` on conflict |
| `rate` | POST `/sessions/:id/rate` | RPC | `rate_session(id, rating, remarks)` | caller must be `player_id`; only from `completed`; second call raises `ALREADY_RATED` |

Shipped in `0021_session_state_machine.sql`, amended by `0026` (the `requested` cancel edge) and `0027` (AT-61's service-role gate). Exact signatures:

- `session_transition(p_session_id uuid, p_action text, p_reason text default null, p_new_date date default null, p_new_slot_start time default null) returns public.sessions` — granted to `authenticated`. Signature unchanged by 0027, so no client call site moved.
- `session_transition_internal(p_actor_id uuid, p_session_id uuid, p_action text, p_reason text default null, p_new_date date default null, p_new_slot_start time default null) returns public.sessions` — **granted to `service_role` only** (0027). Holds the whole machine. Since `0103` it also emits the athlete facing notification for `accept`, `decline`, `start` and `complete`, through `notify_session_parties`, in the same transaction as the status change. Emission lives here rather than in the edge functions because this is the one chokepoint every transition path funnels through, so no caller can move a session without notifying. Not callable by `authenticated`, which gets a bare Postgres `permission denied for function`, and not something `packages/api` ever calls; the two edge functions are its only callers. The actor is explicit because `auth.uid()` is null under the service-role key.
- `rate_session(p_session_id uuid, p_rating smallint, p_remarks text default null) returns public.sessions`

Error codes `packages/api` maps: `UNAUTHENTICATED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `VALIDATION`, `REASON_REQUIRED`, `TOO_EARLY`, `SESSION_STARTED`, `SLOT_TAKEN`, `ALREADY_RATED`, `USE_EDGE_FUNCTION`.

**`USE_EDGE_FUNCTION` (AT-61, extended by CO-04/`0085`)** is raised by `session_transition` for `complete` (from any state), for `cancel` when the session is `requested`, and for `decline` (from any state): the action is legitimate but the entry point is wrong, because its money half lives in an edge function. Deliberately not `FORBIDDEN`, which across this codebase means "the caller is not the party this action belongs to" — here the caller may well be the right party. A user should never see this code; it means a call site regressed to the bare RPC, so treat it as a bug signal rather than something to render. Non-party callers still get `FORBIDDEN` and unknown ids still get `NOT_FOUND`, so the refusal leaks no session state to a stranger.

Two behaviours the tables above do not make obvious. **Reschedule inserts a new row** at the new date/slot in `accepted`, carrying the original's money columns and `payment_intent_id`, and marks the original `rescheduled` as a tombstone; the RPC returns the NEW row, so a caller must not assume the id it passed in is the id it gets back. This mirrors `court_booking_transition`. **`rate_session` also refreshes `coach_profiles.rating`/`rating_count`** in the same transaction, recomputed from `sessions` rather than incremented, so a replay cannot double count; it does this through a transaction-local `app.rating_pipeline` GUC that `lock_coach_profile_admin_fields` now honours alongside `has_role('admin')`.

**No ledger write happens in these RPCs**, despite PRD-02 FR-15 describing completion as triggering the earnings accrual. Per CLAUDE.md, ledger writes live only in edge functions under the service role; AT-41's function calls the transition and writes the balanced group itself. Same resolution `0009_courts.sql` already made for courts. AT-61 is the other half of that decision: because the money half is outside the RPC, the RPC must not be callable by the client for those actions.

### `complete-session`, as built (AT-41)

`POST { session_id }` with the **coach's** own JWT, `verify_jwt` true. Requirements: PRD-02 FR-15, FR-25.

Response `{ session_id, status, outcome, accrual? }` where `outcome` is `accrued` or `already_accrued`, and `accrual` is `{ entry_group_id, gross, platform_fee, coach_payable }`.

Error codes: `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403 (not the assigned coach), `NOT_FOUND` 404, `INVALID_TRANSITION` 409, `TOO_EARLY` 409 (scheduled end time not reached), `PAYMENT_NOT_CAPTURED` 409, `INTERNAL` 500. The first six are `session_transition`'s own codes, relayed rather than flattened.

It runs entirely under the service-role client since AT-61. `session_transition_internal` is `security definer` and enforces coach identity, `accepted` to `completed`, and `TOO_EARLY` against the `p_actor_id` it is handed; that actor is `getAuthenticatedUser()`'s id, validated against GoTrue rather than decoded locally or read from the body. The ledger group is written by the same client, per CLAUDE.md. (Before AT-61 this used two clients, calling `session_transition` under the coach's own bearer token, because `auth.uid()` is null under the service-role key. Passing the actor explicitly is what let the whole flow move behind a `service_role`-only grant.)

**Track C, binding**: the coach session detail screen must call `complete-session`, never `session_transition(id, 'complete')` directly. As of AT-61 the bare RPC refuses that action with `USE_EDGE_FUNCTION` rather than silently completing the session and never crediting the coach, so this is now enforced rather than merely documented. `complete-session` still carries a repair path for an already `completed` session with no accrual, which now only covers pre-AT-61 rows and a run that died mid-flight.

### `cancel-session-refund`, as built (AT-60)

`POST { session_id }` with the **athlete's** own JWT, `verify_jwt` true. Requirements: PRD-02 FR-19 (amended 2026-07-19), FR-34, FR-35; PRD-01 FR-25, FR-26.

Response `{ session_id, status, refund_status, refund_amount, outcome }`:

| `outcome` | `refund_status` | Meaning |
|---|---|---|
| `cancelled_and_refunded` | `processed` | Cancelled, Razorpay accepted the refund, reversing ledger group written |
| `cancelled_refund_pending` | `pending` | Cancelled, but the refund has not settled. Retryable by calling again; visible to admin |
| `cancelled_without_refund` | `not_applicable` | Cancelled, no captured payment existed to refund |
| `already_refunded` | `processed` | A prior call (or the webhook) already refunded this session |

`status` is always `cancelled` on a 2xx. Every non-error outcome means the cancellation succeeded, which is the point: FR-35 requires that a payment provider failure never leaves the athlete holding a `requested` session they have already cancelled. The UI must therefore treat any 2xx as "cancelled" and use `refund_status` only to choose between "refunded" and "refund on its way".

Error codes: `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403 (the caller is not the booking athlete, including a coach attempting this edge), `NOT_FOUND` 404, `INVALID_TRANSITION` 409 (the session is not `requested`, for example the coach accepted or declined first), `INTERNAL` 500. The first five are `session_transition`'s own codes, relayed rather than flattened. Note that `RAZORPAY_ERROR` and `ROUTE_UNAVAILABLE` are deliberately NOT reachable here: a Razorpay failure is reported as `cancelled_refund_pending` with a 200, not as an error.

Same shape as `complete-session` since AT-61: `session_transition_internal(athlete, id, 'cancel')` runs under the service-role client, with the actor validated against GoTrue, so the RPC still enforces "only the booking athlete" and "only from `requested`". The refund's ledger group is written by `settle_refund`, also service-role only.

Idempotency is threefold: `session_transition` refuses a second cancel with `INVALID_TRANSITION`; the unique index `refunds (domain, entity_id)` refuses a second refund row for one session; and `settle_refund` returns unchanged on an already-`processed` row, so the synchronous path and a duplicate `refund.processed` webhook converge on exactly one refund record and exactly one ledger group.

**Track D, binding**: the athlete session detail screen must call `cancel-session-refund` when the session is `requested`, and the bare `session_transition(id, 'cancel', reason)` RPC when it is `accepted`. As of AT-61 the bare RPC refuses the `requested` case with `USE_EDGE_FUNCTION` rather than cancelling without ever refunding, so this split is now enforced rather than merely documented; the `accepted` case is unchanged and still client callable. The function carries a resume path (an already-cancelled session belonging to this athlete whose refund never settled gets retried on a later call), but the resume is a safety net, not the contract. The two cancels must also not share copy: PRD-01 FR-26 requires the `requested` case read as a self-serve exit with a full refund, and the `accepted` case as cancelling a commitment, with no refund promised.

### `decline-session-refund`, as built (CO-04, `0085`)

`POST { session_id, reason? }` with the **coach's** own JWT, `verify_jwt` true. Requirements: PRD-02 FR-14, FR-19, FR-35; PRD-01 FR-25. The coach-side mirror of `cancel-session-refund`, and the fix for the CO-04 P0 money hole (a coach declining an already-captured request left the charge stranded at `captured` with no refund).

Response `{ session_id, status, refund_status, refund_amount, outcome }`:

| `outcome` | `refund_status` | Meaning |
|---|---|---|
| `declined_and_refunded` | `processed` | Declined, Razorpay accepted the refund, reversing ledger group written |
| `declined_refund_pending` | `pending` | Declined, but the refund has not settled. Retryable by calling again; visible to admin |
| `declined_without_refund` | `not_applicable` | Declined, no captured payment existed to refund |
| `already_refunded` | `processed` | A prior call (or the webhook) already refunded this session |

`status` is always `declined` on a 2xx: a payment provider failure never leaves the coach holding a `requested` session they have already declined, exactly as FR-35 requires for the athlete-cancel case. The UI treats any 2xx as "declined" and uses `refund_status` only to choose between "refunded" and "refund on its way".

Error codes: `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403 (not the assigned coach), `NOT_FOUND` 404, `INVALID_TRANSITION` 409 (the session is not `requested`), `INTERNAL` 500. Relayed from `session_transition_internal`. As with `cancel-session-refund`, `RAZORPAY_ERROR`/`ROUTE_UNAVAILABLE` are not reachable: a Razorpay failure is reported as `declined_refund_pending` with a 200.

It runs entirely under the service-role client: `session_transition_internal(coach, id, 'decline', reason)` enforces coach identity and `requested`-only, then the function claims a `refunds` row, calls Razorpay, and settles through `settle_refund` (the reversing `debit platform / credit user <payer>` group). Idempotency and the resume path mirror `cancel-session-refund` byte for byte, with the resume predicate being a session already `declined` by this coach. The refund reuses AT-60's `refunds` table, unique index, and `settle_refund` rather than a parallel record.

**Binding**: the coach session detail screen must call `decline-session-refund`, never `session_transition(id, 'decline')` directly. As of `0085` the bare RPC refuses `decline` with `USE_EDGE_FUNCTION`, so the refund cannot be skipped. `packages/api`'s `declineSession` was repointed to the edge function accordingly.

### `book-session`, as built (AT-40)

`POST` with the athlete's own JWT, `verify_jwt` true.

Request `{ session_type_id, frequency, date, slot_start, focus_area?, location?, expected_total }`. `slot_end` is not accepted from the client; it is derived from `session_types.duration_minutes`, so a client cannot buy a two hour slot at a one hour price.

Response `{ session_id, status, razorpay_order_id, key_id, amount (paise), currency, bill: { price, platform_fee, total } }`. `status` is always `requested`; nothing in this response means the payment succeeded.

Error codes: `VALIDATION` 400, `UNAUTHENTICATED` 401, `NOT_FOUND` 404 (session type missing, inactive, or its coach not `verified`), `SLOT_TAKEN` 409, `PRICE_MISMATCH` 409, `RAZORPAY_ERROR` 502, `INTERNAL` 500.

`SLOT_TAKEN` covers three distinct rejections deliberately, because they are one thing to the athlete ("you cannot have this slot"): the slot falls outside every `coach_availability_windows` row for that weekday, the slot is already held per `get_coach_busy_slots`, or the insert lost the race on `sessions_coach_date_slot_unique` (`23505`). Only the third is authoritative; the first two are optimistic pre-checks that narrow the window without closing it.

`PRICE_MISMATCH` compares `expected_total` against the server derived `total`, which is `session_types.price` (the fee is carved out of it, see SCHEMA.md). The client's number is never charged, and no session row or Razorpay order exists when this fires.

**Capture is finalized by `_shared/finalize-payment.ts`, not here.** That module is the single gate both `razorpay-webhook` and `verify-payment` call; it owns the `update payment_intents ... where status = 'created'` idempotency check and then dispatches on `payment_intents.domain` to `finalize-court-booking-payment.ts` or `finalize-session-payment.ts`. Neither entry point knows which domain it is finalizing. Adding `commerce`/`donation` later means one new branch plus one new file, never a second copy of the gate.

**UC-96 fix (booking confirmation notification).** `finalize-court-booking-payment.ts` calls `dispatchNotification` (`_shared/notify.ts`) right after the ledger group commits, writing a `booking` type `notifications` row for the booking's `user_id` and attempting the Expo push leg. This was the one caller of `court_booking_confirm_payment` that never told the athlete their booking confirmed; the `order`/`chat`/`transfer` notification types documented in `_shared/notify.ts` still have no writer anywhere in the repo and remain open (see `docs/qa/BUG-LEDGER.md`). Best effort: a dispatch failure is caught and logged, never thrown, so it cannot fail the payment confirmation response.

`verify-payment` responds `{ domain, entity_id, booking_id, session_id, status, outcome }`, where `booking_id` and `session_id` are domain-named aliases of `entity_id` (the other is null) so a court-only or session-only caller need not switch on `domain`. `outcome` is `captured` or `already_processed`.

**Correction, 2026-08-14.** The sentence above about the gate owning `update payment_intents ... where status = 'created'` is now wrong in its mechanism and was always wrong in its consequence. The gate calls `claim_payment_intent_for_finalization()` (`0109`), which matches `created` OR a `captured` intent whose `finalized_at` is still null and whose claim has gone stale, so a run that died mid-handler can be re-entered. The old form gave once-only rather than at-most-once and made three documented repair paths unreachable. See `PAYMENTS.md`, "The shared capture gate is re-enterable".

**New error on the session branch: `SESSION_CANCELLED` (409).** `_shared/finalize-session-payment.ts` read the session's status and never looked at it, so a capture landing on an already cancelled or declined session returned `outcome: "captured"` and the athlete was told their booking succeeded. It now raises `SESSION_CANCELLED` with a message stating plainly that the booking was not created and a refund is owed. The client must render that message and must not collapse it to a generic payment failure: the athlete HAS been charged. The intent deliberately stays `captured` with `finalized_at` null so the debt is queryable in `unfinalized_captures`. There is still no code path that pays it back; see `PAYMENTS.md`, "Captured against a dead entity".

## courts

Identical pattern to sessions, per PLAN.md's "Courts lifecycle = Sessions lifecycle verbatim" rule. State machine: `confirmed` to (`completed` or `cancelled` or `rescheduled` or `no_show`); rating is a column write, not a further status.

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `list` | GET `/courts` | PostgREST | `courts` select joined to `venues`, filters as query params | RLS restricts to `venues.status = 'verified'` |
| `get` | GET `/courts/:id` | PostgREST + RPC | `courts` select + `get_court_busy_slots(court_id, from, to)` + `get_court_rating_summary(court_id)` | mirrors `coaches.get`, hides other athletes' booking detail; the rating summary call is required because `court_bookings`' own RLS scopes row reads to the booking's own athlete or the venue's partner/staff, so the aggregate star rating cannot come from a direct `court_bookings` select (`0015_court_rating_summary.sql`) |
| `book` | POST `/courts/:id/book` | Edge Function | `book-court` | creates `payment_intents` + `court_bookings` (`confirmed`), re-prices server side, also the path `portal-court`'s walk-in form calls (partner-scoped variant, same function, service-role bypasses payment for a walk-in flagged `booking_source='walk_in'`) |
| `cancel` | POST `/court-bookings/:id/cancel` | RPC | `court_booking_transition(id, 'cancel', reason)` | releases the slot (unique index) unless the start time has passed, in which case it becomes `no_show` per PRD-03 FR-18 |
| `reschedule` | POST `/court-bookings/:id/reschedule` | RPC | `court_booking_transition(id, 'reschedule', date, slot)` | `SLOT_TAKEN` on conflict |
| `rate` | POST `/court-bookings/:id/rate` | RPC | `rate_court_booking(id, rating, remarks)` | only from `completed`, once |

## portal-court (v2-only, no v1 mock)

`apps/portal-court` has no v1 mock to map from (v1 had no partner-facing surface at all); these ship in `0009_courts.sql` alongside the courts domain tables, same pattern as "Edge functions not in the v1 contract" below.

| Function | Called by | Note |
|---|---|---|
| `submit_venue_verification(payload)` (RPC) | Venue onboarding wizard, Review and submit step (PRD-03 FR-1 through FR-6) | `SECURITY DEFINER`, mirrors `submit_coach_verification`: grants `court_partner`, creates the `venues` row (`status='pending'`), its `courts`, optional `venue_photos`, and a `verification_requests` row (`applicant_type='venue'`), atomically. The only path that can ever create a venue; the plain `venues` RLS insert policy requires `has_role('court_partner')` already true and exists only for a partner's later, already-verified additional venue |
| `accept_venue_staff_invite(venue_staff_id)` (RPC) | Staff invite acceptance link (PRD-03 FR-28) | `SECURITY DEFINER`, sets `accepted_at`; a trigger on that same update grants the `court_staff` role, matching `SCHEMA.md`'s `venue_staff` note |
| `court_booking_check_in(booking_id)` (RPC) | Today dashboard check-in action (PRD-03 FR-16) | Not a status transition (`court_bookings.status` stays `confirmed`), sets `checked_in_at`; venue partner/staff only |
| `get_court_available_slots(court_id, date)` (RPC) | Consumer app `SlotPicker`, portal-court walk-in form's slot picker | Read only, `SECURITY DEFINER`. Availability windows minus blackouts minus non-cancelled bookings for one date, with the peak-adjusted price per slot; complements `get_court_busy_slots` above (that one returns occupied pairs over a range for the court detail/calendar read, this one returns the actual bookable list for one date) |

### `apps/portal-court/src/app/onboarding/*` (PRD-03 FR-1 through FR-7)

Client wiring lives in `apps/portal-court/src/lib/onboarding.ts`, one typed module per FR rather than `.rpc()`/`.from()` calls scattered across the wizard's step pages (`venue-details`, `courts`, `photos`, `review`, `pending`).

| Screen | Call | Note |
|---|---|---|
| `venue-details`, `courts` steps | `submit_venue_verification(payload)` (RPC), called at the end of the **Courts** step, not "Review and submit" | The wizard's prose order in PRD-03 3.1 puts Photos before Courts before Review; the actual call order here is Venue details -> Courts (submits) -> Photos -> Review (read only), because the Photos step (FR-3) uploads to the `venue-media` bucket, whose RLS (`0014_venue_media_bucket.sql`) requires an already-existing, partner-owned venue at `{venue_id}/...`. There is no draft-venue storage path, so the venue must exist before any photo can upload. The end state matches PRD-03's acceptance criterion (venue + >=1 court + >=3 photos + one `verification_requests` row) regardless of call order |
| `photos` step | `venue_photos` insert (PostgREST), `venue-media` storage upload | Both already RLS-scoped to the caller's own venue (`venue_photos_insert_own`, `venue_media_partner_insert`); no new policy needed |
| `pending` step (FR-6, status + rejection reason) | `venues` select (PostgREST), latest row by `created_at` | Reads `venues.status`/`venues.rejection_reason` directly, not `verification_requests`: `0003_moderation_audit.sql` ships no authenticated select/insert policy for `applicant_type = 'venue'` (only a `'coach'`-scoped one), so a non-admin caller cannot read that table for their own venue at all. `venues_select_own` already carries everything FR-6 needs |
| `pending` step, "Edit and resubmit" (FR-6) | `submit_venue_verification(payload)` again, with the draft prefilled from the rejected venue's current fields/courts | **Known gap, not a new migration**: there is no RPC that updates a rejected venue in place or flips its `status` back to `pending_review` for a non-admin caller (`status`/`rejection_reason` are locked to the admin verification RPCs by `lock_venue_admin_fields`, and `submit_venue_verification` always inserts a brand new `venues` row, it has no "existing venue id" input). "Edit and resubmit" therefore creates a second, fresh venue + verification request; the original rejected venue row is left in place, unreferenced by any onboarding route going forward. If the founder wants true same-row resubmission, that needs a new `resubmit_venue_verification(venue_id, payload)` RPC, flagged here rather than added speculatively |
| `dashboard/layout.tsx` gate (FR-7) | `venues` select (`status = 'verified'`), `venue_staff` select (`accepted_at is not null`) | Not part of `onboarding/*` itself, but the enforcement point for FR-7: any authenticated partner with zero verified venues and no accepted staff membership is redirected to `/onboarding` before any `/dashboard/*` page renders |

## shop

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `products` | GET `/products` | PostgREST | `products` select joined `product_variants`, `recommended_rank` field for the rail | RLS public read, `active = true` |
| `product` | GET `/products/:id` | PostgREST | `products` select single | `404` from PostgREST's `.single()` no-row error |
| `getCart` | GET `/cart` | PostgREST | `cart_items` select joined `product_variants` | RLS `user_id = auth.uid()` |
| `addToCart` | POST `/cart/items` | RPC | `add_to_cart(variant_id, qty)` | server re-checks live stock before upsert, raises `OUT_OF_STOCK` and caps rather than silently rounding, per PRD-07 FR-9 |
| `updateCartItem` | PATCH `/cart/items/:productId` | RPC | `update_cart_item(variant_id, qty)` | same stock re-check as `addToCart` |
| `removeCartItem` | DELETE `/cart/items/:productId` | PostgREST | `cart_items` delete | own-row RLS, no stock check needed on removal |
| `checkout` | POST `/orders/checkout` | Edge Function | `checkout` | re-fetches prices and stock for every line, recomputes the bill, rejects `PRICE_MISMATCH` or `OUT_OF_STOCK`, decrements stock and creates the `orders`/`order_items` rows atomically on Razorpay success (via `razorpay-webhook`) |
| `orders` | GET `/orders` | PostgREST | `orders` select | RLS `user_id = auth.uid()` |
| `order` | GET `/orders/:id` | PostgREST | `orders` select single joined `order_items`, `order_timeline` | same RLS |
| addresses | GET/POST `/me/addresses` | PostgREST | `addresses` select / insert | `PINCODE_INVALID` raised by a `BEFORE INSERT` trigger validating the `CHECK` pattern, caught and mapped client side. `DELETE` additionally passes the `0036` guard, raising `ADDRESS_IN_USE` (in-flight order, PRD-07 FR-30) or `ADDRESS_ON_PAST_ORDER` |

**As built in P4 Track A (AT-65 through AT-70), additions to the rows above.**

| Lane | Name | Callable by | Note |
|---|---|---|---|
| View | `product_variant_availability` | `anon`, `authenticated` | **The one definition of available stock.** Every shopper-facing stock read (PDP FR-4, cart FR-9, checkout FR-18) selects from this, never from `product_variants.stock`, which is raw inventory. Columns in `SCHEMA.md` |
| RPC | `variant_available_stock(uuid)` | `anon`, `authenticated` | Scalar form of the view, itself a select from it |
| RPC | `add_to_cart(p_variant_id, p_qty)` | `authenticated` | Additive. Returns `cart_mutation_result` (`qty`, `requested_qty`, `available_stock`, `capped`). Caps rather than raising when the request exceeds available, because FR-9 requires both the notice and the capped line to persist and an exception would roll the cap back. Raises `OUT_OF_STOCK` only when available is zero (nothing to cap to), `NOT_FOUND` for a delisted product, `UNAUTHENTICATED` for the FR-7 guest gate |
| RPC | `update_cart_item(p_variant_id, p_qty)` | `authenticated` | Absolute set, same result shape and same capping rule. Refuses `qty <= 0`; removal is the direct own-row `DELETE` (FR-10) |
| RPC | `toggle_product_wishlist(p_product_id)` | `authenticated` | Atomic insert-or-delete in one CTE statement, avoiding the read-then-write race a client toggle would otherwise introduce. Returns `true` if now wishlisted (FR-6) |
| RPC | `reserve_stock_for_checkout(p_payment_intent_id, p_lines jsonb)` | `service_role` | Called by `checkout` before Razorpay. Locks variants `FOR UPDATE` in id order, raises `OUT_OF_STOCK` naming every offending line, `ALREADY_RESERVED` on a repeat intent. All lines or none |
| RPC | `consume_reservation(p_payment_intent_id)` | `service_role` | Called by `finalize-order-payment.ts` in the same transaction as the order inserts (FR-21). Guarded decrement, idempotent on webhook redelivery, raises `OUT_OF_STOCK` on the late-capture loss path (caller then refunds via AT-60), `NO_RESERVATION` if the intent never reserved |
| RPC | `release_reservation(p_payment_intent_id, p_reason)` | `service_role` | Payment failure exit. Touches `product_variants` not at all |
| RPC | `release_expired_stock_reservations()` | `service_role` | Abandonment sweep, the commerce arm AT-26 calls. Not scheduled by `0033` |
| RPC | `order_transition(p_order_id, p_to_status, p_actor_id, p_note, p_location)` | `service_role` | The whole order machine. Raises `INVALID_TRANSITION` on any skip or illegal edge, writes one `order_timeline` row in the same transaction. `service_role` only per AT-61's rule, so `admin-order-advance` is the sole path and the shopper app never writes a transition (FR-24) |

### affiliate marketplace, client reads (0086 WS4, extended Phase S3 Track F)

`packages/api/src/use-shop.ts`'s `listAffiliateProducts`/`getAffiliateProduct`, the client
side of the `/shop` grid and the `/shop/affiliate/[id]` compare screen.

| Lane | Name | Callable by | Note |
|---|---|---|---|
| PostgREST | `listAffiliateProducts({ sport?, query? })` | `anon`, `authenticated` | `affiliate_products` select joined `product_offers` (adds `retailer_key`), `.eq("active", true)` explicit (mirrors the public browse policy per CLAUDE.md's scoping rule), ordered `created_at desc`, limit 60. Backs `/shop`'s empty-query grid (PHASE-S3-STATUS.md hard decision 3: the catalogue, newest first, never price sorted here). A typed query on `/shop` does not call this; it goes through `search.aiSearch` below instead |
| PostgREST | `getAffiliateProduct(id)` | `anon`, `authenticated` | Same select, single row. Backs `/shop/affiliate/[id]` and hydrates a typed `/shop` query's `affiliate:`-prefixed hits (below) |
| — (mapping only) | `AffiliateProduct.cheapest` | n/a | Client-derived, not a new column: the head of `offers` after the existing cheapest-in-stock-first sort (`{ price, retailer, lastCheckedAt }`, null when every offer is out of stock). `retailerCount` is `offers.length`. Both feed `GearResultTile` directly (FR-40, FR-41) |

`/shop`'s typed query path calls `useSearch(client).search({ query, entityTypes: ["gear"], sport, priceMax })`
(the existing `ai-search` contract above, unchanged), then hydrates each `SearchHit` through
`getAffiliateProduct` (an `affiliate:`-prefixed `entityId`) or `getProduct` (an owned one, only
rendered while `shop.owned_enabled` is true) rather than trusting the hit's own lean shape, so
the grid tile always has the freshness and retailer count fields the hit itself does not carry.

## config

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `useAppConfig(client).get(key)` / `.getBoolean(key, fallback)` | n/a (no v1 equivalent) | PostgREST | `app_config` select, explicit `.eq("public", true)` | New, Phase S3 Track F, PRD-07 FR-53. Reads `app_config`'s `value` column for a public row only; never throws (a read failure or a missing/non-public key resolves to `undefined`/`fallback`). 5 minute in-memory cache per key. The only consumer today is `shop.owned_enabled` (`shop/index.tsx`, `shop/_layout.tsx`'s owned-route redirect, `RecentlyViewedRail`), read once per mount rather than once per app start as IA-SHOP.md's phrasing suggested, since a hook has no "app start" hook of its own. The only write path is `admin_set_app_config` (`0122_app_config_owned_shop_flag.sql`), admin only, audited; no client write exists for this table |

## wishlist (gear)

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `toggle` | PUT `/wishlist/:productId` | RPC | `toggle_product_wishlist(product_id)` | atomic toggle (insert-or-delete in one statement), avoids a read-then-write race the client could otherwise introduce |
| `list` | GET `/wishlist` | PostgREST | `product_wishlist_items` select joined `products` | RLS `user_id = auth.uid()` |

## clutch

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `feed` | GET `/clutch/feed` | PostgREST | `clips` select, `status = 'published'`, keyset pagination on `created_at` | RLS public read restricted to `published`; owner can additionally read their own clip in any status. `Clip.ownerAvatarUrl` is `public_profiles.avatar_url` from the same embed (`CLIP_FEED_SELECT`), passed through only when it is an absolute http URL, for the post header and the reels overlay; `Clip` carries no playback URL (minted per card by `playbackUrl`) and no hydrated top comment |
| `get` | GET `/clutch/:id` | PostgREST | `clips` select single | same RLS |
| `comments` | GET `/clutch/:id/comments` | PostgREST | `clip_comments` select, keyset pagination | RLS public read |
| `addComment` | POST `/clutch/:id/comments` | PostgREST | `clip_comments` insert | RLS requires a non-anonymous `auth.uid()`, guest insert rejected, mapped to `403 GUEST` |
| `upload` | POST `stream-upload-url` (edge), then a direct signed PUT, then POST `stream-webhook` (edge) | Edge Function | v1 storage adapter: `stream-upload-url` creates the own clip row at `status='uploading'` AND mints the signed Storage upload URL (bucket `clips`, private) in one call, returning `{ clipId, uploadUrl, token, path }`; the client PUTs the MP4 to `uploadUrl`, then calls `stream-webhook { clip_id }` to finalize `uploading -> ready`. See `VIDEO.md` v1 storage-adapter contracts. Row status only ever moves via `clip_transition_internal` under service role |
| `playbackUrl` | POST `get_clip_playback_url` (edge) | Edge Function | public-callable; body `{ clip_id }` returns a 300s signed URL only for a `published` clip, the owner's own clip, or admin/moderator; refuses (403, no URL) for `removed`/`rejected`. Never stores a resolved URL. See `VIDEO.md` |
| `playbackUrls` (Phase 3 LAUNCH CT-1, P1-1) | POST `get-clip-playback-url` (edge), batch body | Edge Function | client: `useClutch(...).getPlaybackUrls(clipIds, kind)` (`packages/api/src/hooks.ts`), CLIENT SIDE of the endpoint Track B owns and documents fully above/near CT-1 in `docs/phases/PHASE-3-STATUS.md`. Body `{ clip_ids: string[] (<= 24), kind: 'thumb' \| 'video' }`, response `{ urls: [{ clip_id, url, expires_at }], failed: [{ clip_id, reason }] }`, thumb TTL 3600s / video TTL 300s. The client chunks any longer id list into `<= 24`-id calls with `<= 4` in flight at once (never sends an oversized batch, never floods the function), so a call site never has to. Consumers: `apps/mobile/src/app/profile/index.tsx`'s own-clips/liked/saved grids (`kind: 'thumb'`), replacing the old one-`getPlaybackUrl`-call-per-tile mint. The clutch feed and post detail keep the single legacy `{ clip_id }` body (one active/prefetched card at a time is not a flood) |
| `moderationUrl` | POST `get_clip_moderation_url` (edge) | Edge Function | admin/moderator only; the distinct grant that previews a not-yet-published clip (PRD-04 FR-28); same 300s signed URL, refuses for `removed`/`rejected` |
| `creator` | GET `/clutch/creators/:id` | PostgREST | `public_profiles` select joined aggregate `clips`/`follows` counts (a Postgres view `creator_stats`, rebuilt over `public_profiles` in `0074`) | public read |
| `like` | PUT `/clutch/:id/like` | RPC | `toggle_clip_like(clip_id)` | atomic toggle, maintains `clips.likes_count` via the same transaction; `403 GUEST` if anonymous |
| `follow` | PUT `/clutch/creators/:id/follow` | RPC | `toggle_follow(followee_id)` | atomic toggle; `403 GUEST` if anonymous |
| `retryFailedClip` (Phase 3 LAUNCH CT-6, P1-6) | tap Retry on a `failed` own clip | RPC + Edge Function | client: `useClutch(...).retryFailedClip(clip)` calls `retry_failed_clip(p_clip_id)` (Track A, `0094_clip_failed_state_and_sweep_capture.sql`; owner-scoped SECURITY DEFINER, the only client path off `failed` since clients hold no UPDATE grant on `clips`), then immediately `requestUploadUrl({ caption, sport, clipId })` against the SAME row (now back in `uploading`, the only status `stream-upload-url` will reuse rather than 409). Both are real round trips, no client-side status flip. UI: `apps/mobile/src/app/profile/index.tsx`'s own-clips grid shows `failure_reason` + a Retry tile for any `failed` clip, then routes to `(tabs)/clutch/upload` prefilled (`retryClipId`/`retryCaption`/`retrySport`) so the athlete can pick a replacement file and finish the post against the same clip id |

**Phase 4 LAUNCH (CT-C, `0097_report_block.sql`): `getFeed`/`getComments` filter blocked
authors.** Both subtract the caller's own `blocked_users` set (via `getBlockedUserIds`,
below) from the returned rows client side; the pagination cursor is still derived from the
UNFILTERED page so a block never causes a page to skip rows. See "moderation" below.

## moderation (report + block, Phase 4 LAUNCH Track C, CT-C)

PRD-04 FR-31, FR-32, FR-33; App Store 1.2 / Play UGC policy (a store approval
requirement). `packages/api/src/hooks.ts` exports `useModeration(client)` plus a
plain, non-hook `getBlockedUserIds(client)` both `useClutch` (above) and `useChat`
(below) call internally to subtract the caller's own blocked set from what they
return, since a hook's body cannot call another hook. Reports land in the SAME
`reports` table and admin Reports Queue (`apps/admin/src/pages/reports`) that
clip/comment reports already used (`0041-0043`), now also accepting
`entity_type: 'chat_message' | 'user'`.

| Method | v2 lane | Function / RPC | Note |
|---|---|---|---|
| `useModeration(...).reportEntity({ entityType, entityId, reason })` | PostgREST | `reports` insert | own-row insert (`reporter_id = auth.uid()`, `NOT is_guest()`, unchanged `reports_insert_own` policy); `entityType` is `'clip' \| 'comment' \| 'chat_message' \| 'user'`; empty-trimmed `reason` refused client side AND by the table's `btrim(reason) <> ''` check; lands `pending` in the same admin Reports Queue clip/comment reports already use |
| `useModeration(...).getBlockedIds()` | PostgREST | `blocked_users` select | own rows (`blocker_id = auth.uid()`); empty set for a guest, no round trip cost beyond one no-op query |
| `useModeration(...).blockUser(userId)` | PostgREST | `blocked_users` upsert | own-row (`blocker_id = auth.uid()`), `onConflict: 'blocker_id,blocked_id'` so blocking an already-blocked user is a no-op success; refuses a self-block client side (`VALIDATION`) ahead of the schema's own `check (blocker_id <> blocked_id)` |
| `useModeration(...).unblockUser(userId)` | PostgREST | `blocked_users` delete | own-row delete; idempotent, no error if the row never existed |
| admin: `admin_get_reported_entity(p_report_id)` | RPC | `apps/admin/src/pages/reports/api.ts`'s `fetchReportedEntity`/`fetchReportedEntitySummaries` | admin/moderator only (internal `has_role` check, `FORBIDDEN` otherwise); returns ONE reported entity's jsonb snapshot for ONE existing report; the only read path onto a chat message's content (no blanket admin SELECT policy on `chat_messages`, RLS.md Phase 4 section); also serves `clip`/`comment`/`user` report types for a single uniform admin read shape, though the Reports Queue detail screen still uses the pre-existing direct table reads for `clip`/`comment` (unchanged, already proven) |
| admin: `resolve_report(p_report_id, p_action, p_reason)` | RPC | `apps/admin/src/pages/moderation/api.ts`'s `moderationApi.removeReport`/`dismissReport` (unchanged call sites) | `create or replace`, `0043`'s `clip`/`comment` branches byte-for-byte unchanged; gains a `chat_message` remove arm (soft-delete via `removed_at`/`removed_reason`, `chat_messages` immutability otherwise preserved) and a `user` remove arm (resolves the report `actioned`, no further mutation; account suspension is Track B's separate `admin_suspend_user`, from the User Detail screen, a deliberately separate audited step) |

## empower

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `upas` | GET `/empower/upas` | PostgREST + RPC | `upa_applications` select (`status='verified'`) + `get_empower_stats()` | stats RPC sums `ledger_entries` for `account_type='upa_fund'`, never a cached counter, per PRD-06 FR-3 |
| `upa` | GET `/empower/upas/:id` | PostgREST | `upa_applications` select single, `status='verified'` only | RLS makes an unverified id unresolvable regardless of how it was obtained (PRD-06 requirement) |
| `donate` | POST `/empower/donate` | Edge Function | `donate` | body `{ upa_id, item_id?, amount, expected_total?, method? }`; validates the UPA is still verified and the item not already funded at request time (independent of client cache), rounds/floors `amount` server side, writes ONLY `payment_intents` (`domain='donation'`, `entity_id` NULL) + a `donation_drafts` staging row + the Razorpay order. The `donations` row, `ledger_entries` group (`debit platform / credit upa_fund(upa_id)`, no fee leg) and `upa_wishlist_items.funded_amount` are written atomically ON CAPTURE by `finalize-donation-payment` (the 4th branch of the shared finalize gate). Error codes: `NOT_FOUND` 404 (UPA not verified or item missing), `ITEM_FUNDED` 409, `MIN_AMOUNT` 422, `PRICE_MISMATCH` 409, `RAZORPAY_ERROR` 502 |
| `myImpact` | GET `/empower/impact` | PostgREST + RPC | `donations` select (own) + `get_my_impact_summary()` | summary RPC reads `ledger_entries`/`donations` scoped to `auth.uid()`, never a client-side sum of a possibly-stale local list |
| `moneySummary` | RPC | RPC | `upa_money_summary(p_upa_id)` | 0084, QA money-in remediation. SECURITY DEFINER, scoped inside to OWNER (`applicant_user_id = auth.uid()`) OR any VERIFIED upa, granted `anon, authenticated, service_role`. Returns `{ upa_id, total_raised (ledger, upa_fund_balance), donor_count (distinct donor_id), items (per-item DERIVED funded map from donations, never funded_amount cache), supporters[], gratitude[] }`. Read-only; the portal dashboard/wishlist read it. |
| `upa` (rebuilt) | GET `/empower/upas/:id` | RPC | `public_upa_profile(p_upa_id)` | 0084 rebuild: each item's `funded_amount` is now DERIVED from donations grouped by item, and the payload adds `donor_count`, `supporters[]`, and published `gratitude[]`, so the consumer public profile and the portal preview render coherent money-in. `total_raised` stays ledger-derived; null for any non-verified id unchanged. |

## learn (P7, AT-132)

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `learnHome` | GET `/learn/home` | RPC | `get_learn_home()` | SECURITY DEFINER, self-scoped to `auth.uid()`. Returns jsonb `{ sport, xp_total, current_stage, next_stage, stages[], milestones[] }`. `xp_total` is DERIVED `sum(xp_events.xp_amount)` (no counter column); `current_stage` is the top `roadmap_stages.stage_order` for the player's primary sport (`athlete_sports.is_primary`) whose `xp_threshold <= xp_total`; `milestones[]` each carry an `earned` flag from the caller's `user_milestones`. `sport: null` => the FR-48 empty state. `authenticated`/`service_role` only |
| `drillLibrary` | GET `/learn/drills` | PostgREST | `drills` select | consumer read MUST carry its own `.eq('active', true)` (permissive-OR public catalog, RLS.md). Filterable by `sport`/`difficulty` |
| `markDrillComplete` | POST `/learn/drills/:id/complete` | PostgREST | `drill_completions` insert (own row) | the ONE client write in the XP path. The `0059` `AFTER INSERT` trigger appends the `xp_events` row (amount server-read) and unlocks milestones; a duplicate fails `UNIQUE(user_id, drill_id)` (idempotent, no redo) |
| `adminUpsertDrill` | POST `/admin/drills` (create, `p_id` null) / PATCH `/admin/drills/:id` (edit) | RPC | `admin_upsert_drill(p_id, p_title, p_description, p_sport, p_skill_category, p_difficulty, p_xp_value, p_media_url)` (`0061`) | admin drill create/edit (PRD-04 FR-49/FR-50). SECURITY DEFINER, `has_role('admin')` inside, one `audit_log` row per accepted mutation (`drill.create` / `drill.update`, edit diff via `audit_changed_fields`). Validates `xp_value > 0` (mirrors the `0057` CHECK). Owns content fields only, never `active`. `authenticated` only; `apps/admin` calls it via `drillApi.upsertDrill`, never a direct `drills` write |
| `adminSetDrillActive` | POST `/admin/drills/:id/active` | RPC | `admin_set_drill_active(p_id, p_active)` (`0061`) | admin activate/deactivate (PRD-04 FR-51). SECURITY DEFINER, `has_role('admin')` inside, one `audit_log` row per flip (`drill.activate` / `drill.deactivate`). A flag flip, never a delete: inactive drills stay intact for reactivation and for the `xp_events` referencing them; the consumer surface hides them via its own `active = true` filter. `authenticated` only |
| `adminUpsertAffiliateProduct` | POST `/admin/gear` (create, `p_id` null) / PATCH `/admin/gear/:id` | RPC | `admin_upsert_affiliate_product(p_id, p_title, p_brand, p_sport, p_category_id, p_skill_level, p_age_range, p_description, p_image_url)` (`0120`) | admin gear catalog entry. SECURITY DEFINER, `has_role('admin')` inside, `audit_log` row per mutation (`affiliate_product.create` / `.update`). The tables carry no client write grant, so this RPC is the only client write path. `apps/admin` calls it via `gearApi.upsertProduct` |
| `adminSetAffiliateProductActive` | POST `/admin/gear/:id/active` | RPC | `admin_set_affiliate_product_active(p_id, p_active)` (`0120`) | list / delist, never delete. Audited (`affiliate_product.activate` / `.deactivate`) |
| `adminUpsertProductOffer` | PUT `/admin/gear/:id/offers/:retailer` | RPC | `admin_upsert_product_offer(p_affiliate_product_id, p_retailer, p_price, p_affiliate_url, p_in_stock, p_currency)` (`0120`) | one retailer line; `(product, retailer)` is unique so a re-entered retailer updates in place (this is how a price refresh is entered). Validates `price >= 0` and an `http(s)://` link. Audited (`product_offer.create` / `.update`) |
| `adminDeleteProductOffer` | DELETE `/admin/gear/offers/:id` | RPC | `admin_delete_product_offer(p_id)` (`0120`) | removes a wrong retailer line. Audited (`product_offer.delete`) |
| `ingestFetch` | POST `/admin/gear/ingest` (`action: "fetch"`) | Edge function | `gear-ingest` | FR-44, ADR-011 D3. Admin JWT forwarded. Server-side fetch of the pasted URL, extraction only, writes nothing (no product row, no offer row, no image copy). Returns `{ draft, retailerKey, warnings[] }`; 422 with `{ error: { code, message }, draft?, retailer_key, warnings, upstream_status? }` on an unsupported retailer (`UNSUPPORTED_RETAILER`), a robots.txt disallow (`ROBOTS_DISALLOWED`), an outbound guard refusal (`BLOCKED_TARGET`), a supported retailer that refused the fetch (`RETAILER_UNAVAILABLE`: the programme's `fetchable` is false so no request is made and `upstream_status` is null, or the page answered 403, 429 or 5xx and `upstream_status` carries it; admin UX A3-T2, proven by `scripts/verify-gear-ingest-honesty.mjs`), or a page with no recognisable product (`NO_PRODUCT_FOUND`, FR-47). The partial `draft` on a 422 is what the manual form prefills. `apps/admin` calls it via `gearApi`-adjacent `ingestFetch` in `pages/gear/api.ts`, from the "Add from a link" section on `/gear/create` |
| `ingestSave` | POST `/admin/gear/ingest` (`action: "save"`) | Edge function | `gear-ingest` | FR-45, FR-46, ADR-011 D3. Admin JWT forwarded, never service role, for the catalogue write: the function copies the image into the `product-images` bucket (hash-deduped) then calls `admin_upsert_affiliate_product` and `admin_upsert_product_offer` under the caller's own JWT, so `has_role('admin')` inside those RPCs stays the one gate. Returns `{ productId, offerId, imagePath }`. `apps/admin` calls it via `ingestSave`, navigates to `/gear/show/:id` on success |
| `fetchHealth` | GET `/admin/gear/health` | PostgREST | `affiliate_products` + `product_offers` select (health columns) | FR-49, ADR-011 D4. Admin-only read (same admin SELECT policy `fetchGear` already relies on); computes worst-outcome ordering, offers-alive count, cheapest in-stock price and its age, and days since `health_checked_at` client side. Backs `/gear/health` |
| `recheckProduct` | POST `/admin/gear/:id/recheck` | Edge function | `gear-recheck` (`{ productId }` form) | FR-50, ADR-011 D4. Admin JWT, one product, the "Re-check now" action on `/gear/health` and `/gear/show/:id`; the `{ sweep: true }` form is the nightly job's own, service role only, never called from `apps/admin`. Returns `{ checked, outcomes[] }` |
| `fetchLatestSuggestions` | GET `/admin/gear/:id/suggestion` | PostgREST | `product_fetch_log` select (`ai_suggestion` not null, admin-only per ADR-011 D6) | FR-52. Scoped explicitly to this product's own `product_offers.id` list before reading the log (the table carries no `affiliate_product_id` column of its own), the permissive-OR rule in CLAUDE.md. Renders as a read-only "AI suggestion" card on `/gear/show/:id`; the copy states the suggestion is never applied automatically |
| `adminCreateVenue` | POST `/admin/venues` | RPC | `admin_create_venue(p_name, p_address, p_city, p_pincode, p_lat, p_lng, p_description, p_booking_url, p_courts jsonb)` (`0120`) | one venue plus its courts in one transaction, owned by the entering admin, `status = 'verified'` by construction. Requires at least one court (the Courts tab lists courts, not venues), a six digit pincode, paired coordinates, an `http(s)://` booking link if given. Audited (`venue.admin_create`) |

## wallet / notifs / help

| v1 fn | v1 route | v2 lane | Function / RPC | Note |
|---|---|---|---|---|
| `coachWallet` | GET `/wallet` | RPC | `get_coach_wallet_balance()` | sums `ledger_entries` for `account_type='coach', account_ref=auth.uid()`; `403 NOT_COACH` if no coach role |
| `transactions` | GET `/transactions` | RPC | `get_my_transactions(kind?, limit?, offset?)` | one reverse-chronological feed shaped like v1's `Transaction`, unioning the caller's own `payment_intents` (charges) with their own `ledger_entries` (earnings and payouts); a plain PostgREST select cannot do this because it spans two sources with different shapes |
| `notifs.list` | GET `/notifications` | PostgREST | `notifications` select | RLS `user_id = auth.uid()` |
| `notifs.markRead` | POST `/notifications/:id/read` | PostgREST | `notifications` update, sets `read_at` | own-row RLS |
| `help.submitTicket` | POST `/support/tickets` | PostgREST | `support_tickets` insert | own-row RLS, returned row id is the v1 `ticketId` |

### wallet and transactions, as built (AT-44)

Both shipped in `0025_wallet_and_transactions_rpcs.sql`, both `security definer`, `stable`, granted to `authenticated` only, and both scoped exclusively by `auth.uid()`. Neither takes an owner id parameter, because a parameter is something a client can lie about, and a definer function bypasses the `ledger_entries_select_own` RLS policy that would otherwise be the backstop.

`get_coach_wallet_balance()` returns one row `{ balance, lifetime_earned, lifetime_transferred, this_month }`. `balance` is `sum(credits) - sum(debits)` over `account_type='coach' AND account_ref=auth.uid()`, which is what the coach may transfer out today; `this_month` counts credits since the start of the current calendar month in Asia/Kolkata, the same timezone `session_transition` uses. Raises `NOT_COACH` (403) when the caller has no `coach_profiles` row, so "not a coach" and "a coach with zero earnings" stay distinguishable. Nothing is stored: every number is computed at call time.

`get_my_transactions(p_kind, p_limit, p_offset)` returns `{ id, kind, domain, entity_id, amount, direction, status, description, occurred_at }`. `kind` is `charge` (a `payment_intents` row the caller paid for), `earning` (a ledger credit to their coach or court partner account), or `payout` (a ledger debit, a transfer out). `direction` is from the caller's point of view, `in` or `out`, deliberately not the ledger's debit/credit convention. `p_kind` matches either a `kind` value or a `payment_domain` value (`session`, `court`, `commerce`, `donation`); null returns everything. `p_limit` is clamped to 1..200.

**Deviation from the AT-44 ticket, recorded.** The ticket describes `get_my_transactions` as unioning `sessions`, `court_bookings`, `orders`, and `donations`. Two of those tables do not exist yet, and unioning domain tables would force an edit to this function every time a domain ships. `payment_intents` already carries `domain`, `entity_id`, `amount`, `status`, and `created_at` for every domain including the unbuilt ones, so commerce and donations will appear in this feed with no change here. The binding constraint, that every figure is derived and no stored balance column exists anywhere, holds either way.

## groups (Groups phase, v2-only, no v1 mock)

Training groups with monthly subscription fares (founder-ratified: manual renewal on the one-time payment rails, no autopay, capacity guarded in the join RPC). Client surface is `useGroups` in `packages/api/src/use-groups.ts`; schema 0076 to 0081, money path in `PAYMENTS.md` "Membership fares".

| Client call | Backing | Note |
|---|---|---|
| `listMyGroups` / `listGroupsForCoach` | `training_groups` reads + `get_group_member_counts` RPC | training_groups is permissive-OR (public browse of active groups), so both carry explicit coach_id filters; counts come from the definer RPC, identities never leak |
| `getGroup` | `training_groups` + `group_memberships` + `public_profiles` + `session_participants` | members list is complete for the coach, self-only for a member (RLS); attendance rate = present / (present + absent) over marked participant rows, per member and whole group |
| `createGroup` / `updateGroup` | `create_training_group` / `update_training_group` RPCs (0080) | coach-owned; deactivate, never delete; capacity cannot drop below live members |
| `joinGroup` | `join-group` edge function | `POST { group_id, expected_total }`, athlete JWT. Server re-prices (PRICE_MISMATCH 409), the RPC guards capacity under the group row lock (GROUP_FULL / ALREADY_MEMBER / GROUP_INACTIVE 409, all BEFORE Razorpay), returns `{ membership_id, group_id, status, razorpay_order_id, key_id, amount, currency, bill }` for the checkout sheet |
| `renewMembership` | `renew-group-membership` edge function | `POST { membership_id, expected_total }`, same response shape; `active` or `expired` memberships (`0104`: an expired member still holds their seat and renews on the same row, a lapsed member re-joins because their seat was released); re-snapshots the fare at today's price |
| `verifyMembershipPayment` | shared `verify-payment` | same function every domain uses; response gained a `membership_id` alias; capture activates the membership (period today .. +1 month IST, renewal extends) and writes the carve-out ledger group |
| `myMemberships` | `group_memberships` read, player_id = me | hydrated with the member-readable group rows |
| `groupSessions` / `sessionParticipants` | `sessions` (group_id filter) / `session_participants` | coach full, member self-scoped |
| `getGroupSession` | `sessions` single read, id AND coach_id = me AND group_id not null, embeds `training_groups` | Track B's group session detail screen; a 1:1 id returns null here, mirroring how `useCoachSessions.getSession` returns null for a group id |
| `createGroupSession` | `create_group_session` RPC | inserted `accepted`, zero money columns, participants seeded from active members, SLOT_TAKEN on a coach slot clash |
| `startGroupSession` / `completeGroupSession` | `session_transition` `'start'` / `'complete'` | 0077: start is coach-only from accepted, no time gate; complete via the client door is allowed ONLY for group sessions (no money half), 1:1 stays on complete-session |
| `markAttendance` | `mark_attendance` RPC | coach-only, session must be `in_progress` (INVALID_TRANSITION), marks only active members (NOT_A_MEMBER), no money effect |
| `getGroupThreadId` | `chat_threads` context_type 'group' | one thread per group, trigger-created; messages flow through the existing chat_messages surface, group SELECT/INSERT policies enforce membership (delivery is Broadcast, see the CT-4 note below, gated by `realtime.messages` RLS) |
| `useChat().listThreads` / `getThread` (group threads) | `chat_threads` + `training_groups` (scoped to context_ids from the caller's own thread rows) + `chat_thread_members` count | `ChatThread` gained `isGroup` / `groupName` / `memberCount` / `lastSenderName`; a group row's `participantName` holds the group's name so an unaware caller still renders something sane |
| `useChat().listMessages` / `sendMessage` / live inbound (group threads) | `chat_messages` (sender embedded via `users!sender_id`) | `ChatMessage` gained `senderName`, joined on every PostgREST read; the Broadcast payload below carries no join, so the thread screen backfills it from the loaded roster |
| `useChat().listThreadMembers` | `chat_thread_members` joined to `users` | group thread's seated roster for the members sheet (ChatThreadList / conversation screen, COACH-TRAININGS-GAP.md screen 17); RLS (`chat_thread_members_select_member`) scopes to threads the caller is seated in; empty list for a 1:1 thread rather than an error |

**Phase 4 LAUNCH (CT-C, `0097_report_block.sql`): block + removed-message filtering.**
`useChat().listThreads` drops a 1:1 thread whose other participant is on the caller's own
`blocked_users` list (group threads are never dropped this way); its preview candidates
also exclude a moderator-removed message's text and any message from a blocked sender.
`useChat().listMessages` drops messages from a blocked sender entirely and renders "This
message was removed." in place of a moderator-removed row's real text (`chat_messages.
removed_at` set via `resolve_report`'s chat arm, see the "moderation" section above and
RLS.md). The live Broadcast listener (`subscribeToUserChannel`, below) does NOT re-check
either list mid-session, documented rather than silently promised: a screen reload
(the next `listMessages`/`listThreads` call) closes that gap.

**Chat live delivery moved to Broadcast (CT-4, P1-2, PHASE-3-STATUS.md Phase 3, Track A serves / Track D consumes).** Prior to Phase 3, `useChat().subscribeToThread`/`subscribeToInbox` each opened a `postgres_changes` subscription on `chat_messages`; the server re-evaluated `chat_messages` RLS for every subscriber on every insert, the P1-2 meltdown class at 1000 concurrent chat users. Both are gone, replaced by one method:

- An `AFTER INSERT` trigger on `chat_messages` (Track A) calls `realtime.send()` once per row in `chat_thread_members` for that thread (sender included), to topic `chat:user:{member_user_id}`, event `message_new`, payload `{ thread_id, message_id, sender_id, body, created_at }` (column values as text/ISO strings).
- `realtime.messages` RLS (Track A) allows a socket to subscribe ONLY its own `chat:user:{(select auth.uid())::text}` topic; a private channel, `{ config: { private: true } }`, is required for that policy to evaluate at all.
- `useChat().subscribeToUserChannel(userId, threadId, onMessage, onStatusChange)` subscribes the caller's own `chat:user:{userId}` topic. `threadId` is optional: the thread screen passes its own id to filter to one conversation, the inbox omits it to see every thread's events. Multiple mounted call sites for the SAME `userId` (the inbox behind an open thread) share one physical Realtime channel via a ref-counted registry in `use-chat.ts`, since the contract calls for exactly one channel per signed-in user, not one per screen. Returns an unsubscribe function; the shared channel is only actually torn down once its last subscriber releases it.
- `ChatThreadList` and the thread screen (`apps/mobile/src/app/(tabs)/chat/[id].tsx`) both consume this; `git grep postgres_changes` over `packages/api/src/use-chat.ts` and the chat app/component trees returns nothing as of this change.
| `listMyTraineeNotes` / `addTraineeNote` / `deleteTraineeNote` | `coach_trainee_notes` | coach-private, insert gated by `coach_has_trainee`, no update ever |
| `listTraineeSessions` / `listTraineePayments` | `sessions` (coach_id = me AND player_id = trainee) + memberships join | the trainee profile tabs; payments derive from coach-readable rows since payment_intents is owner-only |
| `getTraineeProfile` | `public_profiles` | Track C, trainee profile Overview tab identity (name/handle/bio); `users` base table stays own-row/admin only so this never touches it |

**Call sites, added by the coach creation layer.** `createGroup`, `updateGroup` and `createGroupSession` shipped with 0079/0080 and had ZERO callers until now, which is what the coach saw as "No training groups yet" and "No sessions scheduled for this group yet" with no affordance beside either. They are now called from `trainings/group/edit.tsx` (create and edit, keyed on an optional `id` param) and `trainings/group/schedule.tsx`. Both assert ownership explicitly on load before rendering a group, because `training_groups` carries a public browse policy and RLS is not scoping; the RPCs refuse the write regardless, but the form must never show a stranger's fee. `createGroupSession` is the only thing in the product that inserts a row with a `group_id`, so it is also what makes the group session detail, Start Session and attendance screens reachable at all.

**`in_progress` in status filters.** 0077 added `in_progress` between `accepted` and `completed`, and several client filters were never updated, so a session the coach had started disappeared from the reader's world until it completed: `useCoachSessions.listUpcoming`, the `hasUpcoming` flag in `useCoachTrainees.listTrainees`, and the `LIVE_STATUSES` lists behind the athlete's bookings screen and the Trainings stat tiles (plus the Trainings payments totals, where it fell out of both delivered and booked ahead). A first pass claimed "all now include it" here and was wrong: a repeat sweep found two more survivors in files this branch itself edited, `(shell)/index.tsx`'s athlete `upcomingSessions` filter (feeding `totalUpcomingCount`, four lines above the group session filter that already had this right) and `(shell)/coaches.tsx`'s `isUpcoming` in `groupByCoach`, which dropped the next-session date off the My coaches row the moment the coach tapped Start. Both are fixed now, and a subsequent sweep over every `.status === 'accepted'` and `'accepted'` occurrence across `apps/mobile/src` found no further survivors, but the count in this doc is only as good as the last sweep, not a guarantee. Any new filter over `sessions.status` should be written as "everything except `declined` and `cancelled`" rather than by enumerating the live states, which is how this class of bug got in six times now.

**Group awareness retrofitted onto `useCoachSessions` / `useCoachTrainees` (Track B).** Group session rows share `sessions` with a NULL `player_id`/`session_type_id` (0076), so every 1:1 shaped coach read now scopes them out explicitly: `listUpcoming` and `getSession` add `player_id is not null` (an accepted group session must never render as a broken 1:1 card, and a group id passed to `getSession` returns null), `listTrainees` filters them out of the roster and additionally joins `session_types.name` to flag each trainee `hasOnline` / `hasInPerson` for the Figma filter chips (`isOnlineSessionTypeName`: a session type whose name contains "online", the gap doc's representation; no flag column exists). `getStats` counts group sessions in `totalSessions` / `sessionsThisMonth` but never in `playersCoached`, and now also returns `totalSessions` plus `lifetimeEarnings` (from `get_coach_wallet_balance().lifetime_earned`, same figure as the Earnings screen) for the dashboard's Total Sessions / Total Earnings tiles.

## Edge functions not in the v1 contract

PLAN.md's edge function roster includes several functions v1 never had a mock for, because v1 had no real payments or video pipeline. They exist to back the coach, court partner, and admin surfaces (PRD-02, PRD-03, PRD-04) and the payment/video internals every v1 endpoint above ultimately calls into.

| Function | Called by | Note |
|---|---|---|
| `razorpay-create-order` | `book-session`, `book-court`, `checkout`, `donate` (each calls this internally, not exposed as its own client-facing endpoint) | single shared helper that creates the Razorpay order with `notes: {domain, entity_id}`, see `PAYMENTS.md` |
| `razorpay-webhook` | Razorpay servers, not a client | confirms payment/capture, writes `ledger_entries`, advances the domain entity out of its "awaiting payment" implicit state. Handles `payment.captured`, `payment.failed`, (AT-60) `refund.processed`, and (AT-43) `transfer.processed` / `transfer.failed`. `refund.processed` resolves the event to one `refunds` row and calls `settle_refund`, which no-ops if already settled. `transfer.processed` resolves to one `transfers` row by `razorpay_transfer_id`, creating it via `record_transfer` if this system never recorded it, then calls `settle_transfer`. `transfer.failed` resolves without creating, then calls `fail_transfer`, which writes the reversing credit group. Every handler is a no-op on redelivery, both through the `webhook_events` insert-before-act gate keyed on the `x-razorpay-event-id` HEADER and through each RPC's own terminal-state short circuit |
| `cancel-session-refund` | athlete session detail, when the session is `requested` | AT-60. Cancels an unanswered request and refunds it in full, automatically. Contract and error codes in the sessions section above |
| `decline-session-refund` | coach session detail, when the session is `requested` | CO-04 (`0085`). Declines an unanswered, already-paid request and refunds it in full, automatically. Coach-side mirror of `cancel-session-refund`, reusing the same `refunds` + `settle_refund` machinery. Contract and error codes in the sessions section above |
| `razorpay-route-onboard` | coach Payout Account Setup, `portal-court` Payout Account | starts Route linked-account KYC hand-off. Built AT-42. `POST { owner_type: 'coach' \| 'court_partner', venue_id? }` with the caller's own JWT (`verify_jwt` true), `venue_id` required for `court_partner`. Returns `{ payout_account_id, owner_type, owner_id, razorpay_account_id, status, onboarding_url, created }`. Errors `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `RAZORPAY_ERROR` 502, `ROUTE_UNAVAILABLE` 503, `INTERNAL` 500. Idempotent on `(owner_type, owner_id)`: an existing `razorpay_account_id` makes the call a status poll (`created: false`), never a second sub-merchant. Sole writer of `payout_accounts`, service role only. Route is not yet enabled on the test merchant account, see `PAYMENTS.md` |
| `razorpay-route-transfer` | coach Transfer screen, admin never | creates a Route transfer, writes `transfers` + a balancing `ledger_entries` group. Built AT-43. `POST { amount }` (rupees, at most 2dp) with the caller's own JWT (`verify_jwt` true). The coach is resolved from `auth.uid()`, never from the body, and the amount is a request the server re-derives against, never an authority (PRD-02 FR-28). Returns `{ transfer_id, razorpay_transfer_id, amount, status, ledger_entry_group_id, balance_before, balance_after }` with `status: 'processing'`; `transfer.processed` moves it to `paid`. Errors `VALIDATION` 400, `UNAUTHENTICATED` 401, `NOT_COACH` 403, `PAYOUT_ACCOUNT_NOT_ACTIVE` 409, `INSUFFICIENT_BALANCE` 409, `RAZORPAY_ERROR` 502, `ROUTE_UNAVAILABLE` 503, `INTERNAL` 500. Every failure writes no `transfers` row and no `ledger_entries` row (FR-29). Route is not yet enabled on the test merchant account, so today every balance-passing call returns `ROUTE_UNAVAILABLE` 503, see `PAYMENTS.md` |

### Payouts, manual (`0130`, 2026-09-25)

Route is closed to ELSHEPH (PAYMENTS.md, "Manual payouts"), so the two Route rows above describe
deployed but unused paths. Coaches and venues are paid by admin. All of these are Postgres RPCs;
each raises `CODE: message` and `mapPostgrestError` surfaces the code.

| RPC | Caller | Contract |
| --- | --- | --- |
| `upsert_my_payout_method` | coach (mobile), venue partner (portal-court) | named args `p_owner_type`, `p_method_type`, `p_account_holder_name`, optional `p_venue_id` (required for `court_partner`), `p_account_number`, `p_ifsc`, `p_vpa`, `p_pan`. Ownership from `auth.uid()`; staff refused. Returns `{ payout_account_id, payout_status, method (masked), changed }`. Identical resubmission is `changed: false` and keeps verification; any change returns the account to `pending`. `VALIDATION`, `FORBIDDEN`, `UNAUTHENTICATED` |
| `get_my_payout_method` | same | `p_owner_type`, optional `p_venue_id`. Returns `{ payout_account_id, payout_status, method (masked, last four only), balance, eligible_balance }` |
| `admin_payouts_due` | admin Payouts page | `p_min_amount`. Everyone the ledger says is owed, INCLUDING payees with no details (`verification_status: 'missing'`), with balance, eligible balance and in-flight amount. `FORBIDDEN` for non-admins |
| `admin_reveal_payout_method` | admin | `p_payout_account_id`, `p_reason` (required). Full details; writes `audit_log` `payout_method.reveal`. `NOTE_REQUIRED` |
| `admin_verify_payout_method` | admin | `p_payout_account_id`, `p_decision` (`verify` or `reject`), `p_note` (required to reject). Verify makes the account `active`; reject makes it `needs_attention` |
| `admin_record_manual_payout` | admin | `p_payout_account_id`, `p_amount`, `p_reference` (UTR, 6 to 40 alphanumerics), `p_note`. Returns the `transfers` row, `processing`. `PAYOUT_ACCOUNT_NOT_ACTIVE`, `PAYOUT_METHOD_NOT_VERIFIED`, `INSUFFICIENT_BALANCE` (eligible balance), `DUPLICATE_REFERENCE` |
| `admin_resolve_manual_payout` | admin | `p_transfer_id`, `p_outcome` (`paid` or `failed`), `p_note` (required for `failed`). Failed writes the reversing ledger group |
| `stream-upload-url` | Clutch Upload screen, and scriptable for verification | v1 storage adapter (Cloudflare deferred, `VIDEO.md` line 153). `POST { caption, sport, clip_id? }` athlete JWT, returns `{ clipId, uploadUrl, token, path, bucket, status }`, clip row set to `uploading`. `sport` in football|cricket|badminton|tennis. Client PUTs the MP4 to `uploadUrl` (or supabase-js `uploadToSignedUrl(path, token, file)`) |
| `stream-webhook` | v1: the uploader's own client, synchronously after the signed PUT (Cloudflare Stream deferred) | `POST { clip_id, thumb_path? }` flips a clip forward `processing` to `ready` via `clip_transition_internal` under service role, returns `{ clipId, status, outcome: 'finalized' \| 'already_finalized' }`, idempotent like `razorpay-webhook` (redelivery is a no-op); see `VIDEO.md` v1 storage-adapter contracts |
| `get-clip-playback-url` | Clutch feed and post detail; public-callable (guests pass anon key) | Legacy body `POST { clip_id }` returns `{ clipId, url, thumbUrl, expiresIn: 300, status }`, unchanged. **New (LAUNCH Phase 3, CT-1):** `POST { clip_ids: string[] (max 24), kind?: "video" \| "thumb" }` returns `{ urls: [{ clip_id, url, expires_at }], failed: [{ clip_id, reason }] }`, 200 even on partial failure (a forbidden/missing id lands in `failed`, never aborts the batch). Same live-row authz as the legacy body for every id: `published` open to anyone, owner in any status, admin/moderator for non-terminal, `removed`/`rejected` refused for everyone but the owner. TTL: `video` 300s (unchanged), `thumb` 3600s. **Rate limit (CT-2):** a per-IP token bucket (`clip-playback-ip`, 60 req/60s, Postgres-backed `take_rate_limit_token`) sits in front of BOTH bodies; over it returns `429 { "error": "RATE_LIMITED", "retry_after_seconds" }`. Fails OPEN on a rate-limit RPC error (never 500s this read path). Never stores a resolved URL. Implementation shared from `supabase/functions/get-clip-playback-url/handler.ts` |
| `get-clip-playback-urls` (LAUNCH Phase 3, alias) | same callers as above | A second deployed function name, delegating to the SAME handler as `get-clip-playback-url` (one authz decision, one shared `clip-playback-ip` bucket, no second front door). Accepts the identical batch body `{ clip_ids, kind? }` (and the legacy `{ clip_id }` body, for symmetry). Callers should prefer POSTing the batch body to `get-clip-playback-url` directly; this alias exists because this track's build dispatch named it explicitly. See `get-clip-playback-urls/index.ts` for the recorded rationale |
| `get-clip-moderation-url` | `apps/admin` Moderation Queue preview; admin/moderator JWT | `POST { clip_id }` same shape as playback mint but admin-gated; 403 for non-admins and for removed/rejected |
| `coach-trainee-video-upload-url` (Track F, WRITTEN NOT DEPLOYED) | coach's trainee profile Video Analytics tab (`TraineeVideoAnalytics` organism) | Mirrors `stream-upload-url` for coach trainee video review. `POST { player_id, caption? }` coach JWT, verifies `player_id` is actually one of the caller's trainees (a `sessions` row exists), creates the `coach_trainee_videos` row, returns `{ videoId, uploadUrl, token, path, bucket }`. Client PUTs the video to `uploadUrl`. Bucket is the existing private `clips` bucket, path prefix `coach-videos/{coach_id}/{player_id}/` |
| `get-coach-trainee-video-url` (Track F, WRITTEN NOT DEPLOYED) | `TraineeVideoAnalytics` organism (coach) and `my-videos` screen (athlete) | Mirrors `get-clip-playback-url`, scoped private (no public path at all): `POST { video_id }` returns `{ videoId, url, expiresIn: 300 }` for the video's coach or its player only; 403 for anyone else, 404 for an unknown id or a row with no `storage_path` yet |
| `notify-dispatch` | every RPC/edge function that writes a `notifications` row, fan-out to device push | Built AT-146, device push transport landed Phase 4 Track D (launch plan decision 7). SERVICE-ROLE ONLY (`verify_jwt` true; `assertServiceRoleRequest` additionally requires the bearer equal the service key, since a dispatch writes an arbitrary `user_id`). `POST { userId, type, title, body, deepLink }` or `{ notifications: [ ... ] }` (snake_case `user_id`/`deep_link` accepted). Two legs: leg 1 writes the `notifications` row (the in-app delivery, fully implemented, the only writer of that row per 0002's grant model); leg 2 is device push over the **Expo Push API** (`https://exp.host/--/api/v2/push/send`), batched <=100 messages per request, payload `{ to, title, body, data: { deepLink, type } }`. Prefs are reconciled across BOTH stores per decision 8: the caller is suppressed if EITHER the per-type `notification_prefs.push_enabled` (0002) OR the mapped `users.notification_prefs` jsonb category (0087; `booking` -> `sessions`, `chat` -> `messages`, all other types unmapped and governed by 0002 alone) opts out. A ticket error `DeviceNotRegistered` deletes that `push_tokens` row (service role); any other per-token failure is reported but the token is left in place. Transport failure never throws into leg 1: the in-app row is already committed. Returns `{ dispatched: [ { notificationId, userId, pushSuppressed, deviceDeliveries: [ { token, platform, status: 'sent' \| 'failed' \| 'pruned', detail? } ] } ] }`. Callers may also import `dispatchNotification`/`parseNotificationInput` from `_shared/notify.ts` to run the same orchestration inline. SQL RPCs that already write a `notifications` row directly (`moderate_clip` 0043, `record_donation_from_draft` 0054, the verification RPCs 0066) get in-app delivery for free by that insert and do not route through this function, so those paths do NOT get the Expo push leg unless/until they are moved onto `dispatchNotification`. Errors `VALIDATION` 400, `FORBIDDEN` 403, `INTERNAL` 500. Deploy: `supabase functions deploy notify-dispatch` (redeploy every function importing `_shared/notify.ts` or `_shared/supabase.ts` alongside it, orchestrator step per PHASE-4-STATUS.md dependency order). Founder/native-gated for REAL on-device delivery: FCM V1 service-account credentials (Android) and an APNs `.p8` key (iOS) loaded into EAS, plus a new native build carrying the `expo-notifications` module; buildable-now proof stops at the Expo API HTTP contract and `push_tokens` registration, see `docs/phases/PHASE-4-STATUS.md` Track D |
| `push_tokens` registration (PostgREST, via `packages/api/src/use-push.ts`) | app start on `signed_in`, `apps/mobile/src/hooks/use-push-registration.ts` | Not an edge function: a plain owner-scoped PostgREST upsert/delete against `push_tokens` (owner-CRUD RLS since 0002, no migration needed this phase). `register({ token, platform })` upserts on the unique `token` column with `user_id = auth.uid()`; `unregister(token)` deletes the caller's own row (also called with the just-departed session's access token on sign-out, since the client's session is already cleared by the time `status` observably flips, see `apps/mobile/src/lib/push.ts` `deletePushTokenWithAccessToken`). The token itself comes from `expo-notifications`' `getExpoPushTokenAsync({ projectId })`, EAS project id `5976cc18-8fc3-4a97-9a3d-c767ad542d69`; a tap on a delivered push routes `data.deepLink` through `expo-router`'s `router.push`, the same navigation `/notifications` already uses |
| `admin-order-advance` | `apps/admin` Order Detail | the only path that can move `orders.status` forward, writes `order_timeline` + `audit_log` |
| `admin-order-refund` | `apps/admin` Order Detail refund action | new function beyond PLAN.md's original list (see PRD-04 open question 2), calls Razorpay refund API, writes `ledger_entries` |
| `admin_approve_verification_request` (RPC, not an edge function) | `apps/admin` Verification Detail approve action | `SECURITY DEFINER` RPC (`supabase/migrations/0007_admin_verification_rpcs.sql`), not an edge function, since it needs no third-party call, just an atomic multi-table write under elevated privilege: admin/moderator only (`has_role`), sets `verification_requests.status='approved'`, mirrors onto `coach_profiles.status` for `applicant_type='coach'` (venue/upa branches are no-ops until those tables exist), writes exactly one `audit_log` row. Exists because `audit_log` carries no `authenticated` write policy at all (`RLS.md`), so the admin client cannot write it directly; PRD-04 FR-9/FR-53. As of `0066` it also writes one `verification` `notifications` row to the applicant (FR-9), in-app delivery |
| `admin_reject_verification_request` (RPC) | `apps/admin` Verification Detail reject action | same shape as above, requires a non-empty `p_reason`, sets `status='rejected'` + `rejection_reason`, mirrors `coach_profiles.status='rejected'`; PRD-04 FR-10/FR-53. As of `0066` the rejection reason is delivered to the applicant as a `verification` `notifications` row (FR-10, in-app delivery), in addition to being recorded in `audit_log` |

### The two SQL notification emitters

Two SQL emitters were added alongside `notify-dispatch` and, like the RPCs listed in the table above (`moderate_clip`, `record_donation_from_draft`, the verification RPCs), write the `notifications` row directly rather than routing through that function:

- `notify_session_parties(p_session_id uuid, p_action text) returns int` — `service_role` only (`0103`). Called by `session_transition_internal` on `accept`, `decline`, `start` and `complete`. Writes one `session` type notification per athlete party (the 1:1 `player_id`, or every `session_participants` row for a group session) and never to the acting coach. Returns the number written.
- `sweep_group_memberships() returns jsonb` — `service_role` only (`0104`), scheduled as `membership-sweep` daily. Writes `membership` type notifications for the renewal reminder, expiry and lapse. See SCHEMA.md "The membership sweep".

**That relay now exists, and it is a sweeper rather than a trigger (`0110` plus the post-deploy script that used to be `0111`, SCALE-REALTIME R-7).** The premise the paragraph above rested on, that the push leg was still the P9 stub, expired: the Expo transport in `_shared/notify.ts` is fully implemented, so "the row is written and nothing pushes" stopped being a no-op and became the P0 that an athlete whose coach starts a session is told nothing and the 03:30 IST membership reminder reaches nobody.

- `notify-push-sweep` (edge function, SERVICE-ROLE ONLY, same `assertServiceRoleRequest` boundary as `notify-dispatch`). `POST {}` or `{ limit }`. Calls `claim_notification_push_batch(p_limit)`, which claims rows with `pushed_at is null` using `for update skip locked`, groups the claimed rows by identical `(type, title, body, deep_link)`, and pushes each group with `pushContentToUsers`. Rows older than 30 minutes are checkpointed without sending. Returns `{ claimed, pushed, suppressed, noDevice, retrying, expired }`. Deploy: `supabase functions deploy notify-push-sweep`.
- `notification-push-sweep` (pg_cron job, `supabase/deploy/notification_push_sweep_schedule.sql`, moved out of `supabase/migrations/0111_*` on 2026-08-14 because it depends on two Supabase Vault secrets that a migration file cannot carry across environments) posts to it every 30 seconds over pg_net, authenticated from two Supabase Vault secrets, `project_url` and `service_role_key`. **The script REFUSES to install the job if pg_net or either secret is missing**, because a job that 403s every 30 seconds into `net._http_response` looks healthy in `cron.job` and delivers nothing. Not yet run against production as of 2026-08-14; see `docs/DEBT.md`.
- Not a trigger, and not a database webhook, deliberately. A per-row webhook fires once per recipient (so a group of 50 is 50 single-recipient HTTP calls, which is SCALE-REALTIME R-6 reintroduced), leaves no mark when it fails so nothing can retry, and would put an outbound HTTP call inside the transaction that moves a session's status. The four-point argument is in `0110`'s header.

**Batching, R-6.** `notify-dispatch`'s per-recipient sequential loop is gone. `_shared/notify.ts` now exports `pushContentToUsers(service, content, userIds)` and `dispatchNotificationFanout(service, content, userIds)`: one bulk insert, bulk prefs and `push_tokens` reads chunked at 200 users, then Expo requests of up to 100 tokens each **across recipients**, paced against Expo's 600-per-second project allowance and bounded to 6 in flight. `notify-dispatch`'s request and response shapes are unchanged; identical content is grouped internally, so a group session roster is one Expo request rather than one per athlete.

When the real APNs/FCM transport lands, the relay belongs on the `notifications` table itself, one trigger covering every domain, rather than being re-plumbed per RPC.

---

## Bounded reads (scale, 10k target)

Recorded 2026-08-14 alongside the sweep that bounded every unbounded read in
`packages/api`. Read `docs/qa/verify/SCALE-CLIENT.md` and
`docs/qa/verify/SCALE-DATABASE.md` for the measurements behind these numbers.

**The mechanism, because it changes what "unbounded" means here.** PostgREST
applies a silent server side row cap to every select on this project. Verified,
not assumed: of 751 `WITH pgrst_source` statements in `pg_stat_statements`,
**0 carry `LIMIT ALL`** and **670 carry a parameterised `LIMIT $n OFFSET $m`**.
PostgREST emits the literal `LIMIT ALL` when a query is genuinely unbounded, so
a numeric limit on a query the client issued with no `.limit()` proves a
`db-max-rows` is set. The consequence is that an unbounded read is not slow, it
is **truncated with a 200 OK**, and nothing anywhere in the stack says so. Where
the client's `.order()` is ascending, the rows dropped are the ones the user
actually wants.

**The cap's value is still UNREAD.** It is a PostgREST environment variable, not
a database setting, so it is not in `pg_db_role_setting` and cannot be read over
SQL. Read it from the Supabase dashboard (Settings, API, "Max rows") and record
it here. Every page size below is chosen to sit comfortably under any plausible
value precisely because nobody knows the real one.

### Signature changes

All three are backwards compatible: every existing call site passes no
argument and gets the default page.

| Method | Before | After |
|---|---|---|
| `useCourts().listMyBookings()` | no args, no owner filter, unbounded | `listMyBookings(limit = 50)`, plus an explicit `.eq("user_id", auth.uid())` |
| `useEmpower().listUpas()` | no args, unbounded, one RPC per row | `listUpas(limit = 48)`, one batched balance RPC |
| `useNotifications().list()` | no args, unbounded | `list(limit = 50)` |
| moderation | `useClutch().report(entityType, entityId, reason)` | Inserts `reports`. `reporter_id` comes from the session, never an argument. Reason capped at 500 chars. |
| moderation | `useClutch().blockUser(userId)` | Upsert into `user_blocks`, idempotent. The subtraction is RLS (0097, table `blocked_users`), not this call. |
| moderation | `useClutch().unblockUser(userId)` | |
| moderation | `useClutch().blockedUserIds()` | Owner scoped read for an unblock list. UI not yet built. |
| account | `useProfile().deleteAccount()` | Invokes the `delete-account` edge function. Caller MUST sign out immediately after. |
| search | `POST ai-search` | Now rate limited to 30 requests per 60s per user AND per IP, enforced before the two Anthropic calls. Returns `429 RATE_LIMITED` with a `Retry-After` header. |
| chat | `useChat().threads()` | Previews now come from `chat_thread_previews` (0113) instead of a client-side fold over every message. |

### Behaviour changes

- **`useChat().listMessages(threadId)` now returns the NEWEST page, not the
  oldest.** It still returns oldest-first within that page, so render order is
  unchanged. The old query was `created_at ASC` with no limit, which under the
  server cap returned the OLDEST N rows: a long thread opened to messages from
  months ago with no way to reach today, and the message the user had just sent
  vanished on the next open. There is no "load older" affordance yet, so a
  thread longer than 50 messages currently starts at the 50th most recent.
- **`useChat().listThreads()` no longer downloads every message in every
  thread.** It calls the `chat_thread_previews` RPC and falls back to a bounded
  batch read when that function is absent. See below.
- **`useEmpower().listUpas()` no longer fans out one HTTP request per verified
  UPA.** It calls `upa_fund_balances` and falls back to a bounded worker pool
  (5 at a time) over the existing per-row RPC.

### Depends on migration 0113, which is NOT applied

`0113_bounded_reads_support.sql` adds `chat_thread_previews(uuid[])`,
`upa_fund_balances(uuid[])` and `idx_notifications_user_created`. The applied
migration ceiling on `syzzfgaudpifwvbpycyi` is **0097** (checked in
`supabase_migrations.schema_migrations`), so **both functions are absent in
production today and both fallback paths are the live ones.**

That is deliberate, not an oversight. Each client checks for PostgREST's
`PGRST202` schema-cache miss (and Postgres's `42883`) and degrades; any other
error still surfaces. So applying 0113 is an improvement, never a prerequisite,
and the gap between merging this and applying it does not break either screen.

What is already fixed without 0113, and what still waits for it:

| Fix | Live now | Needs 0113 |
|---|---|---|
| Bookings: owner filter, Seq Scan to Index Scan | yes | no |
| Every explicit `.limit()` | yes | no |
| Empower: no more N-wide request fan-out | yes, via the worker pool | one-call version |
| Chat inbox: payload cut ~100x | yes | exactly one row per thread |
| Notifications: no more full-history sort | bounded, sort remains | sort removed by the index |

The one thing the fallback does NOT fix is a blank preview on a thread quiet
longer than the newest bounded window, because PostgREST has no `DISTINCT ON`.
That case only disappears when 0113 is applied.

### Reads deliberately left unbounded

Fourteen, each checked rather than skipped. Two shapes:

- **Bounded by a primary key `.in()`**, so the result is one row per id and the
  caller's own page already sizes it: `public_profiles` (four sites),
  `training_groups` by id (two sites), `session_types` by id, `clip_likes` and
  `clip_saves` (unique on `(clip_id, user_id)`).
- **Bounded by the schema, not by users or time**: `user_roles` (role enum),
  `notification_prefs` (max 8, `unique (user_id, notification_type)` against an
  8 value enum, both verified in the catalog), `shopper_categories` (4 rows),
  `fee_config` (7 rows), `promo_banners` (3 active rows).

One read is unbounded and **knowingly wrong to bound**: the group member count
in `use-chat.ts`'s `fetchGroupInfo`. `.in("thread_id", ...)` on a non unique
column returns one row per seat, so it is (threads) x (members). A `.limit()`
there would produce a silently WRONG COUNT rather than a short list, and a wrong
member count has already cost this project a full investigation. It needs a
server side aggregate; that is recorded, not half-fixed.

### The checker

`scripts/scan-unbounded-reads.mjs` enumerates every read chain in
`packages/api/src` and classifies it. It is negative-tested: planting one
unbounded read moves the count and removing it moves it back. Run it before
adding a read.
