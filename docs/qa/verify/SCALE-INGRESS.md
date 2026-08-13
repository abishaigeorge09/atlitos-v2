# SCALE-INGRESS: the front door at 10,000 users

Lane: everything a user hits before they see content. Written 2026-08-14 against
`integration/p6-audit-fixes` @ `709bc40` and the live project `syzzfgaudpifwvbpycyi`
(org `Synth_Web_&_App`, plan **pro**, region **ap-south-1**, Postgres 17.6).

Read-only SQL only. No writes, no DDL, no load generated. No simulator, emulator, Maestro or
Metro touched.

Phase 3's P0-4 conclusion is treated as a starting point, not an answer.

---

## Project facts, measured not assumed

Everything in this table came from the live catalog, the project's own logs, or a file in the
tree. Nothing here is inferred from a migration file.

| Fact | Value | How it was established |
|---|---|---|
| Compute size | **Micro** (1 GB RAM, 2 shared vCPU) | `max_connections=60`, `shared_buffers=32768×8kB=256MB`, `effective_cache_size=98304×8kB=768MB`. 256 MB is 25% and 768 MB is 75% of 1 GB. Supabase's compute table gives 60 direct connections for Nano AND Micro, so the memory derivation is what picks Micro. |
| Postgres max connections | **60**, `superuser_reserved_connections=3` → **57 usable** | `pg_settings` |
| Per-role connection limits | none (`rolconnlimit = -1` on authenticator, supabase_auth_admin, supabase_storage_admin, postgres, pgbouncer, service_role, anon, authenticated) | `pg_roles` |
| **PostgREST pool** | **20 connections** | `postgrest_logs`: `"Connection Pool initialized with a maximum size of 20 connections"`, 18 occurrences in 24 h |
| PostgREST version | 14.5, 9 live `authenticator` backends at rest | `pg_stat_activity` |
| GoTrue pool | **NOT MEASURED** | `supabase_auth_admin` had zero backends at every sample. It closes idle connections; observing its max needs load, which is forbidden. |
| Realtime reservation (Micro) | up to 9 connections | Supabase docs, Realtime Concepts connection table |
| Anonymous sign-in | **enabled and working** | 203 rows in `auth.users` with `is_anonymous`, most recent 2026-08-13 19:06 UTC; 56 `/auth/v1/signup` 200s in the last 24 h of `edge_logs`, zero 429s in that window |
| Users today | 227 total (203 anon, 24 real), 1,124 `auth.sessions`, 1,468 `auth.refresh_tokens` | SQL |
| Database size | 24 MB total; `auth.users` 312 kB for 227 rows (~1.4 kB/row) | `pg_database_size`, `pg_total_relation_size` |
| Peak anon mints ever observed | **15 in one hour** (2026-08-11 08:00 UTC) | `auth.users` grouped by hour |
| CAPTCHA / Turnstile | **not configured anywhere** | grep across `docs supabase scripts packages apps` for captcha/turnstile/hcaptcha: zero hits |
| `auth.audit_log_entries` | **empty**, 0 rows for every action | SQL. No IP-distribution evidence exists for this project. |
| Edge functions deployed | 25, all ACTIVE | `list_edge_functions` |

---

## 1. The anon sign-in rate limit, and what 10,000 opens implies

### 1.1 The limit

Every launch mints an anonymous session. `apps/mobile/src/app/(auth)/splash.tsx:120-131` calls
`continueAsGuest()` for any `signed_out` status, with no first-run choice screen in the way. The
session persists in AsyncStorage (`apps/mobile/src/lib/supabase.ts:49-56`), so a re-open does not
re-mint. **Ingress therefore scales with INSTALLS, not with engaged users.**

From the Supabase docs (fetched live through the docs tool, both the Auth Rate Limits page and
the Production Checklist page, which agree):

