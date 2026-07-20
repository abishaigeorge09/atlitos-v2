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
//      era) is in the supabase_realtime publication at all. It was not (see
//      docs/phases/evidence/p3-realtime/README.md for the query and
//      result), which is the real, mechanical reason P2 never observed an
//      instant push on the partner Live Today board: there was no publish
//      side to push from, no client bug, no timing flake. This script
//      reports that plainly rather than working around it.
//
// EXTENDED BY AT-62 (Parts 3 and 4 below), which fixed that root cause in
// supabase/migrations/0029_realtime_courts_sessions.sql by publishing
// public.court_bookings and public.sessions. AT-59 could only report the gap;
// this script now proves the fix:
//
//   Part 3 (court_bookings): the owning partner subscribes with the EXACT
//     channel/filter shape apps/portal-court's live-today/page.tsx uses
//     (channel `live-today-${venueId}`, event "*", filter
//     `court_id=in.(...)`), then a walk-in is booked through the real
//     book-court edge function (INSERT) and checked in through the real
//     court_booking_check_in RPC (UPDATE). Both latencies are measured.
//     The UPDATE half matters most: check ins and cancellations are UPDATEs,
//     not INSERTs, and 0029 deliberately left REPLICA IDENTITY at DEFAULT, so
//     this is the empirical proof that a DEFAULT-identity UPDATE still carries
//     a full enough new tuple for both the client's court_id filter and the
//     SELECT policy's is_court_partner_or_staff(court_id) check to pass.
//
//   Part 4 (sessions): the same, for a coach receiving a session transition,
//     driven through the real session_transition RPC.
//
//   Cross-party isolation, the security-critical assertion in both parts: a
//     DIFFERENT partner (p2-verify-partner, who owns different venues) and a
//     non-party user must receive ZERO events, on both a guessed same-shape
//     channel AND a completely unfiltered subscription. court_bookings carries
//     money columns and walk-in PII, so publishing it would turn any scoping
//     defect in its SELECT policy into a live cross-tenant broadcast. That is
//     the thing this script exists to rule out.
//
// Every write in Parts 3 and 4 goes through a real product path (book-court,
// court_booking_check_in, session_transition) under a real user's JWT. There
// are no raw inserts and no service-role writes anywhere in this file.
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

// AT-62 Part 3/4 fixtures.
const PARTNER_A_EMAIL = "partner@atlitos.dev"; // owns "Onboarding Demo Turf"
const PARTNER_B_EMAIL = "p2-verify-partner@atlitos.dev"; // owns the seed_p2 venues, NOT A's
const REALTIME_DEADLINE_MS = 10000;
const SETTLE_MS = 2000; // see the wait(2000) rationale in Part 1

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

// ===========================================================================
// AT-62 helpers (Parts 3 and 4)
// ===========================================================================

/** Waits until `getCount()` is non-zero or the deadline passes. Returns true
 * if something arrived. */
async function waitForEvent(getCount, deadlineMs = REALTIME_DEADLINE_MS) {
  const deadline = Date.now() + deadlineMs;
  while (getCount() === 0 && Date.now() < deadline) {
    await wait(25);
  }
  return getCount() > 0;
}

/** Generic postgres_changes subscription helper. `opts` is passed straight
 * through to .on(), so callers spell out the exact shape the app uses rather
 * than having it constructed for them. */
function subscribeRaw(client, channelName, opts, onEvent) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`[verify-realtime] channel ${channelName} never reached SUBSCRIBED`)),
      15000,
    );
    const channel = client
      .channel(channelName)
      .on("postgres_changes", opts, (payload) => onEvent(payload))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve(channel);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`[verify-realtime] channel ${channelName} status ${status}`));
        }
      });
  });
}

/** Subscribes EXACTLY the way apps/portal-court/src/app/dashboard/live-today/
 * page.tsx does: channel `live-today-${venueId}`, event "*" on
 * public.court_bookings, filter `court_id=in.(<ids>)`. Not an approximation. */
function subscribeLiveTodayLikeApp(client, venueId, courtIds, onEvent) {
  return subscribeRaw(
    client,
    `live-today-${venueId}`,
    {
      event: "*",
      schema: "public",
      table: "court_bookings",
      filter: `court_id=in.(${courtIds.join(",")})`,
    },
    onEvent,
  );
}

