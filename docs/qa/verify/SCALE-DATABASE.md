# Scale verification: the database under 10,000 users

Lane: database. Target raised from 1,000 to 10,000 by the founder on 2026-08-14.
All work read only against `syzzfgaudpifwvbpycyi`. No writes, no DDL, no load generated.
Every plan below was captured with `EXPLAIN (ANALYZE, BUFFERS)` as role `authenticated` with a
real JWT claim, so RLS is in the plan. Where a claim is about an absence, the catalog was
queried, never a migration file.

Phase 3's conclusions were treated as a starting point, not an answer. Two of them held and are
recorded in "What survives"; four did not survive the 10x.

---

## Measured constants

These are the inputs every number below is derived from. All from `pg_settings`, `pg_roles` and
`EXPLAIN ANALYZE` on this project, this session.

| Constant | Value | Source |
|---|---|---|
| `max_connections` | 60 | `pg_settings` |
| `shared_buffers` | 256 MB | `pg_settings` (32768 x 8kB) |
| `effective_cache_size` | 768 MB | `pg_settings` (98304 x 8kB) |
| `work_mem` | 3500 kB = 3,584,000 bytes | `pg_settings` |
| `max_parallel_workers_per_gather` | 1 | `pg_settings` |
| `jit` | off | `pg_settings` |
| `statement_timeout`, role `authenticated` | **8000 ms** | `pg_roles.rolconfig` |
| `statement_timeout`, role `anon` | **3000 ms** | `pg_roles.rolconfig` |

The two timeouts are the hard wall. A query that crosses them does not render slowly, it returns
`57014` and the screen shows an error. `anon` is the guest path, so guests break at 3 s while
signed-in users are still limping along at 7 s.

Per-row costs measured on the live tables (all `shared hit`, i.e. fully cached; a cold cache is
strictly worse):

| Relation | Cost per row scanned | Buffers per row | Basis |
|---|---|---|---|
| `court_bookings` under RLS | **0.37 to 0.42 ms** | 11.1 | 3 runs: 40.7 / 38.1 / 42.8 ms over 103 rows, 1140-1148 buffers |
| `chat_threads` under RLS | 0.037 ms | 2.5 | 1.57 ms over 42 rows, 107 buffers |
| `sessions` under RLS (player scan) | 0.076 ms | 3.0 | 3.88 ms over 51 rows, 155 buffers |
| `chat_messages` under RLS | 0.0155 ms | 0.9 | 3.25 ms over 210 rows, 187 buffers |

Average row sizes, for payload and sort-spill arithmetic (`pg_column_size`):

| Table | Bytes/row |
|---|---|
| `clips` | 306 |
| `notifications` | 170 |
| `chat_messages` | 124 (text averages 40 chars) |
| `users` | 180 (heap size / live tuples) |
| `coach_profiles_public` row | 212 (plan width) |

---

## P0-1. The Clutch feed cannot use its index, at any table size, forever

### Mechanism

`clips` carries two permissive SELECT policies, which Postgres merges with OR:

```
clips_select_published : status = 'published'
clips_select_merged    : has_role('admin') OR has_role('moderator') OR owner_id = (SELECT auth.uid())
```

`hooks.ts:1400-1409` (`getFeed`) also filters `status='published'` itself, deliberately, per the
"RLS is not scoping" rule. Under RLS the application's own qual sits at a **higher security level**
than the policy qual, and Postgres will only push such a qual down into an index condition if its
operator is `LEAKPROOF`.

```
select proname, proleakproof from pg_proc where proname = 'enum_eq';
-> enum_eq | false
```

`clips.status` is an enum. `enum_eq` is **not leakproof**. So:

- the application's `status='published'` cannot become an index condition, and
- the merged RLS qual is an OR chain, which cannot become one either.

`idx_clips_status_created_at (status, created_at DESC)` is therefore **dead for the only query it
was created for**.

### Proof (this is not inferred, both halves were run)

As `authenticated`, with `enable_seqscan = off` so a seq scan carries a 1e10 cost penalty:

```
Limit  (cost=10000000018.67..10000000018.69 rows=6)
  -> Sort  (Sort Key: c.created_at DESC)
       -> Seq Scan on clips  (cost=10000000000.00..10000000018.56)
            Filter: (((status='published') OR has_role('admin') OR has_role('moderator')
                      OR (owner_id = (InitPlan 1).col1)) AND (status='published'))
```

Still a Seq Scan. The index path is not merely losing on cost, it is **not generated at all**.

Same query, same setting, as `postgres` (RLS bypassed):

```
Limit  (cost=0.14..3.65 rows=12)
  -> Index Scan using idx_clips_status_created_at on clips
       Index Cond: (status = 'published'::clip_status)
```

