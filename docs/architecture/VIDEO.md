# Video Pipeline (Cloudflare Stream)

The Clutch upload and playback pipeline, per PLAN.md: `mobile -> stream-upload-url (tus one-time URL) -> Cloudflare Stream transcode -> webhook -> clip ready -> moderation_queue -> admin approve -> published -> HLS feed via react-native-video-feed`. This document fixes the exact contract at each arrow.

## Why Cloudflare Stream, not our own storage

Clips are user-generated vertical video that needs adaptive-bitrate HLS delivery, automatic thumbnailing, and resumable upload from a mobile network without our server ever holding the raw file in memory. Cloudflare Stream does all three natively and bills per minute stored/streamed, which is the right shape for a feed product; Supabase Storage is used for every other media type in this schema (certificates, photos, product media) but deliberately not for clip video.

## Clip status machine

`clip_status` (from `SCHEMA.md`): `uploading` to `processing` to `ready`; `ready` to (`published` or `rejected`); `published` to `removed` (moderation takedown only). This is also the "queue": `apps/admin`'s Moderation Queue (PRD-04 3.6) is a plain query, `SELECT * FROM clips WHERE status IN ('uploading', 'processing', 'ready') ORDER BY created_at`, not a separate `moderation_queue` table. Duplicating clip lifecycle state into a second table would let the two drift; a `ready` clip **is** a pending-moderation clip, there is nothing else a moderation queue row would need to say. Reports against an already-`published` clip are a different concern and do live in their own table, `reports` (moderation/audit domain, `SCHEMA.md`), because a report is an event against a clip, not a restatement of the clip's own status.

## Step by step

### 1. Upload start: `stream-upload-url`

The mobile app calls this edge function when the athlete taps Post on the Upload screen (PRD-01 3.4), after caption and sport tag are filled in (FR-44 requires both before posting).

```ts
// supabase/functions/stream-upload-url/index.ts
Deno.serve(async (req) => {
  const { caption, sport } = await req.json();
  const userId = getUserIdFromJWT(req); // service-role fn still reads the caller's JWT to attribute ownership

  const supabase = serviceRoleClient();

  // 1. Create the clip row up front, in `uploading` status, so the athlete's
  //    own Clutch profile can show it immediately (per PRD-01 FR-44).
  const { data: clip } = await supabase
    .from('clips')
    .insert({ owner_id: userId, caption, sport, status: 'uploading' })
    .select()
    .single();

  // 2. Ask Cloudflare Stream for a one-time direct creator upload URL (tus
  //    protocol, resumable). maxDurationSeconds and requireSignedURLs keep
  //    an unpublished clip private until an admin approves it.
  const cfResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_STREAM_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxDurationSeconds: 180,
        requireSignedURLs: true,
        meta: { clipId: clip.id, ownerId: userId },
      }),
    },
  ).then((r) => r.json());

  // 3. Persist the Cloudflare Stream video uid against the clip row so the
  //    webhook (step 3 below) can find it by uid alone.
  await supabase.from('clips').update({ cf_stream_uid: cfResponse.result.uid }).eq('id', clip.id);

  return Response.json({ clipId: clip.id, uploadUrl: cfResponse.result.uploadURL });
});
```

`requireSignedURLs: true` is set on every clip from creation, this is what keeps a clip private (not publicly resolvable by uid) through `uploading`, `processing`, and `ready`; it is never flipped to public delivery, playback for all states instead goes through short-lived signed URLs (step 5), so a rejected or still-processing clip can never leak via a guessed or scraped Cloudflare uid.

### 2. Upload transfer: client to Cloudflare directly

The mobile app uses a tus client (`tus-js-client` or the Expo equivalent) to stream the video file straight to `uploadUrl`, resumable across a dropped connection, with zero bytes passing through Supabase. The Upload screen's `uploading (progress)` state (PRD-01 3.4) tracks the tus client's own progress events; this is entirely client-side and touches no backend call. Once the tus upload completes, the app calls a trivial confirmation (`clips` `UPDATE status='processing'` via PostgREST, own-row RLS) so the UI can move off the progress bar without waiting on Cloudflare's webhook round trip; this is a UX-only optimistic transition, the authoritative state still comes from Cloudflare via the webhook next.

### 3. Transcode complete: `stream-webhook`

Cloudflare Stream POSTs a webhook when processing finishes (success or error), configured once at the account level to point at this function's URL.

