# SCALE-REALTIME: realtime fan-out and push at 10,000 users

Lane: realtime fan-out and push. Target raised from 1,000 to 10,000 by the founder, 2026-08-14.
Written 2026-08-14 against `integration/p6-audit-fixes` at `709bc40`.

Every catalog claim below was read from the live project `syzzfgaudpifwvbpycyi` with read-only SQL.
No writes, no DDL, no load generated. No simulator, emulator, Maestro or Metro used.

---

## Standing facts this lane rests on, each verified not assumed

| Fact | How verified |
|---|---|
| Plan is **Pro**, org `sdibeiimibszmixymsdr` | `get_organization` |
| Region `ap-south-1`, Postgres 17.6.1 | `get_project` |
| `max_connections = 60`, `shared_buffers = 256 MB`, `work_mem = 3.5 MB`, `statement_timeout = 120000 ms` | `pg_settings` |
| `supabase_realtime` publishes exactly `chat_messages`, `court_bookings`, `sessions` | `pg_publication_tables` |
| `supabase_realtime_messages_publication` publishes the daily `realtime.messages_YYYY_MM_DD` partitions | `pg_publication_tables` |
| `chat_messages_broadcast` trigger exists and is enabled (`tgenabled = 'O'`) | `pg_trigger` |
| `chat_broadcast_receive_own` policy on `realtime.messages`, qual `extension = 'broadcast' AND realtime.topic() = 'chat:user:' || auth.uid()` | `pg_policies` + `pg_policy` |
| `notifications` SELECT policy is the single permissive `notifications_select_own`, `user_id = (select auth.uid())`; `notifications_active_update` is RESTRICTIVE | `pg_policies` incl. the `permissive` column |
| `cron.job` holds exactly ONE row: `expire-stale-holds`, `*/5 * * * *` | `cron.job` |
| `public.membership_reminder_lead()` does not exist | query errored `42883` |
| `training_groups` capacity constraint is `CHECK (capacity > 0)`, **no upper bound** | `pg_constraint` |
| Only index on `notifications` besides the pkey is `(user_id, read_at)` | `pg_indexes` |
| Indexes on `group_memberships`: `(group_id,status)`, `(player_id,status)`, partial unique `(group_id,player_id) where status <> 'lapsed'`, `(payment_intent_id)`. **Nothing leads with `status` or `period_end`.** | `pg_indexes` |
| Live row counts: notifications 63, group_memberships 5, training_groups 1 (max capacity 8), sessions 55, session_participants 15, push_tokens 1, auth.users 227, chat_messages 210 | direct counts |

**Migrations 0102 to 0106 are NOT applied to production.** Latest applied `schema_migrations` version is
`20260807044724`; `membership_reminder_lead()` is absent and `notifications` is absent from the
publication. Everything below about session notifications, the sweep and the notifications stream is a
projection for the week those merge, not a description of today.

---

## 1. Every `.channel()` in the client, and whether it fans out

Six call sites, found by `grep -rn "\.channel(" --include=*.ts --include=*.tsx apps packages supabase scripts`.

| # | File | Topic | Mechanism | Scoped by | Live? |
|---|---|---|---|---|---|
| 1 | `apps/portal-life/.../status/status-view.tsx:102` | `upa-status-{userId}` | postgres_changes `*` on `upa_applications` | `applicant_user_id=eq.{userId}` | **DEAD, table not published** |
| 2 | `apps/portal-life/.../wishlist/wishlist-manager.tsx:74` | `wishlist-{upaId}` | postgres_changes `*` on `upa_wishlist_items` and `donations` | `upa_id=eq.{upaId}` on both | **DEAD, neither published** |
| 3 | `apps/portal-life/.../wishlist/[itemId]/funding-detail.tsx:88` | `funding-{itemId}` | postgres_changes `*` on `upa_wishlist_items` and `donations` | `id=eq.`, `item_id=eq.` | **DEAD, neither published** |
| 4 | `apps/portal-court/.../live-today/page.tsx:119` | `live-today-{venueId}` | postgres_changes `*` on `court_bookings` | `court_id=in.(...)` | live |
| 5 | `packages/api/src/use-notifications.ts:179` | `notifications:self` | postgres_changes INSERT on `notifications` | `user_id=eq.{meId}` | dead today, live once 0106 applies |
| 6 | `packages/api/src/use-chat.ts:252` | `chat:user:{userId}` | **private Broadcast**, event `message_new` | `realtime.messages` RLS | live |

### P1-2 verdict: it happened, and nothing has regressed

**There is no unfiltered postgres_changes subscription anywhere in the client.** All five
postgres_changes subscriptions carry a per-entity filter, and chat is on Broadcast as P1-2 recorded.
This was not taken from the docblock: the `chat_messages_broadcast` trigger and the
`chat_broadcast_receive_own` policy were both read out of the live catalog, and the client code path
(`use-chat.ts:252`) subscribes `chat:user:{uid}` with `{ config: { private: true } }` and never touches
`chat_messages` over postgres_changes.

### Why the filter is load-bearing, with the mechanism from the live source

`realtime.apply_rls(wal jsonb, max_record_bytes int)` was read out of `pg_proc` on this project. Per WAL
record on a published table it does:

```
subscriptions realtime.subscription[] = array_agg(subs)
    from realtime.subscription subs
    where subs.entity = entity_
      and (subs.action_filter = '*' or subs.action_filter = action::text);
...
for role_record in (select distinct claims_role from unnest(subscriptions)) loop
    ...
    for subscription_id, claims in (
        select subs.subscription_id, subs.claims
        from unnest(subscriptions) subs
        where subs.claims_role = working_role
          and realtime.is_visible_through_filters(columns, subs.filters)
    ) loop
        perform set_config('role', ...), set_config('request.jwt.claims', claims::text, true);
        -- then executes the walrus_rls_stmt prepared statement
```

