// ATLITOS v2 — supabase/functions/get-coach-trainee-video-url/index.ts
//
// Track F. PRD-02 Player Profile Video Analytics tab
// (docs/design/COACH-TRAININGS-GAP.md gap #8/#18). Mirrors
// get-clip-playback-url's signing shape: given a coach_trainee_videos id,
// returns a short lived (TTL 300s, SIGNED_URL_TTL_SECONDS) signed download
// URL for the object in the private `clips` bucket, minted under the service
// role, AFTER checking the LIVE row.
//
// WHO GETS A URL:
//   * the caller is the video's COACH (coach_id = auth.uid())
//   * the caller is the video's PLAYER (player_id = auth.uid()), read only
// No one else, no public/guest path at all (unlike Clutch playback, this is
// never public: a trainee's review video is private between the coach and
// that one athlete).
//
// NOT deployed by this track; the integrator deploys alongside applying
// 0082_coach_trainee_videos.sql. verify_jwt stays true (default) when
// deployed: every caller here must have a real session.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient } from "../_shared/supabase.ts";
import { mintSignedClipUrl, SIGNED_URL_TTL_SECONDS } from "../_shared/clip-access.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LiveVideo {
  id: string;
  coach_id: string;
  player_id: string;
  storage_path: string | null;
}

function parseVideoId(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const videoId = (raw as Record<string, unknown>).video_id;
  if (typeof videoId !== "string" || !UUID_RE.test(videoId)) {
    throw new AppError("VALIDATION", "video_id must be a valid uuid.", 400);
  }
  return videoId;
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    const videoId = parseVideoId(await request.json().catch(() => null));
    const user = await getAuthenticatedUser(request);
    const supabase = serviceRoleClient();

    const { data: video, error } = await supabase
      .from("coach_trainee_videos")
      .select("id, coach_id, player_id, storage_path")
      .eq("id", videoId)
      .maybeSingle<LiveVideo>();
    if (error) {
      throw new AppError("INTERNAL", `Failed to load video: ${error.message}`, 500);
    }
    if (!video) {
      throw new AppError("NOT_FOUND", "Video not found.", 404);
    }
    if (video.coach_id !== user.id && video.player_id !== user.id) {
      throw new AppError("FORBIDDEN", "This video is not available.", 403);
    }

    // SEC-F3: the row's own storage_path is NOT trusted. 0082's INSERT policy
    // let a coach create a row with a chosen storage_path, bypassing the
    // upload function that derives a safe one, so the mint re-derives the only
    // prefix this row may ever point at and refuses anything else. 0088 closes
    // the policy side; this is the read-side half, and it also refuses rows
    // written before that migration is applied.
    const url = await mintSignedClipUrl(
      supabase,
      video.storage_path,
      `coach-videos/${video.coach_id}/${video.player_id}/`,
    );

    return jsonResponse(
      { videoId: video.id, url, expiresIn: SIGNED_URL_TTL_SECONDS },
      200,
    );
  })
);
