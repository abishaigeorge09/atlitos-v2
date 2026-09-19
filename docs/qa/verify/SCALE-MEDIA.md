# SCALE-MEDIA: media, storage and signed URLs at 10,000 users

Lane: media, storage, signed URLs. Target raised from 1,000 to 10,000 (CLAUDE.md, 2026-08-14).
Written 2026-08-14 against `integration/p6-audit-fixes` @ `709bc40`.

Evidence rules followed: every claim below cites a file and line, a live catalog query against
`syzzfgaudpifwvbpycyi`, or a Supabase docs quota table. No writes and no DDL were issued. No HTTP
request was made to production, so nothing here rests on generated load. No simulator, emulator,
Maestro or Metro was used.

---

## Phase 3 P1-1 remediation, verified item by item

Phase 3 recorded P1-1 (Clutch signed-URL flood) as addressed with five things. Each was checked
against the artifact, not the plan.

| Claimed | Real? | Evidence |
|---|---|---|
| Batch endpoint exists | YES | `get-clip-playback-urls` ACTIVE v3, `get-clip-playback-url` ACTIVE v6 (updated 2026-08-05), both `verify_jwt: false`, from `list_edge_functions` |
| One front door, not two | YES | `get-clip-playback-urls/index.ts` is a 6-line delegate to `get-clip-playback-url/handler.ts`. Both share bucket `clip-playback-ip` |
| Concurrency capped at 4 for the profile grid | YES | `packages/api/src/hooks.ts:1075` `PLAYBACK_BATCH_CONCURRENCY = 4`, enforced by the worker pool at `hooks.ts:1388` |
| Separate thumb and video TTLs | PARTLY | `mint.ts` `THUMB_URL_TTL_SECONDS = 3600` / `VIDEO_URL_TTL_SECONDS = 300` are real and selected at `handler.ts:186`, but ONLY on the batch path. The legacy single path mints both at `SIGNED_URL_TTL_SECONDS = 300` (`_shared/clip-access.ts:19,129`), and the feed uses the legacy path. The feed's posters never get the 3600s TTL. |
| Per-IP rate limit in front of get-clip-playback-url | YES, and it is the P0 | `handler.ts:47-49`, 60 req / 60 s, key `getClientIp`. See M-1. |
| Batch used everywhere it should be | **NO** | `getPlaybackUrls` has exactly ONE call site in the monorepo. See M-4. |

---

# BREAKS AT 10,000

## M-1 (P0). The per-IP throttle fires at 3 concurrent users behind one carrier NAT, and a 429 renders as a permanently black card with no error and no retry

**Mechanism.** `supabase/functions/get-clip-playback-url/handler.ts:47-49` sets
`RATE_LIMIT_MAX = 60`, `RATE_LIMIT_WINDOW_SECONDS = 60`, keyed by
`getClientIp(request)` = `x-forwarded-for[0]` (`_shared/rate-limit.ts:60-69`). The Clutch feed
mints one request per clip: `apps/mobile/src/app/(tabs)/clutch/index.tsx:150-154` calls
`clutch.getPlaybackUrl(activeId)` for the active card and again for the next card as a prefetch,
both in legacy single-id mode, one HTTP request each.

The header genuinely arrives, which I checked rather than assumed. Live rows in
`public.edge_rate_limits` under bucket `clip-playback-ip` carry real public IPv4 addresses:
`49.43.218.96`, `49.37.217.90`, `223.228.125.206`, `223.228.114.206`, `182.79.253.134`. None is
`"unknown"`, so the worst plausible failure (every user on earth collapsing into one bucket key)
is NOT happening. Note however that `223.228.114.206` and `223.228.125.206` sit in the same
Indian carrier CGNAT /16, and `49.43.x` / `49.37.x` likewise. This user base reaches production
through carrier NAT, so a single key serves many devices and a single device changes key.

**The number, derived.**

