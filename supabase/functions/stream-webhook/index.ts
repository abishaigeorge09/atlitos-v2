// ATLITOS v2 — supabase/functions/stream-webhook/index.ts
//
// AT-95. PRD-01 FR-44; VIDEO.md (DECISION UPDATE 2026-07-13) + PHASE-5-STATUS.md.
//
// The finalizer half of the Clutch pipeline. On the v1 Supabase Storage
// adapter there is no asynchronous third-party webhook to lose (Cloudflare
// Stream is deferred, PHASE-5-STATUS.md "stream-reconcile decision"): this is a
// SYNCHRONOUS client-to-edge confirm call the app (or a verification script)
// makes once the MP4 has finished uploading to the signed storage URL minted by
// stream-upload-url. It keeps the SAME NAME and contract as the future
// Cloudflare webhook so the later swap is config plus one adapter.
//
// What it does: drive the caller's OWN clip forward to `ready`, entirely
// through the service-role state machine RPC `clip_transition_internal`
// (AT-91), NEVER a direct status write. Clients hold no UPDATE on clips.status
// (0042); this function under the service role is the only path from
// `uploading` to `ready`.
//
// IDEMPOTENCY, matching razorpay-webhook / finalize-payment verbatim: only act
// on a clip still in its pre-state. Each forward step re-reads the live status
// and transitions only from the expected prior state; a redelivered confirm for
// an already-`ready` (or published/removed/rejected) clip is a NO-OP, not a
// re-finalize. Concurrent duplicate calls converge: the state machine locks the
// row `for update` and raises INVALID_TRANSITION for the loser, which this
// function treats as "already handled" rather than an error, exactly as the
// payment gate's zero-row UPDATE does.
//
// The object must actually exist before a clip is called `ready`: a confirm for
// a clip whose bytes never landed does NOT advance it (the AT-93 reconcile arm
// later rejects a truly stranded upload). This is the storage-adapter analogue
// of Cloudflare's readyToStream check.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient } from "../_shared/supabase.ts";
import { CLIPS_BUCKET, fetchLiveClip, type LiveClip } from "../_shared/clip-access.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FinalizeRequestBody {
  clip_id: string;
  /** Optional client-captured thumbnail object path (v1 does client-side thumbs). */
  thumb_path?: string;
}

function parseRequestBody(raw: unknown): FinalizeRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.clip_id !== "string" || !UUID_RE.test(body.clip_id)) {
    throw new AppError("VALIDATION", "clip_id must be a valid uuid.", 400);
  }
  const parsed: FinalizeRequestBody = { clip_id: body.clip_id };

  if (body.thumb_path !== undefined) {
    if (typeof body.thumb_path !== "string" || body.thumb_path.trim() === "") {
      throw new AppError("VALIDATION", "thumb_path must be a non empty string.", 400);
    }
    parsed.thumb_path = body.thumb_path.trim();
  }
  return parsed;
}

/**
 * Confirm the uploaded object is actually present in the private bucket before
 * finalizing. storage_path is `${owner_id}/${clip_id}.mp4`; list the owner
 * folder searching for the file name.
 */
async function objectExists(
  supabase: ReturnType<typeof serviceRoleClient>,
  storagePath: string | null,
): Promise<boolean> {
  if (!storagePath) return false;
  const slash = storagePath.lastIndexOf("/");
  const folder = slash >= 0 ? storagePath.slice(0, slash) : "";
  const name = slash >= 0 ? storagePath.slice(slash + 1) : storagePath;

  const { data, error } = await supabase.storage
    .from(CLIPS_BUCKET)
    .list(folder, { search: name, limit: 100 });
  if (error) {
    throw new AppError("INTERNAL", `Failed to check storage object: ${error.message}`, 500);
  }
  return (data ?? []).some((entry) => entry.name === name);
}

/**
 * Call the service-role state machine. A benign INVALID_TRANSITION (a
 * concurrent duplicate already moved the clip past this edge) is reported to
 * the caller so the outer flow can treat it as already-handled rather than an
 * error, mirroring the payment gate's idempotent loser path.
 */
async function transition(
  supabase: ReturnType<typeof serviceRoleClient>,
  clipId: string,
  toStatus: "processing" | "ready",
): Promise<{ ok: true } | { ok: false; benign: boolean }> {
  const { error } = await supabase.rpc("clip_transition_internal", {
    p_clip_id: clipId,
    p_to_status: toStatus,
  });
  if (!error) return { ok: true };
  const mapped = appErrorFromPostgrestMessage(error.message);
  if (mapped.code === "INVALID_TRANSITION") {
    return { ok: false, benign: true };
  }
  throw mapped;
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

    let clip: LiveClip = await fetchLiveClip(supabase, body.clip_id);

    // Ownership: the finalizer is a confirm from the uploader's own session.
    if (clip.owner_id !== user.id) {
      throw new AppError("FORBIDDEN", "You can only finalize your own clip.", 403);
    }

    // Idempotent redelivery: a clip at or past `ready` is already finalized (or
    // terminal). No-op, 200, exactly like a duplicate razorpay-webhook event.
    if (clip.status !== "uploading" && clip.status !== "processing") {
      return jsonResponse(
        { clipId: clip.id, status: clip.status, outcome: "already_finalized" },
        200,
      );
    }

    // The bytes must have landed. A confirm for a clip whose object is absent
    // does not advance it (the reconcile arm rejects a truly stranded one).
    if (!(await objectExists(supabase, clip.storage_path))) {
      throw new AppError(
        "VALIDATION",
        "No uploaded video was found for this clip yet.",
        409,
      );
    }

    // Optional client-captured thumbnail path (v1 does client-side thumbs).
    if (body.thumb_path) {
      await supabase.from("clips").update({ thumb_path: body.thumb_path }).eq("id", clip.id);
    }

    // uploading -> processing (only if still uploading; a concurrent call that
    // already advanced it is benign).
    if (clip.status === "uploading") {
      const step = await transition(supabase, clip.id, "processing");
      if (step.ok) {
        clip = await fetchLiveClip(supabase, clip.id);
      } else {
        // Someone else moved it. Re-read and let the ready step below decide.
        clip = await fetchLiveClip(supabase, clip.id);
      }
    }

    // processing -> ready (the authoritative finalize). Only from `processing`;
    // if a redelivery already made it ready/beyond, report already_finalized.
    if (clip.status === "processing") {
      const step = await transition(supabase, clip.id, "ready");
      const after = await fetchLiveClip(supabase, clip.id);
      return jsonResponse(
        {
          clipId: after.id,
          status: after.status,
          outcome: step.ok ? "finalized" : "already_finalized",
        },
        200,
      );
    }

    // Reached `ready` (or beyond) via a concurrent path while we worked.
    const finalClip = await fetchLiveClip(supabase, clip.id);
    return jsonResponse(
      { clipId: finalClip.id, status: finalClip.status, outcome: "already_finalized" },
      200,
    );
  })
);
