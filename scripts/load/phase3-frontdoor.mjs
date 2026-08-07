#!/usr/bin/env node
// ATLITOS v2 — scripts/load/phase3-frontdoor.mjs
//
// LAUNCH Phase 3 Track B gate script. PHASE-3-STATUS.md's "Gate verification"
// section, clause 1 ("No front-door 429"), narrowed to Track B's owned
// endpoint: `get-clip-playback-url`'s SESSIONLESS read path (no Authorization
// header, the guest-browsing-Clutch case, FR-42/FR-3) must not 429 under
// ordinary load, and the per-IP token bucket (CT-2, bucket `clip-playback-ip`,
// 60/60s) must both (a) let a normal cold-start-sized burst through and
// (b) actually engage past its configured limit with the CT-1 429 shape.
//
// One script per scenario (workflow-args-collision lesson, CLAUDE.md): every
// scenario parameter below is a baked-in const, not a CLI arg, so two
// concurrent runs of this file never fight over shared parameters. The one
// thing that cannot be a const is WHERE to run it: the deploy target and a
// real published clip id do not exist until the integrator deploys and seeds
// one, so those two are read from the environment, not baked in, and the
// script refuses to guess them.
//
// This is a LOAD script meant to run against a deployed, rate-safe target
// (staging, or an agreed prod window, per the plan's "Orchestrator: designate
// the rate-safe load-test target"). It was NOT run against a live deployment
// as part of this track's build: this builder has no working Supabase CLI/MCP
// session to deploy with (see the track's final report). Running it here
// with BASE_URL unset intentionally exits non-zero with that explanation
// rather than fabricating a pass.

const BASE_URL = process.env.PHASE3_BASE_URL; // e.g. https://<project>.supabase.co/functions/v1
const CLIP_ID = process.env.PHASE3_PUBLISHED_CLIP_ID; // a real `published` clip id on the target

// Baked-in scenario consts (CT-1, CT-2; the plan's gate clause 1 leaves the
// exact cold-start count to the harness, so this mirrors the gate's own
// "N=200 simulated cold starts" language at a fifth of that, since Track B's
// endpoint is one signed-URL mint per client, not a full cold start).
const NORMAL_BURST_REQUESTS = 40; // well under the 60/60s per-IP cap
const OVER_LIMIT_BURST_REQUESTS = 70; // deliberately over the 60/60s cap
const RATE_LIMIT_MAX_PER_MINUTE = 60;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

async function postPlayback(clipId) {
  const res = await fetch(`${BASE_URL}/get-clip-playback-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clip_id: clipId }),
  });
  return res;
}

async function main() {
  if (!BASE_URL || !CLIP_ID) {
    console.error(
      "NOT RUN: set PHASE3_BASE_URL (deployed functions URL) and PHASE3_PUBLISHED_CLIP_ID " +
        "(a real published clip id on that target) to run this against a real deployment. " +
        "This script deliberately does not fabricate a result without them.",
    );
    process.exitCode = 1;
    return;
  }

  // --- Scenario 1: ordinary sessionless load, zero 429/5xx ---
  const normalResults = await Promise.all(
    Array.from({ length: NORMAL_BURST_REQUESTS }, () => postPlayback(CLIP_ID)),
  );
  const normalBad = normalResults.filter((r) => r.status === 429 || r.status >= 500);
  if (normalBad.length === 0) {
    pass(`${NORMAL_BURST_REQUESTS} sessionless requests, zero 429/5xx`);
  } else {
    fail(`${normalBad.length}/${NORMAL_BURST_REQUESTS} sessionless requests returned 429/5xx`);
  }

  // --- Scenario 2: burst past the configured per-IP limit actually engages ---
  // Runs sequentially against the SAME window so the count is deterministic
  // (parallel requests can straddle a window boundary and undercount).
  let sawRateLimited = false;
  let tailBody = null;
  for (let i = 0; i < OVER_LIMIT_BURST_REQUESTS; i++) {
    const res = await postPlayback(CLIP_ID);
    if (res.status === 429) {
      sawRateLimited = true;
      tailBody = await res.json().catch(() => null);
      break;
    }
  }
  if (sawRateLimited && tailBody && tailBody.error === "RATE_LIMITED" && typeof tailBody.retry_after_seconds === "number") {
    pass(`burst past ${RATE_LIMIT_MAX_PER_MINUTE}/min engaged the limiter with the CT-1 429 shape`);
  } else {
    fail(
      `burst of ${OVER_LIMIT_BURST_REQUESTS} in one window never hit 429 with the RATE_LIMITED shape ` +
        `(got tailBody=${JSON.stringify(tailBody)}). Either the limiter is not applying, or the window ` +
        "reset mid-burst; re-run against a fresh minute if this was a timing artifact.",
    );
  }
}

await main();
