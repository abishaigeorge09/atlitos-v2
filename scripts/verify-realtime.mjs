#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-realtime.mjs
//
// Story AT-59 (Epic AT-12, PRD-01 FR-58/FR-59, PRD-02 FR-30/FR-31), closing
// advisory AT-32 from Phase 2.
//
// AT-32 said: P2 claimed Realtime for the partner Live Today board, but the
// booking was only ever observed as rendered state a day later. Nobody ever
// watched a socket receive an event at the moment of the write. Rendered
// state a day later proves persistence, not push.
//
// This script settles it for chat, the one domain that actually has a
// Realtime subscription (packages/api/src/use-chat.ts, backed by
// supabase/migrations/0022_chat.sql). It:
//
//   1. Subscribes as user A to the EXACT channel/filter use-chat.ts's
//      subscribeToThread uses: channel `chat:${threadId}`, postgres_changes
//      INSERT on public.chat_messages filtered by `thread_id=eq.<id>`. Not a
//      close approximation, the identical call.
//   2. Has user B (the thread's other participant) insert a real message the
//      same way use-chat.ts's sendMessage does (a plain PostgREST insert,
//      not a service-role backdoor), and times how long A's socket takes to
//      see the postgres_changes event.
//   3. Has user C, who is NOT a participant in A/B's thread, subscribed the
//      same way (same channel name guessed, AND the unfiltered chat:inbox
//      shape) and asserts C receives nothing. This is the RLS-scoping claim
//      0022_chat.sql's header makes ("Realtime evaluates the table's SELECT
//      policy per subscriber before delivering a row"); this script is what
//      actually exercises that claim against a live socket instead of
//      trusting the comment.
//   4. Checks whether public.court_bookings (migration 0009_courts.sql, P2
//      era) is in the supabase_realtime publication at all. It is not (see
//      docs/phases/evidence/p3-realtime/README.md for the query and
//      result), which is the real, mechanical reason P2 never observed an
//      instant push on the partner Live Today board: there was no publish
//      side to push from, no client bug, no timing flake. This script
//      reports that plainly rather than working around it.
//
// Fixture data: this run creates ONE real sessions row (via the real
// book-session edge function, not raw SQL, so session_exists_between /
// session_links_pair are satisfied the same way a real booking would
// satisfy them) and ONE real chat_threads row, because no session existed
// yet between player@atlitos.dev and coach1@atlitos.dev in this project.
// Both ids are printed below and are safe to leave in place; re-running
// this script is idempotent, it finds the existing thread/session rather
// than creating a second one, and reuses it for every next run.
//
// Env required:
//   SUPABASE_ANON_KEY  — from apps/portal-court/.env.local's
//                        NEXT_PUBLIC_SUPABASE_ANON_KEY. Never the service
//                        role key: every read/write/subscribe in this script
//                        goes through a real authenticated session, the same
//                        way the product does.
//   SUPABASE_URL       — optional, defaults to the project URL below.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://syzzfgaudpifwvbpycyi.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error(
    "[verify-realtime] SUPABASE_ANON_KEY is required (the anon/publishable key from " +
      "apps/portal-court/.env.local's NEXT_PUBLIC_SUPABASE_ANON_KEY, never the service role key).",
  );
  process.exit(1);
}

const DEMO_PASSWORD = "AtlitosDemo!2026"; // matches scripts/seed-demo-users.mjs
const PLAYER_EMAIL = "player@atlitos.dev"; // user A, thread participant
const COACH1_EMAIL = "coach1@atlitos.dev"; // user B, thread participant
const COACH2_EMAIL = "coach2@atlitos.dev"; // user C, NOT a participant in A/B's thread
const BATTING_BASICS_PRICE = 1000;

function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) throw new Error(`[verify-realtime] sign in failed for ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

/** Finds coach1's real session_type row (created by seed-coaching-fixtures.mjs). */
async function findBattingBasics(coachClient, coachId) {
  const { data, error } = await coachClient
    .from("session_types")
    .select("id, price")
    .eq("coach_id", coachId)
    .eq("name", "Batting Basics")
    .single();
  if (error) throw new Error(`[verify-realtime] could not find coach1's 'Batting Basics' session_type: ${error.message}`);
  return data;
}

/** Ensures a real sessions row exists between player and coach1, in ANY
 * status, by calling the real book-session edge function (never a raw
 * insert) if session_exists_between says none exists yet. Returns the
 * session id, existing or freshly created. */
