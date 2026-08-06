#!/usr/bin/env node
// ATLITOS v2 — scripts/load/phase3-feed.mjs
//
// LAUNCH Phase 3 Track B gate script. PHASE-3-STATUS.md's "Gate verification"
// clause 2 ("No feed poster stall"), Track B's server half: one batch POST to
// `get-clip-playback-url` (CT-1 body `{ clip_ids, kind }`) resolving a
// grid-sized set of clips returns ALL of them in ONE call (not N), the TTLs
// match CT-1 (thumb ~3600s, video ~300s), and a batch containing another
// user's unpublished clip id refuses that one id inside `failed` without
// aborting the rest (CT-1 partial-failure contract, B2/B3/B4 acceptance
// criteria).
//
// Simulates `CONCURRENT_CLIENTS` concurrent grid loads, each issuing exactly
// `ceil(clipCount / BATCH_MAX)` calls (1 for a grid of <= 24, matching the
// plan's C3 criterion Track C depends on this endpoint for), and asserts the
// per-IP limiter (60/60s, CT-2) leaves that legitimate volume alone (the
// plan's explicit false-positive-margin requirement for this clause).
//
// One script per scenario, parameters baked in as consts (workflow-args-
// collision lesson). The deploy target and real clip ids cannot be baked in
// (they do not exist before deploy/seed), so those come from the
// environment; the script refuses to guess them or fabricate a result.
//
// NOT run against a live deployment as part of this track's build (no
// working Supabase CLI/MCP session to deploy with here); see the track's
// final report for what evidence stands in for it instead (a mocked-client
// unit pass of the same handler code, `deno check` green).

const BASE_URL = process.env.PHASE3_BASE_URL;
// Comma-separated published clip ids, >= 12 for a meaningful batch (B1: "one
// real HTTP POST with 12 published clip_ids returns HTTP 200 with 12 entries").
const PUBLISHED_CLIP_IDS = (process.env.PHASE3_PUBLISHED_CLIP_IDS ?? "").split(",").filter(Boolean);
// One id NOT owned by the caller and NOT published (e.g. another user's
// `uploading`/`rejected` clip), to prove the batch refuses it inside `failed`
// rather than in `urls` (B2).
const FORBIDDEN_CLIP_ID = process.env.PHASE3_FORBIDDEN_CLIP_ID;

const CONCURRENT_CLIENTS = 25;
const BATCH_MAX = 24;
const VIDEO_TTL_SECONDS = 300;
const THUMB_TTL_SECONDS = 3600;
const TTL_TOLERANCE_SECONDS = 30; // wall-clock slack for the request round trip

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
}

