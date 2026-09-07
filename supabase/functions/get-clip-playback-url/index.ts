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
//   * the caller is the OWNER -> their own clip in ANY status, terminal
//                              included (uploading/processing/ready AND
//                              rejected/removed). The owner opening their own
//                              clip from their profile must always be able to
//                              watch it back regardless of moderation outcome
//                              (FR-45, FB-004): a rejected/pending upload that
//                              silently refused to play was the founder-review
//                              bug this function fixes.
//   * the caller is admin/moderator -> any NON-terminal clip.
//
// WHO IS REFUSED, no URL:
//   * status = 'removed'/'rejected' -> everyone EXCEPT the clip's own owner.
// This is the takedown's teeth, intact for the whole world: because the mint
// reads the LIVE row, the instant a clip is `removed` this path refuses for
// every non-owner (public, other members, and even an admin here, who previews
// through get-clip-moderation-url instead), and any already minted non-owner
// URL stops resolving once its 300s TTL elapses (residual playability is
// bounded by the TTL, never indefinite). The FB-004 widening is scoped strictly
// to owner-of-row (auth.uid() == clip.owner_id): a takedown still hides the clip
// from everyone else, it just no longer hides the owner's own clip from the
// owner. Verified adversarially in AT-107 (and re-proven for FB-004).
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

    if (clip.status !== "published") {
      // The OWNER always gets their own clip, any status, terminal included
      // (FB-004). Everyone else: a terminal clip (removed/rejected) refuses
      // outright (takedown teeth), and a non-terminal clip is previewable only
      // by an admin/moderator. Resolve owner first so the owner branch never
      // depends on the moderation/terminal checks below.
      const userId = await getOptionalUserId(request);
      const isOwner = userId !== null && userId === clip.owner_id;
      if (!isOwner) {
        if (clip.status === "removed" || clip.status === "rejected") {
          throw new AppError("FORBIDDEN", "This clip is not available.", 403);
        }
        const isAdmin = await isAdminOrModerator(supabase, userId);
        if (!isAdmin) {
          throw new AppError("FORBIDDEN", "This clip is not available.", 403);
        }
      }
    }

    // Both mints are pinned to THIS clip's owner folder, the prefix
    // stream-upload-url derives storage_path under. A row poisoned before the
    // SEC-F1 guard landed (or by any future write path) therefore still
    // refuses here rather than minting another owner's object.
    const ownerPrefix = `${clip.owner_id}/`;
    const videoUrl = await mintSignedClipUrl(supabase, clip.storage_path, ownerPrefix);
    let thumbUrl: string | null = null;
    if (clip.thumb_path) {
      thumbUrl = await mintSignedClipUrl(supabase, clip.thumb_path, ownerPrefix);
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