Index Scan, correct index, **and no Sort node** because the index is already in `created_at DESC`
order. That is the plan the feed was designed to get and never gets.

### Breaking number

Every feed open is: full Seq Scan of `clips`, full Sort of every published clip, then take 12.
The `limit 12` and the keyset cursor bound the payload, not the work.

**Sort spill.** `clips` averages 306 bytes/row (`pg_column_size`, 10,400 bytes over 34 rows). A
sort tuple adds ~24 bytes of header, so ~330 bytes.

```
3,584,000 bytes work_mem / 330 bytes per sort tuple = 10,860 published clips
```

**At 10,860 published clips, every feed open by every user spills a sort to disk.** At 10,000
users that is 1.1 clips per user. It is reachable in launch week.

**Hard timeout.** Measured 42 buffers for 34 rows scanned including RLS work = 1.24 buffers/row,
0.028 ms/row warm.

```
anon (guest, 3000 ms):        3000 / 0.028 = 107,000 clips
authenticated (8000 ms):      8000 / 0.028 = 285,000 clips
```

So the ordering of failures is: sort spills at ~11,000 clips, guests time out at ~107,000, signed
in users at ~285,000. The spill is the one that matters, because a disk-spilling sort on every
feed open by thousands of concurrent users saturates the instance's IO long before any single
query hits its own timeout.

### User experience

The Clutch tab, which is the app's front door, gets slower for everyone at once and then starts
returning an error to guests first, which is the exact population you cannot afford to lose.

### Cheapest fix: MIGRATION, one index

```sql
create index concurrently idx_clips_published_created_at
  on public.clips (created_at desc)
  where status = 'published';
```

A partial index's predicate is proven at plan time, not evaluated as a qual, so it is **not**
subject to the leakproof rule. Verified on this database by the closest available analogue:
`sessions_coach_date_slot_unique` is partial on
`status <> ALL (ARRAY['declined','cancelled']::session_status[])`, and under `authenticated` with
RLS active the planner chose it and proved the predicate from the caller's own (higher security
level, non-leakproof enum) qual:

```
Index Scan Backward using sessions_coach_date_slot_unique on sessions s
  Index Cond: (coach_id = '...')
  Filter: (is_session_participant(...) OR has_role('admin') OR ...)
```

**Do not add `deleted_at` to the index predicate.** `information_schema.columns` confirms `clips`
has no `deleted_at` column on the live project, which is exactly why `getMyClips` filters it in
JavaScript. Adding it would fail the migration.

This index must be planted and re-EXPLAINed on a preview branch before merge. DDL was forbidden
here, so the mechanism is verified and the specific new plan is not.

---

## P0-2. listMyBookings scans the entire court_bookings table, and the RLS OR is written expensive-first

### Mechanism

`packages/api/src/hooks.ts:777-789`:

```ts
const { data, error } = await client
  .from("court_bookings")
  .select("id, court_id, user_id, ... courts ( name, sport, venues ( name, address, city ) )")
  .order("date", { ascending: false })
  .order("slot_start", { ascending: false })
```

No `.eq("user_id", ...)`. No `.limit()`. It relies on RLS for scoping, which is the shape
CLAUDE.md forbids in three separate incidents. Here it is a performance defect as well as a
scoping one.

Two compounding faults:

**(a) No owner filter, so the scan is O(all bookings in the product), not O(my bookings).**

**(b) The policy is written expensive-first.** `court_bookings_select_merged`:

```
is_court_partner_or_staff(court_id) OR (user_id = (SELECT auth.uid()))
  OR has_role('admin') OR has_role('moderator')
```

Postgres reorders top-level AND conjuncts by cost (`order_qual_clauses`). It does **not** reorder
branches inside a single OR expression: they are evaluated left to right. So
`is_court_partner_or_staff(court_id)` runs on **every row**, before the cheap `user_id = uid` is
ever tried. That function is `LANGUAGE sql STABLE` with `SET search_path`, which disables SQL
function inlining, so it is a real function call per row; internally it joins `courts` to `venues`
and calls `has_role` twice.

### Proof

```
Sort  (Sort Key: b.date DESC, b.slot_start DESC)
  Buffers: shared hit=1148
  -> Seq Scan on court_bookings b  (actual time=7.707..40.691 rows=47 loops=1)
       Filter: (is_court_partner_or_staff(court_id) OR (user_id = (InitPlan 1).col1)
                OR has_role('admin') OR has_role('moderator'))
       Rows Removed by Filter: 56
       Buffers: shared hit=1140
Execution Time: 41.074 ms
```