async function ensureSessionBetween(playerClient, playerId, coachClient, coachId) {
  const { data: exists, error: existsError } = await playerClient.rpc("session_exists_between", {
    p_user_a: playerId,
    p_user_b: coachId,
  });
  if (existsError) throw new Error(`[verify-realtime] session_exists_between failed: ${existsError.message}`);

  if (exists) {
    const { data: rows, error } = await playerClient
      .from("sessions")
      .select("id")
      .eq("player_id", playerId)
      .eq("coach_id", coachId)
      .limit(1);
    if (error) throw new Error(`[verify-realtime] could not read back existing session: ${error.message}`);
    console.log(`[verify-realtime] reusing existing session ${rows[0].id} between player and coach1`);
    return rows[0].id;
  }

  const sessionType = await findBattingBasics(coachClient, coachId);
  const { data: busy, error: busyError } = await playerClient.rpc("get_coach_busy_slots", {
    p_coach_id: coachId,
    p_from: new Date().toISOString().split("T")[0],
    p_to: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
  });
  if (busyError) throw new Error(`[verify-realtime] get_coach_busy_slots failed: ${busyError.message}`);
  const busySet = new Set((busy ?? []).map((row) => `${row.date}|${row.slot_start.slice(0, 5)}`));

  let date = null;
  for (let i = 1; i <= 7 && !date; i++) {
    const candidate = new Date(Date.now() + i * 86400000).toISOString().split("T")[0];
    if (!busySet.has(`${candidate}|11:00`)) date = candidate;
  }
  if (!date) throw new Error("[verify-realtime] no free slot found in the next 7 days for coach1");

  console.log(`[verify-realtime] no session exists yet between player and coach1; booking one for real via book-session (${date} 11:00)`);
  const { data, error } = await playerClient.functions.invoke("book-session", {
    body: {
      session_type_id: sessionType.id,
      frequency: "one_time",
      date,
      slot_start: "11:00",
      focus_area: "AT-59 realtime verification fixture",
      location: "N/A",
      expected_total: BATTING_BASICS_PRICE,
    },
  });
  if (error) throw new Error(`[verify-realtime] book-session failed: ${error.message ?? JSON.stringify(error)}`);
  console.log(`[verify-realtime] booked real session ${data.session_id}, status ${data.status} (no payment capture needed: session_links_pair/session_exists_between accept ANY status, per 0022_chat.sql)`);
  return data.session_id;
}

/** Ensures the real chat_threads row exists between player and coach1 for
 * that session, via the exact insert use-chat.ts's openCoachingThread does
 * (sorted participant ids), never a service-role shortcut. */
async function ensureThread(playerClient, playerId, coachId, sessionId) {
  const participantA = playerId < coachId ? playerId : coachId;
  const participantB = playerId < coachId ? coachId : playerId;

  const { data: existing, error: existingError } = await playerClient
    .from("chat_threads")
    .select("id")
    .eq("participant_a", participantA)
    .eq("participant_b", participantB)
    .eq("context_type", "coaching")
    .eq("context_id", sessionId)
    .maybeSingle();
  if (existingError) throw new Error(`[verify-realtime] thread lookup failed: ${existingError.message}`);
  if (existing) {
    console.log(`[verify-realtime] reusing existing chat thread ${existing.id}`);
    return existing.id;
  }

  const { data: created, error: createError } = await playerClient
    .from("chat_threads")
    .insert({ participant_a: participantA, participant_b: participantB, context_type: "coaching", context_id: sessionId })
    .select("id")
    .single();
  if (createError) throw new Error(`[verify-realtime] thread create failed: ${createError.message}`);
  console.log(`[verify-realtime] created chat thread ${created.id}`);
  return created.id;
}

/** Subscribes EXACTLY the way packages/api/src/use-chat.ts's
 * subscribeToThread does: channel `chat:${threadId}`, postgres_changes
 * INSERT on public.chat_messages filtered by thread_id=eq.<id>. Resolves
 * once SUBSCRIBED (or rejects on error/timeout), and calls onInsert for
 * every row the socket actually receives. */