```ts
// supabase/functions/stream-webhook/index.ts
Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('webhook-signature') ?? '';

  if (!verifyCloudflareStreamSignature(rawBody, signatureHeader, CF_STREAM_WEBHOOK_SECRET)) {
    return new Response('invalid signature', { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const uid = event.uid;
  const supabase = serviceRoleClient();

  // Idempotency: Cloudflare can redeliver. Guard by only transitioning a
  // clip that is still in `processing`; a second delivery for an already
  // `ready`/failed clip is a no-op, not a re-processed event.
  const { data: clip } = await supabase
    .from('clips')
    .select('id, status')
    .eq('cf_stream_uid', uid)
    .single();

  if (!clip || clip.status !== 'processing') {
    return new Response('ok (already handled or unknown uid)', { status: 200 });
  }

  if (event.readyToStream === true) {
    await supabase
      .from('clips')
      .update({
        status: 'ready',
        thumb_url: `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg`,
        // video_url is intentionally left null here; playback always goes
        // through a freshly minted signed URL (step 5), never a stored one.
      })
      .eq('id', clip.id);

    await notifyModerationQueue(supabase, clip.id); // pushes a notification/dashboard tile refresh to admin
  } else if (event.status?.state === 'error') {
    await supabase
      .from('clips')
      .update({ status: 'rejected', rejection_reason: 'Upload failed processing' })
      .eq('id', clip.id);
  }

  return new Response('ok', { status: 200 });
});
```

### 4. Poll fallback

PLAN.md flags webhook reliability as a risk ("Stream webhook reliability, idempotent + poll fallback"). A scheduled edge function (`stream-reconcile`, invoked by `pg_cron` every five minutes) queries `clips` where `status = 'processing' AND created_at < now() - interval '10 minutes'`, calls Cloudflare Stream's `GET /stream/{uid}` for each, and applies the same transition logic as the webhook handler above. Because both paths funnel through the same "only transition a clip still in `processing`" guard, a late webhook arriving after the poll already resolved a clip is naturally a no-op, no double-processing, no separate lock needed.

### 5. Moderation: admin approve or reject

`apps/admin`'s Moderation Queue (PRD-04 3.6) previews a `ready` clip inline using a signed Cloudflare Stream playback URL, minted on demand by a small RPC/edge helper (`get_clip_playback_url(clip_id)`, admin-only per `RLS.md`, since `requireSignedURLs` means no static URL works). Approve and reject are the same admin-only RPC pattern as every other verification action in this codebase:

- **Approve**: `SECURITY DEFINER` RPC `moderate_clip(clip_id, 'approve')`, callable only by `has_role('admin')`, sets `status = 'published'`, writes one `audit_log` row (PRD-04 FR-29).
- **Reject**: `moderate_clip(clip_id, 'reject', reason)`, requires a non-empty reason (blocked otherwise, FR-30), sets `status = 'rejected'`, `rejection_reason = reason`, writes `audit_log`, and triggers a `notifications` row to the creator.

Once `published`, the clip's `requireSignedURLs` restriction still applies at the Cloudflare API level (it was set at creation and is not changed), but the feed now serves it through a long-lived signed HLS manifest URL refreshed by the client player on expiry, rather than through a permanently public uid; this keeps the takedown path (`published` to `removed`) actually effective; a takedown that only changed a database row while the video stayed publicly resolvable at Cloudflare would not be a real takedown.

### 6. Feed playback: `react-native-video-feed`

The Clutch feed query (`API-MAPPING.md`: `clips` select, `status = 'published'`) returns `thumb_url` for the poster frame and a `cf_stream_uid`; the client requests a signed manifest URL for each visible-or-about-to-be-visible card from a lightweight edge function (`get_clip_playback_url`, public-callable for `published` clips only, distinct grant from the admin-only moderation preview version) and hands it to `react-native-video-feed`, which handles muted-autoplay, poster-to-video blur swap, and prefetch of the next card exactly as the GMV reference pattern in `TASTE.md` describes for `VideoCard`. Playback never touches Supabase Storage; the only Supabase call per card is the signed-URL mint, cached client side for the manifest's TTL.

## Reports and takedown after publish

A `published` clip can still be reported (`reports` table, `entity_type='clip'`, PRD-04 3.6 Reports Queue). Resolving a report by takedown calls the same `moderate_clip`-family RPC path with an additional `'remove'` action, setting `status='removed'`; resolving by dismissal only updates the `reports` row, the clip is untouched. A `removed` clip is terminal, there is no path back to `published` in v2 (re-review would require a new upload).