**41 ms and 1,140 buffers for 103 rows.** Repeated three times: 40.7, 38.1, 42.8 ms. That is
**0.395 ms and 11.1 buffers per row scanned**, entirely from cache.

### Breaking number

```
8000 ms authenticated timeout / 0.395 ms per row = 20,250 rows in court_bookings
3000 ms anon timeout        / 0.395 ms per row =  7,595 rows
```

**At 20,250 rows in `court_bookings`, every athlete's Bookings tab returns statement timeout.**

Row growth at 10,000 users: if 15% book a court twice a month, that is 3,000 rows/month, crossing
20,250 in **month 7**. If court booking is the primary funnel (10,000 users, 1 booking/month) it
is **month 2**. Either way it is well inside the first year and nowhere near 1 million rows,
which is why "watch the tables that cross 1M" would have missed it entirely.

### User experience

The Bookings tab spins and then shows a generic error. Not for one user: for every user
simultaneously, because the threshold is a property of the table, not of the account.

### Cheapest fix: CODE plus MIGRATION, both one-liners, both needed

**Code**, `hooks.ts:779`, add the owner filter the house rule already requires:

```ts
.eq("user_id", user.id)
```

Measured effect on live data, same session:

```
Sort ... Buffers: shared hit=804
  -> Index Scan using idx_court_bookings_user_id on court_bookings b
       Index Cond: (user_id = '5875...')
Execution Time: 20.483 ms
```

Seq Scan becomes Index Scan, 41.0 ms becomes 20.5 ms, and the scaling changes from O(table) to
O(my bookings), which is the property that actually matters.

**Migration**, reorder the OR so the cheap branch is first:

```sql
-- court_bookings_select_merged
(user_id = (select auth.uid()))
  OR has_role('admin') OR has_role('moderator')
  OR is_court_partner_or_staff(court_id)
```

Without this, the expensive function still runs on every row the index returns (804 buffers for
47 rows is 17 buffers per returned row). The same defect exists in `sessions_select_merged`, which
puts `is_session_participant(id, uid)` first and `player_id = uid` last; sweep both.

---

## P0-3. The chat inbox downloads every message in every one of your threads

### Mechanism

`packages/api/src/use-chat.ts:361-379`, inside `listThreads`. After listing threads it runs:

```ts
client.from("chat_messages")
  .select("thread_id, sender_id, text, created_at, removed_at, sender_profile:public_profiles!sender_id ( name )")
  .in("thread_id", rows.map((row) => row.id))
  .order("created_at", { ascending: false })
```

No `.limit()`, and no per-thread bound. It fetches **every message in every thread the caller
belongs to**, sorts them all, and then keeps the first row per `thread_id` in JavaScript to
render a one-line preview. The docblock explicitly reasons that a per-thread round trip does not
scale, which is correct; the replacement is unbounded instead.

### Proof

The query itself is efficient. RLS collapses into hashed SubPlans over the caller's own thread
set, and the index cond is right:

```
Sort  (Sort Key: m.created_at DESC)  Buffers: shared hit=190
  -> Index Scan using idx_chat_messages_thread_id on chat_messages m
       Index Cond: (thread_id = ANY ((InitPlan 4).col1))
Execution Time: 3.917 ms   (210 rows)
```

0.0155 ms/row. The database will not time out: 8000 / 0.0155 = 516,000 messages, which one user's
threads will not reach. **The break is the payload, not the query.**

### Breaking number

`chat_messages` averages 124 bytes on disk with 40 chars of text. The JSON row carries
`thread_id` + `sender_id` (two UUIDs, 72 chars), `text` (~40), `created_at` ISO (24),
`removed_at`, a nested `sender_profile` object and all the key names: **~230 bytes of JSON per
message**.

An athlete 90 days in, in 3 active group threads (20 members, 30 messages/day) and 5 one-to-one
threads:

```
3 x (30 x 90) + 5 x 100 = 8,100 + 500 = 8,600 messages
8,600 x 230 bytes = 1.98 MB
```

**Two megabytes downloaded on every open of the Chat tab, to render 8 lines of preview text.** On
a 1 Mbit/s mobile link that is 16 seconds of blank inbox. Discomfort starts around 4,000 messages
(~0.9 MB), which a single busy 20-person coaching group reaches in about 5 months, or in weeks if
groups are the primary product at 10,000 users.

`listMessages` (`use-chat.ts:442-455`) has the same missing bound for a single thread: opening a
group conversation loads its entire history, oldest first, with no window.

### Cheapest fix

**Migration, and it deletes a query rather than adding an index.** `chat_threads` already has a
trigger `chat_messages_touch_thread -> touch_chat_thread_last_message` firing on every message
insert (confirmed in `pg_trigger`). Add `last_message_text` and `last_message_sender_id` columns
to `chat_threads`, maintain them in that existing trigger, and the second query disappears
entirely along with a full HTTP round trip.

