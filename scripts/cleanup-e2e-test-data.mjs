#!/usr/bin/env node
// ATLITOS v2 — scripts/cleanup-e2e-test-data.mjs
//
// QA finding 31c (section F, live production sweep 2026-08-11): the coach
// Trainees list, coach/player Chat thread lists, and player My groups
// section were full of leftover rows from e2e/verify runs: training_groups
// named "E2E CO-08 <ts>" / "E2E CO-06 <ts>" / "Oversell Probe <ts>", and
// chat_messages with literal probe bodies ("AT-59 realtime probe ...",
// "AT-59 realtime probe trial2 ...", "Native e2e CH-10 ping").
//
// Root cause: this repo has ONE Supabase project (syzzfgaudpifwvbpycyi) for
// everything, dev, e2e/verify runs, and the live app real demo personas use
// (docs/DEBT.md). scripts/verify-groups-probes.mjs, scripts/verify-realtime.mjs,
// and apps/e2e/specs/money/coaching.spec.ts (CO-06/CO-08) all write real rows
// there with no separate database to isolate into. Those three now attempt
// best-effort teardown of their own rows when SUPABASE_SERVICE_ROLE_KEY is
// set. This script is the sweep for whatever they could not clean (key
// absent, run crashed, older data from before that teardown existed).
//
// Deletes ONLY rows matching the exact literal prefixes those runners
// produce, listed explicitly below, never a broad LIKE. Never touches
// ledger_entries, payment_intents, or any other financial audit table, and
// (per the 2026-08-11 incident logged in docs/DEBT.md, where an earlier
// unreviewed run of a cleanup like this orphaned 57 captured payment_intents
// by deleting their group_memberships out from under them) it now refuses to
// delete any group whose membership is referenced by a captured
// payment_intent. Those groups are reported, not deleted; a human decides
// what to do with them.
//
// This script performs a real DELETE against the live production database.
// Per house rule, it must never be run unattended by an agent: a human
// invokes it directly, reviews the dry-run output first, and only then runs
// it for real.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-e2e-test-data.mjs --dry-run   (always run this first)
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-e2e-test-data.mjs             (deletes for real)

import { createClient } from "@supabase/supabase-js";
import { assertWritableTarget } from "./lib/guard-target.mjs";

const PROJECT_REF = "syzzfgaudpifwvbpycyi";
const SUPABASE_URL = process.env.SUPABASE_URL; // no production default; the guard refuses an unset URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SERVICE_KEY) {
  console.error("[cleanup-e2e-test-data] SUPABASE_SERVICE_ROLE_KEY is required.");
  process.exit(1);
}

// RECONCILIATION 2026-09-15. As written on the 31c branch this guard was
// INVERTED: it refused every host EXCEPT production, and the URL defaulted to
// production. A script whose only job is DELETE must fail closed the other
// way. Route through the shared guard every seed script uses: loopback runs
// freely, production needs the explicit override, anything else is refused.
assertWritableTarget(SUPABASE_URL, "cleanup-e2e-test-data.mjs");

const sql = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Exact prefixes the runners above use. Keep this list in sync with them.
const GROUP_NAME_PREFIXES = ["E2E CO-06 ", "E2E CO-08 ", "Oversell Probe "];
const MESSAGE_TEXT_PREFIXES = [
  "AT-59 realtime probe ",
  "AT-59 realtime probe trial2 ",
  "Native e2e CH-10 ping",
  "e2e CH-01 ",
  "e2e CH-02 ",
  "e2e CH-06 should be rejected",
  "e2e CH-07 offline ",
];

function orFilter(column, prefixes) {
  return prefixes.map((p) => `${column}.like.${p.replace(/[%_]/g, "\\$&")}%`).join(",");
}

