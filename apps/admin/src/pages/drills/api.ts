import type { Db, DrillDifficulty, Sport } from "@atlitos/types";

import { parseRpcError, type CommerceError } from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";

// AT-133, PRD-04 FR-49/FR-50/FR-51. The one place apps/admin talks to the drill
// authoring back end, so the Drill List, Create and Edit screens cannot each
// invent their own call shape. Same posture as pages/commerce/api.ts.
//
// EVERY drill mutation routes through a Track B admin RPC, never a table write:
//
//   * `admin_upsert_drill(p_id, ...)` (0061) creates (p_id null) or edits
//     (p_id set) a drill. It is SECURITY DEFINER, gates on has_role('admin')
//     INSIDE, validates xp_value > 0, and writes exactly one audit_log row per
//     accepted mutation (drill.create / drill.update). audit_log carries no
//     authenticated write grant, so a client cannot write it directly.
//   * `admin_set_drill_active(p_id, p_active)` (0061) flips the active flag and
//     writes exactly one audit_log row (drill.activate / drill.deactivate). A
//     content edit never touches active, so activation is its own audited act.
//
// A direct client `.update()` on drills.active or drills.xp_value from the
// browser is deliberately NOT used even though 0058's admin write policy would
// pass it, because that would change the catalog and leave no audit trail.
//
// There is no service role key in this bundle (PRD-04 FR-2); every call carries
// the signed in admin's own JWT. Reusing commerce/api's parseRpcError keeps the
// "surface the real refusal, do not swallow it" behaviour identical.
//
// PERMISSIVE-OR: `drills` carries an anon-inclusive public SELECT policy (0058),
// so an unscoped read returns EVERY drill including inactive ones. The admin
// Drill List is the ONE surface allowed to see inactive drills, so its base
// read is intentionally unfiltered on active; but every narrowing the admin
// chooses (sport, difficulty, active) is applied as its OWN explicit filter
// here rather than assumed from RLS. The consumer Learn surface (Track C) keeps
// its own `.eq('active', true)`; this file never does.

export type { CommerceError };

type DrillRow = Db.DrillRow;

/** The fields the create/edit form collects. `id` distinguishes edit from create. */
export interface DrillInput {
  id?: string | null;
  title: string;
  description: string;
  sport: Sport;
  skillCategory: string;
  difficulty: DrillDifficulty;
  xpValue: number;
  mediaUrl: string | null;
}

/** Explicit, admin-chosen narrowing for the Drill List read. All optional. */
export interface DrillListFilters {
  sport?: Sport;
  difficulty?: DrillDifficulty;
  /** undefined shows all (the admin default), true/false narrows. */
  active?: boolean;
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw parseRpcError(error.message);
  return data as T;
}

/**
 * FR-49 create, FR-50 edit. The RPC re-validates every required field and the
 * xp_value > 0 rule server side, so a refusal is the database's guarantee, not
 * this file's opinion; the form validation is only a fast first line.
 */
export const drillApi = {
  upsertDrill: (input: DrillInput) =>
    callRpc<DrillRow>("admin_upsert_drill", {
      p_id: input.id ?? null,
      p_title: input.title,
      p_description: input.description,
      p_sport: input.sport,
      p_skill_category: input.skillCategory,
      p_difficulty: input.difficulty,
      p_xp_value: input.xpValue,
      p_media_url: input.mediaUrl,
    }),

  /** FR-51 activate/deactivate. A flag flip, never a delete. */
  setDrillActive: (id: string, active: boolean) =>
    callRpc<DrillRow>("admin_set_drill_active", { p_id: id, p_active: active }),
};

/**
 * FR-49 Drill List read. The admin sees ALL drills by design (no default active
 * filter), which is the one place inactive drills are visible. Any narrowing is
 * applied as its own explicit filter, per the permissive-OR rule.
 */
export async function fetchDrills(filters: DrillListFilters = {}): Promise<DrillRow[]> {
  let query = supabaseClient
    .from("drills")
    .select(
      "id,title,description,sport,skill_category,difficulty,xp_value,media_url,active,created_at,updated_at",
    )
    .order("created_at", { ascending: false });

  if (filters.sport) query = query.eq("sport", filters.sport);
  if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);
  if (filters.active !== undefined) query = query.eq("active", filters.active);

  const { data, error } = await query;
  if (error) throw parseRpcError(error.message);
  return (data as DrillRow[]) ?? [];
}

/** A single drill for the Edit screen, read explicitly by id. */
export async function fetchDrill(id: string): Promise<DrillRow | null> {
  const { data, error } = await supabaseClient
    .from("drills")
    .select(
      "id,title,description,sport,skill_category,difficulty,xp_value,media_url,active,created_at,updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw parseRpcError(error.message);
  return (data as DrillRow | null) ?? null;
}
