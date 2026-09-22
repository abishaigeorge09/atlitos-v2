import type { Db } from "@atlitos/types";

import { supabaseClient } from "../../providers/supabaseClient";

// Who applied, by name, for both the queue and the detail screen.
//
// This lives in one file because it was written twice and drifted: the detail
// screen titled itself with a raw uuid for every applicant type, and when that
// was fixed the list kept its own half of the logic and went on showing a uuid
// in the APPLICANT column. Found twice by the ux-critic on the A2 gate,
// 2026-09-22, which is what the house rule means by sweeping for the class
// rather than fixing the instance.
//
// `applicant_id` points at a different table per type, so the lookup is keyed
// on the type rather than guessed. No payload carries a plain `name`: a venue
// carries `venue_name`, a UPA application carries `school`.

const PAYLOAD_NAME_KEYS = ["name", "venue_name", "school", "organisation", "title"] as const;

/** A name carried by the request itself, with no round trip. */
export function nameFromPayload(row: Db.VerificationRequestRow): string | null {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  for (const key of PAYLOAD_NAME_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Names for a page of requests, as a map of `applicant_id` to name. One query
 * per referenced table, never one per row. Anything unresolved is simply
 * absent from the map, and the caller shows the id.
 */
export async function resolveApplicantNames(
  rows: Db.VerificationRequestRow[],
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const row of rows) {
    const fromPayload = nameFromPayload(row);
    if (fromPayload) names[row.applicant_id] = fromPayload;
  }

  const unresolved = rows.filter((row) => !names[row.applicant_id]);
  const venueIds = [...new Set(unresolved.filter((r) => r.applicant_type === "venue").map((r) => r.applicant_id))];
  const userIds = [...new Set(unresolved.filter((r) => r.applicant_type !== "venue").map((r) => r.applicant_id))];

  const [venues, users] = await Promise.all([
    venueIds.length > 0
      ? supabaseClient.from("venues").select("id,name").in("id", venueIds)
      : Promise.resolve({ data: null }),
    userIds.length > 0
      ? supabaseClient.from("users").select("id,name").in("id", userIds)
      : Promise.resolve({ data: null }),
  ]);

  for (const source of [venues.data, users.data]) {
    for (const record of (source as { id: string; name: string | null }[] | null) ?? []) {
      if (record.name) names[record.id] = record.name;
    }
  }
  return names;
}

/** One request's name, for a detail screen. */
export async function resolveApplicantName(row: Db.VerificationRequestRow): Promise<string | null> {
  const names = await resolveApplicantNames([row]);
  return names[row.applicant_id] ?? null;
}
