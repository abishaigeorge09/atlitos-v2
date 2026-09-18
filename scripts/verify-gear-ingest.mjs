#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-gear-ingest.mjs
//
// Phase S2 Track C (PRD-07 FR-44 to FR-47; ADR-011 D3 Confirmation; AC-11-3).
// Proves `gear-ingest` against the LOCAL stack, never a live retailer: this
// script starts its own static `node:http` fixture server (two fixture
// pages plus a tiny JPEG, `scripts/fixtures/gear/`), inserts a temporary
// `retailer_programmes` row matching `host.docker.internal` (the fixture
// server binds 0.0.0.0 on the host; `supabase functions serve` runs the
// edge runtime in its own docker container, which cannot reach the host's
// 127.0.0.1 by loopback, only via host.docker.internal) so gear-ingest
// resolves a
// retailer_key for it, and manages `supabase functions serve` itself
// (verify-gear-embed.mjs's lifecycle: env file, poll for readiness, force
// the edge runtime container down between phases if one is ever needed).
//
// What this proves, in order:
//   1. fetch on the JSON-LD fixture: 200, a draft with the fixture's title/
//      brand/price/currency/image, retailer_key = the temp programme's key,
//      and affiliate_products/product_offers row counts UNCHANGED (FR-44:
//      "nothing is saved on Fetch").
//   2. save on the same fixture: 200, exactly one new affiliate_products row
//      and one new product_offers row, `image_path` set under the temp
//      programme's key, and `image_url` resolving to THIS project's local
//      Storage domain (never the fixture host), that URL returns 200 with
//      image/jpeg (AC-11-3, on a controlled fixture).
//   3. fetch on the Open-Graph-only fixture (no JSON-LD): 200, a draft
//      still produced via the Open Graph fallback.
//   4. fetch as anon: 401 (AC-11-6, only an admin JWT may call gear-ingest).
//   5. fetch on a robots-disallowed path: 422, ROBOTS_DISALLOWED.
//
// Cleanup always runs (row deletes, the uploaded Storage object, the temp
// retailer_programmes row, both server processes) even on failure.
//
// Env (all optional, default to the local stack the Supabase CLI prints):
//   SUPABASE_URL              default http://127.0.0.1:54321
//   SUPABASE_ANON_KEY         default the local demo anon key
//   SUPABASE_SERVICE_ROLE_KEY default the local demo service role key

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'gear');

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-gear-ingest.mjs');

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const PROGRAMME_KEY = `verify_fixture_${randomUUID().slice(0, 8)}`;

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

function svcClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

// --------------------------------------------------------------------------
// Fixture http server: two static pages + one JPEG, plus a robots.txt that
// disallows /blocked and a /blocked/product page never meant to be reached.
// --------------------------------------------------------------------------

let fixtureServer = null;
let fixturePort = null;
let FIXTURE_ORIGIN = null;

function readFixture(name, origin) {
  const raw = readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
  return raw.replaceAll('__ORIGIN__', origin);
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const origin = FIXTURE_ORIGIN;
      const url = req.url ?? '/';
      if (url === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /blocked\n');
        return;
      }
      if (url === '/product/json-ld') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFixture('product-json-ld.html', origin));
        return;
      }
      if (url === '/product/open-graph') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFixture('product-open-graph.html', origin));
        return;
      }
      if (url === '/blocked/product') {
        // Never actually served to a compliant fetcher: robots.txt disallows
        // this path. If gear-ingest ever reaches this branch, the robots
        // check has a bug, which is exactly what this fixture proves against.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Should never be fetched</title></head></html>');
        return;
      }
      if (url === '/images/racket.jpg') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(readFileSync(path.join(FIXTURES_DIR, 'racket.jpg')));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.listen(0, '0.0.0.0', () => {
      fixturePort = server.address().port;
      FIXTURE_ORIGIN = `http://host.docker.internal:${fixturePort}`;
      fixtureServer = server;
      resolve();
    });
    server.on('error', reject);
  });
}

function stopFixtureServer() {
  return new Promise((resolve) => {
    if (!fixtureServer) return resolve();
    fixtureServer.close(() => resolve());
  });
}

// --------------------------------------------------------------------------
// supabase functions serve lifecycle (verify-gear-embed.mjs's exact shape:
// this script owns start/stop, and force-removes the edge runtime container
// if it does not stop promptly, so a stale environment never serves a second
// phase's assertions).
// --------------------------------------------------------------------------