| Operation | Path | Limited by | Limit | Bucket capacity |
|---|---|---|---|---|
| Anonymous sign-ins | `POST /auth/v1/signup` | **IP address** | **30 requests per hour** | 30 |

The algorithm is a token bucket. Capacity 30, refill 30/hour = **1 token per 120 seconds**. There
is **no project-wide anon signup limit at all**. The only ceiling is per egress IP.

Configurable via the Management API field `rate_limit_anonymous_users`. (The Rate Limits page's
"Customizable" column says No for this row; the Anonymous Sign-Ins page says it "can be modified
in your dashboard" and the documented `PATCH .../config/auth` body includes the field. Treat it
as configurable; the two pages contradict each other and the API is the authority.)

### 1.2 This project's ACTUAL configured value: UNRESOLVED

I could not read it. It requires
`GET https://api.supabase.com/v1/projects/syzzfgaudpifwvbpycyi/config/auth` with a management
token; the Supabase CLI is logged in but stores its token in the macOS keychain, and reading the
keychain was denied by the permission classifier. The MCP surface exposes no auth-config getter.

What the evidence bounds it to, without asserting:

- Nothing in the tree configures it. A grep for `rate_limit_anonymous|anonymous_users|captcha|
  turnstile|hcaptcha` across `docs supabase scripts packages apps` returns one unrelated comment.
- Phase 3 recorded a 429 on this exact path (P0-4).
- `docs/qa/QA-AUDIT-REPORT.md:9` records **124 `over_request_rate_limit` responses** from a single
  4-worker Playwright run. That is password-grant, not anon, but it proves GoTrue's IP limiter
  binds on this project at four concurrent clients.
- Peak anon mints ever observed is 15/hour. Nothing in this project's history would have forced
  anyone to raise the limit.

**Assume 30/hour/IP until someone runs that one curl.** It is a one-command check and it should
be run before launch regardless of anything else in this document.

### 1.3 The arithmetic

Aggregate, which turns out to be the wrong thing to compute:

- 10,000 installs flat over 24 h = 10,000 / 86,400 = **0.12 mints/s**
- Peak hour carrying 20% of the day = 2,000 / 3,600 = **0.56 mints/s**
- Push-driven or single-post launch, 10,000 over 10 minutes = **16.7 mints/s**

None of those matter, because the bucket is per IP and there is no project-wide bucket.

The number that actually breaks, per egress IP:

```
bucket capacity          30 tokens
refill                   30 / hour = 1 token / 120 s
=> instantaneous burst   30 first-opens
=> sustained             1 first-open per 2 minutes, i.e. 30 per hour
```

**Breaking number: the 31st first-open behind a shared egress IP inside a 2-minute window is
refused with 429.**

Restated as a launch requirement. If 10,000 users sit behind K distinct egress IPs and the launch
window is H hours, it survives only when

```
10,000 / K  <=  30 + 30 * H
```

For a 1-hour launch window that needs **K >= 167 distinct egress IPs**. For a 10-minute push
spike, `H = 1/6`, so `10,000/K <= 35`, needing **K >= 286**.

A geographically dispersed 10,000 on home broadband and per-device carrier IPs clears that
easily. K collapses in exactly the scenarios this launch is most likely to use:

- one campus or office wifi behind a single NAT: 30 opens, then 1 every 2 minutes
- CGNAT on an Indian mobile carrier (this is an ap-south-1, India-targeted app): thousands of
  subscribers per public IPv4
- a launch event on one venue's wifi

I have **no measurement of K for this project**: `auth.audit_log_entries` is empty, so the app's
own history carries no IP distribution. K is the single biggest unknown in this lane.

### 1.4 What a refused user experiences

**The app degrades. It does not brick.** Verified in section 3 below, against the live catalog
rather than the migrations.

But the degrade is not free. With no session, `selectRequiresAuthGate`
(`session-store.ts:158`) is true, so every gated tap raises `LoginGateModal`: like a clip,
comment, book a court, open the wallet, notifications, the profile avatar. A refused first-time
user gets a read-only shop window on their first ever run of the app, and no explanation of why.

