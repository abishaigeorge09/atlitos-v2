// ATLITOS v2 — supabase/functions/stream-upload-url/index.ts
//
// AT-94. PRD-01 FR-44; VIDEO.md (DECISION UPDATE 2026-07-13) + PHASE-5-STATUS.md.
//
// The upload-start half of the Clutch pipeline, on the v1 Supabase Storage
// adapter (Cloudflare Stream deferred). Called by the athlete's own JWT when
// they tap Post on the Upload screen, AFTER caption and sport are filled in
// (FR-44 requires both before posting). It:
//
//   1. Creates (or, on a retry, reuses) the caller's OWN clip row in
//      `uploading` status, so the athlete's own profile can show it
//      immediately (FR-45). owner_id is taken from the validated JWT, never a
//      client-supplied id.
//   2. Mints a SIGNED UPLOAD URL against the private `clips` bucket under the
//      service role. The client (or a verification SCRIPT: this is a plain
//      resumable object-upload URL, no device required) PUTs the MP4 straight
//      to storage; no bytes pass through this function.
//   3. Persists the object PATH (storage_path/playback_id) on the row. A PATH,
//      never a resolved URL (PHASE-5-STATUS.md trap 1): playback is always a
//      fresh mint against the live row (get_clip_playback_url, AT-96).
//
// The clip does NOT advance past `uploading` here. stream-webhook (AT-95),
// called once the bytes have landed, is the only thing that moves it to
// `processing`/`ready`, all via the service-role state machine (AT-91). A
// client never writes clips.status (0042 grants no UPDATE).
//
// cf_stream_uid is left NULL: it is the future Cloudflare swap slot. In v1 the
// storage path IS the playback ref (VIDEO.md "playback_id = storage path for
// now"), so the later provider swap is config plus one adapter, not a migration.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient } from "../_shared/supabase.ts";
import { CLIPS_BUCKET } from "../_shared/clip-access.ts";

// The sport enum values (0001). Mirrored here so an unknown sport is a clean
// 400 VALIDATION rather than a Postgres enum-cast 500 on insert.
const SPORTS = [
  "cricket",
  "football",
  "badminton",
  "tennis",
  "basketball",
  "kabaddi",
  "hockey",
  "volleyball",
  "table_tennis",
  "athletics",
  "swimming",
  "other",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTION_MAX = 2000;

interface UploadUrlRequestBody {
  caption: string;
  sport: string;
  /** Optional: reuse an existing OWN clip row (a retried upload). */
  clip_id?: string;
}

interface ClipRow {
  id: string;
  owner_id: string;
  status: string;
}

function parseRequestBody(raw: unknown): UploadUrlRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;

  const caption = body.caption;
  if (typeof caption !== "string" || caption.trim() === "") {
    throw new AppError("VALIDATION", "A caption is required to post a clip.", 400);
  }
  if (caption.length > CAPTION_MAX) {
    throw new AppError("VALIDATION", "Caption is too long.", 400);
  }

  const sport = body.sport;
  if (
    typeof sport !== "string" ||
    !(SPORTS as readonly string[]).includes(sport)
  ) {
    throw new AppError("VALIDATION", "A valid sport is required to post a clip.", 400);
  }

  const parsed: UploadUrlRequestBody = { caption: caption.trim(), sport };

  if (body.clip_id !== undefined) {
    if (typeof body.clip_id !== "string" || !UUID_RE.test(body.clip_id)) {
      throw new AppError("VALIDATION", "clip_id must be a valid uuid.", 400);
    }
    parsed.clip_id = body.clip_id;
  }

  return parsed;
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    const body = parseRequestBody(await request.json().catch(() => null));
    const user = await getAuthenticatedUser(request);
    const supabase = serviceRoleClient();

    // 1. The clip row. Reuse an existing OWN uploading row on a retry, else
    //    create one. Ownership is enforced in TypeScript here (service role
    //    bypasses RLS): a caller can only ever touch a row they own, and can
    //    only re-mint for a row still in `uploading` (once it advances, the
    //    upload window is closed).
    let clip: ClipRow;
    if (body.clip_id) {
      const { data: existing, error: lookupError } = await supabase
        .from("clips")
        .select("id, owner_id, status")
        .eq("id", body.clip_id)
        .maybeSingle<ClipRow>();
      if (lookupError) {
        throw new AppError("INTERNAL", `Failed to load clip: ${lookupError.message}`, 500);
      }
      if (!existing) {
        throw new AppError("NOT_FOUND", "Clip not found.", 404);
      }
      if (existing.owner_id !== user.id) {
        throw new AppError("FORBIDDEN", "You can only upload to your own clip.", 403);
      }
      if (existing.status !== "uploading") {
        throw new AppError(
          "INVALID_TRANSITION",
          "This clip is no longer accepting an upload.",
          409,
        );
      }
      // Let the caller correct caption/sport on the retry.
      const { data: updated, error: updateError } = await supabase
        .from("clips")
        .update({ caption: body.caption, sport: body.sport })
        .eq("id", existing.id)
        .select("id, owner_id, status")
        .single<ClipRow>();
      if (updateError || !updated) {
        throw new AppError("INTERNAL", `Failed to update clip: ${updateError?.message}`, 500);
      }
      clip = updated;
    } else {
      const { data: created, error: insertError } = await supabase
        .from("clips")
        .insert({
          owner_id: user.id,
          caption: body.caption,
          sport: body.sport,
          status: "uploading",
        })
        .select("id, owner_id, status")
        .single<ClipRow>();
      if (insertError || !created) {
        throw new AppError("INTERNAL", `Failed to create clip: ${insertError?.message}`, 500);
      }
      clip = created;
    }

    // 2. The object path in the private bucket. Owner-scoped prefix so the
    //    layout mirrors ownership even though no storage.objects policy ever
    //    authorizes a direct fetch (0042: access is signed-URL only).
    const objectPath = `${user.id}/${clip.id}.mp4`;

    const { data: signed, error: signError } = await supabase.storage
      .from(CLIPS_BUCKET)
      .createSignedUploadUrl(objectPath, { upsert: true });

    if (signError || !signed) {
      throw new AppError(
        "INTERNAL",
        `Failed to mint upload url: ${signError?.message ?? "unknown error"}`,
        500,
      );
    }

    // 3. Persist the PATH (never a resolved URL). playback_id = storage_path
    //    in v1 (VIDEO.md). cf_stream_uid stays null (future Cloudflare slot).
    const { error: pathError } = await supabase
      .from("clips")
      .update({ storage_path: objectPath, playback_id: objectPath })
      .eq("id", clip.id);

    if (pathError) {
      throw new AppError("INTERNAL", `Failed to persist storage path: ${pathError.message}`, 500);
    }

    return jsonResponse(
      {
        clipId: clip.id,
        // A script or the tus/PUT client uploads the MP4 to this URL directly.
        // uploadUrl + token feed supabase-js `uploadToSignedUrl(path, token,
        // file)`; a bare PUT of the file body to uploadUrl works too.
        uploadUrl: signed.signedUrl,
        token: signed.token,
        path: objectPath,
        bucket: CLIPS_BUCKET,
        status: "uploading",
      },
      200,
    );
  })
);