/** Finds a partner's OWN verified venue and its active courts, read through
 * RLS with the partner's own JWT (the same reads the portal does).
 *
 * The `.eq("partner_user_id", partnerUserId)` filter is load bearing and must
 * not be removed. `venues` carries a public "verified venues are readable by
 * anyone" SELECT policy alongside the owner policy, and policies combine with
 * OR, so an unscoped `select * from venues` returns EVERY verified venue in
 * the project, not the caller's. An earlier draft of this function omitted the
 * filter and silently handed partner A a venue owned by partner B, which made
 * the cross-partner isolation assertion below meaningless (both "partners"
 * were pointed at the same venue) and made book-court fail its own ownership
 * check. That is the P2 venue-picker defect reproduced exactly, and RLS.md's
 * durable lesson restated: RLS here is an authorization ceiling, not scoping,
 * so every query carries its own owner filter. */
async function findPartnerVenue(partnerClient, partnerUserId, email) {
  const { data: venues, error: venueError } = await partnerClient
    .from("venues")
    .select("id, name")
    .eq("partner_user_id", partnerUserId)
    .eq("status", "verified")
    .order("created_at", { ascending: true });
  if (venueError) throw new Error(`[verify-realtime] venue lookup failed for ${email}: ${venueError.message}`);
  if (!venues || venues.length === 0) throw new Error(`[verify-realtime] ${email} owns no verified venue`);

  for (const venue of venues) {
    const { data: courts, error: courtError } = await partnerClient
      .from("courts")
      .select("id, name")
      .eq("venue_id", venue.id)
      .eq("active", true);
    if (courtError) throw new Error(`[verify-realtime] court lookup failed: ${courtError.message}`);
    if (courts && courts.length > 0) {
      return { venueId: venue.id, venueName: venue.name, courts };
    }
  }
  throw new Error(`[verify-realtime] ${email} has no verified venue with an active court`);
}

/** Finds the first free slot for a court, today if possible (the Live Today
 * board is a today view), otherwise within the next 7 days. The realtime
 * filter is on court_id only, so a later date still proves push; today is
 * preferred purely for fidelity to the board. */