## What lives where, summarized

| Concern | System of record |
|---|---|
| Clip lifecycle status, caption, sport, owner, counts | `clips` table (Postgres) |
| Raw video bytes, transcode renditions, thumbnail generation | Cloudflare Stream |
| Which clips need moderation right now | a query over `clips.status`, not a separate table |
| Reports against published content | `reports` table (Postgres) |
| Who approved/rejected what and when | `audit_log` table (Postgres) |
| Playback URLs | minted on demand from Cloudflare Stream's signed-URL API, never stored |

## DECISION UPDATE (2026-07-13, founder at P1 gate)

Cloudflare Stream is DEFERRED until Clutch has real traffic (founder declined the $5/mo storage block at signup; account exists, logged in, plan page reached, no purchase).

v1 video provider: Supabase Storage adapter behind the SAME two edge function contracts:
- stream-upload-url: returns a signed Supabase Storage upload URL (bucket clips, private), clip row status uploading
- stream-webhook: replaced by an on-upload finalizer (storage webhook or client confirm call) that sets status ready, stores the storage path as playback ref; client-side thumbnail capture at upload
- Playback: direct MP4 progressive via react-native-video from a signed URL. No HLS/ABR until the Stream swap.
- The clips table columns keep Stream-shaped names (cloudflare_uid nullable, playback_id = storage path for now) so the provider swap is config + one adapter, not a migration.

Accepted tradeoffs at prototype scale: no transcode (odd codecs may fail), no adaptive bitrate, client-side thumbnails.

## v1 storage-adapter edge function contracts (AT-94 / AT-95 / AT-96, built + deployed)

Four functions on project `syzzfgaudpifwvbpycyi`. All under `service_role` for the privileged work; every state move goes through Track A's `clip_transition_internal` under the service role, never a client write (`clips` has no client UPDATE grant). Object PATHS only, never a resolved URL, in any column. Signed download URLs live 300 seconds and are minted against the LIVE clip row on every call.

- **`stream-upload-url`** (POST, athlete JWT, verify_jwt on). Body `{ caption, sport, clip_id? }` (`sport` in the `public.sport` enum: football, cricket, badminton, tennis; `clip_id` optional to reuse an own `uploading` row on a retry). Creates/updates the caller's own clip row at `status='uploading'`, persists `storage_path`/`playback_id = <owner_id>/<clip_id>.mp4`, and returns `{ clipId, uploadUrl, token, path, bucket, status }`. The client (or a verification script, no device required) PUTs the MP4 straight to `uploadUrl`, or uses supabase-js `uploadToSignedUrl(path, token, file)`. `cf_stream_uid` stays null (future Cloudflare slot).
- **`stream-webhook`** (POST, uploader JWT, verify_jwt on). The v1 synchronous finalizer (no Cloudflare webhook to lose). Body `{ clip_id, thumb_path? }`. Verifies the object landed, then drives the owner's clip `uploading -> processing -> ready` via `clip_transition_internal`. Idempotent exactly like `razorpay-webhook`: only acts on a clip still in its pre-state, so a redelivery of an already-`ready` (or terminal) clip is a no-op returning `{ clipId, status, outcome:'already_finalized' }`; a first finalize returns `outcome:'finalized'`.
- **`get_clip_playback_url`** (POST, PUBLIC-callable, verify_jwt OFF). Body `{ clip_id }`. Returns `{ clipId, url, thumbUrl, expiresIn:300, status }` with a fresh signed URL ONLY when the live row is `published` (anyone, including guests), OR the caller is the owner (own clip in ANY status, terminal included), OR the caller is admin/moderator (any NON-terminal clip). `removed`/`rejected` refuse for everyone EXCEPT the clip's own owner. **FB-004 widening (phase-9, 2026-07-29):** the owner branch used to be scoped to non-terminal only, so an owner opening their own `rejected` (or a stuck pending) clip from their profile got a 403 and the client fell back to a silent poster that never played. The owner branch is now unconditional on status: `auth.uid() == clip.owner_id` mints in any status, so the owner always watches their own upload back regardless of moderation outcome (FR-45). The takedown's teeth are intact for the whole world: a `removed`/`rejected` clip still refuses for every non-owner, INCLUDING an admin here (admins preview through `get_clip_moderation_url`), and the widening is scoped strictly to owner-of-row, so a takedown still hides the clip from everyone but the owner. Because the fn runs under the service role, this authz lives in the fn code, not in `clips` RLS (which already lets the owner SELECT their own row in any status via `clips_select_own`).
- **`get_clip_moderation_url`** (POST, admin/moderator only, verify_jwt on). Body `{ clip_id }`. The only preview path for a not-yet-published clip (PRD-04 FR-28), a DISTINCT grant from the public mint. Same response shape; a non-admin gets 403, and `removed`/`rejected` refuse even for an admin.

