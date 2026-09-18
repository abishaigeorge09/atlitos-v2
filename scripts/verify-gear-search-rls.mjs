#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-gear-search-rls.mjs
//
// Phase S1, Track A. Proves ADR-011 D6 / AC-11-6, AC-11-7 as built against
// the LOCAL stack: anon and an authenticated (non admin) player cannot read
// `embedding`, cannot call `match_affiliate_products`, and cannot write any
// of `affiliate_products` / `product_offers` / `query_embedding_cache` /
// `app_config`; service_role can call `match_affiliate_products` against a
// seeded product.
//
// The AT-62 lesson, applied even though this is not a per-user isolation
// test: anon and the authenticated player are genuinely different auth
// contexts, not the same key twice by accident. Checked by decoding both
// JWTs and asserting the `role` claim differs and the player's carries a
// real `sub`, before trusting anything either one is refused.
//
// Run: node scripts/verify-gear-search-rls.mjs
// Requires the local stack running (`supabase start`) and
// scripts/seed-demo-users.mjs already run once so player@atlitos.dev exists.

const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'AtlitosDemo!2026';

if (!ANON || !SERVICE_ROLE_KEY) {
  console.error(
    '[verify-gear-search-rls] SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required ' +
      '(from `supabase status`), and SUPABASE_URL defaults to http://127.0.0.1:54321.',
  );
  process.exit(1);
}

let failed = 0;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function decodeJwt(token) {
  const [, payload] = token.split('.');
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

async function signIn(email) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign in failed ${email}: ${JSON.stringify(json)}`);
  return { token: json.access_token, userId: json.user.id };
}

async function rest(apikey, token, method, path, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function rpc(apikey, token, fn, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// ---------------------------------------------------------------------------
// Identities: anon (the anon apikey with no bearer session of its own, so it
// is sent as both apikey and Authorization) and an authenticated, NON admin
// player.
// ---------------------------------------------------------------------------
const player = await signIn('player@atlitos.dev');

const anonClaims = decodeJwt(ANON);
const playerClaims = decodeJwt(player.token);

record(
  'identities-differ',
  anonClaims.role !== playerClaims.role && typeof playerClaims.sub === 'string' && playerClaims.sub.length > 0,
  `anon.role=${anonClaims.role} player.role=${playerClaims.role} player.sub=${playerClaims.sub}`,
);
if (anonClaims.role === playerClaims.role) {
  throw new Error('VACUOUS PROBE: anon and the authenticated player resolved to the same JWT role');
}

const IDENTITIES = [
  { label: 'anon', apikey: ANON, token: ANON },
  { label: 'authenticated player', apikey: ANON, token: player.token },
];

const ZERO_VECTOR = JSON.stringify(new Array(1024).fill(0));

// ---------------------------------------------------------------------------
// Seed one product with a zero vector under service_role, for the
// service-role match_affiliate_products proof at the end.
// ---------------------------------------------------------------------------
const seedRes = await rest(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY, 'POST', 'affiliate_products', {
  title: 'S1 RLS probe racket',
  brand: 'ProbeBrand',
  active: true,
  embedding: ZERO_VECTOR,
});
const seededProduct = Array.isArray(seedRes.body) ? seedRes.body[0] : null;
record('seed-product-service-role', seedRes.status === 201 && !!seededProduct, `status=${seedRes.status}`);

for (const identity of IDENTITIES) {
  const label = identity.label;

  // 1. select embedding refused.
  const embRes = await rest(identity.apikey, identity.token, 'GET', 'affiliate_products?select=embedding&limit=1');
  record(
    `${label}: select embedding refused`,
    embRes.status === 401 || embRes.status === 403 || embRes.status === 400,
    `status=${embRes.status} body=${JSON.stringify(embRes.body).slice(0, 200)}`,
  );

  // 2. select id,title works.
  const idTitleRes = await rest(identity.apikey, identity.token, 'GET', 'affiliate_products?select=id,title&limit=1');
  record(
    `${label}: select id,title works`,
    idTitleRes.status === 200 && Array.isArray(idTitleRes.body),
    `status=${idTitleRes.status}`,
  );

  // 3. rpc match_affiliate_products refused.
  const matchRes = await rpc(identity.apikey, identity.token, 'match_affiliate_products', {
    query_embedding: JSON.parse(ZERO_VECTOR),
    match_threshold: 0.5,
    match_count: 5,
  });
  record(
    `${label}: rpc match_affiliate_products refused`,
    matchRes.status === 401 || matchRes.status === 403 || matchRes.status === 404,
    `status=${matchRes.status} body=${JSON.stringify(matchRes.body).slice(0, 200)}`,
  );

  // 4. inserts refused on every table this migration touches.
  const insertAffiliate = await rest(identity.apikey, identity.token, 'POST', 'affiliate_products', {
    title: `${label} forbidden insert`,
    active: true,
  });
  record(
    `${label}: insert affiliate_products refused`,
    insertAffiliate.status === 401 || insertAffiliate.status === 403,
    `status=${insertAffiliate.status}`,
  );

  const insertOffer = await rest(identity.apikey, identity.token, 'POST', 'product_offers', {
    affiliate_product_id: seededProduct?.id ?? '00000000-0000-0000-0000-000000000000',
    retailer: `${label} forbidden`,
    price: 1,
    affiliate_url: 'https://example.com',
  });
  record(
    `${label}: insert product_offers refused`,
    insertOffer.status === 401 || insertOffer.status === 403,
    `status=${insertOffer.status}`,
  );

  const insertCache = await rest(identity.apikey, identity.token, 'POST', 'query_embedding_cache', {
    query_hash: `${label}-forbidden`,
    embedding: ZERO_VECTOR,
  });
  record(
    `${label}: insert query_embedding_cache refused`,
    insertCache.status === 401 || insertCache.status === 403 || insertCache.status === 404,
    `status=${insertCache.status}`,
  );

  const insertConfig = await rest(identity.apikey, identity.token, 'POST', 'app_config', {
    key: `${label}-forbidden`,
    value: true,
    public: true,
  });
  record(
    `${label}: insert app_config refused`,
    insertConfig.status === 401 || insertConfig.status === 403,
    `status=${insertConfig.status}`,
  );
}

// ---------------------------------------------------------------------------
// service_role: match_affiliate_products works against the seeded zero
// vector product (returns 200, not an error; the seeded row is a NaN
// similarity match so it is not required to appear in the result set).
// ---------------------------------------------------------------------------
const serviceMatch = await rpc(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY, 'match_affiliate_products', {
  query_embedding: JSON.parse(ZERO_VECTOR),
  match_threshold: 0.5,
  match_count: 5,
});
record(
  'service_role: rpc match_affiliate_products works',
  serviceMatch.status === 200 && Array.isArray(serviceMatch.body),
  `status=${serviceMatch.status} rows=${Array.isArray(serviceMatch.body) ? serviceMatch.body.length : 'n/a'}`,
);

// Cleanup the seeded probe row under service role, so re-runs stay clean.
if (seededProduct?.id) {
  await rest(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY, 'DELETE', `affiliate_products?id=eq.${seededProduct.id}`);
}

console.log('');
console.log(`verify-gear-search-rls: ${results.length - failed} of ${results.length} checks passed.`);
if (failed > 0) {
  console.log(`verify-gear-search-rls: ${failed} FAILED.`);
  process.exit(1);
}
process.exit(0);
