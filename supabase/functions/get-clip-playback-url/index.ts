// ATLITOS v2 — supabase/functions/get-clip-playback-url/index.ts
//
// AT-96. PRD-01 FR-42, FR-45; VIDEO.md + PHASE-5-STATUS.md.
// LAUNCH Phase 3 Track B (P1-1, P1-5's rate-limit half; PHASE-3-STATUS.md
// CT-1, CT-2): extended, in place, with a batch body and a per-IP rate limit.
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
// URL stops resolving once its TTL elapses (residual playability is bounded,
// never indefinite). The FB-004 widening is scoped strictly to owner-of-row
// (auth.uid() == clip.owner_id): a takedown still hides the clip from everyone
// else, it just no longer hides the owner's own clip from the owner. Verified
// adversarially in AT-107 (and re-proven for FB-004).
//
// BATCH BODY (CT-1, new this phase). `{ clip_ids: string[], kind?: "video" |
// "thumb" }` (max 24 ids) returns `{ urls, failed }`, one entry per id, partial
// failure INCLUDED as 200 (a forbidden id lands in `failed`, never aborts the
// batch). Same authz decision as the legacy single-id body, same live-row read
// every call. See `handler.ts` for the shared implementation.
//
// RATE LIMIT (CT-1, CT-2, new this phase). A per-IP token bucket in front of
// BOTH bodies: 60 requests/60s. Fails OPEN on a rate-limit RPC error (never a
// 500 on this read path); see `_shared/rate-limit.ts`.
//
// Deployed with verify_jwt = false BECAUSE it is public callable: a guest has
// no user JWT. Auth is read OPTIONALLY inside (getOptionalUserId), and a valid
// session only ever GRANTS more (owner/admin), never less; an absent or invalid
// token simply means "treated as a guest", who can still see published clips.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { withErrorHandling } from "../_shared/http.ts";
import { handlePlaybackRequest } from "./handler.ts";

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;
    return handlePlaybackRequest(request);
  })
);
