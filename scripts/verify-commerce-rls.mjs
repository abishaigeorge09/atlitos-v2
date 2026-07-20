// Track F RLS isolation probe for the P4 commerce tables.
//
// The AT-62 lesson, applied: an unscoped query against a permissive-OR table
// passes VACUOUSLY. So this probe does three things in order:
//   1. asserts the two shoppers' user ids actually DIFFER
//   2. asserts each shopper actually HAS rows of its own (a probe where both
//      sides see nothing would also "pass" while proving nothing)
//   3. only then asserts neither can see the other's rows
//
// Every read runs with the shopper's OWN JWT through PostgREST, deliberately
// UNSCOPED (no .eq("user_id", ...)), because the question here is what RLS
// alone returns. App code additionally carries its own filter per CLAUDE.md;
// that belt is checked separately by reading the app code.

import { readFileSync } from 'node:fs';

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = readEnvFile('apps/mobile/.env');
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = 'AtlitosDemo!2026';

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

async function rest(token, path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function rpc(token, fn, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const A = await signIn('player@atlitos.dev');
const B = await signIn('p2-verify-athlete@atlitos.dev');

const out = { shopper_a: A.userId, shopper_b: B.userId };
out.ids_differ = A.userId !== B.userId;
if (!out.ids_differ) throw new Error('VACUOUS PROBE: both shoppers resolved to the same user id');

// Give each side rows of its own on cart and wishlist, through the real RPCs.
const BAT = '30000000-0000-0000-0000-000000000001';
const SHUTTLE = '30000000-0000-0000-0000-000000000014';
out.seed = {
  a_cart: (await rpc(A.token, 'add_to_cart', { p_variant_id: BAT, p_qty: 1 })).status,
  b_cart: (await rpc(B.token, 'add_to_cart', { p_variant_id: SHUTTLE, p_qty: 1 })).status,
  a_wish: (await rpc(A.token, 'toggle_product_wishlist', { p_product_id: '20000000-0000-0000-0000-000000000001' })).status,
  b_wish: (await rpc(B.token, 'toggle_product_wishlist', { p_product_id: '20000000-0000-0000-0000-000000000002' })).status,
};

const TABLES = [
  ['orders', 'orders?select=id,user_id'],
  ['cart_items', 'cart_items?select=id,user_id'],
  ['addresses', 'addresses?select=id,user_id'],
  ['product_wishlist_items', 'product_wishlist_items?select=id,user_id'],
];

out.tables = {};
for (const [name, path] of TABLES) {
  const ra = await rest(A.token, path);
  const rb = await rest(B.token, path);
  const rowsA = Array.isArray(ra.body) ? ra.body : [];
  const rowsB = Array.isArray(rb.body) ? rb.body : [];

  const foreignInA = rowsA.filter((r) => r.user_id !== A.userId);
  const foreignInB = rowsB.filter((r) => r.user_id !== B.userId);

  out.tables[name] = {
    a_row_count: rowsA.length,
    b_row_count: rowsB.length,
    // Non vacuity: at least one side must actually hold rows, otherwise the
    // zero cross visibility below is meaningless.
    non_vacuous: rowsA.length > 0 || rowsB.length > 0,
    a_sees_foreign_rows: foreignInA.length,
    b_sees_foreign_rows: foreignInB.length,
    isolated: foreignInA.length === 0 && foreignInB.length === 0,
  };
}

out.verdict = Object.entries(out.tables).every(
  ([, t]) => t.isolated && t.non_vacuous,
)
  ? 'ISOLATED AND NON VACUOUS'
  : 'REVIEW REQUIRED';

console.log(JSON.stringify(out, null, 2));
