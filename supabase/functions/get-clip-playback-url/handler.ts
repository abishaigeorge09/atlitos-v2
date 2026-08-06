// ATLITOS v2 — supabase/functions/get-clip-playback-url/handler.ts
//
// AT-96 (legacy single-clip mint) + LAUNCH Phase 3 Track B, CT-1 (batch mint).
// PHASE-3-STATUS.md "Settled decisions" #1: batch playback is meant to be
// ONE front door (this function, extended), not a second unthrottled route.
// This module IS that one front door: `index.ts` in this directory (legacy
// path, deployed as `get-clip-playback-url`) and the sibling directory
// `get-clip-playback-urls/index.ts` (deployed as a second function, per this
// track's explicit dispatch) both call `handlePlaybackRequest` here, so
// there is exactly one authz/rate-limit code path regardless of which
// deployed function name a caller hits, and the per-IP token bucket (below)
// is shared across both names, not doubled. See `get-clip-playback-urls/index.ts`
// for the one-line note on why that directory exists alongside the
// "extend, don't duplicate" decision.
//
// WHO GETS A URL, same rule for both the legacy and batch bodies (AT-96,
// re-verified adversarially, FB-004):
//   * status = 'published' -> anyone, including a guest with no session.
//   * the caller is the OWNER -> their own clip in ANY status, terminal
//     included (FR-45, FB-004).
//   * the caller is admin/moderator -> any NON-terminal clip.
//   * status = 'removed'/'rejected' -> everyone EXCEPT the owner, refused.
//
// RATE LIMIT (CT-1, CT-2). One per-IP token bucket, `clip-playback-ip`,
// 60 requests/60s, in FRONT of both the legacy and batch bodies. FAILS OPEN
// on a rate-limit RPC error (`_shared/rate-limit.ts`): a DB hiccup on the
// throttle itself must never turn the public playback feed into a 500. The
// existing clip authz above is unaffected by any of this: throttling is a
// scale guard, never a security boundary.

import { AppError } from "../_shared/app-error.ts";
import { jsonResponse } from "../_shared/http.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  fetchLiveClip,
  getOptionalUserId,
  isAdminOrModerator,
  mintSignedClipUrl,
  serviceRoleClient,
  SIGNED_URL_TTL_SECONDS,
  type LiveClip,
} from "../_shared/clip-access.ts";
import { getClientIp, rateLimitedResponse, takeRateLimitToken } from "../_shared/rate-limit.ts";
import { mintSignedUrlWithTtl, THUMB_URL_TTL_SECONDS, VIDEO_URL_TTL_SECONDS } from "./mint.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_LIMIT_BUCKET = "clip-playback-ip";
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;
export const BATCH_MAX_CLIP_IDS = 24;

type Kind = "video" | "thumb";

type ParsedBody =
  | { mode: "legacy"; clipId: string }
  | { mode: "batch"; clipIds: string[]; kind: Kind };

function parseBody(raw: unknown): ParsedBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;

  if (Array.isArray(body.clip_ids)) {
    const rawIds = body.clip_ids;
    if (rawIds.length === 0) {
      throw new AppError("VALIDATION", "clip_ids must be a non empty array.", 400);
    }
    if (rawIds.length > BATCH_MAX_CLIP_IDS) {
      throw new AppError(
        "BATCH_TOO_LARGE",
        `clip_ids may include at most ${BATCH_MAX_CLIP_IDS} entries.`,
        400,
      );
    }
    const clipIds: string[] = [];
    for (const entry of rawIds) {
      if (typeof entry !== "string" || !UUID_RE.test(entry)) {
        throw new AppError("VALIDATION", "Each clip_ids entry must be a valid uuid.", 400);
      }
      clipIds.push(entry);
    }

    let kind: Kind = "video";
    if (body.kind === "thumb" || body.kind === "video") {
      kind = body.kind;
    } else if (body.kind !== undefined) {
      throw new AppError("VALIDATION", "kind must be \"video\" or \"thumb\".", 400);
    }

    return { mode: "batch", clipIds, kind };
  }

  const clipId = body.clip_id;
  if (typeof clipId !== "string" || !UUID_RE.test(clipId)) {
    throw new AppError("VALIDATION", "clip_id must be a valid uuid.", 400);
  }
  return { mode: "legacy", clipId };
}

