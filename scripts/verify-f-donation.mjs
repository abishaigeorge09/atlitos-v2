// TRACK F independent donation re-proof. Drives the DEPLOYED donate + verify-payment
// gate with a real fixture donor JWT, signing the Razorpay callback locally with the
// real RAZORPAY_KEY_SECRET. Targets the OPEN ground-rental item (partial fund), not
// Track B's item, so this is a fresh, independent witness.
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

const UPA = '4f7616f4-f43f-4dd9-b2cb-f166ec268081';
const ITEM_GROUND = '976221c9-aa02-4b0b-aacf-49ffee60d7f1'; // open, cost 3000, funded 2000
const ITEM_CRICKET = '2a1c55e4-0bff-437a-a456-e69f44dfd227'; // already funded

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign in failed: ${JSON.stringify(json)}`);
  return { token: json.access_token, uid: json.user.id };
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
const sig = (o, p) => createHmac('sha256', KEY_SECRET).update(`${o}|${p}`).digest('hex');
async function capture(token, orderId, tag) {
  const paymentId = `pay_F${tag}${Date.now()%100000}`;
  return callFn('verify-payment', token, {
    razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig(orderId, paymentId),
  });
}

const { token, uid } = await signIn('player@atlitos.dev');
const R = { donor_uid: uid };

// 1. Item-specific PARTIAL donation to open ground-rental item (100).
R.item_donate = await callFn('donate', token, { upa_id: UPA, item_id: ITEM_GROUND, amount: 100, method: 'standalone' });
if (R.item_donate.json.razorpay_order_id) {
  R.item_capture = await capture(token, R.item_donate.json.razorpay_order_id, 'G');
  R.item_capture_replay = await capture(token, R.item_donate.json.razorpay_order_id, 'G'); // idempotency
  R.item_order_id = R.item_donate.json.razorpay_order_id;
}

// 2. General (no item) donation to the UPA (75).
R.gen_donate = await callFn('donate', token, { upa_id: UPA, amount: 75 });
if (R.gen_donate.json.razorpay_order_id) {
  R.gen_capture = await capture(token, R.gen_donate.json.razorpay_order_id, 'X');
  R.gen_order_id = R.gen_donate.json.razorpay_order_id;
}

// 3. Error paths (must fire BEFORE any charge -> no razorpay_order_id)
R.err_min_amount = await callFn('donate', token, { upa_id: UPA, amount: 5 });          // expect 422 MIN_AMOUNT
R.err_price_mismatch = await callFn('donate', token, { upa_id: UPA, amount: 100, expected_total: 200 }); // expect 409
R.err_item_funded = await callFn('donate', token, { upa_id: UPA, item_id: ITEM_CRICKET, amount: 50 });   // expect 409 ITEM_FUNDED

console.log(JSON.stringify(R, null, 2));
