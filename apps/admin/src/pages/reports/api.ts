import { parseRpcError, type CommerceError } from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";
import type { ReportStatus } from "../moderation/api";

// Phase 4 LAUNCH Track C (CT-C, 0097_report_block.sql). The Reports Queue's
// own data lane, split out from `../moderation/api` (Track A/pre-Phase-4
// file, not this track's to widen) so `entity_type` can carry the two new
// values this phase adds without touching that file's `ReportQueueRow`.
//
// `admin_get_reported_entity(p_report_id)` (0097) is the ONLY read path onto
// a chat message's content: there is deliberately no blanket admin SELECT
// policy on `chat_messages` (Settled decision 6, PHASE-4-STATUS.md highest
// risk item 4), so a chat report's detail view goes through this one narrow,
// admin-checked, one-report-one-entity RPC instead of a direct table read. A
// user report resolves the same way (there is no dedicated "reported user"
// table row to read; the RPC's `user` arm just echoes the account's public
// name). Clip and comment reports keep the existing direct-table read
// (`clips`/`clip_comments`, both already admin-readable), unchanged from
// before this migration, so the pre-Phase-4 behaviour for those two types is
// exactly as proven.

export type ReportEntityType = "clip" | "comment" | "chat_message" | "user";

export interface ReportQueueRow {
  id: string;
  entity_type: ReportEntityType;
  entity_id: string;
  reporter_id: string;
  reason: string;
  status: ReportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export const entityTypeLabel: Record<ReportEntityType, string> = {
  clip: "Clip",
  comment: "Comment",
  chat_message: "Chat message",
  user: "User account",
};

/** The `admin_get_reported_entity` jsonb shape for a `chat_message` report. */
export interface ReportedChatMessage {
  entity_type: "chat_message";
  id: string;
  thread_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  removed_at: string | null;
  removed_reason: string | null;
}

/** The `admin_get_reported_entity` jsonb shape for a `user` report. */
export interface ReportedUser {
  entity_type: "user";
  id: string;
  name: string;
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw parseRpcError(error.message);
  return data as T;
}

/**
 * Resolves one report's entity snapshot through `admin_get_reported_entity`.
 * Used by the report detail screen for `chat_message`/`user` rows; `null` if
 * the RPC returned nothing (the underlying row was deleted since the report
 * was filed, the same "could not be loaded" case the clip/comment arms
 * already render a fallback for).
 */
export async function fetchReportedEntity(reportId: string): Promise<ReportedChatMessage | ReportedUser | null> {
  const result = await callRpc<(ReportedChatMessage | ReportedUser) | null>("admin_get_reported_entity", {
    p_report_id: reportId,
  });
  return result ?? null;
}

/**
 * Batched label lookup for the Reports Queue LIST (not the detail screen):
 * one `admin_get_reported_entity` call per chat_message/user report row,
 * mirroring the existing clip/comment `.in("id", ids)` batch reads in
 * `list.tsx`. There is no batched form of the RPC (Settled decision 6 keeps
 * it one-report-one-entity on purpose), so this is N calls for N rows of
 * those two types; the Reports Queue is an admin moderation surface with a
 * bounded pending count, not a public high-traffic list, so N small RPC
 * calls is the right trade against widening the RPC's contract.
 */
export async function fetchReportedEntitySummaries(rows: ReportQueueRow[]): Promise<Record<string, string>> {
  const targets = rows.filter((r) => r.entity_type === "chat_message" || r.entity_type === "user");
  const labels: Record<string, string> = {};
  await Promise.all(
    targets.map(async (row) => {
      try {
        const entity = await fetchReportedEntity(row.id);
        if (!entity) return;
        labels[row.entity_id] =
          entity.entity_type === "chat_message"
            ? entity.removed_at
              ? "Already removed"
              : entity.text
            : entity.name;
      } catch {
        // A failed resolve leaves this row's label to the entity_id fallback
        // the list already renders; one bad row never blanks the queue.
      }
    }),
  );
  return labels;
}

export type { CommerceError };
