# SCALE-10K-VERDICT: can this take 10,000 users next week

Synthesis of five verification lanes run 2026-08-14 against `syzzfgaudpifwvbpycyi`, read only.
Sources: `SCALE-INGRESS.md`, `SCALE-DATABASE.md`, `SCALE-CLIENT.md`, `SCALE-MEDIA.md`,
`SCALE-REALTIME.md`. No writes, no DDL, no load generated, no device used.

Phase 3 hardened this app for 1,000 users. The founder raised the target to 10,000 on 2026-08-14.
This document treats Phase 3's conclusions as a starting point. Two of them held and are recorded
in section 3. The rest did not survive the 10x, and three of them do not survive 1,000.

---

## What breaks first, and at what number

**The Clutch video feed breaks first, and it breaks at roughly 830 registered users, not at
10,000.** Every Clutch view downloads the MP4 from Supabase Storage. Measured on the live bucket,
a clip video averages 2,645,699 bytes and a poster averages 283,786 bytes. The feed mounts a
player for the prefetched next card as well as the active one, so a 15 clip session costs
`15 x 2.65 MB x 1.3 prefetch waste = 51.7 MB` of video plus `15 x 0.284 MB = 4.3 MB` of posters,
**56.0 MB per session**. The Pro plan includes 250 GB of egress per month, so
`250 GB / 56.0 MB = 4,464 Clutch sessions per month` is the entire monthly allowance. On the
central activity model (30 percent DAU, 60 percent of those open Clutch, 30 days) each registered
user produces `0.30 x 0.60 x 30 = 5.4` sessions per month, so the quota is exhausted at
`4,464 / 5.4 = 827 registered users`. On the conservative model (20 percent DAU, 40 percent open
Clutch, 10 clips per session at 37.3 MB) it is `(250 GB / 37.3 MB) / 2.4 = 2,793 registered
users`. The quota therefore dies somewhere between **830 and 2,800 registered users**, which is
3.6x to 12x before the target, and at 10,000 the central case burns 3,024 GB per month against a
250 GB allowance. Pro enables the Spend Cap by default, and with it on this is not a $79 bill, it
is an org wide restriction under Fair Use: Clutch stops serving video for every user, and the
quota is shared with the other projects in org `Synth_Web_&_App`.

The same feed breaks a second time, independently, for a reason that has no user count attached
to it: the playback mint is throttled at 60 requests per 60 seconds keyed on
`x-forwarded-for[0]`, one active user costs about 23 requests per minute (13 for one profile
visit across three tabs, 10 for a minute of scrolling), so `ceil(60 / 23) = 3` concurrent users
behind one egress IP exhausts the bucket. Live `edge_rate_limits` rows confirm real Indian
carrier addresses in the same CGNAT /16, so a single public IP does front many devices. Whether
that fires at 300 users or 3,000 depends on K, the number of distinct egress IPs across the user
base, and K is unmeasurable from this project because `auth.audit_log_entries` is empty. When it
fires the card renders as a bare black rectangle: the same call mints the poster, `mintPlayback`
has an empty catch, and the refresh timer is armed only inside the `try` after success, so the
card never retries while it is on screen. No toast, no spinner, no error. Indistinguishable from
the app being broken.

Both of the first two failures are in the video feed, which is the app's front door.

---

## 1. The ordered failure sequence

Ordered by the load at which each mechanism fires. Where a threshold can be expressed in
registered users it is; where it cannot, the real axis is named instead. This ordering is the
useful artifact: notice that nothing in the top half is a database size problem, and that the
tables which cross 1 million rows do not appear until month 7.

### Tier 0. Already broken. These do not start failing at 10,000, they are absent now