---

## 2. The retry storm: amplification factor 192x

Two nested retry layers, neither aware of the other.

**Layer 1**, `packages/api/src/hooks.ts:163-176`:

```
const maxAttempts = 3;
...
await new Promise((resolve) => setTimeout(resolve, attempt * 300));
```

3 requests per call, sleeps of 300 ms and 600 ms.

**Layer 2**, `apps/mobile/src/store/session-store.ts:196-218`:

```
const base   = Math.min(60_000, 2_000 * 2 ** (remintAttempt - 1));
const jitter = base * (0.7 + Math.random() * 0.6);      // mean = base
...
auth.continueAsGuest().catch(() => { scheduleBackgroundRemint(); });
```

Each background tick calls `auth.continueAsGuest()` again, so **every tick is 3 more requests**,
not 1. That is the part the Phase 3 comment does not account for.

Tick schedule at mean jitter, in seconds: 2, 4, 8, 16, 32, 60, 60, 60, ... capped at 60.

```
cumulative to the cap   2 + 4 + 8 + 16 + 32 = 62 s over 5 ticks
remaining in the hour   3600 - 62 = 3538 s / 60 s = 58.9 -> 58 ticks
ticks per hour          5 + 58 = 63
requests per tick       3
splash's own call       3
--------------------------------------------------------------
requests per failing device per hour   3 + 63 * 3 = 192
requests per healthy device            1
```

**Amplification factor = 192x per hour, and it never stops.** There is no attempt ceiling, no
give-up condition, and no backgrounding check. The loop runs for as long as the app sits in
`guest_unminted`.

In the first 10 seconds, which is the window the user actually experiences:
3 requests at t = 0, 0.3, 0.9 s, plus tick 1 at ~2 s (3 more), plus tick 2 at ~6 s (3 more) =
**9 requests in 10 seconds, 9x**.

### 2.1 Why this makes a global 429 strictly worse: the starvation mechanism

This is the finding, not the 192 itself.

The bucket refills at **1 token per 120 s per IP**. One already-failed device fires 3 requests
every 60 s, so **6 requests per refill interval**. With N failed devices behind one NAT, the
arrival rate on that IP is `3N` requests/minute = `6N` per refill interval, all competing for a
single token. A brand-new user's first-ever attempt has roughly a

```
P(new user gets the token) ~ 1 / (6N + 1)
```

chance. At N = 10 failed devices behind one carrier NAT, a new user has a ~1.6% chance per
attempt; expected wait `120 s x 61 ~ 2 hours`. And the failed devices themselves can only recover
at 1 device per 120 s, so a pool that accumulated K failures needs `2 minutes x K` to drain while
the storm keeps every new arrival at the back of a random queue.

**The retry policy converts a 2-minute per-IP outage into a multi-hour one for everyone behind
that IP.** The exponential backoff is correct per device and wrong per IP, because the contended
resource is the IP bucket, not the device.

Jitter does not help. Jitter desynchronises devices that failed at the same instant. It does
nothing to the aggregate arrival RATE, which is the only thing a token bucket measures.

### 2.2 The cheapest fix

Code only. No migration, no config. Three edits:

1. **Do not retry a 429 at all.** In `packages/api/src/hooks.ts` `continueAsGuest`, break out of
   the loop immediately when the error is `status === 429` / `code === 'over_request_rate_limit'`
   instead of burning two more attempts against an empty bucket. **192 -> 64.**
2. **Honour `Retry-After`.** GoTrue returns it on 429. Schedule the next remint at
   `max(retryAfterMs, backoff)` instead of the fixed 2 s ladder. Against a 30/hour bucket that is
   minutes, not seconds.
3. **Raise the cap and add a ceiling.** 60 s cap -> 15 min cap, and stop after ~10 attempts or on
   app background. **192 -> under 10.**

