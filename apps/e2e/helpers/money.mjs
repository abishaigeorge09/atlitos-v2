// ATLITOS v2 — E2E money-rails helper.
//
// "TEST RAILS ONLY" for this harness means the same thing it already means
// in scripts/verify-commerce-payments.mjs, scripts/verify-oversell-probe.mjs
// and scripts/verify-empower-p6.mjs: call the DEPLOYED edge functions with a
// real persona JWT, then complete the capture leg by signing a synthetic
// Razorpay payment id with the same RAZORPAY_KEY_SECRET the deployed
// verify-payment function verifies against. That runs the REAL shared
// finalize gate, the REAL domain handler (finalize-court-booking-payment /
// finalize-session-payment / finalize-order-payment / finalize-donation-
// payment / finalize-membership-payment), and the REAL ledger write. It
// does not drive Razorpay's own checkout.js iframe with a live test card,
// which this repo's own verification scripts also never do, for the same
// reason: that widget is third-party UI outside this codebase, and its
// success path is proven once (PAYMENTS.md's "Exercised against live
// Razorpay" paragraph) rather than re-driven on every spec run.
//
// The secret is never hardcoded and never committed: it comes from
// process.env.RAZORPAY_KEY_SECRET, falling back to supabase/.env (the same
// file scripts/verify-*.mjs already read), matching helpers/sql.mjs's
// "service role key is never hardcoded" discipline for the equivalent
// Supabase secret.

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_URL, anonKey } from "./persona.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function razorpayKeySecret() {
  if (process.env.RAZORPAY_KEY_SECRET) return process.env.RAZORPAY_KEY_SECRET;
  const fnEnv = readEnvFile(join(REPO_ROOT, "supabase", ".env"));
  if (fnEnv.RAZORPAY_KEY_SECRET) return fnEnv.RAZORPAY_KEY_SECRET;
  throw new Error(
    "[e2e/money] No RAZORPAY_KEY_SECRET. Set it in the environment or supabase/.env, " +
      "the same contract scripts/verify-commerce-payments.mjs uses.",
  );
}

/** Calls a deployed edge function with a persona's bearer token. */
export async function callFunction(name, token, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  // Every edge function error response is shaped { error: { code, message } }
  // (supabase/functions/_shared/http.ts's errorResponse), not a top-level
  // { code, message }. Flatten it onto the top level too so spec code can
  // read `.json.code` / `.json.message` uniformly regardless of which shape
  // a given function actually returns, matching the `r.json.code ?? r.json.error?.code`
  // defensiveness scripts/verify-oversell-probe.mjs already uses.
  if (json && typeof json === "object" && json.error && typeof json.error === "object") {
    if (json.code === undefined) json.code = json.error.code;
    if (json.message === undefined) json.message = json.error.message;
  }
  return { status: res.status, json };
}

function paymentSignature(orderId, paymentId) {
  return createHmac("sha256", razorpayKeySecret()).update(`${orderId}|${paymentId}`).digest("hex");
}

/**
 * Completes the capture leg for a razorpay_order_id returned by book-court /
 * book-session / checkout / donate / join-group / renew-group-membership, by
 * calling the deployed verify-payment with a locally-signed synthetic
 * payment id, exactly as scripts/verify-commerce-payments.mjs does. Returns
 * the same { status, json } shape as callFunction. Pass a distinct `tag` per
 * call site so two captures in one spec run never collide on the synthetic
 * payment id.
 */
export async function capturePayment(token, razorpayOrderId, tag = "") {
  const paymentId = `pay_E2E${tag}${Date.now().toString().slice(-8)}`;
  return callFunction("verify-payment", token, {
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: paymentSignature(razorpayOrderId, paymentId),
  });
}