So the cost per inserted row is:

    O(S) calls to is_visible_through_filters   +   O(V) x (2 set_config + 1 RLS statement execution)

where `S` = every subscription on that table and `V` = the subset whose filter matched.

With a `user_id=eq.` filter, **V = 1** no matter how large S grows: the cheap array walk is O(S), the
expensive per-subscriber RLS evaluation is O(1).

Without a filter, **V = S**. Arithmetic for the shape P1-2 removed, at the new target: 10,000
subscribers on `chat_messages`, 1 message inserted per second, and roughly 60 microseconds for two
`set_config` calls plus one prepared-statement execution of the chat SELECT policy:

    10,000 x 1/s x 60 us = 0.6 core-seconds of WAL-decode work per second of wall clock

on a 2-vCPU shared Micro instance. At 5 messages per second it is 3.0 core-seconds per second, which is
unrecoverable: the replication slot falls behind faster than it drains and every subscriber's chat goes
minutes stale. That is the 1,000-concurrent meltdown class, and it is 10x worse now. **Keeping the
filters is not stylistic.**

### FINDING R-1 (P2). `chat_messages` and `sessions` are still published with zero subscribers

`supabase_realtime` still carries `chat_messages`. Nothing subscribes to it, so it costs nothing today
(`array_agg` returns NULL and the loop is skipped). But nothing in the repo stops a future
`.on('postgres_changes', { table: 'chat_messages' })` from working, and it *would* work, silently, and
it would reintroduce exactly the arithmetic above. `sessions` has been published since 0029 for nothing
at all, and `0106` re-confirms nothing will ever subscribe to it.

- **Mechanism:** a published table is a loaded gun for a regression that typechecks, passes review and
  only shows up as a production melt.
- **Breaking number:** not a threshold, a latent regression. If it is reintroduced, it melts at roughly
  1,700 concurrent chat subscribers (1 core-second per second at 1 msg/s).
- **User impact:** none today.
- **Cheapest fix:** MIGRATION.
  `alter publication supabase_realtime drop table public.chat_messages, public.sessions;`
  A future postgres_changes subscription then fails loudly (SUBSCRIBED with no events) rather than
  scaling badly. Note 0106's own header already argues nothing should subscribe to `sessions`.

### FINDING R-2 (P1). Three UPA portal subscriptions are dead: their tables are not published

Subscriptions 1, 2 and 3 target `upa_applications`, `upa_wishlist_items` and `donations`. The
publication contains only `chat_messages`, `court_bookings`, `sessions`.

- **Mechanism:** identical to the defect 0029 found for `court_bookings` and 0106 found for
  `notifications`. The socket reaches `SUBSCRIBED`, the code reads as live, and no event is ever
  delivered because there is no publish side.
- **Breaking number:** already broken at 1 user. It does not degrade with scale, it is simply absent.
- **User impact:** a UPA applicant sitting on the verification status screen never sees the flip to
  verified and never gets the session refresh that `status-view.tsx:113` performs, so the new `upa` role
  never reaches their JWT until they restart the app. A UPA watching their wishlist never sees a
  donation land. A sponsor on the funding detail never sees `funded_amount` move.
- **Cheapest fix:** MIGRATION, three lines, and it must be preceded by an RLS review of each table
  exactly as 0106 did for `notifications`, because publishing a leaky table broadcasts the leak.
  `donations` in particular is money-bearing and needs its SELECT policy set checked for the
  permissive-OR shape CLAUDE.md warns about before it is published.

### FINDING R-3 (P1). The notifications channel accumulates a server-side subscription per screen open

`apps/mobile/src/app/notifications/index.tsx:92` cleans up with `channel.unsubscribe()`, and the topic
is the constant string `"notifications:self"` (`use-notifications.ts:179`).

Verified in `@supabase/realtime-js@2.110.2` (the version resolved in this tree):

- `RealtimeClient.channel(topic)` at `RealtimeClient.js:331` returns the **existing** channel when one
  with the same topic is already in `this.channels`. It does not create a second one.
- `RealtimeChannel.unsubscribe()` at `RealtimeChannel.js:596` leaves the channel in `client.channels`.
  Only `RealtimeClient.removeChannel()` at `RealtimeClient.js:256` also calls `teardown()`.
- `RealtimeChannel._on()` at `RealtimeChannel.js:634` unconditionally pushes onto
  `this.bindings[typeLower]`. Nothing dedupes.
- `subscribe()` at `RealtimeChannel.js:142` builds its join payload as
  `this.bindings.postgres_changes?.map(r => r.filter) ?? []`.
- `_updatePostgresBindings()` at `RealtimeChannel.js:186` walks all K client bindings, pairs each with
  the server's K returned ids, and keeps all K.

So on the K-th open of the bell screen in one app session, the channel object is reused, a K-th
identical `postgres_changes` binding is appended, the join payload carries K identical filters, and
`realtime.subscription` holds **K rows for one device**.

- **Mechanism:** binding accumulation on a reused channel object, because the cleanup uses
  `unsubscribe()` rather than `removeChannel()`, and because the topic carries no per-mount identity.
- **Breaking number:** the multiplier is unbounded and equals bell-screen opens per app session. It
  feeds directly into the `S` of the `apply_rls` formula above: at 200 concurrent users averaging 5
  opens each, S on `notifications` is 1,000 rather than 200, a **5x** inflation of the per-record array
  walk. Not a hard cliff, a silent constant-factor tax that grows with engagement.
- **User impact:** invisible until it is not. The first-order effect is server work; the second-order
  effect is that the topic is not keyed by user id, so on a shared device the channel object survives
  sign-out and the next account's `.on()` is appended alongside the previous account's binding.