---

## 3. The session-less public read path: IT EXISTS, and it is used

Phase 3's P0-4 claim holds for the case it was written for. Verified against the live catalog,
not the migration files, because names built by string concatenation do not appear in a grep.

- `splash.tsx:120-131` calls `continueAsGuest().catch(() => enterGuestUnminted())`.
- `enterGuestUnminted` (`session-store.ts:125-134`) sets `status: 'guest_unminted', hydrated:
  true`, and the effect's first branch (`splash.tsx:106-110`) does `router.replace('/(tabs)')`.
  A refused mint lands in the app.
- **`apps/mobile/src/app/(tabs)/_layout.tsx` contains no session guard.** A grep for
  `status|Redirect|replace|signed_out|guest` in that file returns zero matches. Nothing bounces
  an unminted user back out.
- Every table Home reads has **BOTH** an `anon` RLS SELECT policy **AND** an `anon` table GRANT.
  Both were checked, because a policy without a grant is a silent 401 and they are separate facts:

| Section | Table | Policy (`pg_policy`) | `USING` | anon GRANT SELECT |
|---|---|---|---|---|
| PromoCarousel | `promo_banners` | `promo_banners_select_public` | `active = true` | yes |
| RecentlyViewedRail | `products` | `products_select_public` | `active` | yes |
| " | `product_media` | `product_media_select_public` | EXISTS active product | yes |
| " | `product_variants` | `product_variants_select_public` | EXISTS active product | yes |
| ClutchPreviewCard | `clips` | `clips_select_published` | `status = 'published'` | yes |
| EmpowerRail | `upa_applications` | `upa_applications_select_verified` | `status = 'verified'` | yes |
| CategoriesRow | `categories` | `categories_select_public` | `true` | yes |

- The one edge function on the first-paint path, **`get-clip-playback-url`, is deployed with
  `verify_jwt: false`** (version 6), as is its alias `get-clip-playback-urls` (version 3). Read
  from `list_edge_functions` against the live project, not from `config.toml`. It answers on the
  anon key.
- `useNotifications().unreadCount()` is the only authenticated call on Home and it is gated behind
  `status !== 'signed_in'` (`(tabs)/index.tsx:66`).

So the answer to "does it exist and is it used" is **yes, on both counts**, for a fast refusal.

**But it only covers a FAST failure, and a saturated service fails SLOWLY.** Three gaps.

### Gap A (P0). No request timeout anywhere: the actual brick

`createAtlitosClient` (`packages/api/src/client.ts:17-23`) passes options straight through to
`createClient`. Mobile (`apps/mobile/src/lib/supabase.ts:49-56`) sets only
`auth.{storage, autoRefreshToken, persistSession, detectSessionInUrl}`. **No `global.fetch`, no
AbortSignal, no timeout, anywhere in the monorepo.**

React Native 0.76.9's Android HTTP client is configured with no timeout at all. Verified in the
artifact, at
`node_modules/.pnpm/react-native@0.76.9_.../react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/OkHttpClientProvider.java:58-60`:

```
.connectTimeout(0, TimeUnit.MILLISECONDS)
.readTimeout(0, TimeUnit.MILLISECONDS)
.writeTimeout(0, TimeUnit.MILLISECONDS)
```

Zero means no timeout.

Consequence, and this is the failure a 10x makes MORE likely rather than less: if GoTrue queues
instead of refusing (which is what saturation looks like from the client, connection accepted and
response never sent), `signInAnonymously()` **never resolves and never rejects**. So
`continueAsGuest()` never settles, `.catch()` never runs, and **`enterGuestUnminted()` never
fires**. The splash `ActivityIndicator` (`splash.tsx:151`) spins indefinitely and the entire P0-4
degrade is bypassed. The user force-quits.

A 429 is what you get when the limiter is working. A hang is what you get when the service behind
it is out of capacity. Phase 3 hardened against the first and left the second wide open.

