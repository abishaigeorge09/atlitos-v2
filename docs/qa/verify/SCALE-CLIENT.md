# SCALE-CLIENT: the mobile app at 10,000 users

Lane: the app itself under real data volume, statically and by measurement of what already exists.
Tree: `integration/p6-audit-fixes` at `709bc40`.
Date: 2026-08-14.
No device was used (device gate). No writes, no DDL, no load generation. Every DB fact below came
from a read-only catalog or `pg_stat_statements` query against `syzzfgaudpifwvbpycyi`.

---

## The five facts everything else is derived from

Each of these was queried, not assumed.

| Fact | How it was verified | Value |
|---|---|---|
| PostgREST applies a numeric row cap to every select | `pg_stat_statements`: 751 `WITH pgrst_source` statements, **0** carry `LIMIT ALL`, **670** carry `LIMIT $n OFFSET $m`. PostgREST emits the literal `LIMIT ALL` when unbounded, so a parameterised numeric limit on a query the client issued with no `.limit()` proves a server side `db-max-rows` is set. | cap EXISTS, value unread (see UNRESOLVED) |
| `authenticated` has an 8 second statement timeout | `pg_db_role_setting`: `authenticated -> statement_timeout=8s`, `anon -> 3s`, `authenticator -> 8s` | 8s / 3s |
| Postgres is a 60 connection instance | `pg_settings`: `max_connections=60`, `shared_buffers=256MB`, `work_mem=3.4MB`, `jit=off` | 60 |
| A chat message row costs 262.3 bytes as inbox JSON | `avg(octet_length(row_to_json(t)::text))` over the exact `listThreads` preview projection, 210 real rows | 262.3 B/row |
| A product row costs 935.6 bytes as browse JSON | same method over the exact `PRODUCT_SELECT` shape including all three embeds, 14 active rows | 935.6 B/row |

Two more, measured locally rather than in the DB:

- `new Date(x).toLocaleTimeString(locale, opts)` costs **30.29 us** per call on V8 (Node 24, M series).
  A hoisted `Intl.DateTimeFormat.format` costs **1.12 us**. Ratio **27x**. Hermes on a mid range Android
  is materially slower than V8 for Intl, so treat 30 us as a floor, not an estimate.
- `RN 0.86.0` `VirtualizedList._maybeCallOnEdgeReached` was read from
  `node_modules/.pnpm/@react-native+virtualized-lists@0.86.0/.../VirtualizedList.js:1527-1612`. The exact
  firing condition is quoted in P0-3 below.

---

## The one mechanism that produces most of the P0s

**Almost nothing in `packages/api` is bounded.** A programmatic scan of every non write `.from(...)`
chain in `packages/api/src` found **60 unbounded reads** across 11 files. Only four call sites carry a
`.limit()` that is a real page size: `getFeed`, `getComments` (both `CLUTCH_PAGE_SIZE = 10`),
`listCoaches` (keyset, 20), `listRecommended` (10). Three more carry a flat `.limit(100)` cap with no
pagination behind it (`listFollowing`, `listFollowers`, `listLikedClips`, `listSavedClips`).

Because PostgREST is silently capping every one of those 60 reads, the failure at volume is not
"slow". It is **wrong, with no error**. The client asked for everything, the server returned the first
N, and nothing anywhere in the stack says so. Where the client's `.order()` is ascending, the rows the
user actually wants are the ones dropped.

---

# P0. Breaks before 10,000 users

## P0-1. The Chat inbox downloads every message in every thread to render one line per thread

**Where.** `packages/api/src/use-chat.ts:348-410` (`listThreads`), specifically the preview query at
`use-chat.ts:363-379`.

**Mechanism.** `listThreads` reads the caller's threads, then fires a second query:

```
.from("chat_messages")
.select("thread_id, sender_id, text, created_at, removed_at, sender_profile:public_profiles!sender_id ( name )")
.in("thread_id", rows.map(r => r.id))
.order("created_at", { ascending: false })
```