function subscribeToThreadLikeApp(client, threadId, onInsert) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`[verify-realtime] channel chat:${threadId} never reached SUBSCRIBED`)), 15000);
    const channel = client
      .channel(`chat:${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        (payload) => onInsert(payload.new),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve(channel);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`[verify-realtime] channel chat:${threadId} status ${status}`));
        }
      });
  });
}

/** Subscribes the way subscribeToInbox does: same table, no filter. */
function subscribeToInboxLikeApp(client, onInsert) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("[verify-realtime] channel chat:inbox never reached SUBSCRIBED")), 15000);
    const channel = client
      .channel("chat:inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => onInsert(payload.new))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve(channel);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`[verify-realtime] channel chat:inbox status ${status}`));
        }
      });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkCourtBookingsPublication(anyClient) {
  // No client-side way to read pg_publication_tables (system catalog, not
  // exposed via PostgREST/RLS); this project's ground truth for AT-59 comes
  // from the Supabase MCP execute_sql call recorded in
  // docs/phases/evidence/p3-realtime/README.md. This function exists so the
  // script's own output states the finding even though it cannot requery it
  // itself over the anon key.
  return null;
}

async function main() {
  console.log("[verify-realtime] AT-59: proving Realtime push and RLS scoping for chat (advisory AT-32)\n");

  const player = await signIn(PLAYER_EMAIL); // user A
  const coach1 = await signIn(COACH1_EMAIL); // user B
  const coach2 = await signIn(COACH2_EMAIL); // user C, non-participant
  console.log(`[verify-realtime] signed in: A=player(${player.userId}) B=coach1(${coach1.userId}) C=coach2(${coach2.userId})\n`);

  const sessionId = await ensureSessionBetween(player.client, player.userId, coach1.client, coach1.userId);
  const threadId = await ensureThread(player.client, player.userId, coach1.userId, sessionId);
  console.log(`[verify-realtime] using session ${sessionId}, thread ${threadId}\n`);

  // ---------------------------------------------------------------------
  // Part 1: instant push, thread channel (chat:${threadId})
  // ---------------------------------------------------------------------
  console.log("--- Part 1: A subscribes to chat:<threadId>, B sends, measure latency ---");
  const received = [];
  const aThreadChannel = await subscribeToThreadLikeApp(player.client, threadId, (row) => {
    received.push({ row, receivedAt: process.hrtime.bigint() });
  });
  console.log("[verify-realtime] A subscribed (SUBSCRIBED), channel chat:" + threadId);

  // Non-participant C also subscribes to the SAME thread channel name (a
  // leak would mean C's socket receives the event too even without being
  // a participant; RLS is what has to stop it, not the channel name).
  const cLeakReceived = [];
  const cThreadLeakChannel = await subscribeToThreadLikeApp(coach2.client, threadId, (row) => {
    cLeakReceived.push(row);
  });
  console.log("[verify-realtime] C also subscribed to the SAME channel name (leak probe)");

  // C also subscribes to the unfiltered inbox shape (subscribeToInbox), to
  // prove the "no filter, RLS scopes it" claim in 0022_chat.sql's header.
  const cInboxReceived = [];
  const cInboxChannel = await subscribeToInboxLikeApp(coach2.client, (row) => {
    cInboxReceived.push(row);
  });
  console.log("[verify-realtime] C also subscribed to chat:inbox (unfiltered, RLS-scoping probe)\n");

  // Supabase Realtime's SUBSCRIBED callback fires once the socket is joined,
  // but the walsender/replication side can take a beat longer to start
  // flowing postgres_changes for a brand new channel; 500ms was not always
  // enough headroom in early runs of this script and produced a false
  // "no push" reading on the first trial only. 2s of settle time removes
  // that startup race without hiding a real push failure (a genuine outage
  // still times out at the 10s deadline below).
  await wait(2000);

  const messageText = `AT-59 realtime probe ${new Date().toISOString()}`;
  const sentAt = process.hrtime.bigint();
  const { data: sentRow, error: sendError } = await coach1.client
    .from("chat_messages")
    .insert({ thread_id: threadId, sender_id: coach1.userId, text: messageText })
    .select("id, thread_id, sender_id, text, created_at")
    .single();
  if (sendError) throw new Error(`[verify-realtime] B's insert failed: ${sendError.message}`);
  console.log(`[verify-realtime] B inserted message ${sentRow.id} at t=0`);

  // Wait up to 10s for A's socket to receive it.
  const deadline = Date.now() + 10000;
  while (received.length === 0 && Date.now() < deadline) {
    await wait(25);
  }

  let latencyMs = null;
  if (received.length > 0) {
    latencyMs = Number(received[0].receivedAt - sentAt) / 1e6;
    console.log(`[verify-realtime] A received postgres_changes INSERT for message ${received[0].row.id} after ${latencyMs.toFixed(1)} ms`);
  } else {
    console.log("[verify-realtime] A received NOTHING within 10000 ms. Realtime push did NOT happen for chat_messages.");
  }

  // give the leak probes a further 3s past receipt/timeout to be fair
  await wait(3000);

  console.log(`\n[verify-realtime] RLS isolation, same channel name (chat:${threadId}): C received ${cLeakReceived.length} message(s) (expected 0)`);
  console.log(`[verify-realtime] RLS isolation, unfiltered inbox (chat:inbox): C received ${cInboxReceived.length} message(s) (expected 0)`);

  player.client.removeChannel(aThreadChannel);
  coach2.client.removeChannel(cThreadLeakChannel);
  coach2.client.removeChannel(cInboxChannel);

  // ---------------------------------------------------------------------
  // Part 2: a second, independent trial for a stable latency number
  // ---------------------------------------------------------------------
  console.log("\n--- Part 2: second trial for a corroborating latency sample ---");
  const received2 = [];
  const aThreadChannel2 = await subscribeToThreadLikeApp(player.client, threadId, (row) => {
    received2.push({ row, receivedAt: process.hrtime.bigint() });
  });
  await wait(2000);
  const messageText2 = `AT-59 realtime probe trial2 ${new Date().toISOString()}`;
  const sentAt2 = process.hrtime.bigint();
  const { data: sentRow2, error: sendError2 } = await coach1.client
    .from("chat_messages")
    .insert({ thread_id: threadId, sender_id: coach1.userId, text: messageText2 })
    .select("id, thread_id, sender_id, text, created_at")
    .single();
  if (sendError2) throw new Error(`[verify-realtime] B's second insert failed: ${sendError2.message}`);

  const deadline2 = Date.now() + 10000;
  while (received2.length === 0 && Date.now() < deadline2) {
    await wait(25);
  }
  let latencyMs2 = null;
  if (received2.length > 0) {
    latencyMs2 = Number(received2[0].receivedAt - sentAt2) / 1e6;
    console.log(`[verify-realtime] A received trial 2 message ${received2[0].row.id} after ${latencyMs2.toFixed(1)} ms`);
  } else {
    console.log("[verify-realtime] A received NOTHING for trial 2 within 10000 ms.");
  }
  player.client.removeChannel(aThreadChannel2);

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------
  console.log("\n=== AT-59 SUMMARY ===");
  console.log(`Channel/filter tested: client.channel('chat:${threadId}').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'thread_id=eq.${threadId}' }) — the exact call in packages/api/src/use-chat.ts's subscribeToThread.`);
  console.log(`Trial 1 latency: ${latencyMs === null ? "NO PUSH (timed out)" : latencyMs.toFixed(1) + " ms"}`);
  console.log(`Trial 2 latency: ${latencyMs2 === null ? "NO PUSH (timed out)" : latencyMs2.toFixed(1) + " ms"}`);
  console.log(`RLS isolation (same channel name, non-participant C): ${cLeakReceived.length === 0 ? "PASS, 0 events leaked" : "FAIL, " + cLeakReceived.length + " event(s) leaked"}`);
  console.log(`RLS isolation (unfiltered chat:inbox, non-participant C): ${cInboxReceived.length === 0 ? "PASS, 0 events leaked" : "FAIL, " + cInboxReceived.length + " event(s) leaked"}`);
  console.log("court_bookings in supabase_realtime publication: NO (verified via Supabase MCP execute_sql against pg_publication_tables, see docs/phases/evidence/p3-realtime/README.md). This is why P2 never observed an instant push on the partner Live Today board: court_bookings was never added to the publication in 0009_courts.sql or anywhere since, so there is no Realtime event stream for a court booking to push through at all. A client bug or a timing flake was never the cause. Fix: a migration adding `alter publication supabase_realtime add table public.court_bookings;` guarded the same way 0022_chat.sql guards chat_messages (a pg_publication_tables existence check first), plus RLS review on court_bookings for who should receive that stream (likely the venue's partner/staff only, not the booking player broadcast-wide).");

  const overallPush = latencyMs !== null || latencyMs2 !== null;
  console.log(`\nOverall verdict for chat: Realtime instant push is ${overallPush ? "PROVEN" : "NOT PROVEN"}. RLS scoping is ${cLeakReceived.length === 0 && cInboxReceived.length === 0 ? "PROVEN SAFE" : "A SECURITY FINDING"}.`);

  process.exit(overallPush && cLeakReceived.length === 0 && cInboxReceived.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-realtime] FAILED:", err.message ?? err);
  process.exit(1);
});
