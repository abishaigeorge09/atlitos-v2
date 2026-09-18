#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-search-hybrid.mjs
//
// Phase S1 Track B (PRD-07 FR-40, FR-42, AC-11-1, AC-11-2; ADR-011 D1
// Confirmation). Proves the hybrid ranking against the LOCAL stack
// (127.0.0.1:54321 / postgres on 54322), never production.
//
// Seeds 12 affiliate products with offers across the four sports
// (football, cricket, badminton, tennis) and beginner/intermediate/advanced
// skill levels crossed with junior/adult age ranges, embeds every one
// (`gear-embed`), then asserts:
//
//   (a) "light racket for a 12 year old starting badminton" returns a
//       badminton racket tagged beginner or junior in the top 3.
//       Printed PASS when `VOYAGE_API_KEY` is configured (real embeddings,
//       AC-11-2's actual semantic bar); printed STUB under the offline
//       deterministic embedder, per PHASE-S1-STATUS.md's hard decision: the
//       stub is not semantic, so a query with no keyword overlap at all
//       cannot be proven to recall the RIGHT product by similarity alone. To
//       still exercise the ADDITIVE recall mechanism itself even in stub
//       mode (not just the keyword path, which this fixture also happens to
//       satisfy), part (a2) below crafts a product with a hand-written
//       embedding that matches the query's own stub vector exactly, ZERO
//       keyword overlap, and proves it is recalled and honestly labelled.
//   (b) "Babolat under 2000" with every seeded Babolat product priced above
//       2000 returns the broaden line and zero Babolat hits.
//   (c) with `ai_spend_daily` forced over budget, the same query as (a)
//       returns `mode: "keyword"`, `vector: false`.
//   (d) the response for (a) has `vector: true` when the gate allowed it
//       (asserted before (c) pushes the ledger over budget).
//
// Env (all optional, default to the local stack the Supabase CLI prints):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-search-hybrid.mjs');

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const failures = [];
const notes = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

function svcClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

// --------------------------------------------------------------------------
// The stub embedder, reproduced from supabase/functions/_shared/embeddings.ts
// so this script can hand-craft a vector that will cosine-match whatever the
// LIVE function computes for a given query string, without importing a Deno
// module into Node. Kept byte-for-byte in step with that file's algorithm;
// if that file's stub math ever changes, this needs the same edit.
// --------------------------------------------------------------------------
const EMBED_DIMS = 1024;

