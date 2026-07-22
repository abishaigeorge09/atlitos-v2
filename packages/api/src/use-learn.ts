import { useMemo } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiError, DrillDifficulty, Sport } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapAuthError, mapPostgrestError } from "./errors";

/**
 * `@atlitos/api`'s Learn lane (AT-134/AT-135/AT-136, P7 Track C), per
 * docs/architecture/API-MAPPING.md "learn" and docs/prd/PRD-01-athlete.md
 * (FR-48 through FR-51). Its own file rather than filling `hooks.ts`'s
 * placeholder in place, matching how `use-shop.ts`/`use-empower.ts` split
 * their lanes out of `hooks.ts`.
 *
 * Three rules run through every function here and none is optional
 * (PHASE-7-STATUS.md, CLAUDE.md).
 *
 * 1. **XP is server derived, never computed here.** Every XP total, level,
 *    stage and progress number comes from `get_learn_home()`, a SECURITY
 *    DEFINER RPC self-scoped to `auth.uid()` that derives the total as
 *    `sum(xp_events.xp_amount)` at read time (no counter column). This file
 *    never sums XP client side and never reads `xp_events` to add them up.
 *
 * 2. **The drill catalog is public and permissive-OR, so every read filters
 *    active.** `drills` carries an anon-inclusive public SELECT (RLS.md), so
 *    an unfiltered read returns inactive drills too. Every consumer read here
 *    carries its own explicit `.eq("active", true)` (an inactive drill never
 *    shows in the app), the same RLS-is-not-scoping discipline the shop and
 *    clutch lanes apply.
 *
 * 3. **The only client write is the own-row completion.** Mark-complete is a
 *    bare own-row INSERT into `drill_completions {user_id, drill_id}` (own-row
 *    RLS). Track A's `0059` AFTER INSERT trigger appends the `xp_events` row
 *    (amount read server side from `drills.xp_value`) and unlocks milestones,
 *    all server side. This file NEVER writes `xp_events` or `user_milestones`
 *    (a direct client write returns 42501). A duplicate completion fails
 *    `UNIQUE(user_id, drill_id)` and is surfaced as an already-completed state,
 *    never a crash (idempotent, no redo affordance in v2).
 */

// ---------------------------------------------------------------------------
// Shapes. The screens consume these; the raw jsonb/row shapes stay private.
// ---------------------------------------------------------------------------

/** One roadmap stage in the sport's ladder, server derived. */
export interface RoadmapStage {
  id: string;
  stageOrder: number;
  name: string;
  xpThreshold: number;
}

/** One milestone with the caller's earned flag (earned vs locked, FR-51). */
export interface LearnMilestone {
  id: string;
  key: string;
  name: string;
  description: string;
  /** A lucide icon name, never an emoji (CLAUDE.md). Resolved to a component
   * on the screen. */
  iconName: string;
  earned: boolean;
  earnedAt: string | null;
}

/**
 * The Learn home / roadmap / milestones payload, everything the three screens
 * render, all server derived by `get_learn_home()`. `sport === null` is the
 * FR-48 empty state (no primary sport selected, or no seeded ladder): show the
 * empty state, never a zero-filled roadmap.
 */
export interface LearnHome {
  sport: Sport | null;
  /** DERIVED sum(xp_events.xp_amount) for the caller. Never computed here. */
  xpTotal: number;
  /** The top stage whose threshold is met, or null below the first stage. */
  currentStage: RoadmapStage | null;
  /** The next stage up, or null at the top of the ladder. */
  nextStage: RoadmapStage | null;
  /** The full ladder for the sport, ascending. */
  stages: RoadmapStage[];
  milestones: LearnMilestone[];
}

/** A drill catalog entry (active only in the consumer surface). */
export interface Drill {
  id: string;
  title: string;
  description: string;
  sport: Sport;
  skillCategory: string;
  difficulty: DrillDifficulty;
  xpValue: number;
  mediaUrl: string | null;
}

export interface DrillLibraryFilters {
  sport?: Sport | null;
  difficulty?: DrillDifficulty | null;
}

export interface MarkCompleteResult {
  /** True when the drill was already completed (the UNIQUE guard fired): the
   * screen shows the completed state, no crash, no second XP grant. */
  alreadyCompleted: boolean;
}

// ---------------------------------------------------------------------------
// Raw shapes (private).
// ---------------------------------------------------------------------------

interface RoadmapStageJson {
  id: string;
  stage_order: number;
  name: string;
  xp_threshold: number;
}

interface LearnHomeJson {
  sport: Sport | null;
  xp_total: number;
  current_stage: RoadmapStageJson | null;
  next_stage: RoadmapStageJson | null;
  stages: RoadmapStageJson[] | null;
  milestones:
    | {
        id: string;
        key: string;
        name: string;
        description: string;
        icon_name: string;
        criteria: unknown;
        earned: boolean;
        earned_at: string | null;
      }[]
    | null;
}

interface DrillRow {
  id: string;
  title: string;
  description: string;
  sport: Sport;
  skill_category: string;
  difficulty: DrillDifficulty;
  xp_value: number;
  media_url: string | null;
}

const DRILL_SELECT = "id, title, description, sport, skill_category, difficulty, xp_value, media_url";

// Postgres unique_violation. A duplicate completion (the FR-49 idempotency
// guard) surfaces as this; the mark-complete path treats it as an
// already-completed state, never an error.
const UNIQUE_VIOLATION = "23505";

function mapStage(json: RoadmapStageJson | null): RoadmapStage | null {
  if (!json) return null;
  return { id: json.id, stageOrder: json.stage_order, name: json.name, xpThreshold: json.xp_threshold };
}

