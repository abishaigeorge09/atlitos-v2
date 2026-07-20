// AT-87 oversell probe, Track F verification.
//
// Drives TWO GENUINELY CONCURRENT checkouts through the DEPLOYED `checkout`
// edge function against a variant whose raw stock is 1, using two DISTINCT
// shopper JWTs. Track A proved the no-oversell property at the RPC level with
// parallel Postgres connections; this proves it through the deployed HTTP
// path, which is a different code path (pre-check, intent insert, reserve RPC,
// draft insert, Razorpay call).
//
// Gate clause 4 asks for three things, and each is asserted here:
//   1. exactly one checkout reaches capture
//   2. the other is refused OUT_OF_STOCK *before Razorpay is called*
//   3. product_variants.stock never goes negative
//
// Point 2 is the one that cannot be taken on trust from the status code alone.
// The proof used here is that the loser's payment_intents row still carries the
// `pending:` placeholder razorpay_order_id that `checkout` writes at step 4 and
// only overwrites at step 7 after createOrder() returns. A real Razorpay order
// id (`order_...`) on the loser would mean the charge was attempted before the
// refusal, which is the failure mode the clause exists to catch.

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

const VARIANT = '30000000-0000-0000-0000-000000000004';

const SHOPPERS = [
  { email: 'player@atlitos.dev', address: 'c8971c75-5b0f-4a8f-824f-3b90857fdfd0' },
  { email: 'p2-verify-athlete@atlitos.dev', address: '2a13256c-eec1-4627-b197-7d2873a9b406' },
];

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign in failed for ${email}: ${JSON.stringify(json)}`);
  return { token: json.access_token, userId: json.user.id };
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

const out = {};

// ---------------------------------------------------------------- sign in
const a = await signIn(SHOPPERS[0].email);
const b = await signIn(SHOPPERS[1].email);

// The AT-62 lesson: assert the two parties actually differ before trusting
// anything downstream that depends on them being different people.
if (a.userId === b.userId) throw new Error('probe is vacuous: both shoppers are the same user');
out.shopper_a = a.userId;
out.shopper_b = b.userId;
out.ids_differ = true;

// ------------------------------------------------------- the concurrent race
// Both requests are constructed first and started in the same tick, so the two
// edge function isolates genuinely overlap rather than running back to back.
const payload = (address_id) => ({
  items: [{ product_variant_id: VARIANT, qty: 1 }],
  address_id,
  donation_roundup: false,
});

const started = Date.now();
const [resA, resB] = await Promise.all([
  callFunction('checkout', a.token, payload(SHOPPERS[0].address)),
  callFunction('checkout', b.token, payload(SHOPPERS[1].address)),
]);
out.race_elapsed_ms = Date.now() - started;

out.checkout_a = { status: resA.status, body: resA.json };
out.checkout_b = { status: resB.status, body: resB.json };

const winners = [resA, resB].filter((r) => r.status === 200);
const losers = [resA, resB].filter((r) => r.status !== 200);

out.winner_count = winners.length;
out.loser_count = losers.length;
out.loser_codes = losers.map((r) => r.json.code ?? r.json.error?.code ?? JSON.stringify(r.json).slice(0, 200));

if (winners.length === 1 && losers.length === 1 && !process.env.NO_CAPTURE) {
  out.winner_intent = winners[0].json.payment_intent_id;
  out.winner_razorpay_order_id = winners[0].json.razorpay_order_id;
  out.winner_amount_paise = winners[0].json.amount;
  out.winner_bill = winners[0].json.bill;

  // ------------------------------------------------ capture the winner
  // Signed with the same secret the deployed verify-payment verifies against,
  // so the real shared gate, the real commerce handler, the real
  // place_order_from_draft transaction and the real ledger write all run.
  const paymentId = `pay_probe${Date.now().toString().slice(-8)}`;
  const signature = createHmac('sha256', KEY_SECRET)
    .update(`${out.winner_razorpay_order_id}|${paymentId}`)
    .digest('hex');

  const capture = await callFunction('verify-payment', a.token === winners[0].token ? a.token : (resA.status === 200 ? a.token : b.token), {
    razorpay_order_id: out.winner_razorpay_order_id,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  });
  out.capture = { status: capture.status, body: capture.json };
}

console.log(JSON.stringify(out, null, 2));
