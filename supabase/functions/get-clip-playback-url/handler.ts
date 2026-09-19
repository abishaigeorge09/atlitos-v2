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
// RATE LIMIT (CT-1, CT-2, re-keyed by SCALE-MEDIA M-1). Two token buckets in
// FRONT of both the legacy and batch bodies: `clip-playback-user` 60/60s for a
// signed-in caller keyed on their verified user id, and `clip-playback-ip`
// 600/60s for anonymous callers keyed on the client IP. See the constants
// below for why the single per-IP bucket had to go. FAILS OPEN
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

// SCALE-MEDIA M-1. The throttle used to key EVERY caller on
// `x-forwarded-for[0]`. Live `edge_rate_limits` rows under `clip-playback-ip`
// are Indian carrier CGNAT addresses (49.43.218.96, 223.228.125.206 and
// 223.228.114.206 out of the same /16), so real users share one key: at a
// mixed 23 requests/minute/user the 60/60s budget is exhausted by THREE
// concurrent users behind one egress IP, while global aggregate load at 10,000
// users is only about 3.7 requests/second. It refused legitimate traffic at
// roughly one four-hundredth of any real capacity limit.
//
// Signed-in callers are now keyed on their user id, which is the identity the
// abuse limit actually cares about and which NAT cannot collide. Anonymous
// callers still key on IP, because a guest has no id, but that bucket is sized
// for CGNAT (600/60s = 10 requests/second from one egress address) instead of
// for one person. The protection stays real in both cases: a single abusive
// signed-in account is still capped at 60/60s, and a single IP can no longer
// hide behind "it might be a NAT" for more than 10 requests a second.
const RATE_LIMIT_USER_BUCKET = "clip-playback-user";
const RATE_LIMIT_IP_BUCKET = "clip-playback-ip";
const RATE_LIMIT_USER_MAX = 60;
const RATE_LIMIT_IP_MAX = 600;
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

/**
 * The one authz decision, shared by the legacy and batch paths (see header).
 * Returns NULL when the caller may have a URL, or the `failed` reason string
 * when they may not.
 *
 * This used to return a `{ ok: true } | { ok: false; reason }` union, which
 * Deno's TypeScript did not narrow at the call site: `deno check` on this
 * function has been failing with TS2339 "Property 'reason' does not exist"
 * since the union was introduced, verified by running it against the unmodified
 * base branch. Nothing in the repo runs `deno check` (there is no deno task in
 * turbo.json and no CI), so a red typecheck on every edge function in this
 * directory went unnoticed. A nullable reason has no discriminant to narrow and
 * says exactly the same thing.
 */
async function resolveClipAccess(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clip: LiveClip,
  userId: string | null,
): Promise<string | null> {
  if (clip.status === "published") return null;

  const isOwner = userId !== null && userId === clip.owner_id;
  if (isOwner) return null;

  if (clip.status === "removed" || clip.status === "rejected") {
    return "not_available";
  }
  const isAdmin = await isAdminOrModerator(supabase, userId);
  if (isAdmin) return null;
  return "not_available";
}

async function handleLegacy(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clipId: string,
  userId: string | null,
): Promise<Response> {
  const clip = await fetchLiveClip(supabase, clipId);

  if (clip.status !== "published") {
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
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clipIds: string[],
  kind: Kind,
  userId: string | null,
): Promise<Response> {
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

      const refusalReason = await resolveClipAccess(supabase, clip, userId);
      if (refusalReason !== null) {
        failed.push({ clip_id: clipId, reason: refusalReason });
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

  // M-1. Resolve the caller ONCE, before the throttle, and hand the result to
  // whichever body runs. This is the same verified `getUser` the authz already
  // depended on, never a locally decoded `sub`: an unverified id in the key
  // would let a caller mint a fresh bucket per forged token and remove the
  // limit entirely. Resolving it here also means the batch path and the
  // owner/admin legacy path each do ONE fewer round trip than before, which
  // pays for the one a guest on the published path now adds.
  const userId = await getOptionalUserId(request);

  const rl = userId
    ? await takeRateLimitToken(
      supabase,
      RATE_LIMIT_USER_BUCKET,
      userId,
      RATE_LIMIT_USER_MAX,
      RATE_LIMIT_WINDOW_SECONDS,
    )
    : await takeRateLimitToken(
      supabase,
      RATE_LIMIT_IP_BUCKET,
      getClientIp(request),
      RATE_LIMIT_IP_MAX,
      RATE_LIMIT_WINDOW_SECONDS,
    );
  if (!rl.allowed) {
    // Only reached when the RPC genuinely returned false (window exhausted);
    // an RPC error takes the `failedOpen` branch above and falls through to
    // serve the request instead, per the fail-open read-path rule.
    return rateLimitedResponse(RATE_LIMIT_WINDOW_SECONDS, corsHeaders);
  }

  if (parsed.mode === "batch") {
    return handleBatch(supabase, parsed.clipIds, parsed.kind, userId);
  }
  return handleLegacy(supabase, parsed.clipId, userId);
}
