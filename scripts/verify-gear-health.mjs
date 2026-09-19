#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-gear-health.mjs
//
// Phase S2 Track D (PRD-07 FR-48, FR-51, FR-52; ADR-011 D4 Confirmation;
// AC-11-4). Proves `gear-recheck` against the LOCAL stack, never a live
// retailer: starts its own static `node:http` fixture server bound to
// 0.0.0.0 (the edge runtime container reaches it via host.docker.internal,
// the same trap verify-gear-ingest.mjs's header documents), seeds one
// `retailer_programmes` row for that host, seeds one product with two
// offers, then drives gear-recheck through every outcome by repointing one
// offer's `canonical_url` at a different fixture route per scenario and
// re-invoking `{ productId }` (this function processes every offer of a
// given product on every call, so the OTHER offer is kept parked on the
// always-ok fixture except in the final auto-delist scenario).
//
// Manages `supabase functions serve` itself, verify-gear-ingest.mjs's exact
// lifecycle (env file under $ATLITOS_SCRATCH_DIR/os.tmpdir, poll for
// readiness, force-remove the edge runtime container if it will not stop).
//
// Env (all optional, default to the local stack the Supabase CLI prints):
//   SUPABASE_URL              default http://127.0.0.1:54321
//   SUPABASE_ANON_KEY         default the local demo anon key
//   SUPABASE_SERVICE_ROLE_KEY default the local demo service role key

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-gear-health.mjs');

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const PROGRAMME_KEY = `verify_health_${randomUUID().slice(0, 8)}`;
const HEALTHY_PRICE = 2499;

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
// Fixture http server: every route this script's scenarios need. Bound to
// 0.0.0.0 so `supabase functions serve`'s docker container can reach it via
// host.docker.internal; a real client never touches this host at all.
// --------------------------------------------------------------------------
let fixtureServer = null;
let fixturePort = null;
let FIXTURE_ORIGIN = null;
let errorRouteHits = 0; // /product/error: fails every hit, proves the "one retry" path still ends up blocked