**Breaking number:** any GoTrue response slower than the user's patience, on any Android device.
There is no threshold at which this starts, only a probability that rises with load.

**Fix (code, one file, `packages/api/src/client.ts`):** pass
`global: { fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(8000) }) }`,
or scope the timeout to the auth path only. No migration, no config.

### Gap B (P0). The signed-in ingress path has NO degrade at all

`splash.tsx:115`:

```
if (!me && meError) return; // profile fetch failed: retry state below
```

That holds a returning signed-in user on a full-screen "We could not load your profile" wall with
a Try again button. There is no route into the app.

`getMe()` (`packages/api/src/hooks.ts:277-307`) is **five network calls**: `auth.getUser()`
against GoTrue, serially first, then four PostgREST reads in parallel (`users`, `user_roles`,
`coach_profiles`, `athlete_sports`). It **throws on any of `userError`, `roleError`,
`primaryError`**.

So one transient failure on any of five calls hard-stops a returning signed-in user at the front
door. **Guests degrade gracefully; returning and paying users do not.** That inverts the priority
exactly backwards.

**Breaking number:** at 10,000 returning users this is 10,000 GoTrue `/auth/v1/user` requests and
40,000 PostgREST requests just to render the splash. At a 1% transient error rate that is 100
users stuck on a wall; at the 5% you would expect from a saturated 20-connection pool, 500.

**Fix (code):** on `meError`, route into `/(tabs)` with a degraded profile the same way
`guest_unminted` does, and surface the retry inline instead of as a wall.

### Gap C (P2). `applySession(null)` can silently kill the remint loop

`applySession` (`session-store.ts:237-241`) unconditionally sets `signed_out` for a null session.
`scheduleBackgroundRemint`'s tick (`:204`) stops the loop **permanently** when
`status !== 'guest_unminted'`.

If any late `onAuthStateChange` event carrying a null session lands after `enterGuestUnminted()`:
status flips to `signed_out`; splash's `guestAttempted.current` is already `true` so it will not
retry; `showSpinner` is true for `signed_out` (`splash.tsx:136-137`); and the remint loop kills
itself. Result: a permanent spinner needing an app restart.

The ordering makes this unlikely on a cold start (the `getSession()` seed resolves from
AsyncStorage in well under the ~1.5 s the three mint attempts take), but the code has no guard and
I could not test the race because the device gate forbids the simulator. Filed as P2 on mechanism,
not on an observed failure.

**Fix (code, one line):** make `applySession` refuse to downgrade `guest_unminted` to
`signed_out` when `session == null`.

---

## 4. GoTrue and PostgREST connection limits: where it binds first

### 4.1 The ceiling

```
Postgres max_connections                        60
  less superuser_reserved_connections            3
  ------------------------------------------------
  usable                                        57

PostgREST pool (MEASURED from postgrest_logs)   20   <-- the Data API ceiling
Realtime reservation on Micro (docs)          up to 9
observed at rest: postgres_exporter 1, pg_net 1, pg_cron 1, mgmt-api 1, unnamed 5
GoTrue pool                                 NOT MEASURED
```

**It binds at PostgREST's 20, not at Postgres's 60.** Postgres never sees 57 concurrent backends
from this workload, because PostgREST will not open more than 20 and mobile clients never connect
to Postgres directly at all.

### 4.2 The arithmetic

A PostgREST request holds one pool slot for the length of its transaction:

```
sustained throughput = 20 / mean_transaction_seconds

  5 ms  ->  4,000 req/s
 25 ms  ->    800 req/s
100 ms  ->    200 req/s
```

Beyond that, PostgREST queues on `db-pool-acquisition-timeout` and then returns 503/504. The user
does not see an error: every Home section "hides itself quietly on an empty result or a read
error" (`(tabs)/index.tsx:31-34`), so a saturated pool renders as **a Home screen with silently
missing rails**, which is a much harder thing to notice in a launch-day support queue than a
crash.