/** The one authz decision, shared by the legacy and batch paths (see header). */
async function resolveClipAccess(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clip: LiveClip,
  userId: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (clip.status === "published") return { ok: true };

  const isOwner = userId !== null && userId === clip.owner_id;
  if (isOwner) return { ok: true };

  if (clip.status === "removed" || clip.status === "rejected") {
    return { ok: false, reason: "not_available" };
  }
  const isAdmin = await isAdminOrModerator(supabase, userId);
  if (isAdmin) return { ok: true };
  return { ok: false, reason: "not_available" };
}

async function handleLegacy(
  request: Request,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clipId: string,
): Promise<Response> {
  const clip = await fetchLiveClip(supabase, clipId);

  if (clip.status !== "published") {
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
}

interface BatchUrlEntry {
  clip_id: string;
  url: string;
  expires_at: string;
}
interface BatchFailedEntry {
  clip_id: string;
  reason: string;
}

async function handleBatch(
  request: Request,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clipIds: string[],
  kind: Kind,
): Promise<Response> {
  const userId = await getOptionalUserId(request);
  const ttl = kind === "thumb" ? THUMB_URL_TTL_SECONDS : VIDEO_URL_TTL_SECONDS;

  const urls: BatchUrlEntry[] = [];
  const failed: BatchFailedEntry[] = [];

  // Independent per-clip resolution: one clip's failure (not found, forbidden,
  // no object yet) lands in `failed`, never aborts the batch (CT-1: "partial
  // failure is 200 with entries in failed").
  await Promise.all(
    clipIds.map(async (clipId) => {
      let clip: LiveClip;
      try {
        clip = await fetchLiveClip(supabase, clipId);
      } catch (err) {
        failed.push({ clip_id: clipId, reason: reasonFor(err) });
        return;
      }

      const access = await resolveClipAccess(supabase, clip, userId);
      if (!access.ok) {
        failed.push({ clip_id: clipId, reason: access.reason });
        return;
      }

      const path = kind === "thumb" ? clip.thumb_path : clip.storage_path;
      try {
        const url = await mintSignedUrlWithTtl(supabase, path, ttl);
        urls.push({
          clip_id: clipId,
          url,
          expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
        });
      } catch (err) {
        failed.push({ clip_id: clipId, reason: reasonFor(err) });
      }
    }),
  );

  return jsonResponse({ urls, failed }, 200);
}

function reasonFor(err: unknown): string {
  if (err instanceof AppError) return err.code.toLowerCase();
  return "error";
}

/**
 * The one entry point both deployed functions call. Applies the CT-2 per-IP
 * rate limit, then routes to the legacy or batch body.
 */
export async function handlePlaybackRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError("VALIDATION", "Only POST is supported.", 405);
  }

  const parsed = parseBody(await request.json().catch(() => null));

  const supabase = serviceRoleClient();

  const ip = getClientIp(request);
  const rl = await takeRateLimitToken(
    supabase,
    RATE_LIMIT_BUCKET,
    ip,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (!rl.allowed) {
    // Only reached when the RPC genuinely returned false (window exhausted);
    // an RPC error takes the `failedOpen` branch above and falls through to
    // serve the request instead, per the fail-open read-path rule.
    return rateLimitedResponse(RATE_LIMIT_WINDOW_SECONDS, corsHeaders);
  }

  if (parsed.mode === "batch") {
    return handleBatch(request, supabase, parsed.clipIds, parsed.kind);
  }
  return handleLegacy(request, supabase, parsed.clipId);
}