function mapDrill(row: DrillRow): Drill {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sport: row.sport,
    skillCategory: row.skill_category,
    difficulty: row.difficulty,
    xpValue: row.xp_value,
    mediaUrl: row.media_url,
  };
}

// ---------------------------------------------------------------------------
// learn. Learn home, drill library, drill detail + mark complete, roadmap.
// ---------------------------------------------------------------------------

export function useLearn(client: AtlitosClient) {
  // Memoize on [client] for a STABLE identity across renders, the same fix
  // useClutch/useEmpower document: the Learn screens feed the returned object
  // into a `useCallback(load, [learn])` whose effect runs on `[load]`, so a
  // fresh object each render would refire the effect forever (the F1
  // render/request loop). `supabase` is a module singleton, so this resolves
  // once.
  return useMemo(() => makeLearnApi(client), [client]);
}

function makeLearnApi(client: AtlitosClient) {
  // Widen the schema generic so `from`/`rpc` accept the learn relations: they
  // land in Track A's migrations (0057-0060), not yet in the generated
  // `Database` type on this branch (the same escape hatch useClutch/useEmpower
  // document). Every result is re-narrowed through the interfaces above.
  const db = client as unknown as SupabaseClient;

  async function requireUserId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) throw mapAuthError(error);
    if (!data.user) throw mapAuthError({ message: "Sign in to track your progress.", status: 401 });
    return data.user.id;
  }

  return {
    /** PRD-01 FR-48/FR-50/FR-51. The Learn home / roadmap / milestones payload,
     * every XP/level/progress number DERIVED server side by `get_learn_home()`
     * (rule 1). `sport === null` is the empty state. */
    async getLearnHome(): Promise<LearnHome> {
      const { data, error } = await db.rpc("get_learn_home");
      if (error) throw mapPostgrestError(error);
      const json = (data ?? {}) as LearnHomeJson;

      return {
        sport: json.sport ?? null,
        xpTotal: json.xp_total ?? 0,
        currentStage: mapStage(json.current_stage ?? null),
        nextStage: mapStage(json.next_stage ?? null),
        stages: (json.stages ?? []).map((s) => mapStage(s)!).filter(Boolean),
        milestones: (json.milestones ?? []).map((m) => ({
          id: m.id,
          key: m.key,
          name: m.name,
          description: m.description,
          iconName: m.icon_name,
          earned: m.earned,
          earnedAt: m.earned_at,
        })),
      };
    },

    /** PRD-01 FR-49. The drill library, filterable by sport and difficulty.
     * The `.eq("active", true)` is EXPLICIT and unconditional (rule 2): the
     * catalog is a permissive-OR public read, so an unfiltered query would
     * surface inactive drills. Ordered by ascending XP so the ladder reads low
     * to high. */
    async listDrills(filters: DrillLibraryFilters = {}): Promise<Drill[]> {
      let query = db.from("drills").select(DRILL_SELECT).eq("active", true);
      if (filters.sport) query = query.eq("sport", filters.sport);
      if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);

      const { data, error } = await query
        .order("xp_value", { ascending: true })
        .returns<DrillRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapDrill);
    },

    /** A single drill for the detail screen. The `.eq("active", true)` is kept
     * here too, so an inactive drill is unresolvable by direct id from the
     * consumer surface (returns null), the same active-filter contract as the
     * list read. */
    async getDrill(drillId: string): Promise<Drill | null> {
      const { data, error } = await db
        .from("drills")
        .select(DRILL_SELECT)
        .eq("id", drillId)
        .eq("active", true)
        .maybeSingle<DrillRow>();
      if (error) throw mapPostgrestError(error);
      return data ? mapDrill(data) : null;
    },

    /** The caller's own completed drill ids, owner-scoped explicitly with
     * `.eq("user_id", uid)` (CLAUDE.md: RLS is not scoping). Drives the
     * completed badge on the library and the completed state on the detail
     * screen; persists across reload because it reads the table, not client
     * state. A guest with no session gets an empty set. */
    async getCompletedDrillIds(): Promise<Set<string>> {
      const { data: authData } = await client.auth.getUser();
      if (!authData.user) return new Set();
      const { data, error } = await db
        .from("drill_completions")
        .select("drill_id")
        .eq("user_id", authData.user.id)
        .returns<{ drill_id: string }[]>();
      if (error) throw mapPostgrestError(error);
      return new Set((data ?? []).map((r) => r.drill_id));
    },

    /** PRD-01 FR-49. Mark a drill complete: the ONE client write in the XP
     * path, a bare own-row INSERT into `drill_completions` (rule 3). Track A's
     * trigger grants the XP and unlocks milestones server side in the same
     * transaction; this never writes `xp_events`/`user_milestones`. A duplicate
     * fails `UNIQUE(user_id, drill_id)` and is returned as
     * `alreadyCompleted: true` (idempotent, no redo, no crash). */
    async markDrillComplete(drillId: string): Promise<MarkCompleteResult> {
      const userId = await requireUserId();
      const { error } = await db
        .from("drill_completions")
        .insert({ user_id: userId, drill_id: drillId });

      if (error) {
        // The idempotency guard: a second completion of the same drill is not
        // a failure, it is the already-completed state FR-49 requires.
        if (error.code === UNIQUE_VIOLATION) return { alreadyCompleted: true };
        throw mapPostgrestError(error);
      }
      return { alreadyCompleted: false };
    },
  };
}

export type UseLearnResult = ReturnType<typeof useLearn>;

/** Narrow an unknown thrown value to `ApiError` at a screen's catch site, the
 * same helper the sibling lanes expose. */
export function isLearnApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && "code" in error && "status" in error;
}