**Code, if a migration is not wanted this week:** bound it. `.limit(rows.length * 3)` caps the
worst case at three candidate messages per thread, which is enough for the removed/blocked-sender
skip logic in almost every case. This is a stopgap; it can still miss a preview when one thread's
recent messages are all removed.

Separately, `listMessages` needs `.limit(50)` with a `created_at` cursor for older pages.

---

## P1-4. chat_threads: full table Seq Scan, per-row function, and no index for its sort

### Mechanism

`use-chat.ts:351-355` selects `chat_threads` with **no filter at all** and
`.order("last_message_at", desc)`, relying entirely on RLS.

`chat_threads_select_merged`:

```
((context_type = 'group') AND is_chat_thread_member(id, (SELECT auth.uid())))
  OR (participant_a = (SELECT auth.uid()))
  OR (participant_b = (SELECT auth.uid()))
```

Group branch first again. `is_chat_thread_member` is `LANGUAGE sql STABLE SECURITY DEFINER` with
`SET search_path`, so it cannot be inlined into a semijoin and runs as a genuine function call
per group row of the whole table. There is also **no index on `last_message_at`**, so the sort is
never index-ordered.

### Proof

```
Sort  (Sort Key: chat_threads.last_message_at DESC NULLS LAST)
  Buffers: shared hit=110
  InitPlan 1/2/3 -> Result   (auth.uid() evaluated once each, the 0090 wrap working)
  -> Seq Scan on chat_threads  (actual time=0.534..1.572 rows=32 loops=1)
       Filter: (((context_type='group') AND is_chat_thread_member(id, (InitPlan 1).col1))
                OR (participant_a = (InitPlan 2).col1) OR (participant_b = (InitPlan 3).col1))
       Rows Removed by Filter: 10
       Buffers: shared hit=107
```

107 buffers over 42 rows = 2.5 buffers/row, 1.57 ms / 42 = 0.037 ms per row scanned.

### Breaking number

**The statement timeout is not what breaks.** 8000 / 0.037 = 216,000 threads, and at 10,000 users
the table will hold roughly:

```
one-to-one: 8,500 athletes x 2 coaches engaged = 17,000
group:      ~1,500 groups x 1 thread            =  1,500
total                                            ~18,500 threads
```

So no timeout. What breaks is **the instance**, because the cost is paid per user per tab open:

```
18,500 rows x 0.037 ms = 0.68 s of CPU per Chat tab open
```

On a 2 vCPU instance the whole product can serve **2.9 inbox opens per second**. At 10,000 users
with 10% opening chat inside a peak minute:

```
1,000 opens / 60 s = 16.7 opens/s  ->  5.7x over capacity
```

**The Chat tab saturates the database at roughly 3 concurrent opens per second**, which is
reached at a few hundred simultaneously active users, not ten thousand.

### User experience

Everything slows down, not just chat. The inbox is burning the CPU that the feed, bookings and
checkout all need. This is the failure that looks like "the app is slow" with no single slow
screen to blame.

### Cheapest fix: MIGRATION plus CODE

**Migration**, two indexes and a policy rewrite:

```sql
create index concurrently idx_chat_threads_pa_last_msg
  on public.chat_threads (participant_a, last_message_at desc);
create index concurrently idx_chat_threads_pb_last_msg
  on public.chat_threads (participant_b, last_message_at desc);

-- chat_threads_select_merged, cheap branches first
(participant_a = (select auth.uid())) OR (participant_b = (select auth.uid()))
  OR ((context_type = 'group') AND is_chat_thread_member(id, (select auth.uid())))
```

**Code**: scope the query explicitly rather than leaning on RLS, so PostgREST emits a qual the
new indexes can serve. Cleanest is a single security-definer RPC returning the caller's threads
already ordered and already carrying the denormalized preview from P0-3.

Both of these need a plant-and-EXPLAIN pass on a preview branch: the two-index bitmap-OR plan is
the expected shape but was not measured, because DDL is forbidden here.

---

## P1-5. notifications: unbounded, and the index does not cover the sort

### Mechanism

`use-notifications.ts:79-89`: `where user_id = me order by created_at desc`, no `.limit()`.
The only index is `idx_notifications_user_id_read_at (user_id, read_at)`.

### Proof, not assumption

At 63 live rows the planner picks a Seq Scan, which tells you nothing. Forcing the index path
shows what happens at scale:

