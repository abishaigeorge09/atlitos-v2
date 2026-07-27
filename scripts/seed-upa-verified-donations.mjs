// ATLITOS v2 — scripts/seed-upa-verified-donations.mjs
//
// Fixture seed (test-data, NOT product): give the demo verified UPA seat
// upa.verified@ (application f0000000-0000-0000-0000-000000000001) real
// money-in of its OWN. This seat genuinely has zero donations; the headline
// rupees belong to a DIFFERENT verified cricket UPA (duplicate seed).
//
// Uses the SAME mechanism the app uses: the `donate` edge function creates a
// payment_intent + Razorpay order, then `verify-payment` captures with a
// locally HMAC-signed Razorpay callback (test mode) which runs the real
// finalize path (donations row + funded_amount move + balanced ledger group).
// No hand-insert into donations/ledger, no reassignment of the other UPA's
// rows. Modeled on the proven scripts/verify-f-donation.mjs.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const mobileEnv = readEnvFile("apps/mobile/.env");
const fnEnv = readEnvFile("supabase/.env");
const SUPABASE_URL = mobileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const KEY_SECRET = fnEnv.RAZORPAY_KEY_SECRET;

const UPA = "f0000000-0000-0000-0000-000000000001"; // upa.verified@ own UPA
const ITEM_GROUND = "a1000000-0000-0000-0000-000000000002"; // open, cost 3000
const ITEM_CRICKET = "a1000000-0000-0000-0000-000000000001"; // open, cost 5000

// Try donor@ first (EmpowerDemo!2026), fall back to player@ (AtlitosDemo!2026).
const DONORS = [
  { email: "donor@atlitos.dev", password: "EmpowerDemo!2026" },
  { email: "player@atlitos.dev", password: "AtlitosDemo!2026" },
];

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.access_token) return null;
  return { token: json.access_token, uid: json.user.id, email };
}
async function callFn(name, token, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}
const sig = (o, p) => createHmac("sha256", KEY_SECRET).update(`${o}|${p}`).digest("hex");
async function capture(token, orderId, tag) {
  const paymentId = `pay_UV${tag}${Date.now() % 100000}`;
  return callFn("verify-payment", token, {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: sig(orderId, paymentId),
  });
}

let donor = null;
for (const d of DONORS) {
  donor = await signIn(d.email, d.password);
  if (donor) break;
}
if (!donor) throw new Error("no donor account could sign in");

const R = { donor: donor.email, donor_uid: donor.uid, donations: [] };

async function donate(label, body) {
  const d = await callFn("donate", donor.token, body);
  const entry = { label, donate_status: d.status, order: d.json.razorpay_order_id ?? null };
  if (d.json.razorpay_order_id) {
    const c = await capture(donor.token, d.json.razorpay_order_id, label[0].toUpperCase());
    entry.capture_status = c.status;
    entry.capture_body = c.json;
  } else {
    entry.donate_body = d.json;
  }
  R.donations.push(entry);
}

// Three real captured donations to upa.verified@'s OWN upa.
await donate("ground", { upa_id: UPA, item_id: ITEM_GROUND, amount: 500, method: "standalone" });
await donate("cricket", { upa_id: UPA, item_id: ITEM_CRICKET, amount: 1000, method: "standalone" });
await donate("general", { upa_id: UPA, amount: 750 });

console.log(JSON.stringify(R, null, 2));