Ingress demand at 10,000: one first open costs **4 PostgREST reads** (promo_banners, products,
clips, upa_applications) plus the `get-clip-playback-url` call, which itself performs 2 more DB
round trips (`take_rate_limit_token` RPC and a clips read) ~= **6 DB transactions per open**.

Even the aggressive push-driven case of 16.7 opens/s is ~100 transactions/s, needing
`100 x 0.025 = 2.5` of the 20 pool slots.

**The PostgREST pool is NOT the binding constraint on ingress at 10,000.** Stating that plainly
matters as much as the failures: raising the pool or the compute tier would buy nothing on this
path, and the real risk lives elsewhere (sections 2, 3A and 5.2).

The unmeasured risk is CPU, not connections. Micro is 2 shared vCPU, and every transaction
evaluates RLS predicates, several of which are correlated `EXISTS` subqueries
(`product_media_select_public`, `product_variants_select_public`, `courts_select_public`,
`venue_photos_select_public`). Only the first two are on the ingress path.

### 4.3 GoTrue: unresolved, and it is the service that actually matters here

`supabase_auth_admin` had **zero backends at every sample**, so GoTrue closes idle connections and
its pool max cannot be observed without generating load, which is forbidden. Marked UNRESOLVED.

This is the uncomfortable one: GoTrue is the service on the ingress critical path (signup, token
refresh, and `/auth/v1/user`), it is the service Phase 3 already saw return 429, and it is the one
service whose capacity I cannot measure from here.

### 4.4 A 4x self-inflicted multiplier on GoTrue, found in the logs

`edge_logs`, last 24 hours:

```
/auth/v1/user     200   911
/auth/v1/signup   200    56
```

**16 `/auth/v1/user` calls for every signup.** The cause is in `getFeed`.

`packages/api/src/hooks.ts:1400-1431` `getFeed()` runs `Promise.all([likedClipIds, savedClipIds,
getBlockedUserIds])`, and each of those three (`:1276`, `:1295`, `:1907`) opens with

```
const { data: authData } = await client.auth.getUser();
if (!authData.user || authData.user.is_anonymous) return new Set();
```

The intent is right, the mechanism is wrong. In supabase-js 2.110.2 `getUser()` **always makes a
network round trip** to `/auth/v1/user`; it deliberately does not trust local storage. So the
guest short-circuit spends **three concurrent GoTrue round trips to avoid three cheap PostgREST
reads** — and GoTrue is the bottleneck service, PostgREST is not.

`ClutchPreviewCard.load()` calls `getFeed()` on every Home mount and every pull-to-refresh, so
this is squarely on the ingress path.

**Breaking number:** a minted guest's first open costs `1 signup + 3 getUser = 4` GoTrue requests
instead of 1. At 10,000 first opens that is **40,000 GoTrue requests instead of 10,000**, with the
three `getUser` calls arriving concurrently. A refused (unminted) guest pays 0, because
`getUser()` with no session short-circuits locally — so the app is 4x heavier on GoTrue for the
users it successfully served than for the ones it turned away.

**Fix (code):** these three call sites are pure "am I a guest, skip the query" branches, not auth
decisions. Replace `await client.auth.getUser()` with the locally-cached session
(`client.auth.getSession()`, or read `is_anonymous` from the session store, which already holds
it). Removes 30,000 GoTrue requests from launch day. There are **33 `auth.getUser()` call sites**
in `apps/mobile/src` + `packages` + `supabase/functions`; sweep the class, do not fix only these
three. (The ones inside edge functions are genuine server-side auth checks and must stay.)

---

## 5. Edge function concurrency, and what is on the launch path

### 5.1 The documented limits

From the Supabase docs (Functions > Limits), this project being **Pro**:

| Limit | Value |
|---|---|
| Max memory per worker | 256 MB |
| Max wall clock per worker | **400 s** (paid). A worker serves MULTIPLE requests in that window. |
| Max CPU time | **2 s per request** |
| Request idle timeout | 150 s, then 504 |
| Function-to-function `fetch()` budget | ~5,000 req/min per request chain |

**There is no published per-project concurrent-invocation ceiling.** Supabase autoscales isolates;
every documented limit is per-worker, not per-project. So the honest answer to "how many can run at
once" is: **not publicly bounded, and not measurable from here without generating load.**
UNRESOLVED. It should be treated as unbounded-but-unproven, not as a known-good number.

The function-to-function budget is not relevant: none of the 25 deployed functions call each
other.

### 5.2 What is on the launch path

**Exactly one function runs before the user taps anything:**

- **`get-clip-playback-url`** (`verify_jwt: false`, version 6), called by
  `ClutchPreviewCard.load()` (`ClutchPreviewCard.tsx:42-56`) on every Home mount and every
  pull-to-refresh, to mint the poster and video URL for the single preview clip. Its alias
  `get-clip-playback-urls` (`verify_jwt: false`, version 3) delegates to the same handler.

Nothing else. `ai-search` fires only from the search screen; `checkout`, `book-court`,
`book-session`, `donate`, `join-group`, `renew-group-membership` only on a money or join tap;
`notify-dispatch` is server side; `razorpay-webhook` and `stream-webhook` are inbound.

**Its own rate limiter is per IP too, and it is the same CGNAT problem.**
`docs/architecture/VIDEO.md:178` documents a `clip-playback-ip` token bucket at **60 requests /
60 s**, backed by the Postgres `take_rate_limit_token` RPC. One first open costs 1 request.

**Breaking number: 61 Home opens per minute behind a single shared egress IP.** Over it, 429, and
the preview card falls back to whatever poster the clip row carries (the `catch` at
`ClutchPreviewCard.tsx:52` is silent). Degrades, does not brick. Note it fails **open** on its own
RPC error, so if the database is the thing struggling, the limiter stops limiting at exactly the
moment it is needed.

### 5.3 Every Home open writes to the database, on a row shared by an entire NAT pool

`take_rate_limit_token` is an upsert into `public.edge_rate_limits`, PK `(bucket, key,
window_start)` (`docs/architecture/SCHEMA.md:1349`). Evidence it is live and hot relative to its
size: `pg_stat_user_tables` shows `edge_rate_limits` at **12 live rows, 752 seq scans, 847 index
scans**, and `edge_logs` shows **419 calls to `/rest/v1/rpc/take_rate_limit_token` in 24 hours**.

At 10,000 first opens that is **10,000 writes on the ingress path**, each one WAL, each one taking
a row-level lock. Under CGNAT the bucket key is the shared IP, so **every user behind one carrier
NAT contends on the SAME ROW**.

**Breaking number:** concurrent opens behind one shared IP serialise on a single row lock. At
~1 ms per lock acquisition, 100 concurrent opens produce a ~100 ms tail on the last one; 1,000
produce ~1 s. Those PostgREST pool slots are held for the whole wait, so this is the one place in
the entire ingress path where 10,000 users can make each other measurably slow, and it converts a
per-IP rate limit into a per-IP serialisation point.

**Fix (config first, code second):** cheapest is to widen the bucket key so it is not purely the
IP (append a client-supplied device id, or bucket by `IP + minute + hash(clip_id)`), which spreads
the contention across rows. That is a code change in `supabase/functions/_shared/rate-limit.ts`.
A pure config alternative is to raise the `clip-playback-ip` window so fewer writes occur, but
that weakens the limit rather than fixing the contention.

---

## What genuinely survives 10,000

Each of these was checked against the artifact, and one of them was checked specifically because
my first assumption about it was wrong.

