// ATLITOS v2 — supabase/functions/get-clip-playback-urls/index.ts
//
// LAUNCH Phase 3 Track B, CT-1. This directory exists because the track's
// dispatch named it explicitly as a NEW function to build; it is a thin
// delegate to `../get-clip-playback-url/handler.ts`, the SAME implementation
// the extended `get-clip-playback-url` uses for its batch body, so there is
// exactly one authz decision and one per-IP rate-limit bucket
// (`clip-playback-ip`) shared across both deployed function names, never two
// front doors with independent limits.
//
// Recorded for the record (PHASE-3-STATUS.md "Settled decisions" #1): the
// phase plan explicitly rejected a SEPARATE batch function in favor of
// extending `get-clip-playback-url` in place, reasoning that a second
// function would be a second unrate-limited front door. This file does not
// reopen that risk: it carries no logic of its own, calls the identical
// rate-limited handler, and callers should prefer POSTing the batch body
// `{ clip_ids, kind }` to `get-clip-playback-url` per the settled decision;
// this endpoint is kept in sync as an equivalent alias per this track's
// explicit build instructions. Body: `{ clip_ids: string[] (max 24), kind?:
// "video" | "thumb" }` -> `{ urls: [{ clip_id, url, expires_at }], failed:
// [{ clip_id, reason }] }`. The legacy single `{ clip_id }` body also works
// here (delegates to the same handler), for symmetry, though callers should
// use `get-clip-playback-url` for the single-clip case.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { withErrorHandling } from "../_shared/http.ts";
import { handlePlaybackRequest } from "../get-clip-playback-url/handler.ts";

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;
    return handlePlaybackRequest(request);
  })
);