No `.limit()`, no `.range()`, no `distinct on`. It fetches **every message in every thread the caller
belongs to**, ships them all to the phone, and keeps exactly one per `thread_id`
(`use-chat.ts:385-394`). The docblock at `use-chat.ts:334-340` states the intent ("a per-thread round
trip does not scale") and then implements the opposite trade.

**The number.** Measured payload is 262.3 bytes/row.

- A coach at 10k users: 15 group threads plus 40 one to one coaching threads = 55 threads.
  At 300 messages/thread that is 16,500 rows.
  16,500 x 262.3 B = **4.33 MB** downloaded to render 55 single line previews.
  Waste factor 16,500 / 55 = **300x**.
- It breaches a 1 MB budget at 3,813 total messages across the caller's threads. For a 55 thread coach
  that is **69 messages per thread**, reached in the first fortnight.
- It breaches the 8s `authenticated` statement timeout later than that, but it does breach it: the
  same measured cost path (`pg_stat_statements`, the `thread_id = ANY($1)` variant) is 0.29 ms mean at
  210 rows, and the RLS qual on `chat_messages` (`chat_messages_select_merged`, two correlated `EXISTS`
  against `chat_threads`, one of them calling `is_chat_thread_member`) is evaluated per candidate row.

**What the user experiences.** Opening the Chat tab stalls for seconds on cellular and burns several MB
of their data plan, every open and every pull to refresh. Then, past the PostgREST cap, threads whose
newest message falls outside the globally newest N rows render with an **empty preview** (the
`previewByThread.get(row.id) ?? { text: "" }` fallback at `use-chat.ts:406`). The inbox shows rows with
blank last messages and no explanation.

**Cheapest fix.** Code change, no migration. Replace the whole second query with a single RPC that does
`select distinct on (thread_id) ... where thread_id = any($1) order by thread_id, created_at desc`. One
row per thread, index-ordered on the existing `idx_chat_messages_thread_id (thread_id, created_at)`.
Payload drops from 16,500 rows to 55. If an RPC is too much for launch week, the interim is a
`.limit(200)` plus accepting stale previews, but that is a patch on a wrong shape.

## P0-2. The Chat thread screen loads the entire message history, oldest first, and then chases its own tail

**Where.** `packages/api/src/use-chat.ts:442-455` (`listMessages`), consumed at
`apps/mobile/src/app/(tabs)/chat/[id].tsx:72` and rendered by the `FlatList` at `chat/[id].tsx:276-295`.

Three defects compound here.

**(a) The query is unbounded and ascending.** `listMessages` is documented as "Full message history for
one thread, oldest first" and carries no `.limit()`. Under the verified PostgREST cap the server returns
the **oldest** N rows. A 5,000 message thread therefore shows messages 1 through N and the recent
conversation is unreachable, permanently, with no error and no "load older" affordance to work around
it. The message the user just sent appears optimistically (`chat/[id].tsx:177`) and vanishes on the next
screen open.

Payload at the pre-cap intent: the thread projection adds `id`, `removed_at` and a profile `id` to the
262.3 B measured shape, roughly 340 B/row. 5,000 x 340 B = **1.70 MB** for one screen.

**(b) The FlatList has no virtualization tuning at all.** Grepped: `chat/[id].tsx:276-295` carries
`ref`, `data`, `keyExtractor`, `extraData`, `contentContainerStyle`, `onContentSizeChange` and
`renderItem`. There is no `windowSize`, no `initialNumToRender`, no `maxToRenderPerBatch`, no
`getItemLayout`, no `removeClippedSubviews` and no `inverted`. Contrast the Clutch feed
(`clutch/index.tsx:299-302`), which carries all of them.

**(c) `onContentSizeChange` triggers a render/scroll amplification loop.**
`chat/[id].tsx:285` is `onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}`.
Because there is no `getItemLayout`, `scrollToEnd` can only scroll to the end of the content **already
measured**, which is the last rendered cell. That scroll advances the viewport, which renders the next
batch, which grows `contentLength`, which fires `onContentSizeChange` again.

**The number.** RN defaults are `maxToRenderPerBatch = 10` and `updateCellsBatchingPeriod = 50 ms`.
5,000 messages / 10 per batch x 50 ms = **25 seconds** of continuous render, layout and animated scroll
before the list settles, with an animated scroll kicked off on every one of the 500 batches.

**(d) Per bubble Intl.** `chat/[id].tsx:355`:
`const time = new Date(message.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })`.
`MessageBubble` is not `React.memo`'d and `renderItem` is an inline arrow, so every cell re-renders
whenever `extraData={memberNameById}` changes identity (it changes on every `members` or `me` update).
At the measured 30.29 us/call on V8: 5,000 x 30.29 us = **151 ms per full pass on V8-class hardware**,
and the loop in (c) forces several passes. On Hermes/Android assume multiples of that.

**What the user experiences.** A long conversation opens to a screen that jitters and auto-scrolls for
tens of seconds and is unusable while it does; then, past the cap, it opens to messages from months ago
with no way to reach today.

**Cheapest fix.** Code change, no migration.
1. Add `.order("created_at", { ascending: false }).limit(50)` to `listMessages`, reverse in the client,
   and add a cursor for older pages.
2. Set `inverted` on the FlatList and delete `onContentSizeChange` entirely. An inverted list is already
   at the newest message with no scroll needed, which removes the loop at its cause rather than papering
   it with `getItemLayout`.
3. Hoist a module level `const TIME_FMT = new Intl.DateTimeFormat('en-IN', {...})` and wrap
   `MessageBubble` in `React.memo`. The hoisting pattern already exists in this codebase at
   `trainings/(shell)/earnings.tsx:23` and `trainings/(shell)/analytics.tsx:21`, so this is applying a
   local convention, not inventing one.

## P0-3. Trainings, Coaches tab: virtualization is off and pagination runs away

This is the recorded "onEndReached could never fire" shape, found again, and it fails in the **opposite**
direction from the recorded case, which is worse.

**Where.** `apps/mobile/src/app/(tabs)/trainings/(shell)/coaches.tsx:140-150` renders
`<CoachBrowseList header={myCoachesSection} scrollEnabled={false} />` inside its own `<ScrollView>`.
`CoachBrowseList` at `components/organisms/coaching/CoachBrowseList.tsx:231-249` then does:

```
scrollEnabled={scrollEnabled}
style={scrollEnabled ? { flex: 1 } : undefined}
onEndReachedThreshold={0.5}
onEndReached={() => void loadMore()}
```

**Mechanism, read from the RN 0.86.0 source.** `VirtualizedList._maybeCallOnEdgeReached`
(`VirtualizedList.js:1527-1612`) fires `onEndReached` when all of:

```
cellsAroundViewport.last === getItemCount(data) - 1
&& distanceFromEnd <= onEndReachedThreshold * visibleLength
&& listMetrics.getContentLength() !== _sentEndForContentLength
```

`_onLayout` (`VirtualizedList.js:1408-1421`) sets `visibleLength` from the list's own layout height, and
skips the nesting correction only when `_isNestedWithSameOrientation()` is true, which reads
`VirtualizedListContext`. A plain RN `ScrollView` does not provide that context, so the correction is
skipped. With `style` undefined inside a column content container the list lays out at its **full content
height**, so `visibleLength === contentLength` and `offset === 0`. Therefore:

- `distanceFromEnd` is 0 forever. `isWithinEndThreshold` is always true.
- The render window, sized from `visibleLength`, covers the whole dataset, so
  `cellsAroundViewport.last` is always the final item. **Virtualization is completely off. Every row is
  mounted.**
- `_sentEndForContentLength` is only reset when the list leaves the threshold, which never happens; but
  it is also bypassed whenever `contentLength` changes, which it does on every appended page. So each
  appended page immediately re-fires `onEndReached`.

The only thing that stops it is `nextCursor === null`, that is, the end of the table.

**The number.** `COACH_LIST_DEFAULT_LIMIT = 20` (`use-coaching.ts:87`), and each page issues three
queries (`coach_profiles_public`, `public_profiles`, `session_types`, see `use-coaching.ts:238-278`).
`loadMore` is serialised by the `loadingMore` guard.

- Verified coaches V, pages = ceil(V/20), requests = 3 x ceil(V/20), all serial.
- At 10,000 users with 5 percent coaches and 60 percent verified: V = 300.
  15 pages, **45 serial round trips**. At 150 ms RTT that is **6.8 seconds** of loading with no user
  input, and **300 CoachCards mounted simultaneously**, each with an `<Avatar>` image.
- At 10 percent coaches: V = 600, 30 pages, 90 serial round trips, **13.5 s**, 600 mounted cards.
- It becomes visible at V = 40 (2 auto-pages) and is plainly broken by V = 120.

**What the user experiences.** Opening Trainings, then Coaches, produces a tab that keeps growing and
keeps spinning for many seconds without being touched, then holds hundreds of live rows. The Trainings
module gets progressively less responsive the longer it sits open, and memory climbs monotonically.

**Cheapest fix.** Code change, one file. Delete the outer `<ScrollView>` in `coaches.tsx` and pass
`myCoachesSection` through the `header` prop that `CoachBrowseList` already accepts
(`CoachBrowseList.tsx:35-38` documents exactly this). Then delete the `scrollEnabled` prop and the
`style={scrollEnabled ? ... : undefined}` branch from `CoachBrowseList` so the escape hatch cannot be
used again. That leaves one scroller, restores virtualization, and makes `onEndReached` mean what it
says.

**Class swept.** A repo wide grep for `scrollEnabled` returns exactly these two files, and a structural
scan for a vertical `FlatList` inside a non horizontal `ScrollView` returns nothing else. The three
FlatLists in `trainings/trainee/[id].tsx:345,389,429` were checked specifically and are **not** nested
(the ScrollViews at lines 243 and 282 close at 279 and 305); they are siblings under a `flex: 1` View
and virtualize correctly.

## P0-4. No image is downscaled anywhere in the app, and no screen uses expo-image

**Where.** Everywhere. Verified by absence checked against the artifact rather than inferred:

- `grep -rn "from 'expo-image'" apps/mobile/src` returns **zero hits**. Every image in the app is
  React Native's built in `<Image>`: `components/molecules/ClutchPostCard.tsx:5`, and
  `components/ui/{court-card,upa-card,coach-card,product-card,avatar,app-bar}.tsx`.
- All six storage URL minting sites were listed and **none** passes a `transform` option:
  `use-home.ts:59`, `use-shop.ts:425`, `use-empower.ts:203`, `hooks.ts:611`,
  `supabase/functions/get-clip-playback-url/mint.ts:49`, `supabase/functions/_shared/clip-access.ts:129`.
- No `expo-image-manipulator`, no `manipulateAsync`, no client side resize on the upload path
  (`clutch/upload.tsx` has none).
- `storage.buckets`: every image bucket has `file_size_limit = 10485760` (10 MB) and no downscaling.

**What is actually stored, measured from `storage.objects`:**

| bucket | objects | avg | max |
|---|---|---|---|
| `clips` (includes posters) | 51 | 1.48 MB | **11.29 MB** |
| `upa-photos` | 2 | 1.34 MB | **2.67 MB** |
| `avatars` | 1 | 291 KB | 291 KB |
| `product-media` | 21 | 4.7 KB | 4.9 KB (placeholder PNGs, not real photos) |

**Mechanism.** RN's `<Image>` on iOS decodes at **source** resolution into `RCTImageLoader`'s cache and
downsamples only for display. There is no `contentFit`, no `recyclingKey`, no `cachePolicy`. Android's
Fresco downsamples and pools, which is why the Android numbers already look better than the iOS ones.
A 2.67 MB PNG at typical phone photo geometry is roughly 1800 x 2400 px, which decodes to
1800 x 2400 x 4 B = **17.3 MB** of bitmap. A 11.29 MB JPEG is plausibly 4000 x 3000, decoding to
**48 MB**.

**The numbers, against the recorded baselines (iOS Home 218 MB, Clutch feed 273 MB, tiny seed data):**

- Home, `EmpowerRail` (`components/organisms/home/EmpowerRail.tsx:34,78`) slices to 8 UPA cards. Today
  only **2** UPAs are verified (`select count(*) filter (where status='verified') from upa_applications`
  returns 2), so today's 218 MB already carries 2 of these photos. Going from 2 to 8 adds
  6 x 17.3 MB = **+104 MB**.
- Home, `RecentlyViewedRail` shows 8 product cards. Today's product images are 4.7 KB placeholders;
  real product photography at 1000 x 1000 decodes to 4 MB each, so **+30 MB**.
- Promo carousel, 3 real banners: **+10 MB**.
- **Home at 10k: roughly 218 + 145 = 360 MB.**
- Clutch feed is windowed to `windowSize={5}` with `removeClippedSubviews`, so about 5 cards are
  mounted. At the measured 1.48 MB average `clips` object (roughly 2000 x 1500, 12 MB decoded) that is
  60 MB of bitmaps; at the 11.29 MB worst case it is 240 MB. **Clutch at 10k: 273 to 400 MB.**
- The own profile grid is the outlier and is covered in P1-1.

**Answer to "do 2 to 3 GB devices survive".** Stated plainly:

- **2 GB devices (iPhone 8 class, still inside the Expo SDK 57 support range): no.** iOS jetsam for a
  foreground app on a 2 GB device is roughly 600 to 700 MB. Home alone at 360 MB spends over half of it
  on one screen, and any navigation to Clutch or a profile grid pushes past the limit. Expect
  terminations that read to the user as random closes, not crashes, and that will not appear in Sentry
  as JS errors.
- **3 GB devices (iPhone XR/11 class): marginally, and only because launch-week data is thin.** The
  budget is roughly 1.3 to 1.4 GB. Home 360 MB plus Clutch 400 MB is survivable while both are mounted.
  The own profile grid at more than about 110 clips is not (110 x 12 MB = 1.32 GB).
- **The decisive variable is not list tuning, it is that nothing downscales an image.** Every other
  memory fix is worth single digit percentages next to this one.

**Cheapest fix.** Config plus a mechanical code change, no migration.
1. Add `transform: { width: 400, quality: 70 }` to the four `getPublicUrl` calls and the two
   `createSignedUrl` calls listed above. This is a Supabase Storage image transformation and needs the
   add-on to be enabled on the project (see UNRESOLVED). A 400 px wide poster decodes to
   400 x 500 x 4 = 800 KB instead of 12 to 48 MB, a **15x to 60x** reduction.
2. Swap `react-native`'s `Image` for `expo-image` in the six `components/ui` files plus
   `ClutchPostCard`. It is an Expo app, the dependency is free, and it brings a bounded memory cache,
   `recyclingKey` for list cells, and native downsampling. Do this even if the transform add-on is not
   available, because it is the only lever that does not depend on the plan.

## P0-5. Home fires one RPC per verified UPA, concurrently, on every mount

**Where.** `packages/api/src/use-empower.ts:313-342` (`listUpas`), called from
`components/organisms/home/EmpowerRail.tsx:33` on Home mount and again on every `reloadKey` change.

**Mechanism.**

```
const { data } = await db.from("upa_applications").select(...).eq("status","verified")   // unbounded
const balances = await Promise.all(
  rows.map(async (row) => db.rpc("upa_fund_balance", { p_account_ref: row.id }))          // N+1, concurrent
);
```

Textbook N+1, fanned out with `Promise.all` so all N requests leave the device at once. The rail then
throws away everything past the first 8 (`EmpowerRail.tsx:34`, `.slice(0, 8)`), so N-8 of those RPCs
were pure waste.

**Evidence it is already firing.** `pg_stat_statements` shows the `p_account_ref` RPC at **975 calls**,
the most called RPC on the project, mean 2.25 ms, against **2** verified UPA rows. That is roughly 490
Home loads worth of a two wide fan-out.

**The number.** The binding constraint is not Postgres (2.25 ms each), it is the client's per host
connection limit. Android OkHttp allows **5** concurrent connections per host; iOS NSURLSession allows
about 6. So N requests serialise into ceil(N/5) waves.

- Waves x 150 ms RTT = Home rail load time.
- Budget of 1 second for the rail is exceeded once N > 33.
- At 10,000 users with 3 percent applying to Empower and half verified: N = 150.
  30 waves x 150 ms = **4.5 seconds**, during which the promo carousel, the Clutch preview and the
  product rail are all **head of line blocked behind the same 5 sockets**. Home does not partially
  render, it stalls.
- At N = 300: **9 seconds**.

**What the user experiences.** Home is the first screen after launch. It goes from instant to a
multi-second blank-with-skeletons wait that gets steadily worse as Empower grows, and the delay is
attributed to the app being slow rather than to one rail.

**Cheapest fix.** Migration, small. Replace the loop with a single set returning function
`upa_fund_balances(p_account_refs uuid[])`, or a view that aggregates `ledger_entries` per UPA, and add
`.limit(8).order(...)` to `listUpas` for the rail's own call path. One request replaces N+1. Keep the
existing "never sum `funded_amount`, always derive from the ledger" invariant that the current docblock
correctly enforces.

## P0-6. The umbrella: 60 unbounded reads plus a silent server side cap

**Where.** Programmatic scan of `packages/api/src`. The reads that grow with users or with a user's own
history, and therefore matter:

| File:line | Table | Screen it feeds |
|---|---|---|
| `use-chat.ts:352` | `chat_threads` | Chat inbox |
| `use-chat.ts:363` | `chat_messages` | Chat inbox preview (P0-1) |
| `use-chat.ts:445` | `chat_messages` | Chat thread (P0-2) |
| `use-chat.ts:469` | `chat_thread_members` | Group members sheet |
| `use-notifications.ts:82` | `notifications` | Notifications (P1-3) |
| `hooks.ts:1755` | `clips` | Public creator grid (P1-1) |
| `hooks.ts:1788` | `clips` | Own profile grid (P1-1) |
| `use-shop.ts:533` | `products` | Home rail and shop browse (P1-2) |
| `use-shop.ts:643` | `affiliate_products` | Compare prices rail |
| `use-shop.ts:1024` | `orders` | Order history |
| `use-shop.ts:1243,1274` | `product_wishlist_items` | Wishlist |
| `hooks.ts:656` | `courts` | Courts tab |
| `hooks.ts:779` | `court_bookings` | My bookings |
| `use-empower.ts:315` | `upa_applications` | Home rail (P0-5) |
| `use-coach.ts:226,252,280,563,612,1168` | `sessions` | Coach dashboard, analytics |
| `use-coaching.ts:482` | `sessions` | Athlete My sessions |
| `use-groups.ts:402,418,448,460,470,603,615,629,667,896,931,940` | groups/sessions/memberships | Coach group screens |

**Mechanism.** Every one of these hits the verified PostgREST cap and is truncated with a 200 OK. Where
the client's `.order()` is ascending, the truncation drops exactly the rows the user cares about
(`listMessages`, `getCart`'s `created_at asc`). Where it is descending, the truncation drops history,
which is less bad but still silent.

**What the user experiences.** Depends on the screen, but the shape is always the same: a list that
just stops, with no "end of list", no error, no retry, and no way to tell a truncated list from a
complete one.

**Cheapest fix.** Two things, both cheap, and the first one is what makes the second one findable.
1. **Config, 5 minutes.** Read the project's `Max rows` value from the Supabase dashboard
   (Settings, API) and record it in `CURRENT-STATE.md`. Right now nobody in this repo knows what number
   their app silently truncates at, which is why 60 unbounded reads got written.
2. **Code, per screen.** Add an explicit `.limit(n)` to every read in the table above, chosen so it is
   **below** the server cap. An explicit limit that the code owns is testable and visible in review; an
   implicit cap the code does not know about is neither. Screens that genuinely need more get keyset
   pagination, using `listCoaches` (`use-coaching.ts:236-260`) as the in-tree pattern.

---

# P1. Degrades badly

## P1-1. The profile grid mints a signed URL and decodes a bitmap for every clip a creator has ever posted

**Where.** `hooks.ts:1788` (`getMyClips`, unbounded, deliberately unfiltered by status) and
`hooks.ts:1755` (`getCreatorClips`, unbounded), consumed at `apps/mobile/src/app/profile/index.tsx:110`
and rendered by `components/organisms/ClutchProfileView.tsx:99-105` (`numColumns={3}`, no `windowSize`,
no `getItemLayout`, no `removeClippedSubviews`).

**Mechanism, two layers.**

- `profile/index.tsx:151-170` mints posters for **every clip in the active grid**, not the visible ones:
  `gridClips.filter(...)` then one `getPlaybackUrls` call chunked at `PLAYBACK_BATCH_MAX = 24` with
  `PLAYBACK_BATCH_CONCURRENCY = 4` (`hooks.ts:1074-1075`). The batching is genuinely good work; the
  problem is that the input is unbounded.
- `ClutchProfileView`'s FlatList uses RN defaults: `windowSize = 21`, meaning 21 viewports of cells are
  mounted. A 3 column grid fits about 5 rows, so 15 tiles per viewport, so up to **315 tiles mounted**,
  filled at `maxToRenderPerBatch = 10` every 50 ms, so about **1.6 s** to fill.

**The numbers.** For a creator with C clips:

- Edge function invocations on open: ceil(C/24). At C = 300 that is **13 invocations** minting 300
  signed URLs, for a screen showing 9 tiles.
- Bitmaps: min(C, 315) tiles decoded. Combined with P0-4's measured 1.48 MB average `clips` object
  (roughly 12 MB decoded), C = 300 requests **3.6 GB** of decoded bitmap. The device jetsams first.
- It is visible at C = 40 and fatal on a 3 GB device around C = 110.

**What the user experiences.** Opening your own profile after posting a few dozen clips freezes for a
second or two, then the app is terminated. On iOS this looks like the app closing itself.

**Cheapest fix.** Code change. Add `.limit(30)` plus a `created_at` cursor to `getMyClips` and
`getCreatorClips` (the cursor pattern already exists in `getFeed`, `hooks.ts:1400-1431`), and add
`windowSize={3} initialNumToRender={9} maxToRenderPerBatch={9} removeClippedSubviews` plus a
`getItemLayout` to the `ClutchProfileView` FlatList, mirroring what `clutch/index.tsx:299-302` already
does. Combined with P0-4's transform this drops the grid from gigabytes to tens of MB.

## P1-2. Home downloads the entire product catalog to render eight tiles

**Where.** `components/organisms/home/RecentlyViewedRail.tsx:40-48` calls `shop.listProducts()` with no
arguments, which is `use-shop.ts:531-563`, unbounded, with three embedded resources.

```
const [viewedIds, allProducts] = await Promise.all([getRecentlyViewedProductIds(), shop.listProducts()]);
const byId = new Map(allProducts.map(p => [p.id, p]));   // full catalog, to look up ~8 ids
```

**The number.** Measured 935.6 bytes/row for exactly this projection.

- 500 product catalog: 468 KB per Home mount.
- 2,000 product catalog: **1.87 MB** per Home mount, plus the same again on every shop category switch
  and every pull to refresh (`shop/category/[sport].tsx:83`).
- Parsed into JS objects at roughly 3x, that is a **5.6 MB transient heap spike on Home**.
- Past the PostgREST cap the rail silently fails to hydrate any recently viewed product that falls
  outside the returned window and falls back to the generic "Shop" rail with no explanation.

Server side this is the single most expensive read on the project already: `pg_stat_statements` shows it
at 694 calls, mean 5.29 ms, **max 68.71 ms**, against 14 active products.

**Cheapest fix.** Code change. Add a `listProductsByIds(ids: string[])` to `useShop` using
`.in("id", ids)`, and have the rail call that. Separately add `.limit(50)` plus pagination to
`listProducts` for the browse grid. Note the browse grid itself is already a properly virtualized
`FlatList` (`shop/category/[sport].tsx:295`), so only the query needs bounding.

**Not a finding, checked and cleared.** The `EXPLAIN ANALYZE` of this query shows a `Seq Scan on
product_variants` inside the lateral. `pg_indexes` confirms `idx_product_variants_product_id` **exists**.
The planner is correctly choosing a sequential scan on a 31 row table. Do not "add an index" here.

## P1-3. Notifications: unbounded list, and the sort has no index

**Where.** `use-notifications.ts:79-91` (`list`), rendered at `notifications/index.tsx:198-207`
(FlatList with no `windowSize` and no pagination).

**Mechanism.** `.eq("user_id", me).order("created_at", { ascending: false })` with no limit.
`pg_indexes` on `notifications` shows exactly two indexes: `notifications_pkey` and
`idx_notifications_user_id_read_at (user_id, read_at)`. There is **no** `(user_id, created_at desc)`
index, so the ordering is always a separate `Sort` node. `EXPLAIN (ANALYZE, BUFFERS)` on the real query
confirms `Seq Scan -> Sort (quicksort, Memory: 29kB)` at 63 rows, which is the correct plan at that
size; at scale it becomes an index scan on `(user_id, read_at)` followed by a sort of every one of the
user's rows.

**The numbers.** Measured 148.7 bytes/row as JSON.

- 2,000 notifications: 2,000 x 148.7 B = **297 KB** payload, and a 2,000 row sort per request.
  `work_mem` is 3.4 MB so it stays in memory, roughly 1 ms. The DB is not the problem here.
- The client is: 2,000 rows into an untuned FlatList, and `notifications/index.tsx:226` calls
  `date.toLocaleDateString('en-IN', {...})` per row for anything older than 24 hours.
  2,000 x 30.29 us = **61 ms per pass on V8**, more on Hermes.
- Notifications accumulate with no retention policy anywhere in the repo, so this only grows.

**Cheapest fix.** Two parts.
- Code: `.limit(50)` plus a `created_at` cursor and `onEndReached`, and hoist the date formatter.
- Migration, one line: `create index idx_notifications_user_created on notifications (user_id, created_at desc)`.
  Name the query it serves in the migration comment. Without the limit the index alone buys little; with
  the limit it turns the read into a 50 row index-only walk.

## P1-4. Group rosters and group session lists are plain `.map` inside a ScrollView

**Where.**

- `components/organisms/chat/GroupMembersSheet.tsx:103-111`: `<ScrollView>{members.map(...)}</ScrollView>`,
  fed by `use-chat.ts:467-483` (`listThreadMembers`, unbounded).
- `app/(tabs)/trainings/group/[id].tsx:329` (members), `:405` (upcoming sessions), `:419` (all sessions),
  all inside the ScrollView that closes at `:421`.
- `app/(tabs)/trainings/(shell)/earnings.tsx:156-161` (transactions grouped by month) and
  `(shell)/payments.tsx:134`.

**Mechanism.** A `.map` inside a ScrollView mounts every element. There is no windowing to tune, by
construction. Each roster row is an `<Avatar>` (an RN `<Image>`, see P0-4) plus two `<Text>` nodes, so
roughly 5 native views and one decoded bitmap per member.

**The number.** A training group's capacity is a coach-set field with no schema ceiling
(`training_groups.capacity`). At 10,000 users a large academy group of 200 members mounts 200 rows,
1,000 native views, and 200 avatar decodes at the measured 291 KB average avatar (roughly 1200 x 1200,
5.8 MB decoded) = **1.16 GB requested from a bottom sheet**. It is visibly janky by 60 members and fatal
past roughly 150 on a 3 GB device.

`(shell)/earnings.tsx` is separately capped: `listTransactions(kind, limit = 50)`
(`use-coach.ts:1052`) fetches 50 rows and the screen has no load-more, so a coach can never see their
51st transaction. That is a correctness cap, not a scale break, but it is in the money surface and
should be recorded.

**Cheapest fix.** Code change. Convert `GroupMembersSheet`'s ScrollView to a `FlatList` with
`windowSize={3}` (it is the smallest change and the sheet is already height-capped by
`sheetMaxHeight`), and add `.limit(100)` to `listThreadMembers`. For `group/[id].tsx`, move the members
and sessions sections into the `data`/`ListHeaderComponent` of a single FlatList.

## P1-5. Per item Intl formatting, four more sites

Same mechanism and same 27x measured cost as P0-2(d), on lists that are smaller but still grow:

| File:line | Called per | Grows with |
|---|---|---|
| `components/molecules/TransactionRow.tsx:20` | transaction row | coach earnings history |
| `components/organisms/chat/ChatThreadList.tsx:203,205` | inbox row | threads per user |
| `app/notifications/index.tsx:226` | notification row | notifications per user |
| `app/account/impact.tsx:26` | donation row | donations per user |

**Cheapest fix.** Code change, mechanical. Hoist a module level `Intl.DateTimeFormat` in each file, as
`(shell)/earnings.tsx:23` and `(shell)/analytics.tsx:21` already do correctly. Same edit five times.

---

# P2. Watch

- **`getBlockedUserIds` runs on every feed page.** `hooks.ts:1906-1918` is called from `getFeed`,
  `getComments`, `listThreads` and `listMessages`, and each call does an `auth.getUser()` plus a
  `blocked_users` select. Scrolling 40 Clutch pages costs 40 extra round trip pairs. Cheap fix: memoise
  per session in the module, invalidated by `blockUser`/`unblockUser`.
- **`getAnalytics` reads every completed session a coach has ever had.** `use-coach.ts:1168-1175`,
  unbounded, with a `session_types` embed. A coach doing 5 sessions/day for a year is 1,250 rows fetched
  to compute a monthly chart. Should be a server side aggregate RPC.
- **The Clutch `clips` array never shrinks.** `clutch/index.tsx:122` appends pages forever, and the
  effect at `:145-180` does a `clips.findIndex` plus a full `Object.entries` rebuild of two URL maps on
  every swipe. At 5,000 accumulated clips that is still under 1 ms per swipe, so it is not a launch week
  problem, but the array is the one part of the Clutch feed with no ceiling.
- **`courts.listCourts`** (`hooks.ts:656`) fetches every active court in the country and sorts by
  haversine distance client side (`hooks.ts:645-651`). Correct at 5 courts, wrong shape at 5,000. Should
  be a bounding box filter server side.

---

# What genuinely survives 10,000, with the evidence

These were checked and hold. Recording them so the next agent does not re-derive them.

1. **The Clutch feed and post detail are correctly hardened.** `clutch/index.tsx:279-303` and
   `clutch/post/[id].tsx:526-546` both carry `getItemLayout`, `initialNumToRender={2}`,
   `maxToRenderPerBatch={3}`, `windowSize={5}`, `removeClippedSubviews`, keyset pagination at
   `CLUTCH_PAGE_SIZE = 10`, and an eviction window that drops signed URLs and their refresh timers for
   any clip more than one position from the active card (`clutch/index.tsx:157-180`). This is the model
   the rest of the app should copy. It needs no work.
2. **The comments sheet pagination is fixed on this tree**, contrary to the OPEN entry in
   `CURRENT-STATE.md`. `ClutchCommentsSheet.tsx` now renders through the in-tree `Portal` (not a native
   RN `Modal`), caps height with a pixel number from `useWindowDimensions` rather than a percentage,
   anchors via an `absoluteFill` host with `justifyContent: 'flex-end'`, and carries `flexShrink: 1` on
   the FlatList so it is the scrolling region. `onEndReachedThreshold={0.5}` and `onEndReached` are
   wired at `:221-222`. The `CURRENT-STATE.md` OPEN entry "The comments sheet cannot open" is stale
   against `integration/p6-audit-fixes` and should be moved to PROVEN.
3. **`chat_messages` is correctly indexed for the thread read.** `pg_indexes` confirms
   `idx_chat_messages_thread_id ON chat_messages (thread_id, created_at)`, which exactly covers
   `listMessages`'s filter plus ordering. P0-2 is a payload and client problem, not a query plan problem.
   Do not add an index here.
4. **`product_variants` is indexed.** `idx_product_variants_product_id` exists. The `Seq Scan` visible in
   the products `EXPLAIN ANALYZE` is the planner correctly preferring a scan of 31 rows. This looks
   exactly like a missing index and is not one.
5. **`listCoaches` keyset pagination is correct.** `use-coaching.ts:236-260` bounds every page at
   `limit + 1`, decides `nextCursor` from the extra row without returning it, and expresses the tuple
   comparison `(created_at, user_id) < (X, Y)` correctly as PostgREST `.or()`. The bug in P0-3 is
   entirely in how the component is embedded, not in the query.
6. **Money formatting is not Intl.** `packages/theme/src/index.ts:41` hand-rolls `formatINR` with Indian
   digit grouping. Every `PriceText` in every list is a string operation, not a locale lookup. This is
   the single most rendered value in the app and it costs nothing.
7. **The signed URL batch endpoint is properly bounded.** `hooks.ts:1345-1391` chunks any id list to 24
   per call with a concurrency cap of 4 and degrades a failed chunk to "no poster this pass" rather than
   blanking the grid. The batching is right; only its unbounded input (P1-1) is wrong.
8. **The trainee detail screen's three FlatLists are not nested in a ScrollView.** Checked line by line
   because it looked like an instance of P0-3 and is not.

---

# UNRESOLVED

1. **The actual value of PostgREST `max_rows`.** Verified that a numeric cap exists (0 of 751 pgrst
   statements carry `LIMIT ALL`, 670 carry `LIMIT $n OFFSET $m`). The value is a PostgREST environment
   variable, not a database setting, so it is not in `pg_db_role_setting` and cannot be read over SQL.
   No table on the project exceeds 532 rows, so it cannot be probed empirically without writing data,
   which the gate forbids. **Read it from the Supabase dashboard, Settings, API, "Max rows", and record
   it.** Every truncation number above is conditional on it.
2. **Actual pixel dimensions of the stored images.** File sizes are measured
   (`clips` avg 1.48 MB, max 11.29 MB; `upa-photos` avg 1.34 MB, max 2.67 MB) but `storage.objects`
   does not carry width and height. The decoded bitmap arithmetic in P0-4 assumes typical phone photo
   geometry for those byte sizes. Downloading one object and reading its header would settle it and
   would not be load generation.
3. **Device confirmation of P0-3's runaway auto-pagination.** The mechanism was derived by reading
   RN 0.86.0's `VirtualizedList.js:1527-1612` and matching it against the two call sites, which is
   strong, but the device gate meant it was not observed. Repro when the device is free: open
   Trainings, then Coaches, with more than 40 verified coaches seeded, and count the network requests
   without touching the screen. If it is right, the count is 3 x ceil(V/20) with zero scroll input.
4. **The Hermes to V8 multiplier for `toLocaleTimeString`.** The 27x hoisted-versus-inline ratio is
   measured and platform independent. The absolute 30.29 us/call is V8 on an M series Mac and is a
   floor, not a prediction, for Hermes on a mid range Android. The fix is worth making regardless, since
   the ratio is what matters.
5. **Whether the Supabase Storage image transformation add-on is enabled on this project.** P0-4's
   cheapest fix depends on it. `expo-image` is the fallback that does not.
