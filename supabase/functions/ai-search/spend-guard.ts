// ATLITOS v2 — supabase/functions/ai-search/spend-guard.ts
//
// LAUNCH Phase 3 Track B, P1-5 server half (PHASE-3-STATUS.md CT-2, CT-3).
// Two independent gates decide, BEFORE any LLM call, whether this request may
// use the LLM path at all:
//   1. Per-user throttle (CT-2): `take_rate_limit_token('ai-search-user',
//      user_id, 10, 60)`. Over the 10-per-60s cap, degrade to keyword.
//   2. Daily spend ceiling (CT-3): today's `ai_spend_daily.est_usd` compared
//      against `ai_search_daily_budget()` (feature-flag driven, default 10).
//      At or over budget, degrade to keyword.
//
// Both gates degrade to `mode: "keyword"` on ANY failure to evaluate them
// (RPC error, read error), never a 500 (Settled decision 5: "a search that
// 500s at launch is worse than a dumber search"). This is the one place in
// this phase where "fail safe" is NOT "fail open": an unreadable budget must
// not silently permit unmetered LLM spend, so the DEFAULT on an error here is
// the cheaper path, keyword mode. This is deliberately the opposite fail
// mode from `_shared/rate-limit.ts` (which fails OPEN for the playback read
// path): there, the risk of failing closed is bricking a public feed under a
// DB hiccup; here, the risk of failing open is unmetered spend, so it fails
// toward "spend nothing" instead. Both are read paths that never 500; only
// the direction of the safe default differs, by design.
//
// This module only ever runs against a SERVICE ROLE client: both
// `take_rate_limit_token` and `ai_search_daily_budget`/`ai_spend_daily` are
// service_role-only grants (CT-2, CT-3). The rest of ai-search (the actual
// candidate reads) stays on the caller's own JWT client
// (`userScopedClient`), unchanged; this is the one narrow, explicit use of
// the service role in this function, never for a data read.

import { takeRateLimitToken } from "../_shared/rate-limit.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const THROTTLE_BUCKET = "ai-search-user";
const THROTTLE_MAX = 10;
const THROTTLE_WINDOW_SECONDS = 60;

export type AiSearchMode = "llm" | "keyword";

export interface AiSearchGate {
  mode: AiSearchMode;
}

/**
 * Evaluate whether this request may take the LLM path. Never throws (every
 * branch resolves to a mode, keyword being the safe default on any failure).
 */
export async function evaluateAiSearchGate(
  serviceClient: AnySupabaseClient,
  userId: string,
): Promise<AiSearchGate> {
  const rl = await takeRateLimitToken(
    serviceClient,
    THROTTLE_BUCKET,
    userId,
    THROTTLE_MAX,
    THROTTLE_WINDOW_SECONDS,
  );
  // Per _shared/rate-limit.ts, `allowed` is already true on an RPC error
  // (fails open there). Spend-guard treats "not allowed" (a real exhausted
  // window) as the only throttle reason to degrade.
  if (!rl.allowed) {
    return { mode: "keyword" };
  }

  const overBudget = await isOverDailyBudget(serviceClient);
  return { mode: overBudget ? "keyword" : "llm" };
}

async function isOverDailyBudget(serviceClient: AnySupabaseClient): Promise<boolean> {
  try {
    const { data: budgetData, error: budgetError } = await serviceClient.rpc("ai_search_daily_budget");
    if (budgetError) {
      console.error(`[ai-search] ai_search_daily_budget() errored, degrading to keyword: ${budgetError.message}`);
      return true;
    }
    const budget = typeof budgetData === "number" ? budgetData : Number(budgetData);
    if (!Number.isFinite(budget)) {
      console.error("[ai-search] ai_search_daily_budget() returned a non-numeric value, degrading to keyword");
      return true;
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: spendRow, error: spendError } = await serviceClient
      .from("ai_spend_daily")
      .select("est_usd")
      .eq("day", today)
      .maybeSingle();
    if (spendError) {
      console.error(`[ai-search] ai_spend_daily read errored, degrading to keyword: ${spendError.message}`);
      return true;
    }

    const spent = spendRow && typeof spendRow.est_usd !== "undefined" ? Number(spendRow.est_usd) : 0;
    if (!Number.isFinite(spent)) return true;
    return spent >= budget;
  } catch (err) {
    console.error("[ai-search] budget check threw, degrading to keyword:", err);
    return true;
  }
}

/**
 * Approximate USD cost for a Haiku call, informational only (not a billing
 * source of truth; Anthropic's own invoice is authoritative). Rates are a
 * conservative Claude Haiku 4.5 estimate, kept in one place so the two call
 * sites (intent parse, rerank) never hand-roll their own arithmetic.
 */
const USD_PER_INPUT_TOKEN = 0.000001; // ~$1.00 / MTok
const USD_PER_OUTPUT_TOKEN = 0.000005; // ~$5.00 / MTok

export function estimateUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * USD_PER_INPUT_TOKEN + outputTokens * USD_PER_OUTPUT_TOKEN;
}

/**
 * Phase S1 Track B (PRD-07 FR-40; ADR-011 D1). One named constant for a
 * single Voyage embedding call's cost, informational the same way the Claude
 * per-token rates above are: a conservative flat estimate for a short query
 * string against `voyage-3`, not Voyage's own invoice. `ai-search` records
 * this once per REAL Voyage call (never for a cache hit, never for the
 * offline stub), into the SAME `ai_spend_daily` ledger `estimateUsd`/Claude
 * feeds, so one shared daily budget covers both AI spends, per D1's "gates
 * the Voyage call with the same per-user throttle and daily budget it gates
 * Claude with".
 */
export const VOYAGE_COST_PER_CALL_USD = 0.00006; // ~$0.06 / 1K queries at voyage-3 list pricing, rounded up.

/**
 * Record one LLM call's spend against today's meter. Never throws: a failure
 * to record is logged, not surfaced, because the call it is billing for
 * already happened and a search response must not fail on bookkeeping.
 */
export async function recordAiSpend(
  serviceClient: AnySupabaseClient,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (inputTokens <= 0 && outputTokens <= 0) return;
  const estUsd = estimateUsd(inputTokens, outputTokens);
  await recordEstUsd(serviceClient, inputTokens, outputTokens, estUsd);
}

/**
 * Records a Voyage embedding call's flat cost (VOYAGE_COST_PER_CALL_USD).
 * Voyage bills per token, not per named input/output split the way Claude's
 * usage block does, so this carries 0/0 token counts into the SAME ledger row
 * `record_ai_spend` maintains; `recordAiSpend` above short-circuits on
 * zero/zero token counts (a Claude call with no usage block truly spent
 * nothing), so a Voyage call needs its own entry point rather than reusing
 * that guard.
 */
export async function recordVoyageSpend(serviceClient: AnySupabaseClient): Promise<void> {
  await recordEstUsd(serviceClient, 0, 0, VOYAGE_COST_PER_CALL_USD);
}

async function recordEstUsd(
  serviceClient: AnySupabaseClient,
  inputTokens: number,
  outputTokens: number,
  estUsd: number,
): Promise<void> {
  try {
    const { error } = await serviceClient.rpc("record_ai_spend", {
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_est_usd: estUsd,
    });
    if (error) {
      console.error(`[ai-search] record_ai_spend errored (spend not recorded): ${error.message}`);
    }
  } catch (err) {
    console.error("[ai-search] record_ai_spend threw (spend not recorded):", err);
  }
}