- **Cheapest fix:** CODE, about six lines across two files.
  1. `use-notifications.ts` `subscribe()` should key the topic per user, `notifications:${meId}`, and
     return an unsubscribe closure rather than a `RealtimeChannel`.
  2. That closure calls `client.removeChannel(channel)`.
  3. `notifications/index.tsx:92` calls the closure.
  This is the pattern `use-chat.ts` already gets right: `releaseChatUserChannel` calls
  `client.removeChannel(entry.channel)`.

---

## 2. Realtime concurrency at 10,000, against the actual ceiling

### The ceiling, from the Supabase docs (Realtime Limits, fetched 2026-08-14)

| | Free | **Pro** | **Pro (no spend cap)** | Team |
|---|---|---|---|---|
| Concurrent connections | 200 | **500** | **10,000** | 10,000 |
| Messages per second | 100 | **500** | **2,500** | 2,500 |
| Channel joins per second | 100 | **500** | **2,500** | 2,500 |
| Channels per connection | 100 | 100 | 100 | 100 |

The org is on **Pro**. Whether the spend cap is on decides between the 500 column and the 10,000 column,
and I could not read that setting through the API. **This is the single highest-leverage unknown in the
lane** and it is listed under UNRESOLVED.

The doc also states the failure mode explicitly, which matters more than the number:

> `tenant_events`: Connections will be disconnected if your project is generating too many messages per
> second.

Exceeding messages-per-second does not shed the excess messages. It **disconnects sockets**, project
wide, including sockets that were not responsible.

### Sockets per user

One. `supabase-js` holds a single websocket per client and multiplexes channels over it; the app holds
one client singleton (`packages/api/src/client.ts`). A signed-in athlete with the chat tab and an open
thread holds exactly one `chat:user:{uid}` channel, because `use-chat.ts` ref-counts them
(`chatUserChannels`, `getOrCreateChatUserChannel`). The notifications channel is a second channel on the
same socket, and only while the bell screen is mounted. So **concurrent connections is concurrent
foregrounded app instances**, and the 100-channels-per-connection limit is never approached.

### Deriving concurrency, assumptions stated

Inputs, flagged as assumptions because no analytics exist in this repo to source them:

- DAU/MAU 20% steady state, 40% on launch day.
- Mean session length 7 minutes, 1.6 sessions per DAU per day, so 11.2 app-minutes per DAU per day.
- Peak-hour concentration 25% of daily minutes in the busiest hour (the 18:00 to 21:00 IST training
  window), rising to 45% in the hour after a launch push blast.
- Peak-minute burst factor 2.0 over the hour average.

Steady state at 10,000 registered:

    DAU                     = 10,000 x 0.20            = 2,000
    daily app-minutes       = 2,000 x 11.2             = 22,400
    peak-hour minutes       = 22,400 x 0.25            = 5,600
    mean concurrent in hour = 5,600 / 60               = 93
    peak-minute concurrent  = 93 x 2.0                 = 186 sockets

186 against 500 is 2.7x headroom. **Steady state holds even with the spend cap on.**

Launch day with an announcement push:

    DAU                     = 10,000 x 0.40            = 4,000
    daily app-minutes       = 4,000 x 11.2             = 44,800
    blast-hour minutes      = 44,800 x 0.45            = 20,160
    mean concurrent in hour = 20,160 / 60              = 336
    peak-minute concurrent  = 336 x 2.0                = 672 sockets

### FINDING R-4 (P0 if the spend cap is on, P2 if it is off). Launch-day concurrency crosses 500

- **Mechanism:** concurrent websocket connections exceed the project ceiling; Realtime refuses the
  channel join with `too_many_connections`.
- **Breaking number:** 672 peak-minute sockets against a 500 ceiling, from the arithmetic above.
  Inverting it, the ceiling is reached at **7,440 registered users on launch day**
  (500 / 672 x 10,000), so 10,000 crosses it with 34% to spare on the wrong side. Steady state does not
  cross it until roughly 27,000 registered users.
- **User impact:** nothing crashes and nothing errors visibly. `supabase-js` reports `CHANNEL_ERROR`,
  and the app already handles it: `ChatThreadList.tsx:132` shows the "Disconnected" pill and
  `chat/[id].tsx:244` shows "Disconnected, pull down to reload". So on the busiest hour of launch day,
  a fraction of users have chat silently stop updating live and are told to pull to refresh. The bell
  stops updating for the same users. This reads as "the app is broken" and generates support load, not
  crash reports.
- **Cheapest fix:** **CONFIG, and it is free.** Removing the spend cap on the existing Pro plan moves
  concurrent connections 500 to 10,000 and messages per second 500 to 2,500, per the table above. No
  code, no migration. Do this before launch regardless of every other finding in this document,
  because every other realtime ceiling in this lane moves with it.

Channel joins per second is not the binding constraint and is worth recording so nobody chases it: a
push blast that opens 5,000 apps with half arriving in the first 60 seconds produces 2,500 joins in 60
seconds, and at two channels each that is 84 joins per second against a 500 ceiling.

---

## 3. Session notification volume at 10,000, and whether the bell query holds

### Volume

`0103` writes one `notifications` row per notifying transition. Read from the migration: for a 1:1
session `sessions.player_id` gets one row; for a group session it is
`insert ... select sp.player_id from session_participants sp where sp.session_id = $1`, so one row per
roster member. Notifying actions are accept, decline, start, complete. The coach is never notified
(`notify_session_parties` comment: "athlete side only").

