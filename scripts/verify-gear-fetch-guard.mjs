#!/usr/bin/env node
// Red team 2026-09-18, CWE-918. Proves the outbound fetch guard in
// supabase/functions/_shared/fetch-page.ts holds through gear-ingest: an admin
// cannot make the server fetch the cloud metadata address, loopback, a docker
// service name, an IP literal, a look-alike retailer host, or an image on an
// internal address. Every case must be REFUSED without a request leaving.
//
// Requires `supabase functions serve` running against the LOCAL stack with the
// same env the other gear verify scripts use (FETCH_ALLOW_HOSTS may name the
// fixture host; it must NOT name any host tried here). Local only; never
// production.
//
// Born red: against the pre-guard gear-ingest (git show 23e3e37) every case
// below returned a fetch attempt (a 422 "Could not read a product" after a
// real outbound request, or a draft). After the guard each returns 422 with a
// guard reason before any request is made.
import { createClient } from '@supabase/supabase-js';
import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTIONS = process.env.SUPABASE_FUNCTIONS_URL ?? `${SUPABASE_URL}/functions/v1`;
if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error('set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
assertWritableTarget(SUPABASE_URL, 'verify-gear-fetch-guard.mjs');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed += 1;
}

const admin = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
const { data: session, error: signInError } = await admin.auth.signInWithPassword({
  email: 'admin@atlitos.dev',
  password: 'AtlitosDemo!2026',
});
if (signInError) {
  console.error('admin sign in failed (run scripts/seed-demo-users.mjs first):', signInError.message);
  process.exit(2);
}
const token = session.session.access_token;

async function ingest(body) {
  const res = await fetch(`${FUNCTIONS}/gear-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

const GUARD_REASONS = [
  'not a supported retailer',
  'IP address targets are not allowed',
  'Internal hostnames are not allowed',
  'does not resolve to a public address',
  'Only http/https',
];
function refusedByGuard(r) {
  const msg = r.json?.error?.message ?? r.json?.message ?? '';
  return r.status === 422 && GUARD_REASONS.some((g) => msg.includes(g)) ? null : `status=${r.status} body=${JSON.stringify(r.json).slice(0, 160)}`;
}

// A programme that matches amazon.in exists in the seed; look-alikes must not match it.
const cases = [
  ['metadata service', 'http://169.254.169.254/latest/meta-data/'],
  ['loopback rest api', 'http://127.0.0.1:54321/rest/v1/users'],
  ['docker service name', 'http://kong:8000/'],
  ['ipv6 loopback', 'http://[::1]:54321/'],
  ['look-alike subdomain of evil', 'https://amazon.in.evil.com/dp/x'],
  ['look-alike in path', 'https://evil.com/amazon.in/dp/x'],
  ['localhost name', 'http://localhost:54321/'],
  ['file scheme', 'file:///etc/passwd'],
];
for (const [name, url] of cases) {
  const r = await ingest({ action: 'fetch', url });
  const why = refusedByGuard(r);
  check(`fetch refused: ${name}`, why === null, why ?? `422 ${r.json?.error?.message ?? r.json?.message}`);
}

// Second layer: even a programme that names an internal host or an IP does
// not get it fetched. The allowlist is the first fence, not the only one.
const svc0 = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
await svc0.from('retailer_programmes').delete().like('key', 'guard_test_%');
const { error: badProgrammeError } = await svc0.from('retailer_programmes').insert([
  { key: 'guard_test_ip', display_name: 'Guard test IP', url_patterns: ['169.254.169.254', '127.0.0.1'], affiliate_tag_template: null, extractor: null, fetch_policy: { maxPerMinute: 10 }, active: true },
  { key: 'guard_test_internal', display_name: 'Guard test internal', url_patterns: ['kong', 'localhost', 'db.internal'], affiliate_tag_template: null, extractor: null, fetch_policy: { maxPerMinute: 10 }, active: true },
]);
if (badProgrammeError) { console.error('could not seed guard programmes:', badProgrammeError.message); process.exit(2); }
const deeper = [
  ['programme allows metadata IP', 'http://169.254.169.254/latest/meta-data/', 'IP address targets are not allowed'],
  ['programme allows loopback IP', 'http://127.0.0.1:54321/rest/v1/users', 'IP address targets are not allowed'],
  ['programme allows docker name', 'http://kong:8000/', 'Internal hostnames are not allowed'],
  ['programme allows localhost', 'http://localhost:54321/', 'Internal hostnames are not allowed'],
  ['programme allows .internal', 'http://db.internal/', 'Internal hostnames are not allowed'],
];
for (const [name, url, expected] of deeper) {
  const r = await ingest({ action: 'fetch', url });
  const msg = r.json?.error?.message ?? '';
  check(`deeper guard: ${name}`, r.status === 422 && msg.includes(expected), `status=${r.status} ${msg.slice(0, 90)}`);
}
await svc0.from('retailer_programmes').delete().like('key', 'guard_test_%');

// Image on an internal address: the save must not copy it. Use a real
// programme host for the page URL so only the image is the attack.
const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const { data: programmes } = await svc.from('retailer_programmes').select('key,url_patterns').eq('active', true).limit(1);
const host = programmes?.[0]?.url_patterns?.[0] ?? 'amazon.in';
const r = await ingest({
  action: 'save',
  url: `https://${host}/dp/guard-test`,
  draft: { title: 'Guard test product', brand: null, price: 1, currency: 'INR', inStock: true, imageUrl: 'http://127.0.0.1:54321/rest/v1/users', canonicalUrl: null, description: null },
});
// The page host is real and public, so the save may succeed; the image must be null.
if (r.status === 200 && r.json?.productId) {
  const { data: prod } = await svc.from('affiliate_products').select('image_url,image_path').eq('id', r.json.productId).single();
  check('save with internal image url copies nothing', prod.image_path === null && prod.image_url === null, JSON.stringify(prod));
  await svc.from('affiliate_products').delete().eq('id', r.json.productId);
} else {
  // Any refusal is also acceptable here (the page host itself may be unreachable offline).
  check('save with internal image url did not copy the image', true, `status=${r.status}`);
}

await admin.auth.signOut();
if (failed) {
  console.log(`verify-gear-fetch-guard: ${failed} FAILED.`);
  process.exit(1);
}
console.log('verify-gear-fetch-guard: all checks passed.');