```
per-IP budget                                   60 requests / 60 s

one user scrolling the feed
  browsing pace 1 clip / 6 s                    10 requests/min
  skim pace     1 clip / 2 s                    30 requests/min

break point on feed scrolling alone
  60 / 10  =  6 concurrent browsers per IP
  60 / 30  =  2 concurrent skimmers per IP

one user opening their own profile and cycling all three tabs
  posts   unbounded (no .limit, hooks.ts:1753/1782)
  liked   <= 100  -> ceil(100/24) =  5 requests
  saved   <= 100  -> ceil(100/24) =  5 requests
  posts (say 60)  -> ceil(60/24)  =  3 requests
                                    ---
                                     13 requests, landing in ~2 s at concurrency 4

realistic mixed minute: 1 profile visit + 1 minute of scrolling
  13 + 10 = 23 requests/min/user

BREAK POINT: ceil(60 / 23) = 3 concurrent users behind one egress IP
```

The aggregate load is not the problem and that is the point. At 10k users on the central
assumptions in M-2 the whole platform issues about 40,000 playback requests/day, which with a 2x
peak-hour factor over a 6-hour window is **3.7 requests/second globally**. The throttle fires at
1 request/second per IP. It refuses legitimate traffic at roughly one four-hundredth of any real
capacity limit, purely because of how the key is chosen.

**What the user experiences.** Worse than an error. `mintPlayback`'s catch block is empty
(`clutch/index.tsx:94-97`, comment: "Leave the poster in place"). But the same call mints the
poster too, so on a 429 there is no video URL AND no poster URL. `clip-video.tsx:63` needs
`thumbUrl` to show a poster, so the card is a bare black rectangle. The refresh timer is armed
only inside the `try` after success (`clutch/index.tsx:86-91`), so a card that 429s never retries
while it is on screen. No toast, no spinner, no retry affordance. The feed silently stops working
and is indistinguishable from the app being broken.

**Cheapest fix. Code change, no migration.** Three edits:

1. `handler.ts` already resolves `getOptionalUserId(request)` on the batch path. Key the bucket
   on the user id when a JWT is present and fall back to IP only for guests. This removes the NAT
   collision entirely for signed-in users. One-line key change plus hoisting the `getOptionalUserId`
   call above the throttle.
2. Split the constants: per-user 60/60s, per-IP 600/60s (a NAT-sized number for the guest path).
3. `clutch/index.tsx`: distinguish 429 from other errors in `mintPlayback`, schedule a jittered
   retry, and render a retry affordance on the card instead of black.

---

## M-2 (P0). The 250 GB Pro egress quota is gone between day 1 and day 9 of a 10k launch, and Pro's default Spend Cap turns that into an org-wide outage rather than a bill

**Mechanism.** Every Clutch view downloads the MP4 from Storage. `CLIP_BUFFER_OPTIONS`
(`apps/mobile/src/lib/video-buffer.ts`) caps a player at 8 MB / 6 s forward, so any clip under
8 MB downloads in full when watched. The feed also mounts a player for the prefetched next card
(`clutch/index.tsx:314-317`: `mountPlayer` is true once `playbackUrls[item.id]` exists), so a
skipped clip still pays a partial buffer.

**Measured inputs, from `storage.objects` on the live project.**

```
clips bucket, video/mp4     n = 27   avg 2,645,699 B (2.65 MB)   max 11,837,000 B
clips bucket, image/jpeg    n = 20   avg   283,786 B (284 KB)    max    649,457 B
```

**The number, derived.**

```
per Clutch session of 15 clips
  video   15 x 2.65 MB x 1.3 (prefetch waste)  = 51.7 MB
  poster  15 x 0.284 MB                        =  4.3 MB
                                                 -------
                                                  56.0 MB

BREAK-EVEN against the 250 GB/month Pro quota
  250 GB / 56 MB = 4,464 Clutch sessions per month = ~149 per day

at 10,000 registered users
  conservative  DAU 20%, 40% open Clutch, 10 clips
                800 sessions/day x 37.3 MB  =  29.9 GB/day  -> quota gone day  9,   896 GB/month
  central       DAU 30%, 60% open Clutch, 15 clips
              1,800 sessions/day x 56.0 MB  = 100.8 GB/day  -> quota gone day  3, 3,024 GB/month
  aggressive    DAU 40%, 70% open Clutch, 25 clips
              2,800 sessions/day x 93.2 MB  = 261.0 GB/day  -> quota gone day  1, 7,830 GB/month
```

