# Phase 5 (Clutch) — Track F Verification (AT-106 / AT-107)

Verifier: Track F. Method: SQL and real HTTP/artifacts against the DEPLOYED stack
(project `syzzfgaudpifwvbpycyi`), never by re-reading code. Every builder claim
treated as a hypothesis to disprove. Scripts: `scripts/verify-clutch-p5.mjs`
(committed) plus privileged SQL run via the Supabase MCP for the arms a client
cannot reach (reconcile, `clip_transition_internal`).

Date of pass: 2026-07-22.

## Headline result

The scripted-but-real end-to-end pipeline PASSED. A real 9409-byte MP4 went in one
end and played back out the other, entirely through the deployed backend, with no
device. This is the substitute for the founder's native upload and it closes the
data half of the gate.

- **Real clip id: `67bdf7a9-e431-44c7-a736-15be8d6ee29a`**
  (owner `player@atlitos.dev` = `58756043-7c59-43b2-b23a-c72f0011970f`).
- MP4: `/tmp/atlitos-clip.mp4`, 9409 bytes, `ISO Media MP4` (ffmpeg testsrc 2s 320x180).

One HIGH-severity web bug was found that typechecks miss: the Clutch feed and post
detail on web are in an infinite render/request loop (details in Findings).

---

## Gate clauses (PHASE-5-STATUS.md lines 47-53)

### Clause 1 — Founder uploads a clip; uploading→processing→ready; own profile; not in feed until published
**VERIFIED (scripted-real); native capture CARRIED.**
- `stream-upload-url` (player JWT) → `{clipId, uploadUrl, token, path, bucket:clips, status:uploading}`, HTTP 200.
- `uploadToSignedUrl(path, token, 9409B mp4)` → no error, object landed at `58756043-.../67bdf7a9-.mp4`.
- `stream-webhook {clip_id}` #1 → `{status:ready, outcome:finalized}`; #2 → `{status:ready, outcome:already_finalized}` (idempotent no-op, HTTP 200 both).
- Own profile / own non-published visibility: owner `get-clip-playback-url` on an own `ready` clip → 200 + 9409 video bytes (FR-45). RLS: a fresh own non-published clip is visible to the owner (count 1) and invisible to a non-owner (count 0).
- Not in feed until published: feed query is `status='published'` only; the `ready` clip does not appear until approved.
- CARRIED: the native camera/gallery capture itself (expo-camera / on-device picker) is genuinely native and not exercisable on web.

### Clause 2 — Admin approves in Moderation Queue; ready→published; exactly one audit_log; inline preview via admin-only grant
**VERIFIED.**
- `moderate_clip(clipId,'approve',null)` (admin JWT) → `status:published`.
- Exactly ONE audit row for the accepted transition: `audit_log` `clip.approve`, actor `d247e386…` (admin), before `ready` → after `published`. (The later takedown wrote a second, separate `clip.remove` row — one row per accepted transition, zero on rejection.)
- Admin-only preview grant proven distinct on a REAL-bytes `ready` clip (`04651620-…`): `get-clip-moderation-url` admin → 200 + 9409 bytes; non-admin → 403; the public `get-clip-playback-url` refuses the same `ready` clip for guest (403) and non-owner (403).
- Web: Moderation Queue (`apps/admin` /moderation, admin@atlitos.dev) renders the fixture `ready` clip "Sick smash from the net in doubles rally" (READY FOR REVIEW). Zero nested-button errors on the page.

### Clause 3 — Appears in the vertical feed and plays
**Backend VERIFIED; web feed layout FAILED to verify cleanly (Finding 1); on-device autoplay CARRIED.**
- Guest (anon key, no session) `get-clip-playback-url` on the published clip → 200, `expiresIn:300`; HTTP GET of the signed URL → **200, Content-Type `video/mp4`, length 9409 = exactly what was uploaded (bytesMatch true).** This is the one-end-in / other-end-out proof.
- Feed query (same shape `useClutch.getFeed` runs, `status=eq.published`) contains the clip.
- WEB: the feed renders its shell, the pressable-overlay card renders (caption text in DOM, ZERO nested `<button>` errors — the `4868df9` pattern holds), but the screen never stabilises out of its loading spinner because of the infinite loop in Finding 1. A stable populated feed shot could not be captured on web.
- CARRIED: `react-native-video` muted autoplay / poster-swap on a real device.

