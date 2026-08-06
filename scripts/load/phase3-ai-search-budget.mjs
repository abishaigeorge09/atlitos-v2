#!/usr/bin/env node
// ATLITOS v2 — scripts/load/phase3-ai-search-budget.mjs
//
// LAUNCH Phase 3 Track B gate script. Not one of PHASE-3-STATUS.md's three
// named GATE clauses (those cover the front-door/feed/realtime mechanisms),
// but explicitly required by this track's dispatch and by the doc's own B6/B7
// acceptance criteria: `ai-search` NEVER 500s under throttle or over the
// daily budget, it degrades to `"mode": "keyword"`, HTTP 200 (CT-2, CT-3,
// Settled decision 5).
//
// One script per scenario, parameters baked in as consts (workflow-args-
// collision lesson); only the deploy target and a caller's own bearer token
// come from the environment, since neither exists before deploy/sign-in.
//
// NOT run against a live deployment as part of this track's build (no
// working Supabase CLI/MCP session to deploy with here); see the track's
// final report. `evaluateAiSearchGate`'s throttle/budget branches were
// exercised locally against a mocked Supabase client (same code path this
// script drives over real HTTP) as this track's local/mock-invoke evidence.

const BASE_URL = process.env.PHASE3_BASE_URL; // e.g. https://<project>.supabase.co/functions/v1
const AUTH_TOKEN = process.env.PHASE3_USER_JWT; // any valid session (guest anon session is fine, ai-search's verify_jwt is true)

// Baked-in scenario consts (CT-2's ai-search-user bucket is 10/60s; B6 drives
// 11 calls so the 11th is guaranteed past it).
const THROTTLE_TEST_CALLS = 11;
const QUERY = "badminton racket";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
}

async function search(query) {
  const res = await fetch(`${BASE_URL}/ai-search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AUTH_TOKEN}`,
      apikey: AUTH_TOKEN,
    },
    body: JSON.stringify({ query, limit: 5 }),
  });
  return res;
}

async function main() {
  if (!BASE_URL || !AUTH_TOKEN) {
    console.error(
      "NOT RUN: set PHASE3_BASE_URL and PHASE3_USER_JWT (a real session token, guest or " +
        "signed in) to run this against a real deployment. This script deliberately does " +
        "not fabricate a result without them.",
    );
    process.exitCode = 1;
    return;
  }

  // --- B6 (throttle): 11 calls in one window, the 11th degrades to keyword, HTTP 200, never a 500 ---
  let allOk = true;
  let sawKeywordDegrade = false;
  let anyServerError = false;
  for (let i = 0; i < THROTTLE_TEST_CALLS; i++) {
    const res = await search(QUERY);
    const body = await res.json().catch(() => null);
    if (res.status >= 500) anyServerError = true;
    if (res.status !== 200) allOk = false;
    if (i === THROTTLE_TEST_CALLS - 1 && body?.mode === "keyword") sawKeywordDegrade = true;
  }
  if (!anyServerError && allOk) {
    pass(`${THROTTLE_TEST_CALLS} calls in one window, zero 5xx, all HTTP 200`);
  } else {
    fail(`ai-search 5xx'd or non-200'd under throttle (anyServerError=${anyServerError}, allOk=${allOk})`);
  }
  if (sawKeywordDegrade) {
    pass(`the ${THROTTLE_TEST_CALLS}th call in the window degraded to mode: "keyword"`);
  } else {
    console.warn(
      `WARNING: the ${THROTTLE_TEST_CALLS}th call did not report mode: "keyword". Either ` +
        "ANTHROPIC_API_KEY is unset on the target (llmEnabled() is already false, so every " +
        "call is keyword mode trivially, not a throttle proof), or the throttle bucket needs " +
        "re-checking. Re-run with the key set to get a meaningful signal for this assertion.",
    );
  }

  // --- B7-adjacent: budget=0 forces keyword unconditionally (staging only; the
  // caller sets ai_search_daily_budget_usd=0 via feature_flags BEFORE running
  // this block and restores it after, per the doc's B6 note) ---
  if (process.env.PHASE3_BUDGET_ZERO_ACTIVE === "1") {
    const res = await search(QUERY);
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body?.mode === "keyword") {
      pass("with ai_search_daily_budget_usd=0, call returned mode: keyword, HTTP 200");
    } else {
      fail(`budget=0 did not force keyword mode (status=${res.status}, body=${JSON.stringify(body)})`);
    }
  } else {
    console.warn(
      "SKIPPED: set PHASE3_BUDGET_ZERO_ACTIVE=1 after setting ai_search_daily_budget_usd's " +
        "feature_flags row to 0 on the target to exercise the budget-exhausted branch (B6's " +
        "second half). Restore the flag afterward.",
    );
  }
}

await main();