async function postBatch(clipIds, kind) {
  const res = await fetch(`${BASE_URL}/get-clip-playback-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clip_ids: clipIds, kind }),
  });
  return res;
}

function ttlSecondsFromNow(expiresAtIso) {
  return (new Date(expiresAtIso).getTime() - Date.now()) / 1000;
}

async function main() {
  if (!BASE_URL || PUBLISHED_CLIP_IDS.length < 2) {
    console.error(
      "NOT RUN: set PHASE3_BASE_URL and PHASE3_PUBLISHED_CLIP_IDS (comma-separated, " +
        ">= 2 real published clip ids on that target; B1 wants >= 12). This script " +
        "deliberately does not fabricate a result without them.",
    );
    process.exitCode = 1;
    return;
  }

  // --- B1/B3: one call, N entries back, real fetchable URLs ---
  {
    const res = await postBatch(PUBLISHED_CLIP_IDS, "video");
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body && Array.isArray(body.urls) && body.urls.length === PUBLISHED_CLIP_IDS.length) {
      pass(`one batch call for ${PUBLISHED_CLIP_IDS.length} clip_ids returned ${body.urls.length} urls`);
    } else {
      fail(`batch call did not return one entry per id (status=${res.status}, body=${JSON.stringify(body)})`);
    }

    if (body?.urls?.length) {
      const check = body.urls.slice(0, 2);
      const heads = await Promise.all(check.map((u) => fetch(u.url, { method: "HEAD" })));
      if (heads.every((h) => h.ok)) {
        pass("sampled batch URLs actually fetch (HEAD 200)");
      } else {
        fail(`sampled batch URLs did not all fetch: ${heads.map((h) => h.status).join(",")}`);
      }
    }
  }

  // --- B4: TTLs. thumb ~3600s, video ~300s ---
  {
    const videoRes = await postBatch([PUBLISHED_CLIP_IDS[0]], "video");
    const videoBody = await videoRes.json().catch(() => null);
    const videoTtl = videoBody?.urls?.[0] ? ttlSecondsFromNow(videoBody.urls[0].expires_at) : null;
    if (videoTtl !== null && Math.abs(videoTtl - VIDEO_TTL_SECONDS) <= TTL_TOLERANCE_SECONDS) {
      pass(`video expires_at ~${VIDEO_TTL_SECONDS}s out (got ${videoTtl.toFixed(1)}s)`);
    } else {
      fail(`video TTL out of tolerance (got ${videoTtl})`);
    }

    const thumbRes = await postBatch([PUBLISHED_CLIP_IDS[0]], "thumb");
    const thumbBody = await thumbRes.json().catch(() => null);
    const thumbTtl = thumbBody?.urls?.[0] ? ttlSecondsFromNow(thumbBody.urls[0].expires_at) : null;
    if (thumbTtl !== null && Math.abs(thumbTtl - THUMB_TTL_SECONDS) <= TTL_TOLERANCE_SECONDS) {
      pass(`thumb expires_at ~${THUMB_TTL_SECONDS}s out (got ${thumbTtl.toFixed(1)}s)`);
    } else {
      fail(`thumb TTL out of tolerance (got ${thumbTtl})`);
    }
  }

  // --- B2: a forbidden id inside the batch lands in `failed`, not `urls` ---
  if (FORBIDDEN_CLIP_ID) {
    const res = await postBatch([...PUBLISHED_CLIP_IDS.slice(0, 2), FORBIDDEN_CLIP_ID], "video");
    const body = await res.json().catch(() => null);
    const inUrls = body?.urls?.some((u) => u.clip_id === FORBIDDEN_CLIP_ID);
    const inFailed = body?.failed?.some((f) => f.clip_id === FORBIDDEN_CLIP_ID);
    if (res.status === 200 && !inUrls && inFailed) {
      pass("forbidden clip id inside a batch refused into `failed`, batch still 200 for the rest");
    } else {
      fail(`forbidden clip id not correctly refused (status=${res.status}, body=${JSON.stringify(body)})`);
    }
  } else {
    console.warn("SKIPPED: PHASE3_FORBIDDEN_CLIP_ID not set, B2 (batch auth preserved) not exercised.");
  }

  // --- BATCH_TOO_LARGE: > 24 ids rejected 400 ---
  {
    const tooMany = Array.from({ length: BATCH_MAX + 1 }, (_, i) => PUBLISHED_CLIP_IDS[i % PUBLISHED_CLIP_IDS.length]);
    const res = await postBatch(tooMany, "video");
    const body = await res.json().catch(() => null);
    if (res.status === 400 && body?.error?.code === "BATCH_TOO_LARGE") {
      pass(`${BATCH_MAX + 1} clip_ids rejected 400 BATCH_TOO_LARGE`);
    } else {
      fail(`over-max batch not rejected correctly (status=${res.status}, body=${JSON.stringify(body)})`);
    }
  }

  // --- Feed-load shape: CONCURRENT_CLIENTS grid loads, each ONE batch call,
  // no false-positive 429 at this legitimate volume (margin vs the 60/60s cap
  // per the plan's explicit false-positive-margin requirement) ---
  {
    const gridIds = PUBLISHED_CLIP_IDS.slice(0, Math.min(BATCH_MAX, PUBLISHED_CLIP_IDS.length));
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CLIENTS }, () => postBatch(gridIds, "thumb")),
    );
    const elapsedMs = Date.now() - start;
    const rateLimited = results.filter((r) => r.status === 429);
    if (rateLimited.length === 0) {
      pass(`${CONCURRENT_CLIENTS} concurrent one-call grid loads, zero false-positive 429s (${elapsedMs}ms wall)`);
    } else {
      fail(`${rateLimited.length}/${CONCURRENT_CLIENTS} concurrent grid loads false-positive 429'd`);
    }
  }
}

await main();