### Clause 4 — State machine is RPC-enforced
**VERIFIED.**
- Illegal `uploading → published` via `clip_transition_internal` raises `INVALID_TRANSITION` (SQLSTATE P0001, "cannot move from uploading to published"), zero rows written.
- Legal chain `uploading → processing → ready` succeeds.
- Client cannot set `clips.status`: no client UPDATE path; direct writes to engagement tables denied (below). Reject-requires-reason and rejected-visible-only-to-uploader hold (RLS below).

### Clause 5 — Clip privacy and takedown, proven adversarially (AT-107)
**VERIFIED.**
- Pre-removal: guest mint 200, signed URL fetch 200.
- `moderate_clip(clipId,'remove','…')` → `status:removed` (+ one `clip.remove` audit row with the reason).
- Post-removal, all mints refuse **403 for everyone**: guest playback 403, owner playback 403, admin playback 403, admin moderation-url 403.
- Direct anonymous fetch of the raw storage object path → **400** (anon) and **400** (owner-authed); no public bypass. `clips` bucket is `public=false`; `storage.objects` has no anon/public policy referencing clips.
- Residual: only a URL minted BEFORE removal still resolves (fetched 200), bounded by the 300s TTL. Documented honestly; this is the designed TTL bound, not a leak.

### Clause 6 — Engagement idempotent and gated
**Backend VERIFIED; UI gate PARTIAL/CARRIED.**
- `clip_likes` and `follows` cannot be written directly by a client: both inserts refused `42501 permission denied for table` (RPC-only, matches the zero client insert policies on both tables).
- `toggle_clip_like` RPC works: `{liked:true, likes_count:12}` (count maintained in the same transaction).
- CARRIED: the `LoginGateSheet` guest-tap flow and feed cursor pagination could not be exercised on web because of Finding 1.

### Clause 7 — typecheck/build/lint, RLS advisor diff, light+dark evidence, approver
**PARTIAL.**
- RLS/security advisor run: no NEW clutch findings vs the P4 baseline. `clips` bucket private (not in `public_bucket_allows_listing`, which lists only `avatars`/`venue-media`). `moderate_clip`/`toggle_clip_like`/`toggle_follow` appear as `authenticated_security_definer_function_executable` WARN by design (admin gate is internal; toggles are the intended path). `clips`/`clip_comments`/`objects` anon policies are the intended guest-browse. The 3 `security_definer_view` ERRORs (`public_profiles`, `coach_profiles_public`, `product_variant_availability`) and 3 `rls_enabled_no_policy` (`order_drafts`, `stock_reservations`, `webhook_events`) are all pre-existing non-clutch objects.
- Light/dark: admin queues captured + asserted LIGHT (body bg `rgb(251,246,239)`); mobile Clutch captured DARK (app default). Per-screen light+dark is limited by the dark-mode web gap (carried) and by Finding 1.
- `pnpm turbo typecheck build lint` and biased-approver sign-off are the integrator/approver's step, not run in this pass.

---

## Priority 3 — Reconcile arm (closes Track A's "scheduled but NOT observed" flag)
**VERIFIED, observed to actually reclaim.**
- Constructed two stranded clips backdated 40 min (past the 30-min TTL): one `uploading` with an ABSENT object, one `processing` with a PRESENT object.
- `reconcile_stranded_clips()` returned `{clips_readied:1, clips_rejected:1, clips_failed:0}`.
- After: absent-object clip `uploading → rejected`; present-object clip `processing → ready`. Both correct.
- The arm is wired into the SCHEDULED unified job, not a second cron: `expire_stale_holds()`'s body calls `reconcile_stranded_clips`, and its live return carries `clips_readied/clips_rejected/clips_failed` alongside sessions/court_bookings/stock. The cron `expire-stale-holds` runs `*/5 * * * *`.
- Side observation: the seed's `uploading`/`processing` fixture clips had already been reclaimed to `rejected` by the live cron before this pass (their placeholder objects are absent) — independent corroboration the arm runs in production.

---

## Findings, ranked by severity

