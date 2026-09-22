#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-gear-ingest-honesty.mjs
//
// Phase A3-T2 of the admin UX rebuild (docs/PLAN-ADMIN-UX.md). Proves that
// gear-ingest tells the truth when a supported retailer refuses the fetch,
// instead of reporting NO_PRODUCT_FOUND (which the admin read as "your link
// is wrong", and the founder as "the link does not really add in").
//
// Same lifecycle as verify-gear-ingest.mjs: a local fixture http server, a
// temporary retailer_programmes row for host.docker.internal, its own
// `supabase functions serve`. LOCAL ONLY. Never run alongside a manual
// functions serve (docs/qa/CURRENT-STATE.md, 2026-09-18).
//
// Cases:
//   1. /product/503 (bot wall, og:image in the error page): 422
//      RETAILER_UNAVAILABLE, upstream_status 503, draft carries the og:image.
//   2. /product/403: 422 RETAILER_UNAVAILABLE, upstream_status 403.
//   3. amazon.in URL (programme fetchable = false): 422 RETAILER_UNAVAILABLE,
//      upstream_status null, the fixture server sees NO request (no round trip),
//      draft.canonicalUrl is the pasted URL.
//   4. /product/empty (200, no product data): still 422 NO_PRODUCT_FOUND with
//      the partial draft, so the honest code did not swallow the old one.
//   5. /product/json-ld: still 200 with a full draft (nothing regressed).
//
// Usage:  export PATH=/opt/homebrew/bin:$PATH; node scripts/verify-gear-ingest-honesty.mjs

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
assertWritableTarget(SUPABASE_URL, 'verify-gear-ingest-honesty.mjs');

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const PROGRAMME_KEY = `verify_honesty_${randomUUID().slice(0, 8)}`;

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

function svcClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Fixture server. `hits` records every path the edge runtime asked for, so
// case 3 can assert the amazon.in URL produced no request at all.
let fixtureServer = null;
let FIXTURE_ORIGIN = null;
const hits = [];

const BOT_WALL = `<!doctype html><html><head><title>Service Unavailable</title>
<meta property="og:image" content="__ORIGIN__/images/racket.jpg">
<meta property="og:description" content="Sorry, something went wrong on our end."></head>
<body><h1>503</h1></body></html>`;