| What | Number | What the user experiences |
|---|---|---|
| No session, membership or group notification produces a device push | Broken at 1 user | `0103`'s `notify_session_parties` and `0104`'s `sweep_group_memberships` both `insert into notifications` directly in SQL. Only one caller of `notify.ts` exists in the whole repo (`finalize-court-booking-payment.ts:157`). An athlete whose coach starts a session with the app closed learns nothing. The 03:30 IST membership reminder, whose entire stated purpose is to reach the athlete who has not opened the app, reaches nobody. |
| No clip posted through the app has a thumbnail | The first real clip | `upload.tsx:108` calls `finalizeUpload(ticket.clipId)` with one argument against a two argument signature, so `thumb_path` goes over as `undefined`, and there is no server side frame extraction anywhere. Masked today because all 12 published clips are pre 2026-07-28 fixtures created by scripts that pass the argument; the three most recent `ready` clips, captioned `e2e CL-10`, all have `thumb_path IS NULL`. At volume the feed shows black cards, the profile grid is 100 percent blank tiles, and egress gets **worse** because the only way to show anything is to pull the 2.65 MB video. |
| No HTTP request timeout anywhere in the monorepo | No threshold, a probability that rises with load | React Native 0.76.9 configures Android OkHttp with `connectTimeout(0)`, `readTimeout(0)`, `writeTimeout(0)`, verified in `OkHttpClientProvider.java:58-60`. Zero means no timeout. When GoTrue queues rather than refuses, which is what saturation looks like from a client, `signInAnonymously()` never settles, `.catch()` never runs, and Phase 3's entire P0-4 guest degrade is bypassed. The splash spinner spins forever. |
| The signed in splash has no degrade at all | 1 percent transient error rate stops 100 of 10,000 returning users | `splash.tsx:115` holds a returning signed in user on a full screen "We could not load your profile" wall. `getMe()` is five network calls (one GoTrue plus four PostgREST) and throws on any of three of them. Guests degrade into the app gracefully; returning and paying users hit a hard wall. That is the priority inverted exactly backwards on launch day. |

### Tier 1. Hundreds to low thousands of users