**Poster wiring (native feed).** `clips.thumb_path` is a raw private-bucket key, not a loadable URL, so `mapClipRow` maps it to `Clip.thumbUrl` only when it is already an absolute http(s) URL (a bare path stays undefined). The card poster the native `ClipVideo` (`expo-video` `VideoView`) shows is instead the SIGNED `thumbUrl` `get_clip_playback_url` mints alongside the video: the feed captures it per visible card into a `posterUrls` map (same lifecycle as the playback URL) and passes it to `ClutchPostCard`, which prefers it over `clip.thumbUrl`. Because the mint returns video and thumb together, a published clip whose video OBJECT is absent (a placeholder-byte fixture) gets no mint at all, so its poster does not surface until real bytes exist; a clip with real bytes shows the signed poster until the first frame decodes, then the looped muted video.

Verified adversarially over real HTTP against a real clip id (`404ad654...`): a real MP4 pushed by a script through `stream-upload-url` and a signed PUT, finalized once then a redelivery no-op; owner and admin mints served a resolving URL while a non-owner and a normal user were refused on the same `ready` clip; the clip driven `published` (guest URL resolves) then `removed` via `moderate_clip`, after which the public, owner, and moderation mints all refused (403); and the private bucket object returned 400 to a direct anon path fetch (no stored-URL bypass).

**FB-004 re-proof (phase-9, 2026-07-29, project `syzzfgaudpifwvbpycyi`).** Two distinct seed users, `A = 58756043…` (owner) and `B = afc9b95e…` (non-owner), asserted to differ first (AT-62 anti-vacuity). A fresh `processing` clip (`c62a5c9f…`) was seeded owned by A alongside A's existing `rejected` clip (`97dbc3f5…`). Under the `clips` RLS policies, owner A SELECTed both own non-published rows; non-owner B saw ZERO of them while still seeing A's `published` clip (positive control, proving the query was live). The fn's new decision predicate was evaluated as a truth table over `processing`/`rejected`/`published` for owner/non-owner/admin: owner `true` in every status (the fix); non-owner `true` only for `published`; admin `true` for non-terminal only (`rejected` refused). The seeded clip was deleted after. **The `get-clip-playback-url` edge function must be REDEPLOYED for this widening to take effect in production** (the change is in the deployed fn code; RLS is unchanged, so no migration).

## Storage path validation at the mint (SEC-F1 / SEC-F3, 2026-09-04)

Two separate write paths let a client choose an object key that was later handed to a service-role signed-URL mint against the private `clips` bucket: `stream-webhook`'s `thumb_path` body field, and `coach_trainee_videos`'s direct INSERT policy. Either one turned "mint a URL for this row's media" into "mint a URL for any byte in the bucket", which is the whole takedown and privacy model.

Guarding the writes alone is not enough, because rows poisoned before the guards landed are still in their tables and a policy change does not retract them. So the guard also lives at the read, on the one function all four mints route through:

```ts
mintSignedClipUrl(supabase, objectPath, requiredPrefix)  // prefix is REQUIRED
```

`assertPathUnderPrefix` refuses anything not under `requiredPrefix` and any path containing a `..` segment. The prefix is derived from the row being minted, never from the request body: `${clip.owner_id}/` for clip video and thumbnail (`get-clip-playback-url`, `get-clip-moderation-url`), `coach-videos/${coach_id}/${player_id}/` for trainee video (`get-coach-trainee-video-url`). It is a required positional argument rather than an optional one specifically so a new call site cannot forget it without failing to compile.

`stream-webhook` applies the same predicate at the write, so a poisoned value never reaches the column either. One shared predicate, two enforcement points.

**Both halves need the edge functions REDEPLOYED to take effect in production.** `0089` closes the `coach_trainee_videos` policy, but the mint guards are function code.