function normaliseStubText(text) {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function sha256Seed(text) {
  const data = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
}

async function stubEmbedding(text) {
  let state = await sha256Seed(normaliseStubText(text));
  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const vec = new Array(EMBED_DIMS);
  for (let i = 0; i < EMBED_DIMS; i++) vec[i] = next() * 2 - 1;
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

async function callAiSearch(bearer, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-search`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  if (!json.access_token) throw new Error(`[verify-search-hybrid] player sign in failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

// --------------------------------------------------------------------------
// Fixture catalog: 12 products, all four sports, beginner/junior through
// advanced/adult, one offer each.
// --------------------------------------------------------------------------

const FIXTURES = [
  { title: 'Yonex Voltric Junior Badminton Racket', brand: 'yonex', sport: 'badminton', skill_level: 'beginner', age_range: 'junior', description: 'A light junior badminton racket built for a beginner starting the sport.', price: 1200 },
  { title: 'Wilson Pro Staff Tennis Racket', brand: 'wilson', sport: 'tennis', skill_level: 'advanced', age_range: 'adult', description: 'A tour level tennis racket for advanced adult players.', price: 5000 },
  { title: 'Babolat Pure Drive Tennis Racket', brand: 'babolat', sport: 'tennis', skill_level: 'intermediate', age_range: 'adult', description: 'A powerful intermediate tennis racket for adults.', price: 8500 },
  { title: 'Babolat Junior Tennis Racket', brand: 'babolat', sport: 'tennis', skill_level: 'beginner', age_range: 'junior', description: 'A junior tennis racket for a beginner starting tennis.', price: 3200 },
  { title: 'Cosco Cricket Bat Starter', brand: 'cosco', sport: 'cricket', skill_level: 'beginner', age_range: 'junior', description: 'A junior cricket bat for a beginner.', price: 900 },
  { title: 'SG Cricket Bat Pro', brand: 'sg', sport: 'cricket', skill_level: 'advanced', age_range: 'adult', description: 'A professional grade cricket bat for advanced adult players.', price: 4500 },
  { title: 'Nivia Football Pro', brand: 'nivia', sport: 'football', skill_level: 'intermediate', age_range: 'adult', description: 'An intermediate match football for adults.', price: 1100 },
  { title: 'Adidas Football Junior', brand: 'adidas', sport: 'football', skill_level: 'beginner', age_range: 'junior', description: 'A junior football for a beginner.', price: 700 },
  { title: 'Head Tennis Racket Adult', brand: 'head', sport: 'tennis', skill_level: 'intermediate', age_range: 'adult', description: 'An intermediate tennis racket for adults.', price: 3600 },
  { title: 'Yonex Badminton Shoes Adult', brand: 'yonex', sport: 'badminton', skill_level: 'advanced', age_range: 'adult', description: 'Advanced badminton court shoes for adults.', price: 2600 },
  { title: 'Kookaburra Cricket Ball Set', brand: 'kookaburra', sport: 'cricket', skill_level: 'intermediate', age_range: 'adult', description: 'A set of intermediate grade cricket balls for adults.', price: 500 },
  { title: 'Puma Football Boots Junior', brand: 'puma', sport: 'football', skill_level: 'beginner', age_range: 'junior', description: 'Junior football boots for a beginner.', price: 1500 },
];

async function seedFixtures(svc) {
  const ids = [];
  for (const f of FIXTURES) {
    const id = randomUUID();
    const { error } = await svc.from('affiliate_products').insert({
      id,
      title: f.title,
      brand: f.brand,
      sport: f.sport,
      skill_level: f.skill_level,
      age_range: f.age_range,
      description: f.description,
      active: true,
    });
    if (error) throw new Error(`[verify-search-hybrid] seed product failed (${f.title}): ${error.message}`);
    const { error: offerError } = await svc.from('product_offers').insert({
      affiliate_product_id: id,
      retailer: 'Verify Fixture Retailer',
      price: f.price,
      currency: 'INR',
      affiliate_url: 'https://example.com/verify-search-hybrid-fixture',
      in_stock: true,
    });
    if (offerError) throw new Error(`[verify-search-hybrid] seed offer failed (${f.title}): ${offerError.message}`);
    ids.push(id);
  }
  return ids;
}

async function cleanup(svc, ids) {
  if (ids.length === 0) return;
  await svc.from('affiliate_products').delete().in('id', ids);
}

async function embedAll(svc, ids) {
  for (const id of ids) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-embed`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: id }),
    });
    const json = await res.json();
    if (json.embedded !== 1) throw new Error(`[verify-search-hybrid] gear-embed failed for ${id}: ${JSON.stringify(json)}`);
  }
}

async function forceOverBudget(svc) {
  const { error } = await svc.rpc('record_ai_spend', { p_input_tokens: 0, p_output_tokens: 0, p_est_usd: 999999 });
  if (error) throw new Error(`[verify-search-hybrid] record_ai_spend (force over budget) failed: ${error.message}`);
}

/**
 * Zeroes today's `ai_spend_daily` row before this run's own assertions, so a
 * PRIOR run's (c) (which deliberately pushes the ledger over budget) can
 * never leak into THIS run's (a)/(a2)/(d), which need the gate to allow
 * spend. `ai_spend_daily` is service-role only (CT-3), so this is the same
 * posture as any other fixture cleanup here, just against a ledger table
 * instead of a catalog table.
 */
async function resetSpendLedger(svc) {
  const { error } = await svc.from('ai_spend_daily').delete().eq('day', new Date().toISOString().slice(0, 10));
  if (error) throw new Error(`[verify-search-hybrid] resetting ai_spend_daily failed: ${error.message}`);
}

// --------------------------------------------------------------------------
// Function runtime lifecycle (see verify-gear-embed.mjs for why this waits
// on the actual docker container, not just its own process handle).
// --------------------------------------------------------------------------

let serveProc = null;

function writeEnvFile(vars) {
  const path = join(tmpdir(), `atlitos-search-hybrid-${randomUUID()}.env`);
  writeFileSync(path, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  return path;
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

async function startServe(envVars) {
  await stopServe();
  const envPath = writeEnvFile(envVars);
  serveProc = spawn('supabase', ['functions', 'serve', '--env-file', envPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  serveProc.on('error', (err) => console.error('[verify-search-hybrid] supabase functions serve failed to start:', err));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-search`, { method: 'OPTIONS' });
      if (res.status < 500) {
        try {
          unlinkSync(envPath);
        } catch {
          // best effort
        }
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('[verify-search-hybrid] supabase functions serve did not become ready in time');
}

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

async function main() {
  const svc = svcClient();
  let ids = [];

  try {
    await startServe({ VOYAGE_STUB: '1' });
    await resetSpendLedger(svc);

    console.log('Seeding 12 affiliate products across 4 sports and beginner/intermediate/advanced x junior/adult, embedding each.');
    ids = await seedFixtures(svc);
    await embedAll(svc, ids);
    check('all 12 fixtures embedded', true);

    const token = await playerToken();

    // -----------------------------------------------------------------
    // (a) badminton beginner/junior racket in the top 3.
    // -----------------------------------------------------------------
    console.log('\n(a) "light racket for a 12 year old starting badminton"');
    const resA = await callAiSearch(token, { query: 'light racket for a 12 year old starting badminton', limit: 10 });
    const top3 = (resA.results ?? []).slice(0, 3);
    const badmintonHit = top3.find((r) => r.title === 'Yonex Voltric Junior Badminton Racket');
    const mode = process.env.VOYAGE_API_KEY && process.env.VOYAGE_STUB !== '1' ? 'PASS (real Voyage embeddings)' : 'STUB (deterministic offline embedder, not semantic; PHASE-S1-STATUS.md hard decision)';
    check(
      `(a) badminton beginner/junior racket in top 3 [${mode}]`,
      Boolean(badmintonHit),
      JSON.stringify(top3.map((r) => r.title)),
    );

    // (d) vector: true when the gate allowed it (checked here, before (c)
    // pushes the ledger over budget).
    check('(d) response has vector: true when the gate allowed it', resA.vector === true, JSON.stringify({ vector: resA.vector, mode: resA.mode }));

    // -----------------------------------------------------------------
    // (a2) additive recall mechanism itself, provable even under the
    // non-semantic stub: a product with ZERO keyword overlap with the
    // query, but a hand-crafted embedding identical to the query's own
    // stub vector (cosine similarity 1.0, clears VECTOR_SIMILARITY_FLOOR),
    // must still be recalled and honestly labelled.
    // -----------------------------------------------------------------
    console.log('\n(a2) additive vector-only recall (zero keyword overlap, crafted similarity)');
    const vectorOnlyQuery = 'zzqx wobblefrick paddle finder';
    const vectorOnlyTitle = `Vector Only Fixture ${randomUUID().slice(0, 8)}`;
    const vectorOnlyId = randomUUID();
    const { error: voErr } = await svc.from('affiliate_products').insert({
      id: vectorOnlyId,
      title: vectorOnlyTitle,
      brand: 'nonexistentbrand',
      sport: 'tennis',
      skill_level: null,
      age_range: null,
      description: 'Completely unrelated description text sharing no words with the query at all.',
      active: true,
    });
    if (voErr) throw new Error(`seed vector-only fixture failed: ${voErr.message}`);
    ids.push(vectorOnlyId);
    const craftedVector = await stubEmbedding(vectorOnlyQuery);
    const { error: embErr } = await svc
      .from('affiliate_products')
      .update({ embedding: JSON.stringify(craftedVector) })
      .eq('id', vectorOnlyId);
    if (embErr) throw new Error(`write crafted embedding failed: ${embErr.message}`);

    const resA2 = await callAiSearch(token, { query: vectorOnlyQuery, limit: 10 });
    const a2Hit = (resA2.results ?? []).find((r) => r.title === vectorOnlyTitle);
    check(
      '(a2) zero-keyword-overlap product recalled purely by similarity',
      Boolean(a2Hit),
      JSON.stringify({ parsedIntent: resA2.parsedIntent, titles: (resA2.results ?? []).map((r) => r.title), broaden: resA2.broaden }),
    );
    check(
      '(a2) rankReason names the vector recall',
      a2Hit?.rankReason === 'similar to your query',
      a2Hit?.rankReason,
    );

    // -----------------------------------------------------------------
    // (b) "Babolat under 2000": every seeded Babolat is above 2000.
    // -----------------------------------------------------------------
    console.log('\n(b) "Babolat under 2000"');
    const resB = await callAiSearch(token, { query: 'Babolat under 2000', limit: 10 });
    const babolatHits = (resB.results ?? []).filter((r) => r.title.toLowerCase().includes('babolat'));
    check('(b) zero Babolat hits', babolatHits.length === 0, JSON.stringify(resB.results?.map((r) => r.title)));
    check('(b) broaden line returned', typeof resB.broaden === 'string' && resB.broaden.length > 0, resB.broaden);
    check('(b) broaden line names Babolat or the brand', /babolat|brand/i.test(resB.broaden ?? ''), resB.broaden);

    // -----------------------------------------------------------------
    // (c) over budget: mode: "keyword", vector: false.
    // -----------------------------------------------------------------
    console.log('\n(c) ai_spend_daily forced over budget');
    await forceOverBudget(svc);
    const resC = await callAiSearch(token, { query: 'light racket for a 12 year old starting badminton', limit: 10 });
    check('(c) mode: "keyword" over budget', resC.mode === 'keyword', resC.mode);
    check('(c) vector: false over budget', resC.vector === false, JSON.stringify({ vector: resC.vector }));
  } finally {
    await stopServe();
    await cleanup(svc, ids);
  }

  console.log('\n=== SUMMARY ===');
  for (const n of notes) console.log(`Note: ${n}`);
  if (failures.length === 0) {
    console.log('Verdict: hybrid ranking PROVEN (additive vector recall, brand/price honesty under a vector hit, and the spend gate covering Voyage).');
    process.exit(0);
  }
  console.log(`Verdict: ${failures.length} FAILED assertion(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch(async (err) => {
  console.error('[verify-search-hybrid] FAILED:', err.message ?? err);
  await stopServe();
  process.exit(1);
});
