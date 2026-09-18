#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-gear-embed.mjs
//
// Phase S1 Track B (PRD-07 FR-43; ADR-011 D2 Confirmation; AC-11-7). Proves
// `gear-embed` against the LOCAL stack (127.0.0.1:54321 / postgres on
// 54322), never production: this script owns its own
// `supabase functions serve` child process so it can flip the embedding
// provider's environment between assertions (stub vs. a broken Voyage key),
// something a long-running dev server cannot do per request.
//
// What this proves, in order:
//   1. Seed a product via the service role. Call gear-embed as the service
//      role. Assert the response reports `embedded: 1` and a `mode`, and
//      that the row's `embedding` column is genuinely not null afterwards.
//   2. Call gear-embed as anon. Assert 401 (AC-11-7: only gear-embed writes
//      the column, and only service role or an admin JWT may call it at
//      all).
//   3. Restart the function runtime with `VOYAGE_API_KEY=bad-key` and
//      `VOYAGE_STUB` UNSET (forces the "voyage" code path to actually try
//      and fail, rather than falling back to the stub on its own). Seed a
//      SECOND product, call gear-embed, assert the embedding column stays
//      null AND that the product still comes back from `ai-search` for a
//      query on its exact title (D2's own "the product still appears via
//      the deterministic keyword path" contract, FR-43).
//
// Env (all optional, default to the local stack the Supabase CLI prints):
//   SUPABASE_URL              default http://127.0.0.1:54321
//   SUPABASE_ANON_KEY         default the local demo anon key
//   SUPABASE_SERVICE_ROLE_KEY default the local demo service role key
//   SUPABASE_DB_URL           default the local Postgres connection string

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-gear-embed.mjs');

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

function svcClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function callGearEmbed(bearer, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-embed`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function callAiSearch(bearer, query) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-search`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 20 }),
  });
  return res.json();
}

async function playerToken() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'player@atlitos.dev', password: 'AtlitosDemo!2026' }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`[verify-gear-embed] player sign in failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function seedProduct(svc, title) {
  const id = randomUUID();
  const { error } = await svc.from('affiliate_products').insert({
    id,
    title,
    brand: 'testbrand',
    sport: 'tennis',
    skill_level: 'beginner',
    age_range: 'adult',
    description: 'Fixture row for verify-gear-embed.mjs, safe to delete.',
    active: true,
  });
  if (error) throw new Error(`[verify-gear-embed] seed insert failed: ${error.message}`);
  return id;
}

async function cleanup(svc, ids) {
  if (ids.length === 0) return;
  await svc.from('affiliate_products').delete().in('id', ids);
}

// --------------------------------------------------------------------------
// Function runtime lifecycle: this script owns start/stop so it can flip the
// Voyage env between assertions. `supabase functions serve` binds the fixed
// gateway port from config, so only one instance runs at a time.
// --------------------------------------------------------------------------

let serveProc = null;

function writeEnvFile(vars) {
  const path = join(tmpdir(), `atlitos-gear-embed-${randomUUID()}.env`);
  writeFileSync(path, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  return path;
}

async function startServe(envVars) {
  await stopServe();
  const envPath = writeEnvFile(envVars);
  serveProc = spawn('supabase', ['functions', 'serve', '--env-file', envPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  serveProc.on('error', (err) => console.error('[verify-gear-embed] supabase functions serve failed to start:', err));
  // Poll the gateway until it answers rather than a fixed sleep: cold start
  // time varies with what else is running on the machine.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-embed`, { method: 'OPTIONS' });
      if (res.status < 500) {
        try {
          unlinkSync(envPath);
        } catch {
          // best effort cleanup of the scratch env file.
        }
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('[verify-gear-embed] supabase functions serve did not become ready in time');
}

/**
 * `supabase functions serve` manages its own `supabase_edge_runtime_atlitos`
 * docker container. Killing the CLI's own process is not enough on its own:
 * the container can take a few seconds to actually stop, and starting a new
 * `serve` while the old container is still up serves the OLD environment
 * (this is what silently broke the first version of this script: the
 * "bad key" phase kept reporting `mode: "stub"`, the Phase 1 container's
 * answer, not the freshly-started one's). Poll for the container to
 * disappear; force-remove it if it does not, so the next `startServe` is
 * guaranteed a clean slate.
 */