const EMPTY_PAGE = `<!doctype html><html><head><title>Category listing</title>
<meta property="og:description" content="Browse rackets."></head><body><p>No single product here.</p></body></html>`;

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      hits.push(url);
      if (url === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /blocked\n');
        return;
      }
      if (url === '/product/json-ld') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync(path.join(FIXTURES_DIR, 'product-json-ld.html'), 'utf8').replaceAll('__ORIGIN__', FIXTURE_ORIGIN));
        return;
      }
      if (url === '/product/503') {
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end(BOT_WALL.replaceAll('__ORIGIN__', FIXTURE_ORIGIN));
        return;
      }
      if (url === '/product/403') {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Forbidden</title></head><body>Access denied</body></html>');
        return;
      }
      if (url === '/product/empty') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(EMPTY_PAGE);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.listen(0, '0.0.0.0', () => {
      FIXTURE_ORIGIN = `http://host.docker.internal:${server.address().port}`;
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

let serveProc = null;

function writeServeEnvFile() {
  const scratchDir = process.env.ATLITOS_SCRATCH_DIR ?? os.tmpdir();
  const envPath = path.join(scratchDir, `atlitos-gear-ingest-${randomUUID()}.env`);
  writeFileSync(envPath, `GEAR_INGEST_PUBLIC_URL=${SUPABASE_URL}\nFETCH_ALLOW_HOSTS=host.docker.internal\n`);
  return envPath;
}

async function startServe() {
  await stopServe();
  serveProc = spawn('supabase', ['functions', 'serve', '--env-file', writeServeEnvFile()], { stdio: ['ignore', 'pipe', 'pipe'] });
  serveProc.on('error', (err) => console.error('[honesty] supabase functions serve failed to start:', err));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-ingest`, { method: 'OPTIONS' });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('[honesty] supabase functions serve did not become ready in time');
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

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'AtlitosDemo!2026' }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`[honesty] sign in failed for ${email}: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function ingestFetch(bearer, url) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-ingest`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'fetch', url }),
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

async function main() {
  const svc = svcClient();
  await startFixtureServer();
  console.log(`[honesty] fixture at ${FIXTURE_ORIGIN}`);

  const { error: pe } = await svc.from('retailer_programmes').insert({
    key: PROGRAMME_KEY,
    display_name: 'Honesty Store',
    url_patterns: ['host.docker.internal'],
    affiliate_tag_template: null,
    extractor: null,
    fetch_policy: { maxPerMinute: 60 },
    active: true,
    fetchable: true,
  });
  if (pe) throw new Error(`[honesty] programme insert failed: ${pe.message}`);

  const { data: amazonRow } = await svc.from('retailer_programmes').select('fetchable').eq('key', 'amazon_in').single();
  check('amazon_in is marked fetchable = false by the migration', amazonRow?.fetchable === false, JSON.stringify(amazonRow));

  try {
    await startServe();
    const admin = await signIn('admin@atlitos.dev');

    console.log('\n1. supported retailer answers 503');
    let r = await ingestFetch(admin, `${FIXTURE_ORIGIN}/product/503`);
    check('status 422', r.status === 422, String(r.status));
    check('code RETAILER_UNAVAILABLE', r.json?.error?.code === 'RETAILER_UNAVAILABLE', r.json?.error?.code);
    check('upstream_status 503', r.json?.upstream_status === 503, String(r.json?.upstream_status));
    check('message names the HTTP status', /HTTP 503/.test(r.json?.error?.message ?? ''), r.json?.error?.message);
    check('partial draft carries the og:image', typeof r.json?.draft?.imageUrl === 'string' && r.json.draft.imageUrl.endsWith('/images/racket.jpg'), r.json?.draft?.imageUrl);
    check('retailer_key is the programme', r.json?.retailer_key === PROGRAMME_KEY, r.json?.retailer_key);

    console.log('\n2. supported retailer answers 403');
    r = await ingestFetch(admin, `${FIXTURE_ORIGIN}/product/403`);
    check('status 422', r.status === 422, String(r.status));
    check('code RETAILER_UNAVAILABLE', r.json?.error?.code === 'RETAILER_UNAVAILABLE', r.json?.error?.code);
    check('upstream_status 403', r.json?.upstream_status === 403, String(r.json?.upstream_status));

    console.log('\n3. amazon.in, programme fetchable = false, no round trip');
    const before = hits.length;
    r = await ingestFetch(admin, 'https://www.amazon.in/dp/B0EXAMPLE');
    check('status 422', r.status === 422, String(r.status));
    check('code RETAILER_UNAVAILABLE', r.json?.error?.code === 'RETAILER_UNAVAILABLE', r.json?.error?.code);
    check('upstream_status null', r.json?.upstream_status === null, String(r.json?.upstream_status));
    check('message is the honest copy', (r.json?.error?.message ?? '').startsWith('Amazon India pages cannot be fetched automatically.'), r.json?.error?.message);
    check('draft keeps the pasted URL', r.json?.draft?.canonicalUrl === 'https://www.amazon.in/dp/B0EXAMPLE', r.json?.draft?.canonicalUrl);
    check('retailer_key amazon_in', r.json?.retailer_key === 'amazon_in', r.json?.retailer_key);
    check('fixture server saw no request', hits.length === before, `${hits.length - before} new hits`);

    console.log('\n4. supported retailer, 200 with no product (still NO_PRODUCT_FOUND)');
    r = await ingestFetch(admin, `${FIXTURE_ORIGIN}/product/empty`);
    check('status 422', r.status === 422, String(r.status));
    check('code NO_PRODUCT_FOUND', r.json?.error?.code === 'NO_PRODUCT_FOUND', r.json?.error?.code);
    check('partial draft carries the description', r.json?.draft?.description === 'Browse rackets.', r.json?.draft?.description);

    console.log('\n5. supported retailer, JSON-LD page (no regression)');
    r = await ingestFetch(admin, `${FIXTURE_ORIGIN}/product/json-ld`);
    check('status 200', r.status === 200, String(r.status));
    check('draft has a title and a price', typeof r.json?.draft?.title === 'string' && r.json.draft.title.length > 0 && typeof r.json?.draft?.price === 'number', JSON.stringify({ title: r.json?.draft?.title, price: r.json?.draft?.price }));
  } finally {
    await stopServe();
    await stopFixtureServer();
    await svc.from('retailer_programmes').delete().eq('key', PROGRAMME_KEY);
  }

  console.log('');
  if (failures.length) {
    console.log(`[honesty] FAILED: ${failures.length} check(s)`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('[honesty] all checks passed');
}

main().catch(async (err) => {
  console.error(err);
  await stopServe();
  await stopFixtureServer();
  process.exit(1);
});
