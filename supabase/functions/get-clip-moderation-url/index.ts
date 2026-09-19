// ATLITOS v2 — supabase/functions/get-clip-moderation-url/index.ts
//
// AT-96. PRD-04 FR-28; VIDEO.md + PHASE-5-STATUS.md.
//
// The ADMIN/MODERATOR-only signed-URL mint for Clutch. The Moderation Queue
// (PRD-04 3.6) must preview a clip that is NOT yet published (typically `ready`,
// awaiting an approve/reject decision), which the public get-clip-playback-url
// grant deliberately refuses to a non-owner. This is the ONLY path to preview
// an unpublished clip, and it is the DISTINCT second grant the phase requires
// (PHASE-5-STATUS.md gate clause 5): the two mints never share a code path.
//
// Returns the same short lived (TTL 300s) signed URL shape, minted against the
// private `clips` bucket under the service role, AFTER checking the LIVE row:
//   * caller is NOT admin/moderator -> FORBIDDEN, no URL.
//   * clip is `removed` or `rejected` -> FORBIDDEN, no URL, even for an admin.
//     A takedown is a takedown for everyone; the moderation preview does not
//     resurrect a removed clip. (A rejected clip's own uploader still sees it
//     via the public owner grant; the moderation queue does not.)
//   * otherwise (uploading/processing/ready/published) -> a fresh signed URL.
//
// Deployed with verify_jwt = true: only an authenticated caller can reach it,
// and the role check inside is what actually authorizes.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser } from "../_shared/supabase.ts";
import {
  fetchLiveClip,
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
    const user = await getAuthenticatedUser(request);
    const supabase = serviceRoleClient();

    // Admin/moderator only. A normal user is refused before the clip is loaded.
    if (!(await isAdminOrModerator(supabase, user.id))) {
      throw new AppError("FORBIDDEN", "Admin or moderator role required.", 403);
    }

    // The LIVE row, every call.
    const clip = await fetchLiveClip(supabase, clipId);

    // Terminal states refuse even for an admin: a takedown is not undone by a
    // moderation preview.
    if (clip.status === "removed" || clip.status === "rejected") {
      throw new AppError("FORBIDDEN", "This clip is not available.", 403);
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