1. **The session-less public read path is real end to end.** Policies AND grants for `anon` on
   `promo_banners`, `products`, `product_media`, `product_variants`, `clips`, `upa_applications`,
   `categories` (`pg_policy` plus `information_schema.role_table_grants`, both queried);
   `get-clip-playback-url` deployed with `verify_jwt: false`; no session guard in
   `(tabs)/_layout.tsx`. A refused mint lands in a working, browsable app.
2. **The Clutch feed query IS indexed.** `idx_clips_status_created_at ON public.clips USING btree
   (status, created_at DESC)` exists in `pg_indexes`. My `EXPLAIN ANALYZE` returned a **Seq Scan**,
   which is what made me check: the planner costs the whole table at 2.48 because there are 34 live
   rows, and it will switch to the index as the table grows. "The plan shows a seq scan" is not
   "there is no index", and I would have filed a false P1 if I had stopped at the plan.
3. **Anonymous sign-in is enabled and healthy right now.** 203 anonymous `auth.users` rows, most
   recent 2026-08-13 19:06 UTC; 56 `/auth/v1/signup` 200s in the last 24 h of `edge_logs` with
   **zero 429s** in that window.
4. **`handle_new_user` is cheap for a guest.** Read from `pg_proc`: one `insert into public.users`.
   The `user_roles` insert is skipped for `is_anonymous`, and the `users.phone` uniqueness probe is
   skipped because a guest carries no phone metadata. Exactly one write per mint, and it cannot
   abort the signup (both risky branches are wrapped).
5. **Storage size is not a constraint.** 24 MB total database; `auth.users` is 312 kB for 227 rows
   (~1.4 kB/row), so 10,000 users is ~14 MB. `auth.refresh_tokens` is 800 kB for 1,468 rows
   (~545 B/row); at the observed 6.5 tokens per user, 10,000 users is ~35 MB.
6. **PostgREST pool headroom is real.** Pool 20 (measured), ingress needs ~6 transactions per open,
   ~2.5 slots at the aggressive 16.7 opens/s. Upgrading compute would buy nothing on this path.
7. **There is no project-wide anon signup limit.** The limiter is purely per IP, so a
   geographically dispersed 10,000 never sees it at all. The whole risk in section 1 is
   concentration, not volume.

---

## UNRESOLVED

1. **The project's actual `rate_limit_anonymous_users`.** Needs
   `curl -X GET "https://api.supabase.com/v1/projects/syzzfgaudpifwvbpycyi/config/auth" -H
   "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | jq '.rate_limit_anonymous_users'`. Blocked:
   the CLI's token lives in the macOS keychain and reading it was denied by the permission
   classifier; the MCP surface exposes no auth-config getter. **30/hour/IP assumed throughout.**
   Run this before launch regardless.
2. **GoTrue's DB pool size.** `supabase_auth_admin` showed 0 backends at every sample. Measuring it
   requires load. This is the service on the critical path whose capacity is least known.
3. **The edge function per-project concurrency ceiling.** Not published by Supabase; not measurable
   without load.
4. **Whether a 429'd request consumes a bucket token.** Determines whether the section 2.1 storm
   makes recovery strictly worse or merely no better. Not testable without load.
5. **K, the number of distinct egress IPs across 10,000 users.** `auth.audit_log_entries` is
   **empty** (0 rows, every action), so this project's own history carries no IP evidence at all.
   K is the single largest unknown in this lane and it is the input that decides whether section 1
   is a non-event or a launch-day outage.
6. **iOS request-timeout default.** Android is verified at 0 (no timeout) in the React Native
   0.76.9 source. iOS NSURLSession behaviour under RN's XHR polyfill is not verified, and the
   device gate forbids checking. Gap A is proven for Android and assumed for iOS.
7. **PostgREST restarted 18 times in the last 24 hours** (18 `"Connection Pool initialized"` and
   `"Config reloaded"` entries, 45 schema-cache reload messages). Probably migration activity, but
   each restart drops the pool and the schema cache, and a restart during launch is a visible stall.
   Not investigated; out of lane.
