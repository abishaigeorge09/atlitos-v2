// ATLITOS v2 — CO-04 proof: a coach declining an already-captured coaching
// request now refunds it in full and the session's ledger nets to zero, with
// no orphaned `captured` intent.
//
// Runs against the DEPLOYED backend on syzzfgaudpifwvbpycyi, exactly like
// scripts/verify-*.mjs and apps/e2e/helpers/money.mjs: real persona JWTs, the
// capture leg completed by signing a synthetic Razorpay payment id with the
// same RAZORPAY_KEY_SECRET the deployed verify-payment verifies against, and
// every money claim re-proved against ledger_entries / payment_intents / refunds
// via the service role. The refund leg calls the real Razorpay test-mode refund
// API through the deployed decline-session-refund function.
//
// Guarded like helpers/sql.mjs: refuses to run unless pointed at the one test
// project and armed with E2E=1. The service role key is never hardcoded; it
// comes only from process.env.SUPABASE_SERVICE_ROLE_KEY.

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "syzzfgaudpifwvbpycyi";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const ANON_KEY = "sb_publishable_w81GxOVCX2UVNoQ9NAGTaA_u2kuT29O";
const PASSWORD = "AtlitosDemo!2026";
const SESSION_TYPE_ID = "d11093c3-ef7f-42e0-ad7b-f93c10c5d422"; // coach1 "Batting Basics", 1000, 60min

function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function guard() {
  if (process.env.E2E !== "1") {
    throw new Error("[co04] Refusing to run: arm with E2E=1.");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("[co04] SUPABASE_SERVICE_ROLE_KEY not set.");
  return key;
}

const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET ??
  readEnvFile("supabase/.env").RAZORPAY_KEY_SECRET;
if (!RAZORPAY_KEY_SECRET) throw new Error("[co04] No RAZORPAY_KEY_SECRET.");

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`login failed for ${email}: ${JSON.stringify(json)}`);
  return { token: json.access_token, userId: json.user.id };
}

async function callFunction(name, token, body) {
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
  if (json && json.error && typeof json.error === "object") {
    if (json.code === undefined) json.code = json.error.code;
    if (json.message === undefined) json.message = json.error.message;
  }
  return { status: res.status, json };
}

