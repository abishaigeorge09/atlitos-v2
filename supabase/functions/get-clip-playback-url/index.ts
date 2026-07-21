// ATLITOS v2 — supabase/functions/get-clip-playback-url/index.ts
//
// AT-96. PRD-01 FR-42, FR-45; VIDEO.md + PHASE-5-STATUS.md.
//
// The PUBLIC-callable signed-URL mint for Clutch playback. Given a clip id it
// returns a short lived (TTL 300s) signed download URL for the clip's video
// (and thumbnail), minted against the private `clips` bucket under the service
// role, AFTER checking the LIVE clip row. This is one of the two DISTINCT
// grants (the other is get-clip-moderation-url, admin only); keeping them
// separate is a phase requirement (PHASE-5-STATUS.md gate clause 5).
//
// WHO GETS A URL (checked against the live row every call):
//   * status = 'published'  -> anyone, including a guest with no session
//                              (the feed is guest browsable, FR-42/FR-3).
//   * the caller is the OWNER -> their own clip in ANY non-terminal status
//                              (uploading/processing/ready), for the profile
//                              and the immediate post-upload view (FR-45).
//   * the caller is admin/moderator -> any non-terminal clip.
//
// WHO IS REFUSED, no URL, for everyone INCLUDING the owner and admin:
//   * status = 'removed'  (a takedown; terminal)
//   * status = 'rejected' (terminal)
// This is the takedown's teeth: because the mint reads the LIVE row, the
// instant a clip is `removed` this path refuses for everyone, and any already
// minted URL stops resolving once its 300s TTL elapses (residual playability is
// bounded by the TTL, never indefinite). Verified adversarially in AT-107.
//
// Deployed with verify_jwt = false BECAUSE it is public callable: a guest has
// no user JWT. Auth is read OPTIONALLY inside (getOptionalUserId), and a valid
// session only ever GRANTS more (owner/admin), never less; an absent or invalid
// token simply means "treated as a guest", who can still see published clips.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import {
  fetchLiveClip,
  getOptionalUserId,
  isAdminOrModerator,
  mintSignedClipUrl,
  serviceRoleClient,
  SIGNED_URL_TTL_SECONDS,
} from "../_shared/clip-access.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseClipId(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const clipId = (raw as Record<string, unknown>).clip_id;
  if (typeof clipId !== "string" || !UUID_RE.test(clipId)) {
    throw new AppError("VALIDATION", "clip_id must be a valid uuid.", 400);
  }
  return clipId;
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    const clipId = parseClipId(await request.json().catch(() => null));
    const supabase = serviceRoleClient();

    // The LIVE row, every call. Never a cached or stored decision.
    const clip = await fetchLiveClip(supabase, clipId);

    // Terminal states refuse for EVERYONE, before any owner/admin escalation.
    if (clip.status === "removed" || clip.status === "rejected") {
      throw new AppError("FORBIDDEN", "This clip is not available.", 403);
    }

    if (clip.status !== "published") {
      // Non-published (uploading/processing/ready): owner or admin only.
      const userId = await getOptionalUserId(request);
      const isOwner = userId !== null && userId === clip.owner_id;
      const isAdmin = isOwner ? false : await isAdminOrModerator(supabase, userId);
      if (!isOwner && !isAdmin) {
        throw new AppError("FORBIDDEN", "This clip is not available.", 403);
      }
    }

    const videoUrl = await mintSignedClipUrl(supabase, clip.storage_path);
    let thumbUrl: string | null = null;
    if (clip.thumb_path) {
      thumbUrl = await mintSignedClipUrl(supabase, clip.thumb_path);
    }

    return jsonResponse(
      {
        clipId: clip.id,
        url: videoUrl,
        thumbUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
        status: clip.status,
      },
      200,
    );
  })
);