### F1 — HIGH — Clutch feed and post detail infinite render/request loop on web
**RESOLVED (2026-07-22, integrator). Witnessed on web, before and after, in the connected Chrome against the running Expo web server (port 8090) with a script-minted `player@atlitos.dev` fixture session injected into localStorage (no credential typed).**

Root-cause fix: `useClutch(client)` in `packages/api/src/hooks.ts` now memoizes its
returned api object with `useMemo(() => makeClutchApi(client), [client])` (the body
was extracted into a module-level `makeClutchApi` builder so every inner function is
stable). `supabase` is a module singleton, so the memo resolves once and the object
identity never changes; the four consuming screens' `useCallback(load, [clutch])` +
`useEffect(load, [load])` therefore fire the load effect exactly once. This is a
single systemic fix at the root; none of the four screens
(`clutch/index.tsx`, `post/[id].tsx`, `creator/[id].tsx`, `profile.tsx`) changed.
The sibling hooks (`useShop`/`useCourts`/`useProfile`) are unmemoized and do not
loop because their consumers never feed the returned object into an effect
dependency array; the Clutch screens do, which is why the fix belongs in the hook.
(`packages/api` gained `react` as a peer/dev dependency and `"types": ["react"]`,
matching `@atlitos/ui-native`.)

Second, contributing bug found and fixed while witnessing F1: `CLIP_FEED_SELECT`
selected a non-existent column `thumb_url` (the real column is `clips.thumb_path`),
so every feed/detail/creator/profile read 400'd. Under the render loop those 400s
queued behind the storm and surfaced as perpetually-"pending" requests (matching the
original "167 pending, zero console errors, stuck spinner" observation) rather than a
visible error. Corrected to `thumb_path` (also `ClipFeedRow.thumb_path` and
`mapClipRow`), which lets the feed populate. The loop itself is independent of this:
it fires whether `getFeed` resolves or rejects.

Before/after request-rate evidence (same running server, toggling only the memo):
- BEFORE (unmemoized `return makeClutchApi(client)`): the `GET /rest/v1/clips?...status=eq.published` feed request loops without bound. Measured **38 feed fetches initiated in 2 s on the clips endpoint alone (19 req/s)**, still climbing (resource-timing entries 256 -> 301 over a later 4 s window), sustained, not a one-time burst. With the per-iteration `auth.getUser()` + `clip_likes` reads this is the ~55 req/s the original pass recorded. Browser connection-pool throttling (~6/host) is why completed entries lag initiated.
- AFTER (memoized): **exactly 1 `/rest/v1/clips` request total, 0 req/s** over a 5 s window; 3 total `get-clip-playback-url` mints (active card + prefetch + one refresh), a small finite number. Feed populates and stays stable; the real-bytes clip `04651620` renders with its signed `clips/...` URL in a `<video>` (playing). **Zero `<button> cannot contain a nested <button>` console errors** on the feed (pressable-overlay pattern holds). Light+dark feed screenshots captured with the theme class asserted before each write: `clutch-feed-light.png` (dark=false), `clutch-feed-dark.png` (dark=true).

---

The feed never resolves out of its loading spinner; it fires the same
`GET /rest/v1/clips?...status=eq.published` query in an unbounded loop.
- Measured: **167 identical feed requests in 3 s** (~55 req/s), all `statusCode: pending`, ZERO console errors. Post detail: **60 clip + 61 comment requests in 3 s**. Buffer-cleared counts, so ongoing, not a one-time burst.
- Root cause: `packages/api/src/hooks.ts:864` `useClutch()` returns a fresh object literal every render (no `useMemo`). The screens consume it as `const clutch = useClutch(supabase); const load = useCallback(..., [clutch]); useEffect(() => { void load(); }, [load])` — `apps/mobile/src/app/(tabs)/clutch/index.tsx:41,79-form,~105` and `.../post/[id].tsx:51,79,100-105`. New `clutch` every render → new `load` → effect refires → `setState` → re-render → loop. Because `setState` sits behind an async `getFeed`, React never trips "Maximum update depth", so it fails silently.
- Blast radius: `creator/[id].tsx` and `profile.tsx` use the same `useClutch` + load pattern (inspection). Shared code, so this also hits native, not just web.
- Impact: feed is unusable/unstable and hammers the backend; blocks clean verification of gate clause 3's web layout, clause 6's guest gate and pagination.
- Fix (for integrator, not applied here): memoize `useClutch`'s return (`useMemo` keyed on `client`), or memoize the consuming screens' `load` off stable primitives instead of the `clutch` object.