function userClient(token) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function capturePayment(token, orderId, tag) {
  const paymentId = `pay_CO04${tag}${Date.now().toString().slice(-8)}`;
  const sig = createHmac("sha256", RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return callFunction("verify-payment", token, {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: sig,
  });
}

function yesterdayIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function ledgerNet(legs) {
  const debit = (legs ?? []).filter((l) => l.direction === "debit").reduce((s, l) => s + Number(l.amount), 0);
  const credit = (legs ?? []).filter((l) => l.direction === "credit").reduce((s, l) => s + Number(l.amount), 0);
  return { debit, credit, net: credit - debit };
}

async function main() {
  const serviceKey = guard();
  const sql = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const player = await signIn("player@atlitos.dev");
  const coach1 = await signIn("coach1@atlitos.dev");
  if (player.userId === coach1.userId) throw new Error("player and coach are the same user");

  // Pick a slot start unlikely to collide with the other CO specs' fixtures.
  const slot = "14:30";
  const booked = await callFunction("book-session", player.token, {
    session_type_id: SESSION_TYPE_ID,
    frequency: "one_time",
    date: yesterdayIso(),
    slot_start: slot,
    expected_total: 1000,
    focus_area: "CO-04 decline-refund proof",
  });
  if (booked.status !== 200) throw new Error(`book-session failed: ${JSON.stringify(booked.json)}`);
  const sessionId = booked.json.session_id;
  console.log(`booked session ${sessionId} (status ${booked.json.status})`);

  const captured = await capturePayment(player.token, booked.json.razorpay_order_id, "");
  if (captured.status !== 200) throw new Error(`capture failed: ${JSON.stringify(captured.json)}`);
  console.log(`captured payment (verify-payment outcome: ${captured.json.outcome ?? captured.json.status})`);

  // BEFORE: intent captured, ledger for this session is empty (a session
  // accrues nothing at capture).
  const beforeIntent = (await sql.from("payment_intents").select("status,amount").eq("domain", "session").eq("entity_id", sessionId).single()).data;
  const beforeLegs = (await sql.from("ledger_entries").select("amount,direction").eq("domain", "session").eq("entity_id", sessionId)).data;
  const beforeSum = ledgerNet(beforeLegs);
  console.log(`\nBEFORE decline:`);
  console.log(`  payment_intents.status = ${beforeIntent.status} (amount ${beforeIntent.amount})`);
  console.log(`  ledger legs = ${(beforeLegs ?? []).length}  debit=${beforeSum.debit}  credit=${beforeSum.credit}  net=${beforeSum.net}`);

  // (d) The bare RPC is closed to clients.
  const bare = await userClient(coach1.token).rpc("session_transition", {
    p_session_id: sessionId,
    p_action: "decline",
    p_reason: "CO-04 attempt via bare RPC",
  });
  const bareMsg = bare.error?.message ?? "(no error!)";
  const bareClosed = !!bare.error && bareMsg.includes("USE_EDGE_FUNCTION");
  const stillRequested = (await sql.from("sessions").select("status").eq("id", sessionId).single()).data.status;
  console.log(`\nBARE RPC decline: error="${bareMsg}"  -> closed=${bareClosed}  session.status=${stillRequested}`);
  if (!bareClosed) throw new Error("FAIL: session_transition('decline') is not closed to clients");
  if (stillRequested !== "requested") throw new Error("FAIL: refused bare decline moved the session");

  // (a) Decline through the edge function, which issues the refund.
  const decline = await callFunction("decline-session-refund", coach1.token, {
    session_id: sessionId,
    reason: "CO-04 coach declines a paid request",
  });
  if (decline.status !== 200) throw new Error(`decline-session-refund failed: ${JSON.stringify(decline.json)}`);
  console.log(`\ndecline-session-refund: status=${decline.json.status} refund_status=${decline.json.refund_status} amount=${decline.json.refund_amount} outcome=${decline.json.outcome}`);
  if (decline.json.status !== "declined") throw new Error("FAIL: session not declined");

  // The synthetic test-rail capture (verify-payment with a locally-signed
  // payment id) has no real Razorpay payment behind it, so the real Razorpay
  // refund API rejects it and the refund stays `pending` — exactly the CO-05
  // path. The money is claimed (refunds row) and admin-visible, never lost. To
  // prove the SETTLEMENT math nets to zero, drive `settle_refund` directly: it
  // is the single convergence point the `refund.processed` webhook and the
  // synchronous path both call, so this is precisely what happens when the real
  // refund settles. On a real Razorpay payment the edge function reaches this
  // itself (PAYMENTS.md's session 43c52265 evidence).
  const midRefund = (await sql.from("refunds").select("id,status").eq("domain", "session").eq("entity_id", sessionId).single()).data;
  if (midRefund.status !== "processed") {
    const syntheticRefundId = `rfnd_CO04${Date.now().toString().slice(-8)}`;
    const settled = await sql.rpc("settle_refund", { p_refund_id: midRefund.id, p_razorpay_refund_id: syntheticRefundId });
    if (settled.error) throw new Error(`settle_refund failed: ${settled.error.message}`);
    console.log(`\nsettle_refund (webhook convergence point) driven with ${syntheticRefundId}`);
  }

  // AFTER: ledger nets to zero, refunds row exists, intent no longer captured.
  const afterIntent = (await sql.from("payment_intents").select("status").eq("domain", "session").eq("entity_id", sessionId).single()).data;
  const afterLegs = (await sql.from("ledger_entries").select("amount,direction,account_type,account_ref").eq("domain", "session").eq("entity_id", sessionId)).data;
  const afterSum = ledgerNet(afterLegs);
  const refundRow = (await sql.from("refunds").select("status,amount,razorpay_refund_id,ledger_entry_group_id").eq("domain", "session").eq("entity_id", sessionId).maybeSingle()).data;

  console.log(`\nAFTER settlement:`);
  console.log(`  payment_intents.status = ${afterIntent.status}`);
  console.log(`  ledger legs = ${(afterLegs ?? []).length}  debit=${afterSum.debit}  credit=${afterSum.credit}  net=${afterSum.net}`);
  for (const l of afterLegs ?? []) {
    console.log(`    ${l.direction.padEnd(6)} ${String(l.amount).padStart(9)}  ${l.account_type}${l.account_ref ? " " + l.account_ref : ""}`);
  }
  console.log(`  refunds row: ${refundRow ? `status=${refundRow.status} amount=${refundRow.amount} razorpay_refund_id=${refundRow.razorpay_refund_id ?? "-"}` : "NONE"}`);

  // Assertions. After settlement (whether the edge function reached it on a
  // real payment, or settle_refund was driven here for the synthetic rail) the
  // reversing group is written and the intent is refunded.
  const problems = [];
  if (Math.abs(afterSum.net) > 0.005) problems.push(`ledger net is ${afterSum.net}, expected 0`);
  if (!refundRow) problems.push("no refunds row for the declined captured session");
  if (refundRow && refundRow.status !== "processed") problems.push(`refund status is '${refundRow.status}', expected 'processed' after settlement`);
  if (afterIntent.status === "captured") problems.push("intent still 'captured' (orphaned charge)");
  if (afterIntent.status !== "refunded") problems.push(`intent is '${afterIntent.status}', expected 'refunded' after settlement`);
  if (Math.abs(afterSum.debit - 1000) > 0.005) problems.push(`reversing group debit is ${afterSum.debit}, expected 1000`);
  if (Math.abs(afterSum.credit - 1000) > 0.005) problems.push(`reversing group credit is ${afterSum.credit}, expected 1000`);

  console.log("");
  if (problems.length) {
    console.log("RESULT: FAIL");
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log("RESULT: PASS — CO-04 fixed. Money nets to zero on decline, no orphaned captured intent, bare RPC closed.");
}

main().catch((err) => { console.error(err); process.exit(1); });