function jsonLdPage(title, price, inStock) {
  return `<html><head><title>${title}</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    brand: 'FixtureBrand',
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: 'INR',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  })}</script>
</head><body>${title}</body></html>`;
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\n');
        return;
      }
      if (url === '/product/healthy') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(jsonLdPage('Verify Gear Health Healthy Fixture', HEALTHY_PRICE, true));
        return;
      }
      if (url === '/product/out-of-stock') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(jsonLdPage('Verify Gear Health Out Of Stock Fixture', HEALTHY_PRICE, false));
        return;
      }
      if (url === '/product/missing') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Not found</title></head></html>');
        return;
      }
      if (url === '/product/error') {
        errorRouteHits += 1;
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Service unavailable</title></head></html>');
        return;
      }
      if (url === '/product/unparseable') {
        // No JSON-LD, no og:title: extractProduct returns null on this page.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head></head><body><p>Nothing structured here.</p></body></html>');
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
// supabase functions serve lifecycle (verify-gear-ingest.mjs's exact shape).
// No ANTHROPIC_API_KEY is ever set here, deliberately: the unparsed-page
// scenario proves ai_suggestion stays null without a key, never erroring.
// --------------------------------------------------------------------------
let serveProc = null;

function writeServeEnvFile() {
  const scratchDir = process.env.ATLITOS_SCRATCH_DIR ?? os.tmpdir();
  const envPath = `${scratchDir}/atlitos-gear-health-${randomUUID()}.env`;
  // VOYAGE_STUB is unrelated to gear-recheck (embeddings never run on this
  // path); set for parity with the rest of the stack's local convention and
  // so nothing here could ever attempt a real Voyage call by accident.
  // FETCH_ALLOW_HOSTS is the local escape hatch for the fixture host; the deployed functions never set it.
  writeFileSync(envPath, 'VOYAGE_STUB=1\nFETCH_ALLOW_HOSTS=host.docker.internal\n');
  return envPath;
}

async function startServe() {
  await stopServe();
  const envPath = writeServeEnvFile();
  serveProc = spawn('supabase', ['functions', 'serve', '--env-file', envPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  serveProc.on('error', (err) => console.error('[verify-gear-health] supabase functions serve failed to start:', err));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-recheck`, { method: 'OPTIONS' });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('[verify-gear-health] supabase functions serve did not become ready in time');
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
async function callGearRecheck(bearer, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-recheck`, {
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

async function getOffer(svc, id) {
  const { data, error } = await svc.from('product_offers').select('*').eq('id', id).single();
  if (error) throw new Error(`[verify-gear-health] getOffer(${id}) failed: ${error.message}`);
  return data;
}

async function latestFetchLog(svc, offerId) {
  const { data, error } = await svc
    .from('product_fetch_log')
    .select('*')
    .eq('offer_id', offerId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[verify-gear-health] latestFetchLog(${offerId}) failed: ${error.message}`);
  return data;
}

async function main() {
  const svc = svcClient();
  let productId = null;
  let offerAId = null;
  let offerBId = null;

  try {
    await startFixtureServer();
    console.log(`Fixture server up (listening on 0.0.0.0:${fixturePort}, reached as ${FIXTURE_ORIGIN})`);

    const { error: programmeError } = await svc.from('retailer_programmes').insert({
      key: PROGRAMME_KEY,
      display_name: 'Verify Health Fixture Retailer',
      url_patterns: ['host.docker.internal'],
      affiliate_tag_template: null,
      extractor: null,
      fetch_policy: { maxPerMinute: 6000 }, // fast, this is a fixture host, not a real retailer
      active: true,
    });
    if (programmeError) throw new Error(`[verify-gear-health] temp retailer_programmes insert failed: ${programmeError.message}`);

    const { data: product, error: productError } = await svc
      .from('affiliate_products')
      .insert({ title: 'Verify Gear Health Fixture Racket', active: true })
      .select('id')
      .single();
    if (productError) throw new Error(`[verify-gear-health] product insert failed: ${productError.message}`);
    productId = product.id;

    const { data: offerA, error: offerAError } = await svc
      .from('product_offers')
      .insert({
        affiliate_product_id: productId,
        retailer: 'Verify Health Fixture Retailer',
        price: HEALTHY_PRICE,
        currency: 'INR',
        affiliate_url: `${FIXTURE_ORIGIN}/product/healthy`,
        canonical_url: `${FIXTURE_ORIGIN}/product/healthy`,
        retailer_key: PROGRAMME_KEY,
        in_stock: true,
      })
      .select('id')
      .single();
    if (offerAError) throw new Error(`[verify-gear-health] offer A insert failed: ${offerAError.message}`);
    offerAId = offerA.id;

    const { data: offerB, error: offerBError } = await svc
      .from('product_offers')
      .insert({
        affiliate_product_id: productId,
        retailer: 'Verify Health Fixture Retailer (parked)',
        price: HEALTHY_PRICE,
        currency: 'INR',
        affiliate_url: `${FIXTURE_ORIGIN}/product/healthy`,
        canonical_url: `${FIXTURE_ORIGIN}/product/healthy`,
        retailer_key: PROGRAMME_KEY,
        in_stock: true,
      })
      .select('id')
      .single();
    if (offerBError) throw new Error(`[verify-gear-health] offer B insert failed: ${offerBError.message}`);
    offerBId = offerB.id;

    await startServe();

    console.log('\nAnon is refused');
    const anonRes = await callGearRecheck(ANON_KEY, { productId });
    check('gear-recheck (anon) refused', anonRes.status === 401, `status ${anonRes.status}, ${JSON.stringify(anonRes.json)}`);

    console.log('\nScenario: ok on a healthy page');
    let res = await callGearRecheck(SERVICE_ROLE_KEY, { productId });
    check('recheck returns 200', res.status === 200, `status ${res.status}, ${JSON.stringify(res.json)}`);
    let offerA1 = await getOffer(svc, offerAId);
    check('offer A outcome is ok', offerA1.last_check_outcome === 'ok', offerA1.last_check_outcome);
    check('offer A consecutive_failures is 0', offerA1.consecutive_failures === 0, offerA1.consecutive_failures);

    console.log('\nScenario: price_changed updates price and sets last_price_change_at');
    const staleePrice = HEALTHY_PRICE - 500;
    await svc.from('product_offers').update({ price: staleePrice, last_price_change_at: null }).eq('id', offerAId);
    res = await callGearRecheck(SERVICE_ROLE_KEY, { productId });
    check('recheck returns 200', res.status === 200, `status ${res.status}`);
    const offerA2 = await getOffer(svc, offerAId);
    check('offer A outcome is price_changed', offerA2.last_check_outcome === 'price_changed', offerA2.last_check_outcome);
    check('offer A price updated to the fixture price', Number(offerA2.price) === HEALTHY_PRICE, offerA2.price);
    check('offer A last_price_change_at is set', offerA2.last_price_change_at !== null, offerA2.last_price_change_at);

    console.log('\nScenario: out_of_stock resets consecutive_failures');
    await svc
      .from('product_offers')
      .update({ canonical_url: `${FIXTURE_ORIGIN}/product/out-of-stock`, consecutive_failures: 3 })
      .eq('id', offerAId);
    res = await callGearRecheck(SERVICE_ROLE_KEY, { productId });
    check('recheck returns 200', res.status === 200, `status ${res.status}`);
    const offerA3 = await getOffer(svc, offerAId);
    check('offer A outcome is out_of_stock', offerA3.last_check_outcome === 'out_of_stock', offerA3.last_check_outcome);
    check('offer A consecutive_failures reset to 0', offerA3.consecutive_failures === 0, offerA3.consecutive_failures);
    check('offer A in_stock is false', offerA3.in_stock === false, offerA3.in_stock);

    console.log('\nScenario: gone increments consecutive_failures');
    await svc.from('product_offers').update({ canonical_url: `${FIXTURE_ORIGIN}/product/missing` }).eq('id', offerAId);
    res = await callGearRecheck(SERVICE_ROLE_KEY, { productId });
    check('recheck returns 200', res.status === 200, `status ${res.status}`);
    const offerA4 = await getOffer(svc, offerAId);
    check('offer A outcome is gone', offerA4.last_check_outcome === 'gone', offerA4.last_check_outcome);
    check('offer A consecutive_failures incremented to 1', offerA4.consecutive_failures === 1, offerA4.consecutive_failures);

    console.log('\nScenario: blocked increments consecutive_failures (503, one retry, still blocked)');
    errorRouteHits = 0;
    await svc.from('product_offers').update({ canonical_url: `${FIXTURE_ORIGIN}/product/error` }).eq('id', offerAId);
    res = await callGearRecheck(SERVICE_ROLE_KEY, { productId });
    check('recheck returns 200', res.status === 200, `status ${res.status}`);
    const offerA5 = await getOffer(svc, offerAId);
    check('offer A outcome is blocked', offerA5.last_check_outcome === 'blocked', offerA5.last_check_outcome);
    check('offer A consecutive_failures incremented to 2', offerA5.consecutive_failures === 2, offerA5.consecutive_failures);
    check('the 503 route was hit twice (fetch then one retry)', errorRouteHits === 2, errorRouteHits);

    console.log('\nScenario: a 200 with no parseable product logs unparsed, ai_suggestion stays null');
    await svc.from('product_offers').update({ canonical_url: `${FIXTURE_ORIGIN}/product/unparseable` }).eq('id', offerAId);
    res = await callGearRecheck(SERVICE_ROLE_KEY, { productId });
    check('recheck returns 200', res.status === 200, `status ${res.status}`);
    const offerA6 = await getOffer(svc, offerAId);
    check('offer A outcome degrades to gone (no unparsed value on product_offers)', offerA6.last_check_outcome === 'gone', offerA6.last_check_outcome);
    const logRow = await latestFetchLog(svc, offerAId);
    check('the fetch log row itself records outcome unparsed', logRow?.outcome === 'unparsed', logRow?.outcome);
    check('ai_suggestion stays null with no ANTHROPIC_API_KEY (no error either)', logRow?.ai_suggestion === null, JSON.stringify(logRow?.ai_suggestion));

    console.log('\nScenario: 7-strike auto-delist (AC-11-4, "test with the counter set to 6")');
    await svc
      .from('product_offers')
      .update({ canonical_url: `${FIXTURE_ORIGIN}/product/missing`, consecutive_failures: 6 })
      .eq('id', offerAId);
    await svc
      .from('product_offers')
      .update({ canonical_url: `${FIXTURE_ORIGIN}/product/missing`, consecutive_failures: 6 })
      .eq('id', offerBId);
    res = await callGearRecheck(SERVICE_ROLE_KEY, { productId });
    check('recheck returns 200', res.status === 200, `status ${res.status}, ${JSON.stringify(res.json)}`);
    check('gear-recheck reports the product in autoDelisted', Array.isArray(res.json.autoDelisted) && res.json.autoDelisted.includes(productId), JSON.stringify(res.json.autoDelisted));

    const { data: delistedProduct, error: delistedError } = await svc
      .from('affiliate_products')
      .select('active, auto_delisted_at')
      .eq('id', productId)
      .single();
    if (delistedError) throw new Error(`[verify-gear-health] reading delisted product failed: ${delistedError.message}`);
    check('product active is false', delistedProduct.active === false, delistedProduct.active);
    check('product auto_delisted_at is set', delistedProduct.auto_delisted_at !== null, delistedProduct.auto_delisted_at);

    const { data: auditRows, error: auditError } = await svc
      .from('audit_log')
      .select('actor_id, action')
      .eq('entity_id', productId)
      .eq('action', 'affiliate_product.auto_delist');
    if (auditError) throw new Error(`[verify-gear-health] reading audit_log failed: ${auditError.message}`);
    check('exactly one affiliate_product.auto_delist audit_log row exists', (auditRows ?? []).length === 1, (auditRows ?? []).length);
    check('that row has actor_id null', (auditRows ?? [])[0]?.actor_id === null, JSON.stringify(auditRows));
  } finally {
    await stopServe();
    await stopFixtureServer();

    if (offerAId) await svc.from('product_offers').delete().eq('id', offerAId);
    if (offerBId) await svc.from('product_offers').delete().eq('id', offerBId);
    if (productId) {
      await svc.from('audit_log').delete().eq('entity_id', productId).eq('action', 'affiliate_product.auto_delist');
      await svc.from('affiliate_products').delete().eq('id', productId);
    }
    await svc.from('retailer_programmes').delete().eq('key', PROGRAMME_KEY);
  }

  console.log('\n=== SUMMARY ===');
  if (failures.length === 0) {
    console.log('Verdict: gear-recheck PROVEN (every outcome, 7-strike auto-delist with actor_id null, anon refused).');
    process.exit(0);
  }
  console.log(`Verdict: ${failures.length} FAILED assertion(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch(async (err) => {
  console.error('[verify-gear-health] FAILED:', err.message ?? err);
  await stopServe();
  await stopFixtureServer();
  process.exit(1);
});
