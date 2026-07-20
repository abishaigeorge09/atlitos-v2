// AT-71 / AT-72 / AT-73 verification driver, run against the DEPLOYED
// functions on syzzfgaudpifwvbpycyi with a real player JWT.
//
// Not a fixture seeder and not part of the app. It exercises, in order:
//   1. checkout re-pricing, roundup ZERO case, reservation taken before Razorpay
//   2. checkout roundup NONZERO case
//   3. PRICE_MISMATCH (no charge, no reservation)
//   4. OUT_OF_STOCK (no charge)
//   5. the capture path through the DEPLOYED verify-payment, which is the same
//      shared gate razorpay-webhook uses
//   6. the synchronous Razorpay failure release path in checkout
//
// The capture step signs the Razorpay callback triple locally with the same
// RAZORPAY_KEY_SECRET the deployed verify-payment verifies against, so the
// real gate, the real commerce handler, the real place_order_from_draft
// transaction and the real ledger write all run. The payment id is synthetic,
// which matters only for a refund (Razorpay would reject it), and that is
// called out where it applies.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const mobileEnv = readEnvFile('apps/mobile/.env');
const fnEnv = readEnvFile('supabase/.env');

const SUPABASE_URL = mobileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const KEY_SECRET = fnEnv.RAZORPAY_KEY_SECRET;
const PASSWORD = 'AtlitosDemo!2026';

const ADDRESS_ID = process.argv[2];
const VARIANTS = JSON.parse(process.argv[3]);

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'player@atlitos.dev', password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign in failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function callFunction(name, token, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function paymentSignature(orderId, paymentId) {
  return createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

const results = {};

const token = await signIn();

// ---------------------------------------------------------------- case 1
// Zero roundup. 1000 + 50 delivery + 180 GST = 1230, already a multiple of 10,
// so the derived roundup must be exactly 0 even though the box is CHECKED.
results.case1_checkout = await callFunction('checkout', token, {
  items: [{ product_variant_id: VARIANTS.zero, qty: 1 }],
  address_id: ADDRESS_ID,
  donation_roundup: true,
});

// ---------------------------------------------------------------- case 2
// Nonzero roundup. 999 + 50 + 179.82 = 1228.82, so the roundup is 1.18 and the
// total lands on 1230.00.
results.case2_checkout = await callFunction('checkout', token, {
  items: [{ product_variant_id: VARIANTS.nonzero, qty: 1 }],
  address_id: ADDRESS_ID,
  donation_roundup: true,
});

// ---------------------------------------------------------------- case 3
// PRICE_MISMATCH. The client insists on a total the server did not derive.
results.case3_price_mismatch = await callFunction('checkout', token, {
  items: [{ product_variant_id: VARIANTS.zero, qty: 1 }],
  address_id: ADDRESS_ID,
  donation_roundup: false,
  total: 1.0,
});

// ---------------------------------------------------------------- case 4
// OUT_OF_STOCK. Two units of a variant that has one.
results.case4_out_of_stock = await callFunction('checkout', token, {
  items: [{ product_variant_id: VARIANTS.scarce, qty: 2 }],
  address_id: ADDRESS_ID,
  donation_roundup: false,
});

// ---------------------------------------------------------------- case 5
// Capture both live checkouts through the DEPLOYED verify-payment.
for (const key of ['case1_checkout', 'case2_checkout']) {
  const checkout = results[key].json;
  if (!checkout.razorpay_order_id) continue;
  const paymentId = `pay_TBVERIFY${key === 'case1_checkout' ? 'A' : 'B'}`;
  results[`${key}_capture`] = await callFunction('verify-payment', token, {
    razorpay_order_id: checkout.razorpay_order_id,
    razorpay_payment_id: paymentId,
    razorpay_signature: paymentSignature(checkout.razorpay_order_id, paymentId),
  });
  // Second delivery, to prove the gate is idempotent for commerce too.
  results[`${key}_capture_replay`] = await callFunction('verify-payment', token, {
    razorpay_order_id: checkout.razorpay_order_id,
    razorpay_payment_id: paymentId,
    razorpay_signature: paymentSignature(checkout.razorpay_order_id, paymentId),
  });
}

// ---------------------------------------------------------------- case 6
// The synchronous Razorpay failure. An amount Razorpay refuses outright makes
// checkout's own catch path run for real: release the reservation, fail the
// intent. Nothing here is mocked.
results.case6_razorpay_failure = await callFunction('checkout', token, {
  items: [{ product_variant_id: VARIANTS.huge, qty: 1 }],
  address_id: ADDRESS_ID,
  donation_roundup: false,
});

console.log(JSON.stringify(results, null, 2));