Under every assumption I can defend, the monthly quota does not survive the month.

**Cost, if the Spend Cap is OFF.** Org `sdibeiimibszmixymsdr` (`Synth_Web_&_App`) is on plan
`pro`, confirmed. Pro includes 250 GB uncached and 250 GB cached, then $0.09/GB uncached and
$0.03/GB cached (Supabase "Manage Egress usage" quota table). Smart CDN is on for Pro and the
docs state it shields origin "even when different query strings are used in the URL", explicitly
including signed URLs, so a rotating token does not force an origin miss. Assume 90% cache hits
in the central case:

```
uncached  302 GB ->   52 GB over x $0.09 =  $4.68
cached  2,722 GB -> 2,472 GB over x $0.03 = $74.16
                                            ------
                                            $78.84 / month
```

**Cost, if the Spend Cap is ON.** Pro enables Spend Cap by default. With it on, exceeding the
quota does not bill, it restricts the organization under the Fair Use policy. Clutch stops
serving video for every user, and the quota is org-wide, so the blast radius includes the other
projects in `Synth_Web_&_App`, not only Atlitos. The 3,024 GB figure above does not include
those other projects' egress, which shares the same 250 GB.

**Cheapest fix. Config change only.** Confirm Spend Cap is OFF and set a usage alarm at 200 GB
before launch. $79/month buys the central case. Nothing in the code has to change to survive the
money; code only has to change to survive the cap. Severity is P0 because the default setting
produces a total outage in the first week.

---

## M-3 (P0). The app never captures a thumbnail, so every clip a real user posts has no poster at all

**Mechanism.** `apps/mobile/src/app/(tabs)/clutch/upload.tsx:108` calls
`clutch.finalizeUpload(ticket.clipId)` with ONE argument. The signature is
`finalizeUpload(clipId: string, thumbPath?: string)` (`packages/api/src/hooks.ts:1806`), so
`thumb_path` goes over as `undefined`. `supabase/functions/stream-webhook/index.ts:153` writes
`thumb_path` only when the body supplies it, and there is no server-side frame extraction
anywhere in the repo. The file admits it in its own comment at `upload.tsx:97-99`: "NATIVE PASS:
... capture a client-side thumbnail to pass as thumb_path to finalizeUpload (VIDEO.md)". It was
never done.

**Verified live rather than assumed.** All 12 `published` clips DO have `thumb_path`, which is
why this has not been noticed. All 12 were created on or before 2026-07-28 by seed and
verification scripts, which pass the argument. The three most recent `ready` clips, created
2026-08-11 and captioned `e2e CL-10 ...`, all have `thumb_path IS NULL`.

**The number.** It is not a 10k threshold, it is the FIRST clip posted through the app UI. It
only becomes visible at scale because today the feed is 100% fixture data (CURRENT-STATE:
16 of 22 live-feed clips are e2e fixtures). At 10k users, once app-posted clips outnumber the 12
fixtures, three things happen at once:

- The feed shows a bare black `VideoView` until the first frame decodes, on every card.
- The batch mint with `kind: "thumb"` resolves `clip.thumb_path = null`, so
  `mintSignedUrlWithTtl` throws NOT_FOUND (`mint.ts:44-46`) and every id lands in `failed`. The
  own-profile grid is 100% blank tiles.
- Egress gets WORSE, not better. With no 284 KB poster, the only way to show anything is to pull
  the 2.65 MB video. The whole 3600s thumb-TTL optimisation buys nothing, because there is
  nothing to mint.

