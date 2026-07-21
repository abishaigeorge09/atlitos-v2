# Phase 5 Status: Clutch (the video feed)

**Status: PLANNED (2026-07-21).** Stories AT-89 through AT-107 filed under Jira epic AT-7 (Clutch Video). Deliverables unchecked below. This doc is the contract the P5 builders, integrator, and biased approver work to.

Gate (docs/PLAN.md P5): "Cloudflare pipeline, vertical feed, upload, creator profiles, moderation queue. GATE: founder uploads clip from device to approved to in feed."

Scope ceiling: `docs/prd/PRD-01-athlete.md` section 3.4 and FR-42 through FR-47 (Clutch: feed, upload, creator profile, own profile, like, comment, follow), plus `docs/prd/PRD-04-admin.md` FR-27 through FR-33 (Moderation Queue and Reports Queue) which PRD-01 section 8 delegates to admin. Nothing else. No Learn, no Empower, no Chat scope creeps in because the feed happens to touch profiles or notifications.

## The decided architecture, honoured not re-litigated

Read `docs/architecture/VIDEO.md` in full first, especially the DECISION UPDATE (lines 151 to 161). P5 does not reopen any of this.

- **Cloudflare Stream is DEFERRED.** The founder declined the paid Stream block at P0. **P5 needs NOTHING from the founder's Cloudflare account and plans no Cloudflare hand off.**
- **v1 Clutch ships on a Supabase Storage adapter** behind the same two edge function contracts VIDEO.md names: `stream-upload-url` (returns a signed Supabase Storage upload URL, private bucket `clips`, clip row status `uploading`) and `stream-webhook` (the on upload finalizer that moves `processing` to `ready`).
- **Playback is progressive MP4 via `react-native-video` from a short lived signed URL, NOT HLS/ABR.**
- **The `clips` table keeps Stream shaped column names.** `cf_stream_uid` stays nullable (the future Cloudflare swap slot, null in v1); a new `storage_path` column holds the object key (VIDEO.md's "playback_id = storage path for now"). The later Cloudflare swap is config plus one adapter, not a migration.

## The clip privacy and takedown mechanism (designed here, the crux of the phase)

Privacy does not go through row flips; it goes through short lived signed URLs. The bucket `clips` is **private**, with **no anon or public read policy on `storage.objects`**, so no clip object is resolvable by a guessed or scraped path. This is the Supabase Storage equivalent of Cloudflare's `requireSignedURLs: true`. Every view of a clip video or thumbnail is a **freshly minted signed URL (TTL 300 seconds)** produced by an edge function that checks the **live** clip row at mint time. Columns store object PATHS only; a resolved URL is never persisted anywhere, because a stored public URL would defeat takedown.

**Two distinct signed URL grants** (AT-96):

- `get_clip_playback_url(clip_id)`: public callable. Mints only when the clip's current status is `published`, OR the caller is the owner (own clip any status, for the profile and the immediate post upload view, FR-45), OR the caller is admin/moderator. A clip in `processing`, `rejected`, or `removed` yields nothing on this path.
- `get_clip_moderation_url(clip_id)`: admin and moderator only (`has_role`, FORBIDDEN otherwise). The only way to preview a not yet published clip (PRD-04 FR-28).

**Takedown that actually makes the video unplayable** (`published` to `removed`): `moderate_clip(clip_id, 'remove', reason)` (or `resolve_report` takedown) sets status `removed`. Because every playback URL is minted against the live row, the instant the row is `removed` the public and owner path refuses to mint for everyone including the owner (removed is terminal), and any already minted signed URL stops resolving once its 300 second TTL elapses. Residual playability after a takedown is therefore bounded by the TTL, never indefinite, the direct analogue of Cloudflare signed URL revocation. The clip also leaves the `published`-only feed query at once. This is verified adversarially in AT-107, not argued.

## The stream-reconcile decision (poll fallback)

VIDEO.md step 4 specifies a `stream-reconcile` pg_cron poller as a Cloudflare webhook reliability fallback. **In v1 that dedicated poller is DEFERRED**, because the Supabase Storage adapter has no asynchronous third party webhook that can be lost: the `stream-webhook` finalizer is a synchronous client to edge function call in the same session (AT-95), so there is nothing to poll a remote provider about. When Cloudflare Stream is swapped in later, the real `stream-reconcile` (polling `GET /stream/{uid}`) is added then.

What IS built now (AT-93): a `reconcile_stranded_clips()` arm wired into the existing unified `expire_stale_holds()` pg_cron job (the same `*/5 * * * *` job that already runs courts, sessions, and commerce, per the P4 handoff's explicit invitation to add an arm rather than cut a new cron). It reclaims clips stranded in `uploading`/`processing` past a 30 minute TTL: if the storage object is present it drives the clip to `ready`, if absent to `rejected`. This delivers the "no clip stranded forever" reliability property VIDEO.md wanted using the pattern the codebase already runs. Like AT-26, "scheduled" means observed to have run.

## Reused from P4, do not rebuild

- **The state machine RPC + `audit_log` pattern** (`order_transition` / `admin_approve_verification_request`): a `SECURITY DEFINER` transition raising `INVALID_TRANSITION` on an illegal edge, writing exactly one audit row per accepted transition and zero on rejection. The clip machine follows this exactly (AT-91). Clients never set `clips.status`.
- **The unified `expire_stale_holds()` pg_cron job**: extended with a fourth (clip reconcile) arm, not duplicated (AT-93).
- **`_shared` edge function helpers** (`app-error`, `cors`, `http`, `supabase`) and the `razorpay-webhook` idempotency shape (only act on a row still in its pre state) for the finalizer (AT-95).
- **RLS permissive-OR discipline**: `clips` is `published` public beside own row any status, so every owner or own clip read carries its own explicit filter; RLS is a ceiling, not scoping (CLAUDE.md). Isolation tests assert the two party ids DIFFER before trusting the result (AT-62 lesson).
- **The pressable overlay card pattern** (DESIGN-LANGUAGE.md): the feed and `ClutchPostCard` (already fixed in `4868df9`) must not reintroduce nested pressables.

## Gate definition

P5 passes when all of the following hold on the deployed stack:

1. **Founder uploads a clip from a device (native).** Capture or pick, caption and sport both required before posting (FR-44). The clip goes `uploading` to `processing` to `ready`, appears in the founder's own profile immediately in its current status, and is in no feed until published (FR-42, FR-44).
2. **Admin approves it in the Moderation Queue (web).** `ready` to `published` via `moderate_clip`, exactly one `audit_log` row (PRD-04 FR-29, FR-53), inline preview served through the admin only signed URL grant (FR-28).
3. **It appears in the vertical feed and plays.** `published`-only feed (FR-42), progressive MP4 from a minted signed URL, muted autoplay on device.
4. **The state machine is RPC enforced.** Every illegal edge is refused with `INVALID_TRANSITION` and writes zero rows; a client cannot set `clips.status` (no UPDATE grant plus a grant level revoke); reject requires a non empty reason (FR-30); a rejected clip is visible only to its uploader (FR-45).
5. **Clip privacy and takedown hold, proven adversarially.** Unpublished, rejected, and removed clips are not resolvable through signed URLs; the private bucket object is not fetchable by path as anon; takedown makes the video unplayable within the TTL; moderation preview and feed playback are distinct grants (AT-107).
6. **Engagement is idempotent and gated.** like/comment/follow toggle idempotently, guest taps open `LoginGateSheet` (FR-3, FR-43, FR-46); the feed cursor paginates.
7. `pnpm turbo typecheck build lint` green, RLS advisor run and diffed against the P4 baseline, light and dark web evidence captured, biased approver APPROVE. The native surfaces in clause 1 and the on device autoplay in clause 3 are evidenced by the founder's device action at the gate.

**Not a gate clause, deliberately:** any Cloudflare Stream integration, HLS/ABR playback, transcode, or push notification delivery. All deferred or owned elsewhere.

## Web now, native later. What that means concretely here.

Consistent with the founder's standing instruction and P4's measured amendment.

**Verified on web in P5:** the whole data pipeline (a sample MP4 driven through `stream-upload-url`, a direct storage PUT, the `stream-webhook` finalizer, `moderate_clip` approve, and into the published feed query), the clip state machine and its `INVALID_TRANSITION` rejections, the moderation queue and reports queue (a web app regardless), all of the privacy and takedown proofs (backend and platform independent), the feed layout and the pressable overlay pattern, guest gating, and like/comment/follow toggles. All four states per screen, light and dark.

**Deferred to the native pass, because these are genuinely native and cannot be exercised on react-native-web:**
- Device camera capture (`expo-camera`) and the on device gallery picker (AT-99).
- The on device file upload to the signed storage URL from a real phone.
- `react-native-video` muted autoplay, poster to video swap, and prefetch behaviour in the feed (AT-97). Web uses a different video element and silently papers over native playback.
- Haptics on the engagement rail.

**The founder's single native action at the gate:** on a real device, capture or pick a clip, add a caption and sport, and post it, watching it upload and land in their own profile. Then (as admin, on web) approve it. Then confirm on the device that it plays in the vertical feed. That capture to on device autoplay round trip is the one thing that is inherently native and only the founder's device pass can close; everything upstream and downstream of it is proven on web first.

## Deliverables owed, by track

### Track A: schema, RLS, state machine, storage privacy (opus)
- [ ] AT-89 Clutch schema migration: clips (storage adapter shaped, `storage_path`), clip_likes, clip_comments, follows, count triggers, creator_stats view (PRD-01 FR-42, FR-44, FR-45, FR-46, FR-47)
- [ ] AT-90 Clutch RLS + private `clips` storage bucket + storage.objects policies (PRD-01 FR-42, FR-45; PRD-04 FR-2)
- [ ] AT-91 Clip state machine RPCs: `clip_transition_internal`, `moderate_clip`, `resolve_report` (PRD-01 FR-44, FR-45; PRD-04 FR-29, FR-30, FR-32, FR-33, FR-53)
- [ ] AT-92 `toggle_clip_like` / `toggle_follow` count maintaining RPCs (PRD-01 FR-43, FR-46)
- [ ] AT-93 Stranded clip reconcile arm in `expire_stale_holds()` (stream-reconcile v1 form) (PRD-01 FR-44; VIDEO.md step 4)

### Track B: edge functions, upload + finalize + signed URL mints (opus)
- [ ] AT-94 `stream-upload-url` edge function (Supabase Storage adapter) (PRD-01 FR-44; VIDEO.md)
- [ ] AT-95 `stream-webhook` storage finalizer, idempotent (PRD-01 FR-44; VIDEO.md)
- [ ] AT-96 `get_clip_playback_url` + `get_clip_moderation_url`, two distinct grants (PRD-01 FR-42, FR-45; PRD-04 FR-28; VIDEO.md)

### Track C: mobile Clutch feed, upload, profiles (sonnet)
- [ ] AT-97 Vertical feed with `react-native-video` progressive MP4, pressable overlay (PRD-01 FR-42, FR-43)
- [ ] AT-98 Post detail + comments sheet, guest gated add comment (PRD-01 FR-43)
- [ ] AT-99 Upload screen: capture/pick, caption+sport gate, upload progress (PRD-01 FR-44)
- [ ] AT-100 Creator profile + own social profile, follow toggle (PRD-01 FR-46, FR-47)
- [ ] AT-101 `packages/api` `useClutch` wiring (PRD-01 FR-42, FR-43, FR-44, FR-46)

### Track D: admin moderation (sonnet)
- [ ] AT-102 Moderation Queue: inline preview, approve/reject with required reason (PRD-04 FR-27, FR-28, FR-29, FR-30, FR-33, FR-53)
- [ ] AT-103 Reports Queue: resolve by takedown or dismissal with required reason (PRD-04 FR-31, FR-32, FR-33, FR-53)

### Track E: fixtures and copy (haiku)
- [ ] AT-104 Clutch seed fixtures: published clips, storage objects, pending queue, reports (PRD-01 FR-42, FR-45, FR-47; PRD-04 FR-27, FR-31)
- [ ] AT-105 House style copy pass across all P5 screens (PRD-01 FR-70; CLAUDE.md)

### Track F: verification (opus)
- [ ] AT-106 Pipeline + state machine + non vacuous RLS isolation verification (PRD-01 FR-42, FR-44, FR-45; PRD-04 FR-27, FR-29, FR-30)
- [ ] AT-107 Clip privacy and takedown teeth verification (PRD-01 FR-45; PRD-04 FR-32; VIDEO.md)

## Dependency order

Track A first and strictly in order: AT-89 gates everything; AT-90 and AT-91 need AT-89; AT-92 needs AT-89; AT-93 needs AT-91 (the internal transition RPC) and AT-90 (the bucket). Track B next: AT-94 needs AT-89 and AT-90; AT-95 needs AT-94 and AT-91; AT-96 needs AT-89, AT-90, AT-91. Tracks C and D build on A and B in parallel, and both are blocked on AT-104's seed catalog (including the actual storage objects) before any screen can render populated. AT-101 is the shared api layer C's screens consume, so it lands early in C. Track E copy pass (AT-105) runs after screens land. Track F verifies at the end: AT-106 must not begin before AT-93 is scheduled and observed to have run, and AT-107 needs the full pipeline plus the mints live.

## Doc update duties baked into tickets

- AT-89 updates `SCHEMA.md` clutch section for the `storage_path` column and the private `clips` bucket.
- AT-90 reconciles `RLS.md`'s Storage table row: it currently names bucket `clutch-video` governed by Cloudflare Stream signed URLs; the v1 reality is bucket `clips`, private, Supabase Storage signed URLs minted by edge functions. This naming drift (VIDEO.md and this plan use `clips`; RLS.md's storage table says `clutch-video`) must be resolved to `clips` in the migration and the doc.
- AT-96 / VIDEO.md: record the two signed URL grants and the 300 second TTL as the v1 adapter's privacy mechanism.

## Traps this phase will hit

1. **A stored URL silently defeats takedown.** If any builder writes a resolved public or long lived signed URL into `clips.video_url`/`thumb_url` (or anywhere), a removed clip stays playable. Columns hold PATHS; every view is a fresh mint. AT-107 attempts to fetch a removed clip and asserts no column bypasses the mint.
2. **Permissive-OR RLS on `clips`.** `published` public sits beside own row any status inside single feed and profile queries. An unscoped select returns other users' rows. Every owner or own clip read carries its own explicit filter in app code, seed, and tests, and isolation tests assert the two party ids differ first (AT-62 lesson).
3. **Client set status.** No client insert or update of `clips.status`. Insert forces `uploading` by default; every forward move is an edge function or the moderation RPC. No mobile code calls `clip_transition_internal`, `moderate_clip`, or `resolve_report`.
4. **Nested pressables.** The feed and `ClutchPostCard` use the pressable overlay pattern; do not reintroduce the `<button> cannot contain a nested <button>` class bug fixed in `4868df9`.
5. **Do not cut a second cron.** The clip reconcile is a fourth arm on `expire_stale_holds()`, not a new pg_cron job.
6. **Tokens, mono numerics, lucide, no emoji, no hyphens/em dashes in copy strings**, on every P5 surface. Numeric readouts (likes, comment and follower counts, upload progress) in JetBrains Mono tabular.

## Open questions carried from PRD-01 section 9 (assumptions the plan ships)

- **Follow graph visibility** (item 7): follower/following counts are display only in v1; tapping a count to browse the list is NOT built (not in FR-47). Assumed.
- **Guest local persistence** (item 2): no guest side local persistence of feed position or likes across a session before login. Assumed.

## Handoff notes owed at phase close

Phase close must record: whether the on device capture to autoplay round trip actually closed at the gate or is carried; the state of AT-93 across the reconcile arm (observed to have run, not just scheduled); confirmation that no column stores a resolved URL; and the Cloudflare Stream swap surface for a future phase (the `cf_stream_uid` slot, the two edge function contracts, and the real `stream-reconcile` poller that becomes live only when Stream is enabled).