let serveProc = null;

/**
 * `supabase functions serve` runs the edge runtime inside a docker container
 * whose own `SUPABASE_URL` is the docker-internal `http://kong:8000`, not
 * anything this script (or a real client) can resolve. `GEAR_INGEST_PUBLIC_URL`
 * tells `gear-ingest` what to rewrite a Storage public URL to before
 * returning it (see `publicStorageUrl` in the function), so the image_url
 * assertion below can actually fetch what it gets back. Written to a scratch
 * env file rather than the sandbox-blocked `.env*`.
 */
function writeServeEnvFile() {
  const scratchDir = process.env.ATLITOS_SCRATCH_DIR ?? os.tmpdir();
  const envPath = path.join(scratchDir, `atlitos-gear-ingest-${randomUUID()}.env`);
  // FETCH_ALLOW_HOSTS is the local escape hatch for the fixture host; the deployed functions never set it.
  writeFileSync(envPath, `GEAR_INGEST_PUBLIC_URL=${SUPABASE_URL}\nFETCH_ALLOW_HOSTS=host.docker.internal\n`);
  return envPath;
}

async function startServe() {
  await stopServe();
  const envPath = writeServeEnvFile();
  serveProc = spawn('supabase', ['functions', 'serve', '--env-file', envPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  serveProc.on('error', (err) => console.error('[verify-gear-ingest] supabase functions serve failed to start:', err));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-ingest`, { method: 'OPTIONS' });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('[verify-gear-ingest] supabase functions serve did not become ready in time');
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

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'AtlitosDemo!2026' }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`[verify-gear-ingest] sign in failed for ${email}: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function callGearIngest(bearer, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-ingest`, {
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

async function countRows(svc, table) {
  const { count, error } = await svc.from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`[verify-gear-ingest] count(${table}) failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const svc = svcClient();
  let createdProductId = null;
  let createdOfferId = null;
  let uploadedImagePath = null;

  try {
    await startFixtureServer();
    const origin = FIXTURE_ORIGIN;
    console.log(`Fixture server up at ${origin} (listening on 0.0.0.0:${fixturePort})`);

    const { error: programmeError } = await svc.from('retailer_programmes').insert({
      key: PROGRAMME_KEY,
      display_name: 'Verify Fixture Retailer',
      url_patterns: ['host.docker.internal'],
      affiliate_tag_template: null,
      extractor: null,
      fetch_policy: { maxPerMinute: 10 },
      active: true,
    });
    if (programmeError) throw new Error(`[verify-gear-ingest] temp retailer_programmes insert failed: ${programmeError.message}`);

    await startServe();

    const adminToken = await signIn('admin@atlitos.dev');
    const anonToken = ANON_KEY;

    console.log('\nPhase 1: fetch on the JSON-LD fixture writes nothing');
    const beforeProducts = await countRows(svc, 'affiliate_products');
    const beforeOffers = await countRows(svc, 'product_offers');

    const jsonLdUrl = `${origin}/product/json-ld`;
    const fetchRes = await callGearIngest(adminToken, { action: 'fetch', url: jsonLdUrl });
    check('fetch (json-ld) returns 200', fetchRes.status === 200, `status ${fetchRes.status}, ${JSON.stringify(fetchRes.json)}`);
    check(
      'fetch (json-ld) draft.title matches the fixture',
      fetchRes.json.draft?.title === 'Verify Gear Ingest JSON-LD Fixture Racket',
      JSON.stringify(fetchRes.json.draft),
    );
    check('fetch (json-ld) draft.brand matches the fixture', fetchRes.json.draft?.brand === 'FixtureBrand', JSON.stringify(fetchRes.json.draft));
    check('fetch (json-ld) draft.price matches the fixture', fetchRes.json.draft?.price === 1999, JSON.stringify(fetchRes.json.draft));
    check('fetch (json-ld) retailer_key resolves to the temp programme', fetchRes.json.retailer_key === PROGRAMME_KEY, fetchRes.json.retailer_key);

    const afterFetchProducts = await countRows(svc, 'affiliate_products');
    const afterFetchOffers = await countRows(svc, 'product_offers');
    check('fetch leaves affiliate_products count unchanged', afterFetchProducts === beforeProducts, `${beforeProducts} -> ${afterFetchProducts}`);
    check('fetch leaves product_offers count unchanged', afterFetchOffers === beforeOffers, `${beforeOffers} -> ${afterFetchOffers}`);

    console.log('\nPhase 2: save creates exactly one product and one offer, image served from our Storage');
    const saveRes = await callGearIngest(adminToken, { action: 'save', url: jsonLdUrl, draft: fetchRes.json.draft });
    check('save returns 200', saveRes.status === 200, `status ${saveRes.status}, ${JSON.stringify(saveRes.json)}`);
    createdProductId = saveRes.json.product?.id ?? null;
    createdOfferId = saveRes.json.offer?.id ?? null;

    const afterSaveProducts = await countRows(svc, 'affiliate_products');
    const afterSaveOffers = await countRows(svc, 'product_offers');
    check('save creates exactly one affiliate_products row', afterSaveProducts === afterFetchProducts + 1, `${afterFetchProducts} -> ${afterSaveProducts}`);
    check('save creates exactly one product_offers row', afterSaveOffers === afterFetchOffers + 1, `${afterFetchOffers} -> ${afterSaveOffers}`);

    const imagePath = saveRes.json.product?.image_path ?? null;
    uploadedImagePath = imagePath;
    check('image_path is set', typeof imagePath === 'string' && imagePath.startsWith(`${PROGRAMME_KEY}/`), imagePath);

    const imageUrl = saveRes.json.product?.image_url ?? '';
    const localStoragePrefix = `${SUPABASE_URL}/storage/v1/object/public/product-images/`;
    check('image_url points at our local Storage domain, not the fixture host', imageUrl.startsWith(localStoragePrefix), imageUrl);
    check('image_url never points at the fixture host', !imageUrl.includes(`host.docker.internal:${fixturePort}`), imageUrl);

    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      check('the Storage-served image returns 200', imgRes.status === 200, `status ${imgRes.status}`);
      check(
        'the Storage-served image has an image content-type',
        (imgRes.headers.get('content-type') ?? '').startsWith('image/'),
        imgRes.headers.get('content-type'),
      );
    }

    console.log('\nPhase 3: fetch on the Open-Graph-only fixture (no JSON-LD)');
    const ogUrl = `${origin}/product/open-graph`;
    const ogRes = await callGearIngest(adminToken, { action: 'fetch', url: ogUrl });
    check('fetch (open graph) returns 200', ogRes.status === 200, `status ${ogRes.status}, ${JSON.stringify(ogRes.json)}`);
    check(
      'fetch (open graph) draft.title matches the fixture',
      ogRes.json.draft?.title === 'Verify Gear Ingest Open Graph Fixture Racket',
      JSON.stringify(ogRes.json.draft),
    );

    console.log('\nPhase 4: anon is refused');
    const anonRes = await callGearIngest(anonToken, { action: 'fetch', url: jsonLdUrl });
    check('gear-ingest (anon) refused', anonRes.status === 401, `status ${anonRes.status}, ${JSON.stringify(anonRes.json)}`);

    console.log('\nPhase 5: robots.txt disallow refuses with 422');
    const blockedUrl = `${origin}/blocked/product`;
    const blockedRes = await callGearIngest(adminToken, { action: 'fetch', url: blockedUrl });
    check('fetch on a robots-disallowed path returns 422', blockedRes.status === 422, `status ${blockedRes.status}, ${JSON.stringify(blockedRes.json)}`);
  } finally {
    await stopServe();
    await stopFixtureServer();

    if (createdOfferId) {
      await svc.from('product_offers').delete().eq('id', createdOfferId);
    }
    if (createdProductId) {
      await svc.from('affiliate_products').delete().eq('id', createdProductId);
    }
    if (uploadedImagePath) {
      await svc.storage.from('product-images').remove([uploadedImagePath]);
    }
    await svc.from('retailer_programmes').delete().eq('key', PROGRAMME_KEY);
  }

  console.log('\n=== SUMMARY ===');
  if (failures.length === 0) {
    console.log('Verdict: gear-ingest PROVEN (fetch writes nothing, save creates one product + one offer with a Storage-served image, anon refused, robots.txt honoured).');
    process.exit(0);
  }
  console.log(`Verdict: ${failures.length} FAILED assertion(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch(async (err) => {
  console.error('[verify-gear-ingest] FAILED:', err.message ?? err);
  await stopServe();
  await stopFixtureServer();
  process.exit(1);
});
