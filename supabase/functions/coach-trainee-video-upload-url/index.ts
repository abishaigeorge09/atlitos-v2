// ATLITOS v2 — supabase/functions/coach-trainee-video-upload-url/index.ts
//
// Track F. PRD-02 Player Profile Video Analytics tab (design node
// 1047:16588, docs/design/COACH-TRAININGS-GAP.md gap #8/#18).
//
// The upload-start half of coach trainee video review, mirroring
// stream-upload-url's shape one to one (VIDEO.md's Supabase Storage adapter
// pattern): the coach's own JWT calls this after picking a video and a
// caption for one trainee. It:
//
//   1. Verifies the caller is a coach and the target player_id is actually
//      one of theirs (has at least one session together), so a coach cannot
//      mint an upload row against an athlete they have never coached.
//   2. Creates the caller's OWN coach_trainee_videos row (coach_id from the
//      validated JWT, never client-supplied).
//   3. Mints a SIGNED UPLOAD URL against the private `clips` bucket (0042),
//      under a `coach-videos/{coach_id}/{player_id}/{id}.mp4` prefix. No
//      bytes pass through this function. The bucket has zero direct-access
//      storage.objects policies (0042), so this signed-upload token is the
//      only way bytes can land there.
//   4. Persists the object PATH (never a resolved URL) on the row.
//
// NOT deployed by this track; the integrator deploys alongside applying
// 0082_coach_trainee_videos.sql.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient } from "../_shared/supabase.ts";
import { CLIPS_BUCKET } from "../_shared/clip-access.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTION_MAX = 2000;

interface UploadUrlRequestBody {
  player_id: string;
  caption?: string;
}

interface VideoRow {
  id: string;
  coach_id: string;
  player_id: string;
}

function parseRequestBody(raw: unknown): UploadUrlRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;

  const playerId = body.player_id;
  if (typeof playerId !== "string" || !UUID_RE.test(playerId)) {
    throw new AppError("VALIDATION", "player_id must be a valid uuid.", 400);
  }

  const parsed: UploadUrlRequestBody = { player_id: playerId };

  if (body.caption !== undefined) {
    if (typeof body.caption !== "string" || body.caption.length > CAPTION_MAX) {
      throw new AppError("VALIDATION", "Caption is too long.", 400);
    }
    parsed.caption = body.caption.trim() || undefined;
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

    // The target player must actually be one of this coach's trainees
    // (RLS.md scoping rule: never trust a client-supplied pair without
    // checking it server side). `sessions` is the only coach-player link.
    const { count: sessionCount, error: sessionError } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", user.id)
      .eq("player_id", body.player_id);
    if (sessionError) {
      throw new AppError("INTERNAL", `Failed to verify trainee: ${sessionError.message}`, 500);
    }
    if (!sessionCount || sessionCount === 0) {
      throw new AppError("FORBIDDEN", "This athlete is not one of your trainees.", 403);
    }

    const { data: created, error: insertError } = await supabase
      .from("coach_trainee_videos")
      .insert({
        coach_id: user.id,
        player_id: body.player_id,
        caption: body.caption ?? null,
      })
      .select("id, coach_id, player_id")
      .single<VideoRow>();
    if (insertError || !created) {
      throw new AppError("INTERNAL", `Failed to create video row: ${insertError?.message}`, 500);
    }

    // Owner-scoped path prefix, matching 0082's comment. No storage.objects
    // policy ever authorizes a direct fetch; access is signed-URL only.
    const objectPath = `coach-videos/${created.coach_id}/${created.player_id}/${created.id}.mp4`;

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

    const { error: pathError } = await supabase
      .from("coach_trainee_videos")
      .update({ storage_path: objectPath })
      .eq("id", created.id);
    if (pathError) {
      throw new AppError("INTERNAL", `Failed to persist storage path: ${pathError.message}`, 500);
    }

    return jsonResponse(
      {
        videoId: created.id,
        uploadUrl: signed.signedUrl,
        token: signed.token,
        path: objectPath,
        bucket: CLIPS_BUCKET,
      },
      200,
    );
  })
);
