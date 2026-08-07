// ATLITOS v2 — supabase/functions/get-clip-playback-url/mint.ts
//
// CT-1 (PHASE-3-STATUS.md, LAUNCH Phase 3 Track B): the batch playback path
// needs a DIFFERENT signed-URL TTL for `thumb` (3600s) than the existing
// `video` mint (300s, `SIGNED_URL_TTL_SECONDS` in `_shared/clip-access.ts`).
// `_shared/clip-access.ts` is consumed by two other functions this track does
// not own (`get-clip-moderation-url`, `get-coach-trainee-video-url`), so
// rather than widen that shared file's signature, this local helper
// duplicates the small "mint against the private clips bucket, treat a
// missing object as NOT_FOUND not a 500" logic with an explicit TTL. Scoped
// to this function's own directory only (used by both `get-clip-playback-url`
// and the sibling `get-clip-playback-urls`, which delegates to `handler.ts`
// here).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "../_shared/app-error.ts";
import { CLIPS_BUCKET } from "../_shared/clip-access.ts";

/** Batch `kind: "thumb"` TTL (CT-1). Longer than video: posters are cheap to over-cache and the grid wants fewer re-mints. */
export const THUMB_URL_TTL_SECONDS = 3600;

/** Batch `kind: "video"` TTL (CT-1), matches the existing single-mint `SIGNED_URL_TTL_SECONDS`. */
export const VIDEO_URL_TTL_SECONDS = 300;

function isObjectNotFoundError(error: { message?: string; statusCode?: string; status?: number }): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("not found") || message.includes("not_found")) return true;
  const status = error.statusCode ?? (typeof error.status === "number" ? String(error.status) : undefined);
  return status === "404";
}

/**
 * Mint a signed download URL for `objectPath` at an explicit `ttlSeconds`,
 * against the private `clips` bucket, under the service role. Never stored.
 * A missing storage object surfaces as NOT_FOUND (404), never a 500, mirroring
 * `mintSignedClipUrl`'s reasoning: an un-uploaded clip is an expected data
 * condition, not a server fault.
 */
export async function mintSignedUrlWithTtl(
  supabase: SupabaseClient,
  objectPath: string | null,
  ttlSeconds: number,
): Promise<string> {
  if (!objectPath) {
    throw new AppError("NOT_FOUND", "Clip has no stored object yet.", 404);
  }
  const { data, error } = await supabase.storage
    .from(CLIPS_BUCKET)
    .createSignedUrl(objectPath, ttlSeconds);

  if (error || !data?.signedUrl) {
    if (error && isObjectNotFoundError(error)) {
      throw new AppError("NOT_FOUND", "Clip object is not available yet.", 404);
    }
    throw new AppError(
      "INTERNAL",
      `Failed to mint signed url: ${error?.message ?? "unknown error"}`,
      500,
    );
  }
  return data.signedUrl;
}