```
set local enable_seqscan = off;

Sort  (Sort Key: n.created_at DESC)   Sort Method: quicksort  Memory: 29kB
  -> Result  (One-Time Filter: ((InitPlan 1).col1 = '5875...'))
       -> Index Scan using idx_notifications_user_id_read_at on notifications n
            Index Cond: (user_id = '5875...')
```

The index serves the filter. **The Sort node is still there.** The index covers `user_id` and
`read_at` but not `created_at`, so the whole of the user's notification history is materialized
and sorted on every open of the notification screen.

The unread-badge query (`read_at is null` + owner) IS covered by the existing index. That half is
fine.

### Breaking numbers

**Sort spill.** 170 bytes/row (`pg_column_size`, max 192), sort tuple ~194 bytes.

```
3,584,000 / 194 = 18,470 notifications for one user before spilling to disk
```

**Payload.** ~330 bytes of JSON per row. A coach with 30 students at 4 notification-producing
events per student per week reaches 3,120 rows in 6 months:

```
3,120 x 330 = 1.03 MB per open of the notification screen
```

**The table never shrinks.** `cron.job` on the live project holds exactly one active job,
`expire-stale-holds` every 5 minutes. There is **no retention job for notifications**.

```
10,000 users x 3 notifications/week x 52 weeks = 1,560,000 rows in year one
```

`notifications` is one of the two tables that crosses 1 million.

### Correction for CURRENT-STATE.md

CURRENT-STATE currently records "No pg_cron jobs exist anywhere in the repo." That is true of the
repo and **false of production**: `pg_cron` is installed and `cron.job` has one active job. This
is the same shape as the webhook entry already in the DISPROVEN section, absence in the tree read
as absence in production.

### Cheapest fix

- **Code**, one line: `.limit(50)` plus a `created_at` cursor for older pages.
- **Migration**, one index: `create index concurrently idx_notifications_user_created on public.notifications (user_id, created_at desc);` Removes the Sort. Keep `(user_id, read_at)` for the badge.
- **Migration**, retention: a pg_cron job deleting read notifications older than 90 days, next to the existing `expire-stale-holds`.

---

## P1-6. listUpas is an unbounded N+1 that opens one HTTP request per row

### Mechanism

`packages/api/src/use-empower.ts:313-329`:

```ts
const { data } = await db.from("upa_applications")
  .select("id, story_headline, ... upa_wishlist_items ( cost )")
  .eq("status", "verified")
  .order("created_at", { ascending: false })       // no .limit()

const balances = await Promise.all(
  rows.map(async (row) => db.rpc("upa_fund_balance", { p_account_ref: row.id }))
);
```

Every verified UPA, unbounded, then **one PostgREST HTTP request per row, all fired
simultaneously, with no concurrency bound.** The `Promise.all` is not a batch, it is a fan-out.

### Breaking number

This one is not about rows in a table, it is about connections.

```
max_connections = 60   (verified in pg_settings)
```

At 10,000 users, if 2% of the user base qualifies as an underprivileged athlete and is verified,
that is 200 rows. Opening the Empower tab issues **201 concurrent requests from a single phone.**
Two users doing it in the same second is 402 concurrent requests against a database that accepts
60 connections, plus whatever the pooler will queue.

**The Empower tab takes the database down at 200 verified UPAs, which is 2% of the target user
base.** It takes it down for everyone, not just for the person on that tab.

Contrast with `mintPlaybackBatch` in `hooks.ts:1344-1391`, which solves exactly this problem
correctly: chunks of 24, bounded worker count, per-chunk degradation. `listUpas` is the same
pattern left unfixed.

### User experience

Everyone else's request queues behind 200 balance lookups. Checkout, chat and the feed all stall
for the duration. If the pooler exhausts, other users see connection errors from screens that
have nothing to do with Empower.

### Cheapest fix: MIGRATION

One set-returning function, called once:

```sql
create function public.upa_fund_balances(p_account_refs uuid[])
  returns table (account_ref uuid, balance numeric) ...
```

Plus `.limit()` on the list read. `ledger_entries` already has
`idx_ledger_entries_account (account_type, account_ref)`, so a single call with `= ANY($1)` is an
index scan. The alternative, folding the balance into a `verified_upa_cards` view, is equally
cheap and removes the second call entirely.

---

## P2-7. listCoaches: Phase 3 bounded the rows but not the sort

Phase 3's CT-5 keyset pagination held and is correct. What it did not fix is the ordering.

```
set local enable_seqscan = off;

Limit  (cost=3.41..3.41 rows=2)
  -> Sort  (Sort Key: coach_profiles.created_at DESC, coach_profiles.user_id DESC)
       -> Bitmap Heap Scan on coach_profiles
            Recheck Cond: (status = 'verified')
            -> Bitmap Index Scan on idx_coach_profiles_status_sport
                 Index Cond: (status = 'verified')
```