async function main() {
  const { data: groups, error: groupsErr } = await sql
    .from("training_groups")
    .select("id,name")
    .or(orFilter("name", GROUP_NAME_PREFIXES));
  if (groupsErr) throw new Error(`[cleanup-e2e-test-data] group lookup failed: ${groupsErr.message}`);

  const { data: messages, error: messagesErr } = await sql
    .from("chat_messages")
    .select("id,text")
    .or(orFilter("text", MESSAGE_TEXT_PREFIXES));
  if (messagesErr) throw new Error(`[cleanup-e2e-test-data] message lookup failed: ${messagesErr.message}`);

  let candidateGroups = groups ?? [];

  // Safety check carried forward from the 2026-08-11 incident (docs/DEBT.md):
  // never delete a group whose membership is still referenced by a captured
  // payment_intent. A group in that state needs a human to reconcile the
  // ledger side before its listing rows disappear, not a script deciding
  // silently.
  let blockedGroups = [];
  if (candidateGroups.length > 0) {
    const groupIds = candidateGroups.map((g) => g.id);
    // group_memberships.payment_intent_id points at the payment_intents row
    // (not the other way around); a membership with a non-null
    // payment_intent_id whose intent is "captured" is real captured money,
    // even if the group itself is a test fixture. That group is blocked.
    const { data: memberships, error: memErr } = await sql
      .from("group_memberships")
      .select("id,group_id,payment_intent_id")
      .in("group_id", groupIds)
      .not("payment_intent_id", "is", null);
    if (memErr) throw new Error(`[cleanup-e2e-test-data] membership lookup failed: ${memErr.message}`);

    const intentIds = [...new Set((memberships ?? []).map((m) => m.payment_intent_id))];
    const referencedGroupIds = new Set();
    if (intentIds.length > 0) {
      const { data: intents, error: intentErr } = await sql
        .from("payment_intents")
        .select("id,status")
        .in("id", intentIds)
        .eq("status", "captured");
      if (intentErr) throw new Error(`[cleanup-e2e-test-data] payment_intents lookup failed: ${intentErr.message}`);
      const capturedIntentIds = new Set((intents ?? []).map((i) => i.id));
      for (const m of memberships ?? []) {
        if (capturedIntentIds.has(m.payment_intent_id)) referencedGroupIds.add(m.group_id);
      }
    }

    blockedGroups = candidateGroups.filter((g) => referencedGroupIds.has(g.id));
    candidateGroups = candidateGroups.filter((g) => !referencedGroupIds.has(g.id));
  }

  console.log(
    `[cleanup-e2e-test-data] found ${candidateGroups.length} deletable test group(s), ` +
      `${blockedGroups.length} blocked by a captured payment_intent, ${messages?.length ?? 0} test message(s)`,
  );
  for (const g of blockedGroups) {
    console.log(`  BLOCKED (captured payment_intent references it): training_group ${g.id} "${g.name}"`);
  }

  if (DRY_RUN) {
    for (const g of candidateGroups) console.log(`  would delete training_group ${g.id} "${g.name}"`);
    for (const m of messages ?? []) console.log(`  would delete chat_message ${m.id} "${m.text}"`);
    console.log("[cleanup-e2e-test-data] --dry-run, nothing deleted");
    return;
  }

  const groupIds = candidateGroups.map((g) => g.id);
  if (groupIds.length > 0) {
    const { error: e1 } = await sql.from("sessions").delete().in("group_id", groupIds);
    if (e1) throw new Error(`[cleanup-e2e-test-data] sessions delete failed: ${e1.message}`);
    const { error: e2 } = await sql.from("group_memberships").delete().in("group_id", groupIds);
    if (e2) throw new Error(`[cleanup-e2e-test-data] group_memberships delete failed: ${e2.message}`);
    const { error: e3 } = await sql.from("training_groups").delete().in("id", groupIds);
    if (e3) throw new Error(`[cleanup-e2e-test-data] training_groups delete failed: ${e3.message}`);
  }

  const messageIds = (messages ?? []).map((m) => m.id);
  const affectedThreadIds = new Set();
  if (messageIds.length > 0) {
    const { data: threadRows } = await sql.from("chat_messages").select("thread_id").in("id", messageIds);
    for (const r of threadRows ?? []) affectedThreadIds.add(r.thread_id);
    const { error: e4 } = await sql.from("chat_messages").delete().in("id", messageIds);
    if (e4) throw new Error(`[cleanup-e2e-test-data] chat_messages delete failed: ${e4.message}`);
  }

  // Repair chat_threads.last_message_at for threads that lost their most
  // recent message so a stale probe timestamp doesn't linger in the
  // Chat list's sort order after the message itself is gone.
  for (const threadId of affectedThreadIds) {
    const { data: latest } = await sql
      .from("chat_messages")
      .select("created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      await sql.from("chat_threads").update({ last_message_at: latest.created_at }).eq("id", threadId);
    }
  }

  console.log(
    `[cleanup-e2e-test-data] deleted ${groupIds.length} group(s), ${messageIds.length} message(s), ` +
      `repaired ${affectedThreadIds.size} thread(s), left ${blockedGroups.length} group(s) blocked for human review`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
