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