`idx_coach_profiles_status_sport (status, sport)` serves the filter. It does not cover
`created_at DESC, user_id DESC`, so **the whole verified-coach set is materialized and sorted for
every page of every browse**. The `.limit(limit + 1)` bounds what comes back, not what is done.

The cursor is expressed as a PostgREST `.or(...)` (`created_at.lt.X` OR `and(created_at.eq.X,
user_id.lt.Y)`), and an OR can never be an index condition, so even with the right index the
cursor would contribute ordering, not restriction. That is acceptable; the sort is the problem.

**Breaking number.** Plan row width 212 bytes, sort tuple ~236.

```
3,584,000 / 236 = 15,190 verified coaches before the sort spills
```

At 10,000 users with 5% coaches (500 verified) the sort costs ~0.1 ms. **This one survives
10,000.** It is listed because the fix is one line and the cliff is real at ~15,000.

**Fix: MIGRATION**, using the same partial-index mechanism verified in P0-1:

```sql
create index concurrently idx_coach_profiles_verified_created
  on public.coach_profiles (created_at desc, user_id desc)
  where status = 'verified';
```

---

## P2-8. isHandleAvailable Seq Scans the users table on every check

`hooks.ts:423-435` calls `.ilike("handle", pattern)` against `public_profiles`.

**Proven, not assumed.** With `enable_seqscan = off`:

```
Limit  (cost=10000000000.00..10000000008.15 rows=1)
  -> Seq Scan on users  (actual time=0.163..0.163 rows=0 loops=1)
       Filter: ((handle ~~* 'demoplayer') AND (id <> '5875...'))
       Rows Removed by Filter: 227
```

Still a Seq Scan under a 1e10 penalty, so no index path exists at any cost.
`idx_users_handle_lower` is `btree (lower(handle))`; `ILIKE` (`~~*`) is not an indexable operator
against it, and Postgres does not rewrite a wildcard-free ILIKE into an equality.

**Breaking number.** `users` heap is 40 kB over 227 live tuples = 180 bytes/row, ~45 rows/page.
At 10,000 users that is 222 pages and 10,000 ILIKE evaluations, roughly 3 to 5 ms warm. The 8 s
timeout needs about 2 million users. **This survives 10,000 comfortably.** It is listed because it
puts a full table scan on the profile-edit path in a workload that is otherwise index-driven, and
because on a cold cache it is 222 random reads.

**Fix.** Live data supports it: `count(*) filter (where handle <> lower(handle))` is **0 of 22
non-null handles**, so a case-sensitive comparison is currently equivalent. But `.eq("handle", x)`
alone would not use `idx_users_handle_lower` either, since that index is on the expression. The
cheapest correct pairing is one **migration** and one **code** line:

```sql
create function public.is_handle_available(p_handle text) returns boolean
  language sql stable security definer set search_path to 'public' as $$
    select not exists (select 1 from public.users where lower(handle) = lower(p_handle));
  $$;
```

which uses the existing expression index, and the client calls the RPC instead of `.ilike`.

---

## P2-9. fetchMyGroupSessions is an N+1 across the athlete's groups

`apps/mobile/src/lib/group-sessions.ts:31` and `apps/mobile/src/app/(tabs)/trainings/upcoming.tsx:71`:

```ts
const results = await Promise.all(groupIds.map((groupId) => groups.groupSessions(groupId)));
```

One HTTP request per group, unbounded. Each of those is itself an unbounded
`sessions where group_id = X` (`use-groups.ts:627-637`, no `.limit()`), with the per-row
`is_session_participant` RLS function measured at 0.076 ms/row.

An athlete in 8 groups issues 8 concurrent requests on every Trainings tab open; a heavily
enrolled account in 30 groups issues 30. Not fatal at 10,000 users, and far less severe than
P1-6 because the fan-out is bounded by one user's own membership count rather than by a
product-wide table.

**Fix: CODE, one line.** `sessions` has `idx_sessions_group_id (group_id) where group_id is not
null`, so a single `.in("group_id", groupIds)` call is an index scan and returns the same rows.
This is already the shape used everywhere else in the package.

---

## Complete list of unbounded reads on tables that grow with users

`listCoaches` was fixed in Phase 3. These are the others. "Grows with" is what actually bounds the
result set today.