### F2 — MEDIUM — `get-clip-moderation-url` returns 500 (not a clean 4xx) for a placeholder-byte clip
**RESOLVED (2026-07-22, integrator). Redeployed via MCP (version 2, ACTIVE, verify_jwt=true).**

Fix: `mintSignedClipUrl` in `supabase/functions/_shared/clip-access.ts` now detects an
absent storage object (a `"Object not found"` storage error, matched on message with a
404-status secondary signal) and throws `AppError("NOT_FOUND", ..., 404)` instead of
the previous blanket `INTERNAL` 500. A missing object is an expected data condition for
an un-uploaded / fixture (placeholder-path) clip, not a server fault. A bare 400 is NOT
treated as not-found, so a genuine bad request still surfaces as 500. The
admin/moderator gate and the removed/rejected refusal are untouched (both run before the
mint), so auth/privacy is not weakened.

Verified against the deployed function (admin/non-admin tokens minted by script):
- Admin + placeholder-byte `ready` clip `dbc6f83f` (object absent): **404 `NOT_FOUND` "Clip video is not available yet."** (was 500 INTERNAL).
- Admin + real-bytes published clip `04651620` (object present): **200** with a signed `clips/...` URL, `expiresIn:300`.
- Non-admin (`player@atlitos.dev`) + real clip: **403 `FORBIDDEN` "Admin or moderator role required."**
- Admin + `rejected` clip `04af7f0f`: **403 `FORBIDDEN` "This clip is not available."**
- Admin + `removed` clip `67bdf7a9`: **403 `FORBIDDEN`.**

Note (out of F2 scope, not changed): `get-clip-playback-url` shares `mintSignedClipUrl` in
source but is a separately deployed bundle still carrying the old inline copy, so it still
500s on a placeholder-byte clip. Redeploying it would fix it consistently; left as an
advisory since F2 named only `get-clip-moderation-url`.

---

On the fixture `ready` clip `dbc6f83f` (placeholder path, no bytes), admin
`get-clip-moderation-url` → **500 INTERNAL "Failed to mint signed url: Object not found"**.
Authorization passes (admin); the failure is at the storage sign step because the
object does not exist. With real bytes it is a clean 200 (proven on `04651620-…`).
Low security impact, but a not-yet-uploaded/lost-object clip should surface as a
tidy `NOT_FOUND`/422, not a 500. `mintSignedClipUrl` already throws NOT_FOUND for a
null path but not for a present-path/absent-object.

### F3 — LOW/carried — dark-mode web gap
`apps/admin` renders light only (body bg `rgb(251,246,239)`, no theme toggle control
found). Mobile Clutch defaults dark. Per-screen light+dark web evidence is therefore
not achievable on the admin surface. Carried from P3/P4.

### Carried advisories (none dropped)
- Route not enabled on the test merchant (razorpay-route-* return `ROUTE_UNAVAILABLE`).
- AT-88 refund-not-surfaced in shopper UI.
- `tmp-seed-demo-users` edge function still deployed (ACTIVE) — remove before prod.
- Native-only Clutch sliver: camera capture, react-native-video muted autoplay/poster-swap/prefetch, haptics on the engagement rail, on-device gallery picker. Only the founder's device pass closes these.
- Fixture drift: the seed's `uploading`/`processing` clips were reclaimed to `rejected` by the live reconcile cron, so the moderation queue no longer shows those two states from the seed (a `ready` fixture and my uploading probe remain).

---

## Test data left in the project
- `67bdf7a9-…` real-bytes clip, now `removed` (takedown test).
- `04651620-…` real-bytes clip, now `published` (a genuinely playable feed clip; bonus for the gate).
- `f02b8a37-…` own `uploading` RLS probe (shows in the moderation queue as UPLOADING; harmless, will reconcile to rejected).
- One extra like on `535154a7` from the `toggle_clip_like` check.