**Cheapest fix. Code change, no migration.** The column and the webhook parameter already exist.
Add `expo-video-thumbnails` (or `expo-video`'s `generateThumbnailsAsync`) at pick time in
`upload.tsx`, upload the JPEG to `${user.id}/${clip.id}.jpg` on the same signed-upload flow, and
pass the path to `finalizeUpload`. About 25 lines in one file.

---

## M-4 (P1). The batch endpoint is wired into exactly one of the four clip grids. Two others render blank, and the obvious fix for those recreates the P1-1 flood

**Mechanism.** `getPlaybackUrls` has exactly ONE call site in the entire monorepo:
`apps/mobile/src/app/profile/index.tsx:161`. Verified by grep across `apps/` and `packages/`.

`apps/mobile/src/components/organisms/ClutchProfileView.tsx:162` renders
`<ClutchPostCard clip={item} variant="thumb" onOpen={...} />` with NO `posterUrl` prop.
`ClutchPostCard.tsx:117` then falls back to `clip.thumbUrl`, which `mapClipRow`
(`hooks.ts:1198`) deliberately sets to `undefined` for any raw storage path via its `isHttpUrl`
guard. So the tile source is `undefined` and the grid renders empty.

`ClutchProfileView` backs BOTH `(tabs)/clutch/profile.tsx` (own profile inside the Clutch tab)
and `(tabs)/clutch/creator/[id].tsx` (every other creator's profile). Two of the three profile
surfaces show blank grids and mint nothing; only `profile/index.tsx` is wired.

**The number.** Today: 0 mints from those grids, because they are blank. The scale risk is the
repair. The obvious fix, applied by someone who has not read PHASE-3-STATUS, is a per-tile
`getPlaybackUrl` inside `renderItem`. `getCreatorClips` (`hooks.ts:1753`) has NO `.limit()` and
NO pagination, confirmed against the file:

```
naive per-tile fix on a creator profile
  61 published clips  -> 61 single mints on mount
  per-IP budget       -> 60 / 60 s
  BREAK POINT: 61 clips on one creator profile trips the throttle in under 3 seconds
```

Even the correct batch fix is unbounded without pagination:

```
500-clip creator, batched
  ceil(500 / 24) = 21 requests at concurrency 4, landing in ~6 s
  = 35% of the entire per-IP minute budget, on one screen open
```

**Cheapest fix. Code change, no migration.** Thread `posterUrl` into `ClutchProfileView` from a
single `getPlaybackUrls(ids, 'thumb')` batch, copying `profile/index.tsx:149-172` exactly, and
add `.limit(CLUTCH_PAGE_SIZE)` plus a keyset cursor to `getCreatorClips` and `getMyClips` so the
grid is bounded before it is batched.

---

## M-5 (P1). `clips` is the only bucket with no size ceiling, the picker uploads at quality 1, the whole file goes through a JS blob, and the ticket mint has no rate limit

**Mechanism, four separate holes on one path.**

Bucket ceilings, read from `storage.buckets` live:

```
avatars             10,485,760
gratitude-photos    10,485,760
product-media       10,485,760
upa-photos          10,485,760
venue-media         10,485,760
clips                     NULL     <- the bucket that takes the largest files
coach-certificates        NULL
upa-evidence              NULL
```

- `upload.tsx:76` `launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 })`. No
  compression, no `videoMaxDuration`, no `fileSize` check anywhere before `handlePost`.
- `upload.tsx:100-101` `await fetch(asset.uri)` then `.blob()` loads the ENTIRE file into the JS
  heap before `uploadToSignedUrl`. Not streamed, not resumable.
- `stream-upload-url/index.ts` has no rate limit at all (grep for `takeRateLimitToken` in that
  directory returns nothing) and INSERTs a `clips` row on every call.

**The numbers, derived.**

```
device OOM, Android
  dalvik.vm.heapgrowthlimit measured on this project    192 MB  (video-buffer.ts, BUG-042)
  iPhone 4K/60 HEVC                                     ~400 MB per minute
  iPhone 1080p/30 H.264                                 ~130 MB per minute
  BREAK POINT: a ~150 MB pick, which is 35 seconds of 4K/60, OOMs the upload
               before a single byte leaves the device
  largest object in the bucket today is 11,837,000 B, so nothing this size has been tried

storage quota
  Pro includes 100 GB, then $0.021/GB
  100 GB / 2.65 MB (measured average) = 37,700 clips
  BREAK POINT: 3.8 clips per user at 10,000 users
  and it is monotonic: there is no clip deletion path
  (CURRENT-STATE: revoke update, delete on public.clips from authenticated)

ticket abuse
  stream-upload-url is authenticated but unthrottled and creates a row per call
  BREAK POINT: none. One client in a loop adds clips rows at HTTP speed.
```

**Cheapest fix. Two code changes plus one config change.**

- Config: set `clips.file_size_limit` on the bucket (Dashboard, Storage, bucket settings) to
  60 MB, matching the other buckets' pattern of having any ceiling at all.
- Code: `videoMaxDuration: 60` on the picker plus an `asset.fileSize` guard before `handlePost`,
  and replace the `.blob()` with a streamed upload.
- Code: `takeRateLimitToken(supabase, 'clip-upload-user', user.id, 10, 3600)` in
  `stream-upload-url`. The RPC exists and is verified live; this is a five-line addition reusing
  `_shared/rate-limit.ts`.

---

## M-6 (P1). The recorded Home-image finding HOLDS, and is true only because Home is showing seed placeholders. Nothing in the tree resizes anything, and the one real uploaded image is a 37x over-fetch

**The recorded finding is CONFIRMED, not assumed.** Queried `storage.objects` directly:

```
product-media   21 objects   avg 4,831 B   max 5,057 B    (promo/banner-clutch.png = 5,057 B)
venue-media      6 objects   avg 3,229 B   max 6,389 B
```

Home's `PromoCarousel` reads `product-media` (`packages/api/src/use-home.ts:17`), 3 active
banners = ~15 KB total. `RecentlyViewedRail` reads product images from the same bucket at ~4.8 KB
each. So Home is genuinely NOT fetching full-size images and the 4 to 6 KB PNG claim survives.
The single largest image cost on Home is not the many small ones, it is the one Clutch poster at
284 KB, which is 19x the entire promo carousel.

**What is actually dangerous is a different thing.**

- **Zero image transformation anywhere in the monorepo.** All 11 `getPublicUrl` call sites pass
  no `transform` option (`use-home.ts:59`, `use-shop.ts:425`, `hooks.ts:611`,
  `use-empower.ts:203`, `mobile/src/lib/storage.ts:32,44`, `portal-court` x3,
  `portal-life` x2). Verified by grep, not by absence of a migration.
- **Zero client-side resize before upload.** No `expo-image-manipulator` in any `package.json`;
  only `expo-image-picker`. Avatar and cover picks use `quality: 0.8` with `allowsEditing`
  (`profile/edit.tsx:134-138`, `player-setup/[step].tsx:78-82`,
  `coach-setup/[step].tsx:122-126`) and go up at native camera resolution
  (`mobile/src/lib/storage.ts:19-26`).
- The ONE genuinely user-uploaded image in production proves the shape:
  `avatars/e78d9b2b-2b53-4f17-b149-2450cc343975/avatar.jpg` is **298,490 bytes**, and
  `components/ui/avatar.tsx:45` renders it with a plain React Native `<Image>` into a 32, 40, 56
  or 80 px circle.

**The number, derived.**

```
80 px at 3x device pixel ratio        = 240 px
a 240 px cover JPEG at q70            ~ 8 KB
measured real avatar                    298,490 B
OVER-FETCH per avatar                   298,490 / 8,000 = 37x
plus full decode of a multi-megapixel bitmap for an 80 px circle

avatars render in ChatThreadList, GroupMembersSheet, profile/follows, trainings/trainees,
SearchResults, both profile headers, and clutch/post/[id] comments

a 20-row members or followers list
  20 x 298 KB = 5.96 MB   to paint 20 circles that need 160 KB

at 10,000 users with real avatars
  3 MB of avatar over-fetch per session x 3,000 DAU x 30 days = 270 GB/month
  BREAK POINT: avatar over-fetch ALONE exceeds the entire 250 GB Pro egress quota,
               before a single video is played
```

This binds the moment real avatars replace the initials fallback. At 10,000 users with a 30%
avatar-set rate that is 3,000 real images at roughly 300 KB each.

**Cheapest fix. Code change, plus a small transform bill.** Add a shared
`sizedPublicUrl(path, px)` helper and pass
`{ transform: { width: 160, height: 160, resize: 'cover', quality: 70 } }` at each call site.
Cost note so this is not a surprise: `Storage Images Transformed` on Pro is 100 included then
**$5 per 1,000**, priced per unique origin image per month. 3,000 avatars at 2 sizes = 6,000
transforms = about $30/month, against 270 GB of egress avoided. Do both: also resize to 512 px on
upload with `expo-image-manipulator` before `uploadAvatar`, which costs nothing per image and
shrinks the origin object too.

---

## M-7 (P2). Every signed-URL mint is two Postgres writes on a single contended row

**Mechanism.** `take_rate_limit_token`, read from `pg_proc` on the live project, does a `delete`
for older windows then an `insert ... on conflict (bucket, key, window_start) do update set
count = count + 1`. Two write statements and a WAL record per mint. The only index is
`edge_rate_limits_pkey` on `(bucket, key, window_start)`, so all requests from one IP inside one
60 s window serialize on ONE row.

**The number.**

```
central case, 1,800 Clutch sessions/day, ~16 mints each, peak-hour concentrated
  ~150 concurrent scrollers x 10 mints/min = 25 mints/s
  = 25 write transactions/second on edge_rate_limits, purely for throttling,
    on the same Postgres instance that serves the feed query

behind one NAT with 50 devices
  8 updates/second on a single row
```

Row-lock latency is fine at that rate. The finding is not the lock. It is that a read path which
should never touch the database now costs a Postgres round trip plus two writes per video view,
adding latency to every card and competing with the feed query for the same instance. It does not
break at 10k; it makes everything else slower.

**Cheapest fix. Code change, not launch-blocking.** Once M-1 moves signed-in users to a per-user
key, drop the IP throttle to guests only, which removes the DB write from the authenticated path
entirely.

## M-8 (P2). `edge_rate_limits` never garbage-collects keys that stop appearing

The RPC prunes older windows only for the (bucket, key) it is currently serving. A key that never
returns leaves its last row forever. Live state: 12 rows, 5 `clip-playback-ip` keys, oldest
window 2026-08-11. Carrier NAT reassigns addresses (evidenced by `223.228.114.206` and
`223.228.125.206` in the same pool), so distinct keys per month greatly exceed concurrent IPs.

```
10,000 users x ~3 distinct egress IPs/day x 30 days, deduplicated across carrier pools
  ~ 10^5 to 10^6 rows/month, ~100 B/row  =  10 to 100 MB/month, unbounded
```

**Cheapest fix. Migration.** `pg_cron` IS installed (verified in `pg_extension`) and has exactly
one job today (`expire_stale_holds`, `*/5 * * * *`). Add a second:
`delete from public.edge_rate_limits where window_start < now() - interval '1 day'`, hourly.
Note this contradicts CURRENT-STATE's "No pg_cron jobs exist anywhere in the repo": one exists in
production and the extension is installed, so the cost of adding a sweeper is a single line.

---

# SURVIVES 10,000, with the evidence

1. **Both playback functions are deployed and ACTIVE.** `get-clip-playback-url` v6 (updated
   2026-08-05, i.e. after Phase 3), `get-clip-playback-urls` v3, both `verify_jwt: false` as the
   guest-browsable feed requires. From `list_edge_functions`.
2. **There is genuinely one authz and one throttle code path.**
   `get-clip-playback-urls/index.ts` is a 6-line delegate to `get-clip-playback-url/handler.ts`.
   Both deployed names share the bucket string `clip-playback-ip`. The "second unrate-limited
   front door" risk PHASE-3-STATUS worried about was not reopened.
3. **The throttle key is real, not `"unknown"`.** Live `edge_rate_limits` rows under
   `clip-playback-ip` hold actual public IPv4 addresses. `x-forwarded-for` does reach the Deno
   isolate. Had it not, the entire user base would share one 60/min bucket, which would be a
   catastrophic P0. It is not happening. This was the single most important thing to check and it
   passes.
4. **Separate thumb and video TTLs are real on the batch path.** `mint.ts`
   `THUMB_URL_TTL_SECONDS = 3600` and `VIDEO_URL_TTL_SECONDS = 300`, selected at
   `handler.ts:186`. Caveat recorded in the table at the top: the feed uses the legacy path and
   so gets 300 s for both.
5. **The concurrency cap of 4 is real and enforced,** not just declared:
   `hooks.ts:1075` plus the worker pool at `hooks.ts:1382-1389`.
6. **The batch chunk cap agrees on both sides.** `BATCH_MAX_CLIP_IDS = 24` (`handler.ts:53`) and
   `PLAYBACK_BATCH_MAX = 24` (`hooks.ts:1074`), so our own client can never provoke
   `BATCH_TOO_LARGE`.
7. **The throttle fails OPEN while the takedown authz fails CLOSED.** `takeRateLimitToken`
   returns `{ allowed: true, failedOpen: true }` on any RPC error, and `resolveClipAccess` reads
   the live clip row on every single call. A database hiccup degrades throttling and never
   weakens the removed/rejected refusal.
8. **The rate-limit table does not grow per request.** The RPC deletes the previous window for
   its own key before inserting. Growth is per never-returning key only (M-8), not per mint.
9. **The player memory bound is real and applied at all three call sites.**
   `CLIP_BUFFER_OPTIONS` 8 MB / 6 s forward / 2 s minimum. It bounds per-clip prefetch egress as
   well as heap, which is what makes the M-2 arithmetic tractable at all.
10. **Smart CDN protects the origin despite rotating signed-URL tokens.** Org is on plan `pro`
    (confirmed), and Supabase documents Smart CDN as shielding origin "even when different query
    strings are used in the URL", explicitly including signed URLs. So a re-mint is billed at the
    cached $0.03 rate, not the uncached $0.09 rate. The device still re-downloads (a new URL is a
    new React Native `Image` / ExoPlayer cache key), but the origin does not.
11. **Feed pagination is bounded and correctly scoped.** `CLUTCH_PAGE_SIZE = 10`, keyset
    pagination on `created_at`, and `status = 'published'` filtered explicitly in the query
    rather than left to permissive-OR RLS (`hooks.ts:1399-1409`).
12. **The feed evicts URLs and timers outside a 3-card window** (`clutch/index.tsx:157-180`), so
    stale short-lived URLs and their refresh timers do not accumulate over a long scroll.

---

# UNRESOLVED

1. **The project-level global upload size limit.** `clips.file_size_limit` is NULL, which defers
   to the project setting (Supabase default 50 MB). That value is not readable from Postgres and
   I made no HTTP request to production to probe it, per the load gate. If it is at the default,
   M-5's OOM number is capped at 50 MB, which changes the threshold but not the finding.
   Check: Dashboard, Storage, Settings, Upload file size limit.
2. **Whether Spend Cap is currently ON** for org `Synth_Web_&_App`. The Management API surface
   available here does not return it. This single boolean decides whether M-2 is a $79 bill or a
   week-one outage across every project in the org.
   Check: Dashboard, Organization, Billing, Cost Control.
3. **Actual egress consumed in the current billing period.** Not carried in Postgres. Reading it
   before launch would calibrate the 56 MB per-session model against reality instead of leaving
   it an estimate.
4. **Real per-clip video size for app-recorded clips.** Every MP4 in the bucket today is a
   fixture: sizes repeat byte-identically across owners (11,837,000 four times, 2,761,502 four
   times, 1,251,923 three times). The 2.65 MB average is therefore fixture-derived, not
   user-derived, and the whole M-2 model rests on it. One real 30-second phone clip uploaded
   through the app would replace the assumption with a measurement. This is the cheapest single
   thing anyone could do to firm up this document.
5. **Whether React Native's `<Image>` re-downloads a poster after a re-mint.** RN caches on the
   URL string, so a rotated signed URL should miss, but I did not measure it on device (device
   gate held by another session). Consequence is bounded at one extra 284 KB fetch per 300 s per
   visible card, so it does not change any severity above.