| Order | Fires at | What breaks | Mechanism |
|---|---|---|---|
| 1 | **3 concurrent Clutch viewers behind one egress IP** | Clutch feed renders black cards, silently, no retry | 60 req/60s per IP, 23 req/min per active user. Aggregate load is 3.7 req/s globally at 10k, so this refuses legitimate traffic at about one four hundredth of any real capacity limit, purely from the choice of bucket key. |
| 2 | **830 to 2,800 registered users** | The 250 GB monthly egress quota is gone inside the month; with the default Spend Cap on, Clutch stops serving video org wide | Arithmetic in the opening paragraph. |
| 3 | **31st first open behind one shared IP in a 2 minute window** | Anonymous mint refused, then a 192x retry storm turns a 2 minute per IP outage into a multi hour one | Anon signup is limited per IP at 30/hour, bucket capacity 30, refill 1 token per 120 s, with **no project wide bucket at all**, so volume is irrelevant and IP concentration is everything. 10,000 users across K distinct IPs over H hours survives only when `10000/K <= 30 + 30H`: a 1 hour launch window needs `K >= 167`, a 10 minute push spike needs `K >= 286`. The refused user is not bricked (anon RLS policies and grants both verified present) but every gated tap raises the login modal, so a first time user gets a read only shop window with no explanation. |
| 3b | Same event | The retry policy makes recovery worse for everyone behind that IP | `continueAsGuest` retries 3 times, and `scheduleBackgroundRemint` calls it again on every tick with no attempt ceiling and no give up, so each tick is 3 requests. Ticks at 2,4,8,16,32,60,60... give 63 ticks/hour x 3 = **192 requests per failing device per hour against 1 for a healthy device**. With N failed devices behind one NAT, a brand new user's chance of catching the 1 token per 120 s refill is about `1/(6N+1)`: at N=10 that is 1.6 percent per attempt, expected wait about 2 hours. Jitter desynchronises devices and does nothing to aggregate arrival rate, which is the only thing a token bucket measures. |
| 4 | **~1,300 registered users** (V = 40 verified coaches at 5 percent coaches, 60 percent verified) | Trainings, Coaches tab auto paginates the entire table with no user input and virtualization is off | `coaches.tsx:140-150` renders `CoachBrowseList` with `scrollEnabled={false}` inside its own `ScrollView`. Read from `VirtualizedList.js:1527-1612`: a plain RN `ScrollView` does not provide `VirtualizedListContext`, so the nesting correction is skipped, the list lays out at full content height, `distanceFromEnd` is 0 forever, and `_sentEndForContentLength` is bypassed on every appended page. At 10,000 users with V = 300 that is 15 pages x 3 queries = **45 serial round trips, 6.8 s at 150 ms RTT, and 300 CoachCards mounted at once**. Plainly broken by V = 120. |
| 5 | **~2,200 registered users** (N = 33 verified UPAs at 3 percent applying, half verified) | Home stalls, not partially renders | `listUpas` is an unbounded read plus one `upa_fund_balance` RPC per row fanned out with `Promise.all`, then `.slice(0, 8)` throws the rest away. The binding constraint is not Postgres (2.25 ms per call) but the client's 5 connections per host on Android, so N requests serialise into `ceil(N/5)` waves. At N = 150 that is 30 waves x 150 ms = **4.5 s**, during which the promo carousel, the Clutch preview and the product rail are all head of line blocked behind the same 5 sockets. Already firing: `pg_stat_statements` shows this RPC at 975 calls, the most called on the project, against 2 verified rows. |
| 6 | **First fortnight of real group chat** (3,813 messages across one caller's threads) | The Chat inbox downloads every message in every thread to render one line per thread | `use-chat.ts:363-379` has no `.limit()`, no `.range()`, no `distinct on`. Measured 262.3 bytes per row as inbox JSON. A coach with 55 threads at 300 messages each downloads `16,500 x 262.3 B = 4.33 MB` to render 55 single line previews, a **300x waste factor**. Past the PostgREST cap, threads whose newest message falls outside the globally newest N rows render with a blank preview and no explanation. |

### Tier 2. Thousands to the target

| Order | Fires at | What breaks | Mechanism |
|---|---|---|---|
| 7 | **7,440 registered users on launch day** | Realtime refuses channel joins; chat and the bell silently stop updating | Derived at 672 peak minute sockets against the Pro-with-spend-cap ceiling of 500. `supabase-js` reports `CHANNEL_ERROR`, the app shows "Disconnected, pull down to reload". Nothing crashes, which is why this generates support load rather than crash reports. Steady state does not cross until about 27,000 users. |
| 8 | **10,860 published clips**, which is 1.1 clips per user at 10,000 | Every Clutch feed open, by every user, spills a sort to disk | `clips` carries two permissive SELECT policies which Postgres merges with OR, so the plan is a full Seq Scan plus a full Sort of every published clip, then take 12. The `limit 12` and the keyset cursor bound the payload, not the work. `3,584,000 bytes work_mem / 330 bytes per sort tuple = 10,860`. The hard timeouts are much later (guests at ~107,000 clips on the 3 s `anon` timeout, signed in users at ~285,000 on the 8 s one), but the spill is what matters because thousands of concurrent disk spilling sorts saturate instance IO long before any single query hits its own wall. |
| 9 | **Any group above 240 recipients**, and any broadcast at all | Push fan out times out partway with no resume and no idempotency key | `notify.ts` dispatches per recipient sequentially with a synchronous external HTTP round trip inside the loop, and batches on the wrong dimension (one user's devices, not many users' devices). At ~250 ms per recipient that is **4 pushes per second**, 0.7 percent of Expo's own 600/s allowance. A group of 50 takes 12.5 s so the last athlete hears 12 seconds after the first; a group of 240 crosses a 60 s client timeout; a 10,000 user announcement takes **42 minutes** serialised. |
| 10 | **Any group above 100 members at 5 msg/s**, or 500 members at 1 msg/s | Realtime disconnects sockets **project wide** | `broadcast_chat_message` is an after insert per row trigger that loops over the member union calling `realtime.send` once per member, so each message is M physical INSERTs, M WAL records and M websocket events inside the sender's transaction. `training_groups_capacity_check` is `CHECK (capacity > 0)` with **no upper bound**, so all four fan outs (participants, notifications, chat broadcast, push) are bounded only by a number a coach types into a form. Steady state chat at 10,000 is 0.17 events/s, so the risk is entirely the missing ceiling, not the user count. When the tenant limit is crossed Realtime does not drop the excess, it disconnects everyone. |

### Tier 3. Months in, but well inside year one

| Order | Fires at | What breaks |
|---|---|---|
| 11 | **20,250 rows in `court_bookings`, month 7** (or month 2 if court booking is the primary funnel) | Every athlete's Bookings tab returns statement timeout `57014`, for every user at once, because the threshold is a property of the table not the account. `listMyBookings` has no owner filter, so it Seq Scans the whole table at a measured 0.37 to 0.42 ms per row under RLS, and `court_bookings_select_merged` puts `is_court_partner_or_staff(court_id)` before `user_id = auth.uid()`, so the expensive function runs on every row. Guests break earlier at 7,595 rows on the 3 s `anon` timeout. |
| 12 | `chat_messages` crosses 1M in month 7, `notifications` in month 8 | Neither is the alarm that matters. **The two queries that fail first fail at 20,250 and 10,860 rows.** Watching for a million row table would have caught neither in time. |

---

## 2. Every P0, with its cheapest fix

Effort is one engineer familiar with this tree. It excludes the repo's own device proof rule
(`CLAUDE.md`: Release build screenshot plus a per flow Maestro run for anything touching a
screen), which applies to nine of these and is currently blocked by another session holding the
device.

| # | P0 | Fix type | Cheapest fix | Effort |
|---|---|---|---|---|
| 1 | Egress quota gone by day 3 to day 9, Spend Cap converts it to an org wide outage | **CONFIG** | Read the Spend Cap state, turn it off, set a usage alarm at 200 GB. $79/month buys the central case. Nothing in the code has to change to survive the money, only to survive the cap. | 10 minutes |
| 2 | Realtime concurrency crosses the 500 ceiling at 7,440 users | **CONFIG** | Same setting. Removing the spend cap moves concurrent connections 500 to 10,000 and messages/s 500 to 2,500. Free. Do this regardless of everything else, because every other realtime ceiling moves with it. | included in 1 |
| 3 | Three project settings nobody in this repo has ever read | **CONFIG** | Read and record in `CURRENT-STATE.md`: PostgREST `Max rows` (Settings, API), `rate_limit_anonymous_users` (Management API `/config/auth`), Storage upload size limit. The first is why 60 unbounded reads got written: nobody knows the number their app silently truncates at. | 20 minutes |
| 4 | No HTTP timeout anywhere, which bypasses the entire P0-4 degrade | **CODE**, one file | `packages/api/src/client.ts`: pass `global: { fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(8000) }) }`. | 1 hour |
| 5 | Playback throttle fires at 3 concurrent users per IP and renders a black card | **CODE**, two files | Key the bucket on user id when a JWT is present (`getOptionalUserId` is already resolved on the batch path, hoist it above the throttle), fall back to IP for guests only, split the constants to per user 60/60s and per IP 600/60s, and make `mintPlayback` distinguish 429 from other errors with a jittered retry and a visible affordance instead of black. | half a day |
| 6 | Anon mint refused at 31 first opens per shared IP | **CONFIG then CODE** | PATCH `rate_limit_anonymous_users` upward via the Management API, then stop minting on splash so ingress stops scaling with installs. Turnstile/hCaptcha is the documented companion and is configured nowhere in the repo. | half a day |
| 7 | 192x retry storm starves the IP bucket for everyone behind it | **CODE**, two files | Break immediately on 429 / `over_request_rate_limit` instead of burning two more attempts against an empty bucket (192 to 64), honour the `Retry-After` header GoTrue returns, raise the cap from 60 s to 15 min and stop after ~10 attempts or on background (192 to under 10). | 2 hours |
| 8 | Signed in splash has no degrade | **CODE** | On `meError`, route into `/(tabs)` with a degraded profile exactly as `guest_unminted` already does, and surface retry inline rather than as a full screen wall. | 2 hours |
| 9 | No thumbnail on any app posted clip | **CODE**, ~25 lines in one file | The column and the webhook parameter already exist. Generate the frame at pick time in `upload.tsx`, upload to `${user.id}/${clip.id}.jpg` on the existing signed upload flow, pass the path to `finalizeUpload`. | half a day |
| 10 | No push fires for any session or membership event | **MIGRATION + CODE** | Add `pushed_at timestamptz` to `notifications` and a pg_cron job every 30 s selecting `where pushed_at is null`, grouped by `(type, title, body, deep_link)`, calling the new fan out over `pg_net`. Needs no change to `0103` or `0104`, gets batching for free because a roster shares one title and body, and is resumable because `pushed_at` is the checkpoint. Do **not** put a `pg_net` call inside the transaction: that couples session state transitions to Expo availability on a money bearing path. | half a day |
| 11 | Push throughput capped at 4/s | **CODE**, one file | `dispatchNotificationFanout(service, payload, userIds[])` in `_shared/notify.ts`: one `insert ... select unnest($1)`, one prefs read, one tokens read, then 100 token Expo requests. A 10,000 recipient blast goes from 10,000 requests to 100, and from 42 minutes to about 25 seconds. The chunking helper already exists. | half a day |
| 12 | Clutch feed cannot use its index under permissive-OR RLS | **MIGRATION**, one index | `create index concurrently idx_clips_published_created_at on public.clips (created_at desc) where status = 'published';` A partial index predicate is proven at plan time, not evaluated as a qual, so it is not subject to the leakproof rule. Verified by the closest analogue on this same database: `sessions_coach_date_slot_unique` is chosen under `authenticated` with RLS active and its predicate proven from the caller's own non leakproof enum qual. **Do not** add `deleted_at` to the predicate: `information_schema.columns` confirms `clips` has no such column and the migration would fail. | 1 hour, plus a preview branch to re-EXPLAIN |
| 13 | `listMyBookings` Seq Scans the whole table, RLS OR written expensive first | **CODE + MIGRATION**, both one liners, both needed | Code: add `.eq("user_id", user.id)` at `hooks.ts:779`. Measured on live data: Seq Scan becomes Index Scan on `idx_court_bookings_user_id`, 41.0 ms to 20.5 ms, and the scaling changes from O(table) to O(my bookings). Migration: reorder `court_bookings_select_merged` so `user_id = (select auth.uid())` comes first, otherwise the expensive function still runs on every row the index returns (804 buffers for 47 rows). **Sweep the class**: `sessions_select_merged` has the identical defect. | 2 hours |
| 14 | Chat inbox downloads every message in every thread; chat thread loads full history oldest first | **MIGRATION preferred, CODE stopgap** | Migration deletes a query rather than adding an index: `chat_threads` already has a `chat_messages_touch_thread` trigger, so add `last_message_text` and `last_message_sender_id` maintained in it and the second query and its HTTP round trip disappear. Stopgap if a migration is not wanted this week: `.limit(rows.length * 3)` on the preview read, and `.limit(50)` plus a `created_at` cursor on `listMessages`. | half a day migration, 1 hour stopgap |
| 15 | Coaches tab: virtualization off, pagination runs away | **CODE**, one file | Delete the outer `ScrollView` in `coaches.tsx` and pass `myCoachesSection` through the `header` prop `CoachBrowseList` already accepts and documents, then delete the `scrollEnabled` prop and its `style` branch so the escape hatch cannot be used again. Class swept: a repo wide grep for `scrollEnabled` returns exactly these two files and a structural scan finds no other vertical `FlatList` in a non horizontal `ScrollView`. | 1 hour |
| 16 | `listUpas` unbounded N+1 fanned out concurrently | **MIGRATION** | `upa_fund_balances(p_account_refs uuid[])` set returning function, plus `.limit(8).order(...)` on the rail's own call path. Keep the existing "never sum `funded_amount`, always derive from the ledger" invariant. | half a day |
| 17 | 60 unbounded reads against a silent PostgREST cap | **CONFIG then CODE, per screen** | The config item is #3. Then add an explicit `.limit(n)` below the server cap to every read in `SCALE-CLIENT.md`'s table. An explicit limit the code owns is testable and visible in review; an implicit cap the code does not know about is neither. Screens that genuinely need more get keyset pagination using `listCoaches` as the in tree pattern. **Where the client's `.order()` is ascending the truncation drops exactly the rows the user wants**, silently, with a 200 OK. | 1 to 2 days |
| 18 | No image is downscaled anywhere and no screen uses `expo-image` | **CODE**, or CONFIG if the Storage transform add on is enabled | `grep -rn "from 'expo-image'"` returns zero hits; all six URL minting sites pass no `transform` option; there is no client side resize on the upload path. Either enable Storage image transformations and pass `transform` at the six mint sites, or swap RN `<Image>` for `expo-image` which downscales on decode. | half a day either way |
| 19 | No upper bound on group capacity, so four fan outs are unbounded | **MIGRATION**, one line | `alter table public.training_groups add constraint training_groups_capacity_max check (capacity <= 100);` Pick the number from the product, but pick one. Closes chat fan out, group session notification and push fan out simultaneously. | 15 minutes |

Config total: about 30 minutes, and items 1 and 2 are the highest value 10 minutes available.
Code and migration total: **6 to 9 engineer days**, plus a preview branch to plant and re-EXPLAIN
every recommended index (DDL was forbidden in this pass, so the index plans are verified by
mechanism and not by measurement), plus device proof for nine screen touching changes.

---

## 3. What genuinely survives 10,000

Short and evidenced. Each of these was checked against the artifact, and two of them were checked
specifically because the first assumption about them was wrong.

1. **The Clutch feed component is correctly hardened and is the model the rest of the app should
   copy.** `getItemLayout`, `initialNumToRender={2}`, `maxToRenderPerBatch={3}`, `windowSize={5}`,
   `removeClippedSubviews`, keyset pagination at `CLUTCH_PAGE_SIZE = 10`, and an eviction window
   that drops signed URLs and their refresh timers for any clip more than one position from the
   active card. It needs no work. The feed's problems are all in the layers around it.
2. **`0090`'s InitPlan wrap held, and it is wider than the 22 policies it claimed.** Verified in
   `pg_policy`, not in the migration file: of 258 policies in `public`, 113 mention `auth.uid()`,
   and in **113 of 113** every occurrence is wrapped as `(SELECT auth.uid())`. Policies containing
   at least one bare `auth.uid()`: **zero**. Confirmed independently in every captured plan as
   `InitPlan N -> Result` executed once with `rows=1`.
3. **Every index in `public` is valid, ready and live.** `pg_index where not indisvalid or not
   indisready or not indislive` returns 0 rows. Checked against the catalog because a half built
   `CREATE INDEX CONCURRENTLY` leaves an invalid index that `pg_indexes` still lists.
4. **The session-less public read path is real end to end.** Policies **and** grants for `anon` on
   `promo_banners`, `products`, `product_media`, `product_variants`, `clips`, `upa_applications`,
   `categories` (`pg_policy` plus `information_schema.role_table_grants`, both queried);
   `get-clip-playback-url` deployed with `verify_jwt: false`; no session guard in
   `(tabs)/_layout.tsx`. A refused mint lands in a working browsable app rather than a brick.
5. **The playback throttle key is real, not `"unknown"`.** Live `edge_rate_limits` rows hold actual
   public IPv4 addresses, so `x-forwarded-for` does reach the Deno isolate. Had it not, the entire
   user base would share one 60/min bucket. This was the single most important thing to check and
   it passes.
6. **There is one authz path and one throttle path, not two.** `get-clip-playback-urls/index.ts` is
   a 6 line delegate to `get-clip-playback-url/handler.ts` and both share the bucket string
   `clip-playback-ip`. The "second unrate-limited front door" PHASE-3-STATUS worried about was not
   reopened. The throttle also fails **open** while the takedown authz fails **closed**.
7. **`chat_messages` RLS is genuinely efficient and needs no work.** The two EXISTS subqueries in
   `chat_messages_select_merged` are collapsed by the planner into hashed SubPlans over the
   caller's thread set rather than re-evaluated per row: 187 buffers over 210 rows, 0.0155 ms/row.
   `idx_chat_messages_thread_id (thread_id, created_at)` exactly covers `listMessages`'s filter
   plus ordering. P0-2 is a payload problem, not a plan problem. **Do not add an index here.**
8. **Double booking protection is correct and its partial indexes are usable under RLS.** A plan
   captured as `authenticated` with RLS active shows the planner selecting
   `sessions_coach_date_slot_unique` and proving its enum predicate from the caller's own qual.
   This is also the mechanism the fix in #12 depends on.
9. **The signed URL batch endpoint is properly bounded and Phase 3's CT-1 held.** Chunks at 24 per
   call with an enforced concurrency cap of 4, agreeing on both sides (`BATCH_MAX_CLIP_IDS = 24`,
   `PLAYBACK_BATCH_MAX = 24`), and degrades a failed chunk to "no poster this pass" rather than
   blanking the grid. Only its unbounded input is wrong.
10. **Phase 3's CT-5 keyset pagination on `listCoaches` held.** `.limit(limit + 1)`, tuple ordered
    cursor `(created_at, user_id)` expressed correctly as PostgREST `.or()`, and `byCityFirst`
    only reorders within a page so it cannot reintroduce a gap. The bug is entirely in how the
    component is embedded.
11. **Money formatting is not `Intl`.** `packages/theme/src/index.ts:41` hand rolls `formatINR`.
    The single most rendered value in the app is a string operation, not a 30 us locale lookup.
12. **Storage size and the PostgREST pool are not constraints.** 24 MB total database;
    `auth.users` is 1.4 kB/row so 10,000 users is ~14 MB. Pool is 20 (measured from the project's
    own logs) and ingress needs about 2.5 slots at the aggressive rate. **Upgrading compute would
    buy nothing on the ingress path.** There is also no project wide anon signup limit at all, so
    a geographically dispersed 10,000 never sees the limiter: the entire risk is concentration.
13. **`handle_new_user` is cheap for a guest.** Read from `pg_proc`: exactly one insert, the
    `user_roles` insert skipped for `is_anonymous`, the phone uniqueness probe skipped for lack of
    metadata, and both risky branches wrapped so they cannot abort the signup.

Two corrections to `CURRENT-STATE.md` fall out of this pass and should be applied:

- **The comments sheet OPEN entry is stale.** On `integration/p6-audit-fixes` it renders through
  the in tree `Portal`, caps height with a pixel number from `useWindowDimensions` rather than a
  percentage, anchors via an `absoluteFill` host, and carries `flexShrink: 1` on the FlatList.
  `onEndReachedThreshold` and `onEndReached` are wired. Move it to PROVEN.
- **`idx_clips_status_created_at` exists.** An `EXPLAIN ANALYZE` returning a Seq Scan on 34 rows
  is the planner costing the whole table at 2.48, not a missing index. Recorded because stopping
  at the plan would have filed a false P1, which is the ninth instance of this project's standing
  failure shape.

---

## 4. UNRESOLVED

Grouped by what would actually settle them. Three of these change a severity, not just a number.

### Settled by reading one dashboard value. Do these before anything else

1. **Is the Pro Spend Cap on?** This single boolean decides whether the #1 finding is a $79/month
   bill or a week one outage across every project in org `Synth_Web_&_App`, and it decides whether
   the realtime ceiling is 500 sockets or 10,000. The Management API surface available here does
   not return it. Dashboard, Organization, Billing, Cost Control.
2. **PostgREST `max_rows`.** Verified that a numeric cap **exists** (of 751 `WITH pgrst_source`
   statements in `pg_stat_statements`, **0** carry `LIMIT ALL` and 670 carry `LIMIT $n OFFSET $m`,
   and PostgREST emits the literal `LIMIT ALL` when unbounded). The value is a PostgREST
   environment variable, not a database setting, so it is not in `pg_db_role_setting` and cannot
   be read over SQL. No table exceeds 532 rows so it cannot be probed without writing. Every
   truncation number in this document is conditional on it. Dashboard, Settings, API, Max rows.
3. **The project's actual `rate_limit_anonymous_users`.** 30/hour/IP is assumed on Supabase's
   documented default throughout. `curl -X GET
   "https://api.supabase.com/v1/projects/syzzfgaudpifwvbpycyi/config/auth"` with a management
   token returns it. Blocked here because the CLI token lives in the macOS keychain and reading it
   was denied by the permission classifier.
4. **The project global upload size limit.** `clips.file_size_limit` is NULL so it defers to the
   project setting, default 50 MB. Dashboard, Storage, Settings.
5. **Actual egress consumed in the current billing period.** Would calibrate the 56 MB per session
   model against reality rather than leaving it an estimate.

### Settled by one cheap measurement, no load required

6. **Real per clip video size for app recorded clips.** Every MP4 in the bucket today is a
   fixture: sizes repeat byte identically across owners (11,837,000 four times, 2,761,502 four
   times). The 2.65 MB average is fixture derived, and the entire egress model rests on it. **One
   real 30 second phone clip uploaded through the app replaces the assumption with a measurement,
   and it is the cheapest single thing anyone could do to firm up this verdict.**
7. **Actual pixel dimensions of stored images.** File sizes are measured (`clips` avg 1.48 MB,
   `upa-photos` avg 1.34 MB) but `storage.objects` does not carry width and height. Downloading
   one object and reading its header settles it and is not load generation.
8. **Who creates the `realtime.messages` daily partitions.** They exist only through `2026_08_16`
   and `cron.job` has no partition job, so the Realtime service manages them out of band. If a
   stretch with no connected tenant leaves the next day's partition uncreated, every
   `realtime.send()` and therefore every chat message fails. Worth one check on a quiet morning.
9. **PostgREST restarted 18 times in the last 24 hours** (18 "Connection Pool initialized" and 45
   schema cache reloads in `edge_logs`). Probably migration activity, but each restart drops the
   pool and the schema cache, and a restart during launch is a visible stall. Not investigated.

### Settled only by a real load test against a staging project. Say this plainly

These cannot be answered from this production database, from the repo, or from any amount of
further reading. Each requires a separate Supabase project seeded to 10k-shaped volume and driven
with synthetic traffic. **The load gate here is correct and should not be lifted; the answer is a
staging environment, not a riskier production query.**

10. **GoTrue's DB pool size and its actual throughput.** `supabase_auth_admin` showed 0 backends
    at every sample. GoTrue is the service on the critical ingress path whose capacity is least
    known, it is the one that produces the 429 in finding #6 and the hang in finding #4, and the
    app currently makes it 4x heavier than it needs to be (measured 16:1 `/auth/v1/user` to
    `/auth/v1/signup` in `edge_logs`, because three feed helpers call `auth.getUser()` which always
    round trips, purely to short circuit for guests). **Requires a load test.**
11. **The edge function per project concurrency ceiling.** Not published by Supabase and not
    measurable without load. **Requires a load test.**
12. **Whether a 429'd request consumes a bucket token.** Decides whether the 192x retry storm makes
    recovery strictly worse or merely no better. **Requires a load test.**
13. **Replication slot lag under load.** `pg_replication_slots` is currently empty, consistent with
    an idle project. **Requires a load test.**
14. **Whether Realtime coalesces K matching subscription ids into one websocket message or sends
    K.** Decides whether the notifications channel binding leak multiplies wire events against the
    messages per second quota or only server side matching work. Needs the Realtime server source
    or a live socket test. The fix is the same either way, so it does not block.
15. **Every plan measurement in this pass is warm.** All buffer counts are `shared hit`. A cold
    cache after a restart or eviction turns each into a physical read and every number gets worse.
    Forcing eviction was not possible without affecting production. **Requires a load test.**
16. **The recommended indexes were not planted, so their plans are inferred.** DDL is forbidden
    here. Plant each on a preview branch and re-run the EXPLAINs before merging. The two index
    bitmap OR plan for `chat_threads` is the least certain of the set.

### Settled only by the device, which another session holds

17. **The Coaches tab runaway auto pagination.** Derived by reading RN 0.86.0's
    `VirtualizedList.js:1527-1612` and matching it against the two call sites, which is strong, but
    not observed. Repro: open Trainings, then Coaches, with more than 40 verified coaches seeded,
    and count network requests **without touching the screen**. If the derivation is right the
    count is `3 x ceil(V/20)` with zero scroll input.
18. **iOS request timeout default.** Android is verified at 0 in the RN 0.76.9 source. iOS
    NSURLSession behaviour under RN's XHR polyfill is not verified. Finding #4 is proven for
    Android and assumed for iOS.

### Assumptions, not measurements, stated so the founder can challenge them

19. **DAU, session length, peak concentration, coach ratio, UPA ratio and chat activity are all
    stated assumptions.** No analytics exist in this repo. Live per user ratios are unusable
    because 203 of 227 users are anonymous guests, 16 of 22 feed clips and 6 of 10 venues are e2e
    fixtures, and 36 training groups were deleted. The only ratio taken from real data is
    `532 ledger_entries / 205 captured payment_intents = 2.60 per captured payment`. **Every
    mechanism and every per row cost in this document is independent of these numbers; only the
    calendar dates and the user count thresholds move.** If the founder has real figures from any
    prior surface, sections 1 and 2 should be re-derived rather than trusted.
20. **K, the number of distinct egress IPs across 10,000 users**, is the single largest unknown in
    the whole verdict. `auth.audit_log_entries` is empty (0 rows, every action), so this project
    carries no IP evidence at all. K decides whether the per IP throttle and the anon mint limit
    are non events or launch day outages, and it is the input behind the first item in the ordered
    sequence.
21. **The `ap-south-1` to `exp.host` round trip (250 ms) is an estimate.** The push finding
    survives any plausible value: even at an optimistic 100 ms the sequential loop still caps at
    10 pushes per second and still times out around 600 recipients.

---

## 5. The sentence the founder needs

**No, not as it stands: the video feed breaks at roughly 830 registered users and the app has no
push notifications at all today, so this can take 10,000 users next week only if the two config
changes in section 2 (#1 to #3, about 30 minutes) and the ten P0 code and migration fixes (#4 to
#15, six to nine engineer days plus device proof) land first, and even then four of the answers
in section 4 cannot be settled without a real load test against a staging project, which does not
exist.**
