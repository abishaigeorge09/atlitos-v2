// AT-111..114 Track B verification, run against the DEPLOYED functions on
// syzzfgaudpifwvbpycyi with a real donor JWT. Signs the Razorpay callback triple
// locally with the same RAZORPAY_KEY_SECRET the deployed verify-payment verifies
// against, so the real gate, the real finalize-donation-payment handler, the real
// record_donation_from_draft transaction and the real ledger write all run.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ROOT = '.';
function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const mobileEnv = readEnvFile(`${ROOT}/apps/mobile/.env`);
const fnEnv = readEnvFile(`${ROOT}/supabase/.env`);
const SUPABASE_URL = mobileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const KEY_SECRET = fnEnv.RAZORPAY_KEY_SECRET;
const PASSWORD = 'AtlitosDemo!2026';

const UPA = '4f7616f4-f43f-4dd9-b2cb-f166ec268081';
const ITEM_A = '2a1c55e4-0bff-437a-a456-e69f44dfd227'; // cost 5000, funded 0
const ADDRESS = 'c8971c75-5b0f-4a8f-824f-3b90857fdfd0';
const VARIANT = '30000000-0000-0000-0000-000000000016'; // price 100 -> roundup 2

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'player@atlitos.dev', password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign in failed: ${JSON.stringify(json)}`);
  return json.access_token;
}
async function callFn(name, token, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}
const sig = (orderId, paymentId) => createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
async function capture(token, orderId, tag) {
  const paymentId = `pay_P6${tag}`;
  return callFn('verify-payment', token, {
    razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig(orderId, paymentId),
  });
}

const R = {};
const token = await signIn();

// A. Item-specific donation fully funding ITEM_A (5000).
R.A_donate = await callFn('donate', token, { upa_id: UPA, item_id: ITEM_A, amount: 5000, method: 'standalone' });
if (R.A_donate.json.razorpay_order_id) {
  R.A_capture = await capture(token, R.A_donate.json.razorpay_order_id, 'A');
  R.A_capture_replay = await capture(token, R.A_donate.json.razorpay_order_id, 'A'); // idempotency
}

// B. General (no item) donation to the UPA (250).
R.B_donate = await callFn('donate', token, { upa_id: UPA, amount: 250 });
if (R.B_donate.json.razorpay_order_id) {
  R.B_capture = await capture(token, R.B_donate.json.razorpay_order_id, 'B');
}

// C. MIN_AMOUNT floor (min 10).
R.C_min_amount = await callFn('donate', token, { upa_id: UPA, amount: 5 });

// D. PRICE_MISMATCH (client expected_total disagrees with amount).
R.D_price_mismatch = await callFn('donate', token, { upa_id: UPA, amount: 100, expected_total: 200 });

// E. ITEM_FUNDED (ITEM_A is now funded by A).
R.E_item_funded = await callFn('donate', token, { upa_id: UPA, item_id: ITEM_A, amount: 100 });

// F. Commerce roundup forward arm: checkout with roundup, then capture.
R.F_checkout = await callFn('checkout', token, { items: [{ product_variant_id: VARIANT, qty: 1 }], address_id: ADDRESS, donation_roundup: true });
if (R.F_checkout.json.razorpay_order_id) {
  R.F_capture = await capture(token, R.F_checkout.json.razorpay_order_id, 'F');
}

console.log(JSON.stringify({
  donorId_hint: 'player@atlitos.dev',
  A_donate: R.A_donate, A_capture: R.A_capture, A_capture_replay: R.A_capture_replay,
  B_donate: R.B_donate, B_capture: R.B_capture,
  C_min_amount: R.C_min_amount, D_price_mismatch: R.D_price_mismatch, E_item_funded: R.E_item_funded,
  F_checkout: R.F_checkout, F_capture: R.F_capture,
}, null, 2));