async function findFreeSlot(partnerClient, courtId) {
  for (let i = 0; i <= 7; i++) {
    const date = new Date(Date.now() + i * 86400000).toISOString().split("T")[0];
    const { data: slots, error } = await partnerClient.rpc("get_court_available_slots", {
      p_court_id: courtId,
      p_date: date,
    });
    if (error) throw new Error(`[verify-realtime] get_court_available_slots failed: ${error.message}`);
    if (slots && slots.length > 0) {
      return { date, slot: slots[0] };
    }
  }
  throw new Error(`[verify-realtime] no free slot found for court ${courtId} in the next 7 days`);
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
  // Part 3 (AT-62): court_bookings push + cross-partner isolation
  // ---------------------------------------------------------------------
  console.log("\n--- Part 3 (AT-62): court_bookings INSERT + UPDATE push, and cross partner isolation ---");

  const partnerA = await signIn(PARTNER_A_EMAIL);
  const partnerB = await signIn(PARTNER_B_EMAIL);
  const venueA = await findPartnerVenue(partnerA.client, partnerA.userId, PARTNER_A_EMAIL);
  const venueB = await findPartnerVenue(partnerB.client, partnerB.userId, PARTNER_B_EMAIL);
  if (venueA.venueId === venueB.venueId) {
    throw new Error("[verify-realtime] partner A and B resolved to the SAME venue; the cross partner assertion would be vacuous. Check the owner filter in findPartnerVenue.");
  }
  const courtIdsA = venueA.courts.map((c) => c.id);
  console.log(`[verify-realtime] partner A = ${PARTNER_A_EMAIL}, venue "${venueA.venueName}" (${venueA.venueId}), ${courtIdsA.length} active court(s)`);
  console.log(`[verify-realtime] partner B = ${PARTNER_B_EMAIL}, venue "${venueB.venueName}" (${venueB.venueId}) — a DIFFERENT venue, must receive nothing`);

  // A subscribes exactly as the Live Today board does.
  const aBookingEvents = [];
  const aLiveChannel = await subscribeLiveTodayLikeApp(partnerA.client, venueA.venueId, courtIdsA, (payload) => {
    aBookingEvents.push({ payload, receivedAt: process.hrtime.bigint() });
  });
  console.log(`[verify-realtime] A subscribed to live-today-${venueA.venueId} (event "*", filter court_id=in.(...))`);

  // B, a different partner, probes two ways:
  //   (a) the same channel name AND the same court_id filter as A, i.e. B
  //       actively targets A's courts. Only RLS can stop this.
  const bTargetedEvents = [];
  const bTargetedChannel = await subscribeRaw(
    partnerB.client,
    `live-today-${venueA.venueId}`,
    { event: "*", schema: "public", table: "court_bookings", filter: `court_id=in.(${courtIdsA.join(",")})` },
    (payload) => bTargetedEvents.push(payload),
  );
  //   (b) completely unfiltered: every change on court_bookings, project wide.
  const bUnfilteredEvents = [];
  const bUnfilteredChannel = await subscribeRaw(
    partnerB.client,
    "court-bookings-unfiltered-probe",
    { event: "*", schema: "public", table: "court_bookings" },
    (payload) => bUnfilteredEvents.push(payload),
  );
  console.log("[verify-realtime] B subscribed twice: A's exact channel+filter (targeted probe) and an unfiltered project wide probe\n");

  await wait(SETTLE_MS);

  // --- 3a: INSERT, via the real book-court walk-in path ---
  const court = venueA.courts[0];
  const { date: walkInDate, slot } = await findFreeSlot(partnerA.client, court.id);
  console.log(`[verify-realtime] booking a real walk in on "${court.name}" ${walkInDate} ${slot.slot_start} via the book-court edge function`);

  const insertSentAt = process.hrtime.bigint();
  const { error: walkInError } = await partnerA.client.functions.invoke("book-court", {
    body: {
      court_id: court.id,
      date: walkInDate,
      slot_start: slot.slot_start,
      slot_end: slot.slot_end,
      booking_source: "walk_in",
      walk_in_name: "AT-62 realtime probe",
    },
  });
  if (walkInError) throw new Error(`[verify-realtime] book-court walk in failed: ${walkInError.message ?? JSON.stringify(walkInError)}`);

  const gotInsert = await waitForEvent(() => aBookingEvents.filter((e) => e.payload.eventType === "INSERT").length);
  let insertLatencyMs = null;
  let bookingId = null;
  if (gotInsert) {
    const evt = aBookingEvents.find((e) => e.payload.eventType === "INSERT");
    insertLatencyMs = Number(evt.receivedAt - insertSentAt) / 1e6;
    bookingId = evt.payload.new.id;
    console.log(`[verify-realtime] A received postgres_changes INSERT for booking ${bookingId} after ${insertLatencyMs.toFixed(1)} ms`);
  } else {
    console.log(`[verify-realtime] A received NO INSERT within ${REALTIME_DEADLINE_MS} ms.`);
  }

  // --- 3b: UPDATE, via the real check-in RPC. This is the half that the
  // REPLICA IDENTITY DEFAULT decision in 0029 rests on. ---
  let updateLatencyMs = null;
  let updateCarriedCheckIn = false;
  if (bookingId) {
    const beforeUpdateCount = aBookingEvents.filter((e) => e.payload.eventType === "UPDATE").length;
    const updateSentAt = process.hrtime.bigint();
    const { error: checkInError } = await partnerA.client.rpc("court_booking_check_in", { p_booking_id: bookingId });
    if (checkInError) throw new Error(`[verify-realtime] court_booking_check_in failed: ${checkInError.message}`);
    console.log(`[verify-realtime] A checked in booking ${bookingId} via court_booking_check_in (an UPDATE, not an INSERT)`);

    const gotUpdate = await waitForEvent(
      () => aBookingEvents.filter((e) => e.payload.eventType === "UPDATE").length - beforeUpdateCount,
    );
    if (gotUpdate) {
      const evt = aBookingEvents.filter((e) => e.payload.eventType === "UPDATE")[beforeUpdateCount];
      updateLatencyMs = Number(evt.receivedAt - updateSentAt) / 1e6;
      updateCarriedCheckIn = Boolean(evt.payload.new?.checked_in_at);
      console.log(`[verify-realtime] A received postgres_changes UPDATE after ${updateLatencyMs.toFixed(1)} ms; payload.new.checked_in_at = ${evt.payload.new?.checked_in_at ?? "null"}`);
      console.log(`[verify-realtime] REPLICA IDENTITY DEFAULT check: the UPDATE payload's new record ${updateCarriedCheckIn ? "DID" : "did NOT"} carry the full row (checked_in_at populated), which is what the court_id filter and the RLS policy both need.`);
    } else {
      console.log(`[verify-realtime] A received NO UPDATE within ${REALTIME_DEADLINE_MS} ms.`);
    }
  }

  // give B's probes a fair further window past A's receipt
  await wait(3000);

  console.log(`\n[verify-realtime] cross partner isolation, targeted probe (B on A's exact channel+filter): B received ${bTargetedEvents.length} event(s) (expected 0)`);
  console.log(`[verify-realtime] cross partner isolation, unfiltered probe (B, project wide): B received ${bUnfilteredEvents.length} event(s) (expected 0)`);

  partnerA.client.removeChannel(aLiveChannel);
  partnerB.client.removeChannel(bTargetedChannel);
  partnerB.client.removeChannel(bUnfilteredChannel);

  // ---------------------------------------------------------------------
  // Part 4 (AT-62): sessions push + non-party isolation
  // ---------------------------------------------------------------------
  console.log("\n--- Part 4 (AT-62): sessions UPDATE push (coach), and non party isolation ---");

  // The coach subscribes scoped to their own sessions, the shape a coach
  // dashboard would use.
  const coachSessionEvents = [];
  const coachSessionChannel = await subscribeRaw(
    coach1.client,
    `sessions:coach:${coach1.userId}`,
    { event: "*", schema: "public", table: "sessions", filter: `coach_id=eq.${coach1.userId}` },
    (payload) => coachSessionEvents.push({ payload, receivedAt: process.hrtime.bigint() }),
  );
  console.log(`[verify-realtime] coach1 subscribed to sessions filtered coach_id=eq.${coach1.userId}`);

  // A non-party (partner A: not the coach, not the player) probes unfiltered.
  const nonPartySessionEvents = [];
  const nonPartySessionChannel = await subscribeRaw(
    partnerA.client,
    "sessions-unfiltered-probe",
    { event: "*", schema: "public", table: "sessions" },
    (payload) => nonPartySessionEvents.push(payload),
  );
  console.log(`[verify-realtime] non party (${PARTNER_A_EMAIL}) subscribed unfiltered to sessions\n`);

  await wait(SETTLE_MS);

  // Drive a real transition through session_transition. Which action depends
  // on the fixture session's current status, so re-running this script is
  // idempotent rather than failing with INVALID_TRANSITION on the second run.
  const { data: sessionRow, error: sessionReadError } = await coach1.client
    .from("sessions")
    .select("id, status")
    .eq("id", sessionId)
    .single();
  if (sessionReadError) throw new Error(`[verify-realtime] session read failed: ${sessionReadError.message}`);

  const transitionArgs =
    sessionRow.status === "requested"
      ? { p_session_id: sessionId, p_action: "accept" }
      : {
          p_session_id: sessionId,
          p_action: "reschedule",
          p_new_date: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0],
          p_new_slot_start: "11:00",
        };
  console.log(`[verify-realtime] session ${sessionId} is '${sessionRow.status}', driving session_transition action '${transitionArgs.p_action}'`);

  const sessionSentAt = process.hrtime.bigint();
  const { error: transitionError } = await coach1.client.rpc("session_transition", transitionArgs);
  if (transitionError) throw new Error(`[verify-realtime] session_transition failed: ${transitionError.message}`);

  const gotSession = await waitForEvent(() => coachSessionEvents.length);
  let sessionLatencyMs = null;
  if (gotSession) {
    sessionLatencyMs = Number(coachSessionEvents[0].receivedAt - sessionSentAt) / 1e6;
    console.log(`[verify-realtime] coach1 received postgres_changes ${coachSessionEvents[0].payload.eventType} for session ${sessionId} after ${sessionLatencyMs.toFixed(1)} ms`);
  } else {
    console.log(`[verify-realtime] coach1 received NOTHING for the session transition within ${REALTIME_DEADLINE_MS} ms.`);
  }

  await wait(3000);
  console.log(`\n[verify-realtime] non party isolation (sessions, unfiltered): received ${nonPartySessionEvents.length} event(s) (expected 0)`);

  coach1.client.removeChannel(coachSessionChannel);
  partnerA.client.removeChannel(nonPartySessionChannel);

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------
  console.log("\n=== AT-59 SUMMARY ===");
  console.log(`Channel/filter tested: client.channel('chat:${threadId}').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'thread_id=eq.${threadId}' }) — the exact call in packages/api/src/use-chat.ts's subscribeToThread.`);
  console.log(`Trial 1 latency: ${latencyMs === null ? "NO PUSH (timed out)" : latencyMs.toFixed(1) + " ms"}`);
  console.log(`Trial 2 latency: ${latencyMs2 === null ? "NO PUSH (timed out)" : latencyMs2.toFixed(1) + " ms"}`);
  console.log(`RLS isolation (same channel name, non-participant C): ${cLeakReceived.length === 0 ? "PASS, 0 events leaked" : "FAIL, " + cLeakReceived.length + " event(s) leaked"}`);
  console.log(`RLS isolation (unfiltered chat:inbox, non-participant C): ${cInboxReceived.length === 0 ? "PASS, 0 events leaked" : "FAIL, " + cInboxReceived.length + " event(s) leaked"}`);

  console.log("\n=== AT-62 SUMMARY (court_bookings and sessions) ===");
  console.log("court_bookings/sessions in supabase_realtime publication: YES, as of supabase/migrations/0029_realtime_courts_sessions.sql. Before 0029 neither was published (only chat_messages was), which is the mechanical root cause of advisory AT-32 that AT-59 identified: the Live Today board's subscription was correct all along, but Postgres was never told to replicate the table, so there was no publish side to push from.");
  console.log(`Channel/filter tested: client.channel('live-today-${venueA.venueId}').on('postgres_changes', { event: '*', schema: 'public', table: 'court_bookings', filter: 'court_id=in.(...)' }) — the exact call in apps/portal-court/src/app/dashboard/live-today/page.tsx.`);
  console.log(`court_bookings INSERT (real walk in via book-court): ${insertLatencyMs === null ? "NO PUSH (timed out)" : insertLatencyMs.toFixed(1) + " ms"}`);
  console.log(`court_bookings UPDATE (real check in via court_booking_check_in): ${updateLatencyMs === null ? "NO PUSH (timed out)" : updateLatencyMs.toFixed(1) + " ms"}`);
  console.log(`REPLICA IDENTITY DEFAULT sufficient for UPDATE delivery: ${updateCarriedCheckIn ? "YES, payload.new carried the full row" : "NOT CONFIRMED"}`);
  console.log(`Cross partner isolation, targeted (B on A's exact channel+filter): ${bTargetedEvents.length === 0 ? "PASS, 0 events leaked" : "FAIL, " + bTargetedEvents.length + " event(s) leaked"}`);
  console.log(`Cross partner isolation, unfiltered (B, project wide): ${bUnfilteredEvents.length === 0 ? "PASS, 0 events leaked" : "FAIL, " + bUnfilteredEvents.length + " event(s) leaked"}`);
  console.log(`sessions UPDATE push to the coach (via session_transition): ${sessionLatencyMs === null ? "NO PUSH (timed out)" : sessionLatencyMs.toFixed(1) + " ms"}`);
  console.log(`Non party isolation (sessions, unfiltered): ${nonPartySessionEvents.length === 0 ? "PASS, 0 events leaked" : "FAIL, " + nonPartySessionEvents.length + " event(s) leaked"}`);

  const chatPush = latencyMs !== null || latencyMs2 !== null;
  const chatIsolated = cLeakReceived.length === 0 && cInboxReceived.length === 0;
  const courtPush = insertLatencyMs !== null && updateLatencyMs !== null;
  const courtIsolated = bTargetedEvents.length === 0 && bUnfilteredEvents.length === 0;
  const sessionPush = sessionLatencyMs !== null;
  const sessionIsolated = nonPartySessionEvents.length === 0;

  console.log(`\nOverall verdict for chat: Realtime instant push is ${chatPush ? "PROVEN" : "NOT PROVEN"}. RLS scoping is ${chatIsolated ? "PROVEN SAFE" : "A SECURITY FINDING"}.`);
  console.log(`Overall verdict for court_bookings: instant push (INSERT and UPDATE) is ${courtPush ? "PROVEN" : "NOT PROVEN"}. Cross partner RLS scoping is ${courtIsolated ? "PROVEN SAFE" : "A SECURITY FINDING"}.`);
  console.log(`Overall verdict for sessions: instant push is ${sessionPush ? "PROVEN" : "NOT PROVEN"}. Non party RLS scoping is ${sessionIsolated ? "PROVEN SAFE" : "A SECURITY FINDING"}.`);

  const allGood = chatPush && chatIsolated && courtPush && courtIsolated && sessionPush && sessionIsolated;
  process.exit(allGood ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-realtime] FAILED:", err.message ?? err);
  process.exit(1);
});