| Site | Table | Grows with | Severity |
|---|---|---|---|
| `use-chat.ts:363` | `chat_messages` | all messages in all my threads | **P0-3** |
| `hooks.ts:779` | `court_bookings` | **the whole table** (no owner filter) | **P0-2** |
| `use-chat.ts:352` | `chat_threads` | **the whole table** (no filter) | **P1-4** |
| `use-notifications.ts:82` | `notifications` | my notification history, forever | **P1-5** |
| `use-empower.ts:315` | `upa_applications` | every verified UPA | **P1-6** |
| `use-chat.ts:445` | `chat_messages` | one thread's entire history | P1 |
| `use-coaching.ts:482` | `sessions` | my session history | P2 |
| `use-coach.ts:226, 252, 322, 374, 426, 563, 612` | `sessions` | the coach's whole history | P2 |
| `use-groups.ts:629` | `sessions` | a group's whole history (and fanned N+1) | P2 |
| `use-groups.ts:602` | `group_memberships` | my memberships | P2 |
| `use-groups.ts:447` | `group_memberships` | a group's roster | P2 |
| `use-groups.ts:667` | `session_participants` | a session's roster | P2 |
| `use-groups.ts:818` | `coach_trainee_notes` | notes on one player | P2 |
| `hooks.ts:1755` | `clips` | a creator's whole published grid | P2, and each clip needs a minted URL |
| `hooks.ts:1788` | `clips` | my own clips, all statuses | P2 |
| `use-coach.ts:688, 745` | `coach_trainee_videos` | a coach's whole library | P2 |
| `use-shop.ts:1024` | `orders` | my order history | P2 |
| `use-shop.ts:533` | `products` | catalog, not users | P3 |
| `use-shop.ts:641` | `affiliate_products` | catalog, could be scraped and large | P3 |
| `use-learn.ts:238` | `drills` | catalog | P3 |

The bounded ones, for the record, are correct and should not be touched: `hooks.ts:1643/1657`
(follows, `.limit(100)`), `hooks.ts:1681/1743` (liked/saved clips, `.limit(100)`),
`hooks.ts:1406/1461` (feed and comments, `CLUTCH_PAGE_SIZE`), `use-shop.ts:587`
(recommended, `.limit(limit)`), `use-coaching.ts:245` (coaches, `.limit(limit + 1)`).

---

## Row growth at 10,000 users

Derivation basis, stated so it can be challenged. **Live per-user ratios are not usable**: 203 of
227 users are anonymous guests, 16 of 22 feed clips and 6 of 10 venues are e2e fixtures, and 36
training_groups were deleted. The only ratio taken from real data is the money one:
`532 ledger_entries / 205 captured payment_intents = 2.60 entries per captured payment`. Everything
else below is a stated activity assumption. The mechanisms and per-row costs above do **not**
depend on these numbers; only the calendar dates do.

| Table | Assumption | Rows/month at 10k | Crosses 1M | Hot query index-only at that size? |
|---|---|---|---|---|
| `chat_messages` | 30% chat, 0.5 msg/day | 150,000 | **month 7** | `listMessages` yes, `(thread_id, created_at)` fits exactly. The inbox preview read is unbounded, P0-3 |
| `notifications` | 3/user/week, no retention | 130,000 | **month 8** | **No.** `(user_id, read_at)` does not cover `created_at DESC`, P1-5 |
| `clip_likes` | 20% engaged, 5 likes/day | 60,000 | month 17 | Yes. `clip_likes_clip_id_user_id_key` serves `clip_id = ANY(page) AND user_id = me` |
| `ledger_entries` | 2.60 per captured payment, 1 purchase/user/month | 26,000 | month 39 | Admin only, `(domain, entity_id)` and `(account_type, account_ref)` present |
| `payment_intents` | 1/user/month | 10,000 | month 100 | Yes, `(user_id)` and `(domain, entity_id)` |
| `court_bookings` | 15% book twice/month | 3,000 | month 28 | **No. Fails at 20,250 rows in month 7, 50x before 1M**, P0-2 |
| `sessions` | 30% book 1/month | 3,000 | never in year 1 | Index-covered on `player_id`/`coach_id`, but sorts |
| `clips` | 20% post 0.3/month | 600 | never | **No. Index unusable under RLS at any size**, P0-1 |
| `clip_comments` | 0.5 per clip view for 10% | ~15,000 | month 66 | Yes, `(clip_id, created_at)` fits the sort |
| `users` | the target | - | never | Yes, except `isHandleAvailable`, P2-8 |
| `chat_threads` | 2 coaches/athlete + groups | ~18,500 total | never | **No.** Full seq scan, no `last_message_at` index, P1-4 |

**Tables crossing 1 million: `chat_messages` (month 7) and `notifications` (month 8).**

The more important conclusion is that **1 million rows is the wrong alarm for this database**. The
two queries that fail first fail at 20,250 rows and 10,860 rows, because of plan shape rather than
size. Watching for a million-row table would have caught neither in time.

---

