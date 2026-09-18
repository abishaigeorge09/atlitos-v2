#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-owned-shop-flag.mjs
//
// Phase S1, Track A. Proves ADR-011 D5 / PRD-07 FR-53 / AC-11-5 as built
// against the LOCAL stack:
//   - anon reads shop.owned_enabled from app_config (a public=true row)
//   - anon cannot see a public=false row
//   - anon cannot call admin_set_app_config
//   - an admin can flip the flag through admin_set_app_config, an audit_log
//     row appears, and it is flipped back so the tree is left as found
//   - with the flag false, POST to the local `checkout` function returns
//     403 OWNED_SHOP_DISABLED, before any pricing
//
// Requires: `supabase start` and `supabase functions serve` both running
// locally, and scripts/seed-demo-users.mjs already run so admin@atlitos.dev
// and player@atlitos.dev exist.

const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'AtlitosDemo!2026';

if (!ANON || !SERVICE_ROLE_KEY) {
  console.error(
    '[verify-owned-shop-flag] SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required ' +
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
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

const admin = await signIn('admin@atlitos.dev');
const player = await signIn('player@atlitos.dev');

// ---------------------------------------------------------------------------
// 1. anon reads shop.owned_enabled (public=true row).
// ---------------------------------------------------------------------------
const anonRead = await rest(
  ANON, ANON, 'GET',
  'app_config?select=key,value,public&key=eq.shop.owned_enabled',
);
record(
  'anon: reads shop.owned_enabled',
  anonRead.status === 200 && Array.isArray(anonRead.body) && anonRead.body.length === 1 && anonRead.body[0].value === false,
  `status=${anonRead.status} body=${JSON.stringify(anonRead.body)}`,
);

// ---------------------------------------------------------------------------
// 2. seed a private (public=false) row via service_role, prove anon cannot
//    see it.
// ---------------------------------------------------------------------------
const PRIVATE_KEY = 's1-verify-private-flag';
await rest(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY, 'DELETE', `app_config?key=eq.${PRIVATE_KEY}`);
const seedPrivate = await rest(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY, 'POST', 'app_config', {
  key: PRIVATE_KEY,
  value: 'secret',
  public: false,
});
record('seed private row (service_role)', seedPrivate.status === 201, `status=${seedPrivate.status}`);

const anonPrivateRead = await rest(ANON, ANON, 'GET', `app_config?select=key&key=eq.${PRIVATE_KEY}`);
record(
  'anon: cannot see public=false row',
  anonPrivateRead.status === 200 && Array.isArray(anonPrivateRead.body) && anonPrivateRead.body.length === 0,
  `status=${anonPrivateRead.status} body=${JSON.stringify(anonPrivateRead.body)}`,
);

// ---------------------------------------------------------------------------
// 3. anon cannot call admin_set_app_config.
// ---------------------------------------------------------------------------
const anonAdminCall = await rpc(ANON, ANON, 'admin_set_app_config', {
  p_key: PRIVATE_KEY,
  p_value: 'anon-write-attempt',
});
record(
  'anon: cannot call admin_set_app_config',
  anonAdminCall.status === 401 || anonAdminCall.status === 403 || anonAdminCall.status === 404,
  `status=${anonAdminCall.status} body=${JSON.stringify(anonAdminCall.body)}`,
);

// A non admin authenticated player must also be refused (has_role('admin')
// checked inside the function, not just the grant).
const playerAdminCall = await rpc(ANON, player.token, 'admin_set_app_config', {
  p_key: PRIVATE_KEY,
  p_value: 'player-write-attempt',
});
record(
  'authenticated player (non admin): cannot call admin_set_app_config',
  playerAdminCall.status >= 400,
  `status=${playerAdminCall.status} body=${JSON.stringify(playerAdminCall.body)}`,
);

// ---------------------------------------------------------------------------
// 4. admin flips shop.owned_enabled true -> audit_log row appears -> flips
//    it back. The tree is left with the flag false, matching the seed.
// ---------------------------------------------------------------------------
const beforeAuditCount = await rest(
  ANON, admin.token, 'GET',
  "audit_log?select=id&action=eq.app_config.set&order=created_at.desc&limit=1",
);

const flipOn = await rpc(ANON, admin.token, 'admin_set_app_config', {
  p_key: 'shop.owned_enabled',
  p_value: true,
});
record(
  'admin: flips shop.owned_enabled to true',
  flipOn.status === 200 && flipOn.body?.value === true,
  `status=${flipOn.status} body=${JSON.stringify(flipOn.body)}`,
);

const afterAudit = await rest(
  ANON, admin.token, 'GET',
  "audit_log?select=id,action,actor_id,before,after&action=eq.app_config.set&order=created_at.desc&limit=1",
);
const auditRow = Array.isArray(afterAudit.body) ? afterAudit.body[0] : null;
record(
  'admin: audit_log row appears for app_config.set',
  afterAudit.status === 200 && !!auditRow && auditRow.after?.value === true,
  `status=${afterAudit.status} row=${JSON.stringify(auditRow)}`,
);

const flipOff = await rpc(ANON, admin.token, 'admin_set_app_config', {
  p_key: 'shop.owned_enabled',
  p_value: false,
});
record(
  'admin: flips shop.owned_enabled back to false',
  flipOff.status === 200 && flipOff.body?.value === false,
  `status=${flipOff.status} body=${JSON.stringify(flipOff.body)}`,
);

// Cleanup the private probe row.
await rest(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY, 'DELETE', `app_config?key=eq.${PRIVATE_KEY}`);

// ---------------------------------------------------------------------------
// 5. checkout refuses OWNED_SHOP_DISABLED with the flag false, before any
//    pricing. Requires `supabase functions serve` running locally.
// ---------------------------------------------------------------------------
const FUNCTIONS_BASE = process.env.SUPABASE_FUNCTIONS_URL ?? `${URL_BASE}/functions/v1`;
try {
  const checkoutRes = await fetch(`${FUNCTIONS_BASE}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${player.token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ product_variant_id: '00000000-0000-0000-0000-000000000001', qty: 1 }],
      address_id: '00000000-0000-0000-0000-000000000002',
      donation_roundup: false,
    }),
  });
  const checkoutJson = await checkoutRes.json().catch(() => null);
  record(
    'checkout: refuses OWNED_SHOP_DISABLED with the flag false',
    checkoutRes.status === 403 && checkoutJson?.error?.code === 'OWNED_SHOP_DISABLED',
    `status=${checkoutRes.status} body=${JSON.stringify(checkoutJson)}`,
  );
} catch (err) {
  record(
    'checkout: refuses OWNED_SHOP_DISABLED with the flag false',
    false,
    `could not reach ${FUNCTIONS_BASE}/checkout: ${err.message}. Run \`supabase functions serve\` first.`,
  );
}

console.log('');
console.log(`verify-owned-shop-flag: ${results.length - failed} of ${results.length} checks passed.`);
if (failed > 0) {
  console.log(`verify-owned-shop-flag: ${failed} FAILED.`);
  process.exit(1);
}
process.exit(0);