Derivation at 10,000 registered:

    1:1 sessions
      booking athletes        = 10,000 x 0.15                    = 1,500
      sessions per week       = 1,500 x 2                         = 3,000
      sessions per day        = 3,000 / 7                         = 430
      notifications per day   = 430 x 3 (accept, start, complete) = 1,290

    group sessions
      coaches                 = 10,000 x 0.02                     = 200
      groups per coach        = 2
      sessions per group/week = 3
      mean roster             = 10
      transitions             = 3
      per week                = 200 x 2 x 3 x 10 x 3              = 36,000
      per day                                                     = 5,140

    membership sweep (0104)
      live memberships        = 10,000 x 0.40                     = 4,000
      reminders per day       = 4,000 / 30                        = 133
      expiries + lapses/day   = 133 + 27 (20% churn)              = 160

    TOTAL                                                          ~ 6,700 rows/day
                                                                   = 0.078/s average
                                                                   = 0.78/s in a 10x evening peak

Against a 500 messages-per-second ceiling that is nothing, and it is nothing even as realtime events,
because subscription 5 only exists while the bell screen is mounted. **Notification volume is not a
fan-out problem at 10,000.** It is a storage and query-shape problem.

    6,700/day x 365 = 2.45M rows/year
    at ~250 bytes heap + ~60 bytes index = ~760 MB in year one

### The bell query, plan proven not assumed

`use-notifications.ts` has two reads behind the bell and they behave completely differently.

**`unreadCount()` HOLDS.**

```
.from("notifications").select("id", { count: "exact", head: true })
  .eq("user_id", me).is("read_at", null)
```

`idx_notifications_user_id_read_at` is `(user_id, read_at)`. This is an exact left-prefix match on both
predicates, and the unread set is small by construction because the screen marks read. This query stays
cheap at any table size. This is also the only notification query Home runs
(`(tabs)/index.tsx:71`, inside a `useFocusEffect`), so the hot path is the healthy one.

**`list()` DOES NOT HOLD.**

```
.from("notifications").select(NOTIFICATION_SELECT)
  .eq("user_id", me).order("created_at", { ascending: false })
```

There is **no `.limit()`**. Plan, forced past the 63-row seq-scan preference with
`set local enable_seqscan = off` so the shape at scale is visible:

```
Sort  (cost=2.37..2.38 rows=1 width=148)
  Sort Key: notifications.created_at DESC
  ->  Index Scan using idx_notifications_user_id_read_at on public.notifications
        Index Cond: (notifications.user_id = $1)
```

Two problems in that plan. The index does not carry `created_at`, so a **Sort node is unavoidable**;
and the index carries none of `title`, `body`, `deep_link`, so **it is not and cannot become
index-only** for this select list. Every qualifying row is a heap fetch.

### FINDING R-5 (P1). The bell list is unbounded and grows linearly forever

- **Mechanism:** an unbounded `select ... order by created_at desc` over a table with no retention, on
  an index that serves neither the ordering nor the projection.
- **Breaking number, derived:** a group athlete in 2 groups receiving 3 group sessions per week at 3
  notifying transitions each accrues 18 rows per week plus roughly 1.5 membership rows per month, so
  **950 rows per year**. Because rows are inserted chronologically and interleaved across 10,000 users,
  one user's 950 rows land on roughly 950 distinct heap pages. Against a 760 MB table in a 256 MB
  buffer cache most of those are misses, and at ~0.4 ms per gp3 read that is **~380 ms of IO for one
  screen open**, plus the sort, plus ~240 KB of JSON over mobile data. The threshold where it becomes
  perceptible, taking 300 rows and ~120 ms as the line, is **month 4 after launch**. There is no
  ceiling: it is linear in account age and never falls, because nothing deletes from `notifications`
  (no `delete` against it exists anywhere in `supabase/` or `packages/`).
- **User impact:** the bell screen takes progressively longer to paint, and the app downloads the
  user's entire notification history on every open. On a metered Indian mobile plan that is real money.
  At month 12 it is roughly a quarter of a megabyte per tap.
- **Cheapest fix:** two changes, both small, do the first one at minimum.
  1. **CODE**, `packages/api/src/use-notifications.ts`: add `.limit(50)` and a keyset `lt("created_at",
     cursor)` for the next page. Three lines, and it removes the unbounded fetch immediately with no
     schema change.
  2. **MIGRATION**: `create index concurrently idx_notifications_user_created on public.notifications
     (user_id, created_at desc);` This removes the Sort node entirely and makes a 50-row page 50
     sequential index entries plus 50 heap fetches instead of 950. Note `idx_notifications_user_id_read_at`
     must be KEPT, it is what makes `unreadCount()` cheap.
  3. Optional **MIGRATION**: fold a retention pass into `sweep_group_memberships` deleting read
     notifications older than 90 days, which caps the table rather than the query.

---

## 4. Expo push: batching, rate limits, and a coach action on a large group

### The provider's limits, from the Expo docs (fetched 2026-08-14)

- **600 notifications per second per project**, exceeding it returns `TOO_MANY_REQUESTS`.
- **100 push notifications maximum per request**, exceeding it returns `PUSH_TOO_MANY_NOTIFICATIONS`.
- 1,000 ticket ids maximum per receipt query.

### What the code does

`supabase/functions/_shared/notify.ts` sets `EXPO_BATCH_SIZE = 100` and `chunk(tokens, EXPO_BATCH_SIZE)`,
so the 100-per-request limit is respected. But `deliverToDevices(service, tokens, input)` is only ever
called from `dispatchNotification`, which handles **one user**. The tokens it chunks are that one
user's device tokens. Production has 1 `push_tokens` row across 227 auth users; a realistic user has 1
to 2. **So every request to Expo carries 1 or 2 messages and the batching is dead code in practice.**

`supabase/functions/notify-dispatch/index.ts` does accept `{ notifications: [...] }`, and then:

```js
for (const input of inputs) {
  dispatched.push(await dispatchNotification(service, input));
}
```

Strictly sequential, one full `dispatchNotification` per recipient. Each of those performs, in order:
one INSERT into `notifications`, one SELECT on `notification_prefs`, one SELECT on `push_tokens` (plus
one SELECT on `users` only for `booking` and `chat` types, since `TYPE_TO_0087_CATEGORY` maps nothing
for `session` and `membership`), and one HTTPS POST to `exp.host`.