async function stopServe() {
  if (!serveProc) return;
  serveProc.kill('SIGTERM');
  serveProc = null;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await edgeRuntimeContainerRunning())) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((resolve) => {
    const p = spawn('docker', ['rm', '-f', 'supabase_edge_runtime_atlitos'], { stdio: 'ignore' });
    p.on('close', resolve);
    p.on('error', resolve);
  });
}

function edgeRuntimeContainerRunning() {
  return new Promise((resolve) => {
    const p = spawn('docker', ['ps', '--format', '{{.Names}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', () => resolve(out.includes('supabase_edge_runtime_atlitos')));
    p.on('error', () => resolve(false));
  });
}

async function main() {
  const svc = svcClient();
  const anon = anonClient();
  const seededIds = [];

  try {
    console.log('Phase 1: normal stub embedding, service role and anon auth');
    await startServe({ VOYAGE_STUB: '1' });

    const goodId = await seedProduct(svc, 'Verify Gear Embed Fixture Racket');
    seededIds.push(goodId);

    const svcRes = await callGearEmbed(SERVICE_ROLE_KEY, { productId: goodId });
    check('gear-embed (service role) returns 200', svcRes.status === 200, `status ${svcRes.status}`);
    check('gear-embed reports embedded: 1', svcRes.json.embedded === 1, JSON.stringify(svcRes.json));
    check('gear-embed reports a mode', typeof svcRes.json.mode === 'string', JSON.stringify(svcRes.json));

    const { data: row, error: rowError } = await svc
      .from('affiliate_products')
      .select('embedding')
      .eq('id', goodId)
      .maybeSingle();
    check('embedding column is not null after gear-embed', !rowError && row && row.embedding !== null, rowError?.message);

    const anonRes = await callGearEmbed(ANON_KEY, { productId: goodId });
    check('gear-embed (anon) refused', anonRes.status === 401, `status ${anonRes.status}, ${JSON.stringify(anonRes.json)}`);

    console.log('\nPhase 2: broken Voyage key (VOYAGE_API_KEY=bad, VOYAGE_STUB unset)');
    await startServe({ VOYAGE_API_KEY: 'bad-key-atlitos-verify' });

    const badTitle = `Verify Gear Embed Bad Key Fixture ${randomUUID().slice(0, 8)}`;
    const badId = await seedProduct(svc, badTitle);
    seededIds.push(badId);

    const badRes = await callGearEmbed(SERVICE_ROLE_KEY, { productId: badId });
    check('gear-embed (bad key) returns 200 (never errors, D2)', badRes.status === 200, `status ${badRes.status}`);
    check('gear-embed (bad key) reports failed: 1', badRes.json.failed === 1, JSON.stringify(badRes.json));
    check('gear-embed (bad key) reports mode: voyage (it tried the real call)', badRes.json.mode === 'voyage', JSON.stringify(badRes.json));

    const { data: badRow, error: badRowError } = await svc
      .from('affiliate_products')
      .select('embedding')
      .eq('id', badId)
      .maybeSingle();
    check('embedding stays null on a Voyage failure', !badRowError && badRow && badRow.embedding === null, badRowError?.message);

    const token = await playerToken();
    const searchResult = await callAiSearch(token, badTitle);
    const titles = (searchResult.results ?? []).map((r) => r.title);
    check(
      'product with a null embedding still surfaces via ai-search keyword path (FR-43)',
      titles.includes(badTitle),
      JSON.stringify({ titles, broaden: searchResult.broaden }),
    );
  } finally {
    await stopServe();
    await cleanup(svc, seededIds);
  }

  console.log('\n=== SUMMARY ===');
  if (failures.length === 0) {
    console.log('Verdict: gear-embed PROVEN (write path, anon refusal, and the D2 null-on-failure/keyword-fallback contract).');
    process.exit(0);
  }
  console.log(`Verdict: ${failures.length} FAILED assertion(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch(async (err) => {
  console.error('[verify-gear-embed] FAILED:', err.message ?? err);
  await stopServe();
  process.exit(1);
});