## What survives 10,000, with the evidence

1. **0090's InitPlan wrap held, and it is wider than the 22 policies it claimed.** Verified in
   `pg_policy`, not in the migration file: of **258** policies in `public`, **113** mention
   `auth.uid()`, and in **113 of 113** every single occurrence is wrapped as
   `( SELECT auth.uid() AS uid)`. The count of policies containing at least one bare
   `auth.uid()` is **zero**. Confirmed independently in every plan captured here, where it
   appears as `InitPlan N -> Result` executed once with `rows=1`, referenced downstream as
   `(InitPlan N).col1`. Nothing since 0090 reverted it.

2. **Every index in `public` is valid, ready and live.** `pg_index where not indisvalid or not
   indisready or not indislive` returns 0 rows. This was checked against the catalog because a
   half-built `CREATE INDEX CONCURRENTLY` leaves an invalid index that pg_indexes still lists.

3. **chat_messages RLS is genuinely efficient and needs no work.** The two EXISTS subqueries in
   `chat_messages_select_merged` are collapsed by the planner into hashed SubPlans over the
   caller's thread set rather than re-evaluated per row: measured 187 buffers over 210 rows,
   0.0155 ms/row. Contrast `chat_threads`, where the equivalent test is a non-inlinable function
   and costs 2.5 buffers/row.

4. **Phase 3's CT-5 keyset pagination on listCoaches held.** `.limit(limit + 1)` is present, the
   cursor is tuple-ordered `(created_at, user_id)`, and `byCityFirst` only reorders within a page
   so it cannot reintroduce a gap. Only the sort is unfixed, and it does not break at 10,000.

5. **Phase 3's CT-1 batched playback URL minting held.** `mintPlaybackBatch` chunks at 24 with
   bounded worker concurrency and degrades per chunk. This is the correct shape and is exactly
   what P1-6's `listUpas` should be rewritten to.

6. **The clip feed's like and save lookups are index-covered and bounded.** `likedClipIds` and
   `savedClipIds` issue `user_id = me AND clip_id IN (page of 12)`, served directly by
   `clip_likes_clip_id_user_id_key (clip_id, user_id)` and `clip_saves_clip_id_user_id_key`.
   Constant work per page regardless of how many likes exist.

7. **The comments list is fully index-covered including its sort.**
   `idx_clip_comments_clip_id (clip_id, created_at)` matches
   `where clip_id = X order by created_at asc` exactly, and the read is `.limit(CLUTCH_PAGE_SIZE)`.
   This is what a correct hot path looks like on this schema.

8. **Double-booking protection is correct and its partial indexes are usable under RLS.**
   `court_bookings_court_date_slot_unique` and `sessions_coach_date_slot_unique` are partial
   unique indexes on enum status predicates; a plan captured as `authenticated` with RLS active
   shows the planner selecting `sessions_coach_date_slot_unique` and proving its predicate from
   the caller's own qual. This is also the mechanism the P0-1 fix depends on.

---

## Unresolved

- **The recommended indexes were not planted, so their plans are inferred.** DDL is forbidden
  here. P0-1's partial-index fix is verified by mechanism (a working analogue on this same
  database with the same enum machinery) but not by measurement. Plant each recommended index on
  a preview branch and re-run the EXPLAIN in this document before merging. P1-4's two-index
  bitmap-OR plan is the least certain of the set.
- **Row growth rests on stated activity assumptions, not on live ratios**, because 203 of 227
  users are anonymous guests and the clips, venues and chat_threads tables are known to be
  polluted with e2e fixtures. Only `2.60 ledger_entries per captured payment_intent` is real. The
  founder should challenge the assumptions; the per-row costs and plan shapes do not depend on
  them.
- **Every measurement is warm.** All buffer counts are `shared hit`. A cold cache after a restart
  or eviction turns each of those into a physical read and every number above gets worse. I could
  not force eviction without affecting production.
- **`sessions_select_merged` was identified as having the same expensive-first OR defect as
  `court_bookings_select_merged`, but its cost was not separately isolated.** Measured 0.076 ms/row
  overall on an index scan; the split between `is_session_participant` and the rest was not
  attributed. Sweep it with the P0-2 fix rather than treating it as a separate investigation.
- **The connections picture belongs to another lane but P1-6 depends on it.** `max_connections =
  60` is confirmed. Whether Supavisor is in transaction or session mode, and its pool size,
  determines whether 200 concurrent requests from one phone queues or errors. That answer changes
  P1-6's severity, not its existence.
- **Realtime fan-out was not assessed.** `chat_messages` has a `broadcast_chat_message` trigger on
  every insert. That is the realtime lane's number, but it multiplies with the chat findings here.
