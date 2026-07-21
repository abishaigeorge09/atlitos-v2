import type { ClipStatus, Sport } from "@atlitos/types";

import { parseRpcError, type CommerceError } from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";

// AT-102 / AT-103. The one place apps/admin talks to the Clutch moderation back
// end, so the Moderation Queue and Reports Queue cannot each invent their own
// call shape. Mirrors pages/commerce/api.ts exactly.
//
// EVERY state change routes through a Track A admin RPC, never a table write:
//
//   * `moderate_clip(clip_id, action, reason)` (0043) approves, rejects, or
//     takes down a clip. It is SECURITY DEFINER, gates on has_role INSIDE, and
//     writes exactly one audit_log row per accepted transition (audit_log
//     carries no authenticated write grant, so a client cannot write it).
//   * `resolve_report(report_id, action, reason)` (0043) removes or dismisses a
//     reported clip. A takedown reuses moderate_clip's `remove` path, so it is
//     audited and the creator notified exactly as a direct takedown is.
//
// The inline preview is the admin-only signed URL grant `get-clip-moderation-url`
// (Track B), NOT a public URL and NOT the stored path (the bucket is private).
// A fresh 300 second signed URL is minted against the LIVE clip row on every
// open; nothing here persists a resolved URL. This is the takedown's teeth: the
// instant a clip is `removed` the mint refuses for everyone.
//
// There is no service role key in this bundle (PRD-04 FR-2); every call carries
// the signed in admin's own JWT. Reusing commerce/api's `parseRpcError` keeps
// the "surface the real refusal, do not swallow it" behaviour identical.

export type { CommerceError };

/** A row of the Moderation Queue: a clip pending review (uploading/processing/ready). */
export interface ClipQueueRow {
  id: string;
  owner_id: string;
  status: ClipStatus;
  caption: string;
  sport: Sport;
  thumb_path: string | null;
  rejection_reason: string | null;
  likes_count: number;
  comment_count: number;
  created_at: string;
}

/**
 * A report row. NOTE: the live DB `report_status` enum is
 * `pending | actioned | dismissed` (0041). The shared `@atlitos/types`
 * ReportStatus is stale (`pending | dismissed | removed`), so this file uses
 * its own accurate union rather than the drifted shared type.
 */
export type ReportStatus = "pending" | "actioned" | "dismissed";

export interface ReportQueueRow {
  id: string;
  entity_type: "clip" | "comment";
  entity_id: string;
  reporter_id: string;
  reason: string;
  status: ReportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** The admin-only signed preview grant response (Track B contract). */
export interface ModerationUrl {
  clipId: string;
  url: string;
  thumbUrl: string | null;
  expiresIn: number;
  status: ClipStatus;
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw parseRpcError(error.message);
  return data as T;
}

/**
 * FR-29 approve, FR-30 reject. `reason` is required by the RPC for reject, not
 * only by the form. Deliberately does NOT decide whether the step is legal:
 * `clip_transition_internal` owns the machine and raises INVALID_TRANSITION, so
 * a refusal is the database's guarantee, not this file's opinion.
 */
export const moderationApi = {
  approveClip: (clipId: string) =>
    callRpc<unknown>("moderate_clip", { p_clip_id: clipId, p_action: "approve", p_reason: null }),

  rejectClip: (clipId: string, reason: string) =>
    callRpc<unknown>("moderate_clip", { p_clip_id: clipId, p_action: "reject", p_reason: reason }),

  /** FR-32 takedown: published to removed, via resolve_report's remove path. */
  removeReport: (reportId: string, reason: string) =>
    callRpc<unknown>("resolve_report", { p_report_id: reportId, p_action: "remove", p_reason: reason }),

  /** FR-32 dismissal: the clip is untouched, only the report row resolves. */
  dismissReport: (reportId: string, reason: string) =>
    callRpc<unknown>("resolve_report", { p_report_id: reportId, p_action: "dismiss", p_reason: reason }),
};

/**
 * FR-28. Mints the admin-only signed preview URL for a not yet published clip
 * through the `get-clip-moderation-url` edge function. 403 for non admins and
 * for removed/rejected clips, surfaced as a real error rather than swallowed
 * (the same unwrap advanceOrder does for a non 2xx edge response).
 */
export async function fetchModerationUrl(clipId: string): Promise<ModerationUrl> {
  const { data, error } = await supabaseClient.functions.invoke("get-clip-moderation-url", {
    body: { clip_id: clipId },
  });

  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: CommerceError };
        if (body?.error?.code) throw body.error;
      } catch (parsed) {
        if (parsed && typeof parsed === "object" && "code" in parsed) throw parsed;
      }
    }
    throw { code: "INTERNAL", message: error.message } satisfies CommerceError;
  }

  return data as ModerationUrl;
}