### FINDING R-6 (P0). Push throughput is capped at about 4 per second regardless of load

- **Mechanism:** per-recipient sequential dispatch with a synchronous external HTTP round trip inside
  the loop, and a batch API whose batching is applied to the wrong dimension (one user's devices rather
  than many users' devices).
- **Breaking number, derived:** a round trip from `ap-south-1` to `exp.host` is roughly 200 to 250 ms,
  plus ~15 ms of database round trips, so call it **250 ms per recipient**, giving a ceiling of
  **4 pushes per second**. Against Expo's own 600 per second allowance that is 0.7% utilisation: the
  design cannot reach its provider's rate limit even in principle. Concretely:
  - a group of 50 takes **12.5 seconds**, so the last athlete is told the session started 12 seconds
    after the first;
  - a group of **240 crosses a 60-second client timeout** (60 / 0.25);
  - a launch announcement to 10,000 users takes **10,000 x 0.25 s = 42 minutes** serialized, and will
    time out long before finishing, leaving a partial send with no resume and no idempotency key.
- **User impact:** group notifications arrive staggered over tens of seconds, and any fan-out above a
  couple of hundred simply fails partway with no record of where it stopped.
- **Cheapest fix:** **CODE**, contained entirely in `supabase/functions/_shared/notify.ts`. Add a
  `dispatchNotificationFanout(service, { type, title, body, deepLink }, userIds[])` that does:
  one `insert into notifications ... select unnest($1)` for all rows; one
  `select ... from notification_prefs where user_id in (...)`; one
  `select ... from push_tokens where user_id in (...)`; then group every surviving token into
  100-token Expo requests. A 10,000-recipient blast goes from 10,000 requests to **100 requests**, and
  from 42 minutes to roughly 25 seconds. Keep the existing per-user path for single dispatches. The
  chunking helper already exists.

### FINDING R-7 (P0). No session or membership notification produces a device push at all

`grep -rn "notify-dispatch\|dispatchNotification"` over `supabase/functions`, `supabase/migrations` and
`packages` returns exactly **one** caller outside the definition itself:
`supabase/functions/_shared/finalize-court-booking-payment.ts:157`.

`0103`'s `notify_session_parties` and `0104`'s `sweep_group_memberships` both write
`insert into public.notifications (...)` directly in SQL. Neither reaches `notify.ts`, so neither
attempts the device-push leg. The migrations are consistent about this and 0104's header even says the
push leg "buys nothing" today, but that reasoning was written against the P9 stub, and `notify.ts` is no
longer a stub: the Expo transport is fully implemented.

- **Mechanism:** two delivery paths exist (in-database INSERT, and edge-function dispatch) and only the
  second carries push. The new features were built on the first.
- **Breaking number:** broken at 1 user. It does not scale badly, it is absent.
- **User impact:** this is the feature the founder asked for and it does not deliver. An athlete whose
  coach accepts, starts or completes a session with the app closed learns nothing. There are only three
  ways a notification currently reaches them: the realtime stream, which only fires while they are
  sitting on the bell screen; the `unreadCount()` badge, which only refreshes when Home regains focus;
  or pull-to-refresh. A membership reminder sent at 03:30 IST, whose entire purpose per 0104's header
  is to reach "the athlete who has not opened the app", reaches nobody.
- **Cheapest fix:** **MIGRATION plus CODE**, and it composes with R-6.
  Add `pushed_at timestamptz` to `notifications`, and a second pg_cron job every 30 seconds that selects
  `where pushed_at is null`, groups by `(type, title, body, deep_link)`, and calls the new
  `dispatchNotificationFanout` over `pg_net`. This gets batching for free (a group session's whole
  roster shares one title and body, so it becomes ONE Expo request), needs no change to 0103 or 0104,
  and is resumable because `pushed_at` is the checkpoint. The alternative, a `pg_net` call inside the
  transaction, couples session state transitions to Expo availability and should not be used on a
  money-bearing path.

### The group size ceiling: there isn't one

`pg_constraint` on `training_groups` gives `training_groups_capacity_check` as `CHECK ((capacity > 0))`.
**No upper bound.** Live maximum capacity today is 8 across one group, so nothing has exercised it.

`create_group_session` seeds `session_participants` from active members, `notify_session_parties` fans
out one notification per participant, `broadcast_chat_message` fans out one `realtime.send` per thread
member, and the push path fans out one Expo request per recipient. **All four fan-outs are bounded only
by a number the coach types into a form.**

### FINDING R-8 (P1). Chat broadcast fan-out is O(members) writes per message with no capacity ceiling

`0092`'s `broadcast_chat_message` is an `after insert ... for each row` trigger on `chat_messages` that
loops over the member union and calls `realtime.send(...)` once per member. `realtime.send` inserts a
row into `realtime.messages`, which is a daily-partitioned table published through
`supabase_realtime_messages_publication` (both verified above). So each message is M physical INSERTs,
M WAL records and M delivered websocket events, inside the sender's own transaction.

- **Mechanism:** database-side fan-out. Project events per second is the sum over active threads of
  (messages per second x member count).
- **Breaking number:** the messages-per-second ceiling is **500** with the spend cap on, 2,500 without.
  M x R > 500 breaks it, so:
  - a **100-member** group sustaining **5 messages per second** hits the cap on its own;
  - a **500-member** group needs only **1 message per second**.
  Steady-state chat at 10,000 is nowhere near this (2,000 chat-active users x 6 messages/day with a
  weighted mean thread size of 4 gives 14,400 events/day = 0.17/s average, 1.7/s at a 10x peak), so
  **the risk is entirely the missing capacity ceiling, not the user count.** Separately, the
  synchronous cost inside the sender's transaction is roughly 0.15 ms per member on this instance, so
  send latency picks up ~30 ms at M=200 and ~150 ms at M=1,000, while holding one of only 60
  connections.
- **User impact:** when the tenant messages-per-second limit is crossed, Realtime does not drop the
  excess, it **disconnects sockets project wide** (`tenant_events`). One coach with an oversized group
  takes live chat and the notification stream away from every other user on the platform, and the app
  shows them "Disconnected, pull down to reload".
- **Cheapest fix:** **MIGRATION**, one line, and it closes the unbounded fan-out in chat, group session
  notifications and push simultaneously:
  `alter table public.training_groups add constraint training_groups_capacity_max check (capacity <= 100);`
  Pick the number from the product, but pick one. The architectural alternative, a per-thread topic with
  a membership policy on `realtime.messages`, turns M inserts into 1, but it forces the inbox to
  subscribe every thread's topic and runs into the 100-channels-per-connection limit, so it is not the
  cheap fix.

---

## 5. The membership expiry sweep at 10,000

`0105` schedules `select public.sweep_group_memberships();` at `0 22 * * *`, one statement, therefore
**one transaction**. `0104`'s function has three stages, each a `for v_row in select ... loop` with a
`begin ... exception when others` block wrapping an UPDATE and an INSERT per row.

### Scan cost: a non-issue at 10,000, and saying "add an index" here would be wrong

`EXPLAIN (ANALYZE, BUFFERS)` of the stage-2 predicate against the live table:

```
Nested Loop
  ->  Seq Scan on group_memberships m
        Filter: ((period_end IS NOT NULL) AND (status = 'active') AND (period_end < ...) AND (period_end >= ...))
  ->  Seq Scan on training_groups g
```

Seq scan, as expected: `pg_indexes` confirms no index leads with `status` or `period_end`
(`(group_id,status)` and `(player_id,status)` both lead with the wrong column).

Arithmetic at 10,000: roughly 4,000 live memberships, and a year of churn accumulating lapsed rows
triples it to ~12,000. At ~180 bytes per row that is 2.16 MB, about 264 pages. Three stage scans is
~800 buffered page reads, **roughly 4 ms**, fully cached. **An index here would be dead weight until
somewhere north of 500,000 memberships.** Recorded explicitly so the next agent does not add one.

### FINDING R-9 (P2). The sweep opens one subtransaction per row and overflows the subxid cache

- **Mechanism:** every `begin ... exception when others` block in plpgsql allocates a subtransaction.
  Postgres caches at most **64** subtransaction ids per top-level transaction in PGPROC; past that the
  transaction is flagged overflowed, and every *other* backend that must check tuple visibility against
  it reads `pg_subtrans` through the shared SubtransSLRU instead of the in-memory cache.
- **Breaking number:** the threshold is **65 swept rows in one run**. At 10,000 users, rows swept per
  night:
  - stage 1, reminders: 4,000 live memberships renewing monthly, 3-day lead, so **4,000 / 30 = 133/day**
  - stage 2, expiries: another **133/day** crossing `period_end`
  - stage 3, lapses: 20% never renew, so **27/day**
  - total **293 subtransactions per run**, 4.6x the cache.
  It is crossed on the first night after launch and every night after, at any user count above roughly
  **2,000** (65 x 30 = 1,950 live memberships, or ~4,900 registered at a 40% membership rate).
- **User impact:** at 22:00 UTC, which is 03:30 IST, almost nobody is on the platform, which is exactly
  why 0105 chose that hour and it was a good choice. The cost is paid as latency on concurrent
  backends, and there are close to none. **This is a watch item, not a launch blocker.** It becomes a
  real problem only if the sweep is ever run manually during the day or its schedule is moved.
- **Cheapest fix:** **MIGRATION**. Replace each row loop with a single set-based
  `update ... returning` feeding an `insert into notifications ... select`. The per-row exception
  swallowing is lost, but there is no per-row failure mode here that a set operation would not also
  fail on: all three stages write only to tables the definer owns, with no user input and no
  constraint a single row could violate independently. If per-row isolation is genuinely wanted,
  convert to a `procedure` and `commit` every 500 rows, which also caps the lock hold time.

### Locks: they do not block live traffic at 10,000, with one exception worth naming

The sweep holds `RowExclusiveLock` on `group_memberships` and `notifications` for the whole run.
RowExclusive does not conflict with SELECT, INSERT, UPDATE or DELETE, so **it does not block ordinary
traffic**. What it does block:

1. **DDL.** `ALTER TABLE` on either table waits behind it. A migration deploy scheduled near 03:30 IST
   will queue.
2. **`renew_group_membership` and `activate_group_membership_paid`.** Both open with
   `select * into ... from public.group_memberships where id = $1 for update`. Row locks are held for
   the lifetime of the transaction, not the statement, so an athlete tapping Renew on a row the sweep
   has already touched blocks until the **entire sweep commits**, not until that row's own update
   finishes.

Duration, derived: 293 rows x roughly 1.5 ms per iteration (one UPDATE, one INSERT, one subtransaction)
= **~440 ms**. So the worst-case blocked Renew waits 0.44 seconds, at 03:30 IST. **Not a P0 at 10,000.**
The same arithmetic at 50,000 users gives 1,465 rows and ~2.2 seconds, which is a P1; past roughly
500,000 it is an outage shape. The set-based fix in R-9 removes this too, because a single UPDATE
statement holds its row locks for milliseconds rather than for the run.

### FINDING R-10 (P2). Stages 2 and 3 notify unconditionally while the update is guarded

Stage 2, verbatim from `0104`:

```sql
update public.group_memberships
set status = 'expired', expiry_notified_at = now()
where id = v_row.id and status = 'active';       -- guarded

insert into public.notifications (user_id, type, title, body, deep_link)
values (...);                                     -- NOT guarded
```

Stage 3 has the same shape with `status in ('active','expired')`.

- **Mechanism:** the UPDATE is idempotent, the INSERT beside it is not. Two overlapping runs (the cron
  job plus a manual invocation, or a retried job) both select the same row into their loops. One
  UPDATE wins and the other matches zero rows, but **both INSERTs fire**.
- **Breaking number:** any overlap. Not user-count dependent, but the window widens with the sweep's
  duration, which is linear in swept rows, so at 10,000 there is a ~440 ms window every night and it
  grows.
- **User impact:** duplicate "Membership needs renewing" and "Membership lapsed" notifications for the
  same period. The idempotency the migration's own header promises ("a double run in one day is a no
  op") does not hold for the notification, only for the status.
- **Cheapest fix:** **MIGRATION**. Guard the INSERT with `if found then ... end if;` after the UPDATE,
  or fold both into `update ... returning` feeding the INSERT, which is the same change R-9 wants.

---

## What is scheduled versus what runs

`cron.job` holds exactly one row on production:

```
jobid 1 | expire-stale-holds | */5 * * * * | select public.expire_stale_holds(); | active
```

`0105` is not applied, so **the membership sweep does not run at all today**. Every membership
currently sitting past `period_end` is still `active`, the Renew button is still dead, and the coach's
client-side lapsed chip still disagrees with the athlete's card, exactly as CURRENT-STATE records under
OPEN. Nothing in this lane changes that until 0102 to 0106 merge and apply.

---

## Ranked, for the week

| # | Finding | Severity | Fix type | Effort |
|---|---|---|---|---|
| R-4 | Launch concurrency crosses the 500 Pro ceiling | P0 (if spend cap on) | CONFIG | minutes, free |
| R-7 | No session or membership notification produces a push | P0 | MIGRATION + CODE | half a day |
| R-6 | Push throughput capped at ~4/s, breaks at 240 recipients | P0 | CODE | half a day |
| R-2 | Three UPA subscriptions dead, tables unpublished | P1 | MIGRATION | an hour plus RLS review |
| R-3 | Notifications channel accumulates a subscription per open | P1 | CODE | six lines |
| R-5 | Bell list unbounded, no retention, sort not covered | P1 | CODE + MIGRATION | an hour |
| R-8 | Chat fan-out O(members), no capacity ceiling | P1 | MIGRATION | one line |
| R-1 | chat_messages and sessions published with no subscribers | P2 | MIGRATION | one line |
| R-9 | Sweep opens 293 subtransactions per run | P2 | MIGRATION | an hour |
| R-10 | Sweep notifies unconditionally beside a guarded update | P2 | MIGRATION | ten lines |

---

## Track outcome: push notification delivery, 2026-08-14

Branch `track/push-delivery-scale` off `integration/p6-audit-fixes` at `32f96e9`. Nothing was
applied to production; every migration below is a FILE. Everything asserted here is either a
command output or a read-only catalog query, both quoted.

### R-7 CLOSED in code. Sweeper, not webhook, and the choice was made on four points

`0110_notification_push_delivery.sql` adds `pushed_at`, `push_claimed_at` and `push_attempts` to
`notifications`, a partial index on the backlog, `claim_notification_push_batch` (a single
`update ... where id in (select ... for update skip locked limit n) returning`), and a
`notifications_lock_push_state` BEFORE UPDATE trigger so the owner UPDATE policy 0002 grants the
bell cannot be used to forge delivery state. `0111` schedules `notification-push-sweep` every 30
seconds over pg_net. `supabase/functions/notify-push-sweep/index.ts` is the worker.

The webhook alternative was rejected because it is per row (a group of 50 becomes 50
single-recipient HTTP calls, R-6 reintroduced one layer up), fire and forget (a pg_net failure
lands in `net._http_response` and leaves no mark on the row, so nothing can retry), it would put
an outbound call inside the transaction that moves a session's status, and it can never drain a
backlog written while it was down. The sweeper inverts all four: `pushed_at` is a checkpoint, so
a failed dispatch simply comes back; `skip locked` plus the claim window means two overlapping
runs cannot send the same push twice; and rows sharing a title and body collapse into one Expo
request, which is the batching R-6 wanted, for free.

Two facts that shaped it, both read from the live project, and both of which contradict the fix
this document originally proposed:

    select extname from pg_extension where extname in ('pg_net','pg_cron','supabase_vault');
      -> pg_cron 1.6.4, supabase_vault 0.3.1.  pg_net IS NOT INSTALLED.
    select name from vault.secrets;   -> zero rows.

R-7's "cheapest fix" said "a second pg_cron job ... over pg_net" as though pg_net were present.
It is not, and neither are the secrets such a job needs. `0111` therefore opens with four hard
guards and RAISES rather than skipping: a job installed without a working key would run every 30
seconds, take a 403 from `assertServiceRoleRequest`, record it only in `net._http_response`, and
show as a healthy active row in `cron.job` while delivering nothing. That is the "gate that
cannot run" shape CURRENT-STATE names, so it is a failure, not a skip.

### R-6 CLOSED in code

`_shared/notify.ts` gains `pushContentToUsers` and `dispatchNotificationFanout`. Prefs and
`push_tokens` are read in bulk (chunked at 200 users per `IN` list, because PostgREST puts the
list in the query string), Expo requests carry up to 100 tokens **belonging to different users**,
requests run at most 6 in flight, and a pacer reserves `messages / 600` seconds per batch so the
fan-out runs at the provider's own allowance and no faster. `notify-dispatch` groups identical
content instead of looping recipients; its request and response shapes are unchanged.

The old per-user path still exists as `dispatchNotification`, now implemented on top of the
fan-out, so `finalize-court-booking-payment.ts` is untouched.

### R-8: capacity ceiling SHIPPED, moving the fan-out off the transaction DELIBERATELY NOT DONE

`0112_training_group_capacity_ceiling.sql` adds `check (capacity <= 100)` (added `not valid` then
validated, so the ALTER does not hold a strong lock through a scan) and recreates 0080's two RPCs
verbatim plus one guard each so a coach gets a sentence rather than a constraint violation. The
mobile create/edit screen enforces the same number with honest copy. 100 is not arbitrary: it is
exactly one Expo request, 20% of the 500/s Pro realtime ceiling at one message per second, about
15 ms of synchronous trigger cost at 0.15 ms per member, and an order of magnitude above the
largest real group today (live maximum capacity is 8).

**Moving `broadcast_chat_message` off the sender transaction was assessed and NOT attempted.**
Precisely what was found, so the next agent does not re-derive it:

1. **`realtime.send` opens a SUBTRANSACTION per call.** Read from `pg_proc.prosrc` on the live
   project, its body is `BEGIN BEGIN ... INSERT INTO realtime.messages ... EXCEPTION WHEN OTHERS
   THEN RAISE WARNING ... END; END;`. Every plpgsql `begin ... exception` block allocates a
   subtransaction, so a group chat message does not merely perform M inserts, it opens **M
   subtransactions inside the sender's transaction**. That is the same PGPROC 64-subxid overflow
   mechanism as R-9, on the interactive chat path rather than the 03:30 sweep. This is new: it is
   not in R-8 above, and it is a second, independent reason the capacity ceiling matters, because
   the ceiling of 100 sits just past the 64-entry cache.
2. **A set-based rewrite is small but not verifiable here.** Replacing the loop with one
   `insert into realtime.messages (id, payload, event, topic, private, extension) select ...` over
   the member union would turn M statements and M subtransactions into one statement writing M
   rows. It cannot remove the M WAL records or the M websocket events: those are inherent to
   per-user topics, and the alternative (one topic per thread) forces the inbox to subscribe every
   thread and runs into the 100-channels-per-connection limit, exactly as R-8 says.
3. **Why it was not shipped anyway.** It reimplements a Supabase-owned function's internals,
   including its `SET LOCAL realtime.topic TO <topic>` before the insert. `realtime.messages`
   carries no triggers (`pg_trigger` on `realtime.messages`, zero non-internal rows), which
   suggests that GUC is read on the subscriber side by `realtime.topic()` and is vestigial for the
   insert. **Suggests is not proves.** Confirming it needs either a live socket test, which the
   device gate refuses and which no read-only query substitutes for, or the Realtime server
   source. Getting it wrong silently breaks every chat message in the product with a green
   typecheck. Shipping an unverifiable rewrite of the live chat path to save a subtransaction is
   the wrong trade while the capacity ceiling already bounds the blast radius.
4. **A genuine move off the transaction is a different, larger change.** It means an outbox: the
   trigger writes one row, and a worker fans out. That trades the current strict ordering and
   sub-millisecond delivery for a queue, and it needs its own claim, retry and ordering design.
   That is a track, not a fix, and it is not needed at 10,000: steady-state chat is 0.17 events
   per second average and 1.7 at a 10x peak against a 500 ceiling.

**Recommended next step, in order:** apply 0112 first, since one line of DDL removes the
unbounded case entirely; then, if the set-based rewrite is still wanted, do it behind a real
socket test on a preview branch, not on production.

### What this track did NOT do

- Did not apply anything. `schema_migrations` is untouched; 0102 to 0113 are all unapplied
  (renumbered during the p6 integration merge, see docs/architecture/MIGRATION-RENUMBERING.md).
- Did not deploy `notify-push-sweep`, and did not create the two vault secrets, both writes.
- Did not take a device screenshot or run Maestro for the one-line capacity caption. The UI change
  is a validation string and a caption on an existing screen, and the device gate is a founder
  rule, so this is recorded as owed rather than claimed.
- Did not touch R-1 through R-5, R-9 or R-10; other tracks own those.

---

## UNRESOLVED

1. **Whether the Pro spend cap is on.** The docs distinguish Pro (500 concurrent, 500 messages/s) from
   Pro with no spend cap (10,000 and 2,500). I could not read that setting through the management API
   and did not touch billing. R-4's severity and R-8's breaking number both flip on it. Read it from
   the dashboard billing page before acting on either.
2. **Whether Realtime coalesces K matching subscription ids into one websocket message or sends K.**
   This decides whether R-3's binding leak multiplies wire events against the messages-per-second quota
   or only multiplies server-side matching work. Determining it needs the Realtime server source or a
   live socket test, and a live socket test on a device is refused under the device gate. The fix is
   the same either way, so this does not block R-3.
3. **Who creates the `realtime.messages` daily partitions.** They exist only through `2026_08_16` and
   `cron.job` has no partition job, so the Realtime service manages them out of band. I did not verify
   the mechanism, so I cannot say whether a stretch with no connected tenant leaves the next day's
   partition uncreated, which would make every `realtime.send()` and therefore every chat message fail.
   Worth one check on a quiet morning.
4. **Replication slot lag under load.** `pg_replication_slots` is currently empty, consistent with an
   idle project whose Realtime tenant has disconnected. Measuring decode lag requires generating load,
   which is forbidden.
5. **DAU/MAU, session length and peak concentration are assumptions**, stated inline. No analytics
   exist in this repo to source them. Every concurrency number in section 2 scales linearly with them,
   so if the founder has real figures from any prior surface, section 2 should be re-derived rather
   than trusted.
6. **The `ap-south-1` to `exp.host` round trip time (250 ms) is an estimate**, not a measurement,
   because measuring it means sending real pushes. R-6's breaking numbers are proportional to it. The
   finding survives any plausible value: even at an optimistic 100 ms the sequential loop still caps at
   10 pushes per second and still times out around 600 recipients.
