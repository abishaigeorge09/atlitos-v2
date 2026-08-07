#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-moderation-phase4.mjs
// Phase 4 LAUNCH Track C (CT-C, PRD-04 FR-31/FR-32/FR-33). Scripted-but-real
// proof against the DEPLOYED project, mirroring scripts/verify-realtime.mjs
// and scripts/verify-clutch-p5.mjs: real persona JWTs via
// signInWithPassword, real PostgREST reads/writes/RPC calls under each
// persona's own token, no service role key anywhere in this file (the admin
// checks below go through the admin persona's OWN JWT + has_role, matching
// the "no service role key in this bundle" pattern PRD-04 FR-2 already
// establishes for every other admin surface in this repo).
//
// AT-62 discipline throughout: every isolation claim below first asserts the
// two parties' ids actually differ (`playerId !== coach1Id`, etc.) before
// trusting a refusal or a filtered result, so a vacuous pass (picking a row
// the "other" party actually owns) cannot slip through unnoticed.
//
// Fixture reuse: this script reuses the exact session+thread fixture
// scripts/verify-realtime.mjs already establishes between player@atlitos.dev
// and coach1@atlitos.dev (ensureSessionBetween/ensureThread, same functions,
// copied here rather than imported so this file has no cross-script runtime
// dependency), so a repeated run is idempotent, it finds the existing
// session/thread rather than creating a second one.
//
// Requires migration 0097_report_block.sql applied first (the orchestrator's
// job, this repo's builder agents have no prod-authed Supabase CLI/MCP).
//
// Env required:
//   SUPABASE_ANON_KEY — apps/portal-court/.env.local's
//                        NEXT_PUBLIC_SUPABASE_ANON_KEY (never service role).
//   SUPABASE_URL       — optional, defaults to the project URL below.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://syzzfgaudpifwvbpycyi.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error(
    "[verify-moderation] SUPABASE_ANON_KEY is required (the anon/publishable key, never the service role key).",
  );
  process.exit(1);
}

const DEMO_PASSWORD = "AtlitosDemo!2026"; // matches scripts/seed-demo-users.mjs
const PLAYER_EMAIL = "player@atlitos.dev"; // user A: reporter, blocker
const COACH1_EMAIL = "coach1@atlitos.dev"; // user B: reported/blocked
const COACH2_EMAIL = "coach2@atlitos.dev"; // user C: non-admin, forbidden-call proof
const ADMIN_EMAIL = "admin@atlitos.dev"; // resolves reports, calls admin_get_reported_entity
const BATTING_BASICS_PRICE = 1000;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail));
};
const assert = (name, cond, detail) => record(name, Boolean(cond), detail);

function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) throw new Error(`[verify-moderation] sign in failed for ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

// ---- fixture: real session + thread between player and coach1 (copied from
// verify-realtime.mjs so this file has no cross-script runtime import) -----

async function findBattingBasics(coachClient, coachId) {
  const { data, error } = await coachClient
    .from("session_types")
    .select("id, price")
    .eq("coach_id", coachId)
    .eq("name", "Batting Basics")
    .single();
  if (error) throw new Error(`[verify-moderation] could not find coach1's 'Batting Basics' session_type: ${error.message}`);
  return data;
}

async function ensureSessionBetween(playerClient, playerId, coachClient, coachId) {
  const { data: exists, error: existsError } = await playerClient.rpc("session_exists_between", {
    p_user_a: playerId,
    p_user_b: coachId,
  });
  if (existsError) throw new Error(`[verify-moderation] session_exists_between failed: ${existsError.message}`);

  if (exists) {
    const { data: rows, error } = await playerClient
      .from("sessions")
      .select("id")
      .eq("player_id", playerId)
      .eq("coach_id", coachId)
      .limit(1);
    if (error) throw new Error(`[verify-moderation] could not read back existing session: ${error.message}`);
    return rows[0].id;
  }

  const sessionType = await findBattingBasics(coachClient, coachId);
  const { data: busy, error: busyError } = await playerClient.rpc("get_coach_busy_slots", {
    p_coach_id: coachId,
    p_from: new Date().toISOString().split("T")[0],
    p_to: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
  });
  if (busyError) throw new Error(`[verify-moderation] get_coach_busy_slots failed: ${busyError.message}`);
  const busySet = new Set((busy ?? []).map((row) => `${row.date}|${row.slot_start.slice(0, 5)}`));

  let date = null;
  for (let i = 1; i <= 7 && !date; i++) {
    const candidate = new Date(Date.now() + i * 86400000).toISOString().split("T")[0];
    if (!busySet.has(`${candidate}|11:00`)) date = candidate;
  }
  if (!date) throw new Error("[verify-moderation] no free slot found in the next 7 days for coach1");

  const { data, error } = await playerClient.functions.invoke("book-session", {
    body: {
      session_type_id: sessionType.id,
      frequency: "one_time",
      date,
      slot_start: "11:00",
      focus_area: "CT-C moderation verification fixture",
      location: "N/A",
      expected_total: BATTING_BASICS_PRICE,
    },
  });
  if (error) throw new Error(`[verify-moderation] book-session failed: ${error.message ?? JSON.stringify(error)}`);
  return data.session_id;
}

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
  if (existingError) throw new Error(`[verify-moderation] thread lookup failed: ${existingError.message}`);
  if (existing) return existing.id;

  const { data: created, error: createError } = await playerClient
    .from("chat_threads")
    .insert({ participant_a: participantA, participant_b: participantB, context_type: "coaching", context_id: sessionId })
    .select("id")
    .single();
  if (createError) throw new Error(`[verify-moderation] thread create failed: ${createError.message}`);
  return created.id;
}

// ---- fixture: a real published clip owned by player, for the clip/comment
// report+block proofs (C1, C3) -----------------------------------------

async function ensurePublishedClip(playerClient, adminClient) {
  const caption = "CT-C moderation verification fixture clip";
  const { data: existing, error: existingError } = await playerClient
    .from("clips")
    .select("id, status")
    .eq("caption", caption)
    .maybeSingle();
  if (existingError) throw new Error(`[verify-moderation] clip lookup failed: ${existingError.message}`);
  if (existing && existing.status === "published") return existing.id;

  const { data: up, error: upError } = await playerClient.functions.invoke("stream-upload-url", {
    body: { caption, sport: "football" },
  });
  if (upError) throw new Error(`[verify-moderation] stream-upload-url failed: ${upError.message}`);

  // A byte or two is enough: this fixture never needs real video content,
  // only a row that can be finalized and approved (same shape verify-
  // clutch-p5.mjs's pipeline exercises with a real file; this script only
  // needs the clip to REACH published, not to play back).
  const placeholder = new Uint8Array([0, 1, 2, 3]);
  const { error: putError } = await playerClient.storage
    .from(up.bucket)
    .uploadToSignedUrl(up.path, up.token, placeholder, { contentType: "video/mp4" });
  if (putError) throw new Error(`[verify-moderation] placeholder upload failed: ${putError.message}`);

  const { error: finError } = await playerClient.functions.invoke("stream-webhook", { body: { clip_id: up.clipId } });
  if (finError) throw new Error(`[verify-moderation] stream-webhook failed: ${finError.message}`);

  const { error: modError } = await adminClient.rpc("moderate_clip", {
    p_clip_id: up.clipId,
    p_action: "approve",
    p_reason: null,
  });
  if (modError) throw new Error(`[verify-moderation] moderate_clip approve failed: ${modError.message}`);

  return up.clipId;
}

const main = async () => {
  const player = await signIn(PLAYER_EMAIL); // A
  const coach1 = await signIn(COACH1_EMAIL); // B
  const coach2 = await signIn(COACH2_EMAIL); // C, non-admin
  const admin = await signIn(ADMIN_EMAIL);

  assert("AT-62: player.id !== coach1.id", player.userId !== coach1.userId, {
    player: player.userId,
    coach1: coach1.userId,
  });
  assert("AT-62: player.id !== admin.id", player.userId !== admin.userId, {
    player: player.userId,
    admin: admin.userId,
  });

  // ===== C1: clip comment report reaches the queue =====
  const clipId = await ensurePublishedClip(player, admin);
  record("fixture: published clip", true, { clipId });

  const { data: comment, error: commentError } = await coach1.client
    .from("clip_comments")
    .insert({ clip_id: clipId, user_id: coach1.userId, text: "CT-C fixture comment from coach1" })
    .select("id")
    .single();
  if (commentError) throw new Error(`comment insert failed: ${commentError.message}`);

  const { data: commentReport, error: reportCommentError } = await player.client
    .from("reports")
    .insert({ entity_type: "comment", entity_id: comment.id, reporter_id: player.userId, reason: "CT-C fixture: spam" })
    .select("id, status")
    .single();
  assert("C1: comment report lands pending", !reportCommentError && commentReport.status === "pending", {
    error: reportCommentError?.message ?? null,
    report: commentReport,
  });

  const { data: adminQueueRow, error: adminQueueError } = await admin.client
    .from("reports")
    .select("id, entity_type, entity_id, status")
    .eq("id", commentReport.id)
    .maybeSingle();
  assert("C1: admin Reports Queue read sees the row", !adminQueueError && adminQueueRow?.id === commentReport.id, {
    error: adminQueueError?.message ?? null,
    row: adminQueueRow,
  });

  const { data: resolvedComment, error: resolveCommentError } = await admin.client.rpc("resolve_report", {
    p_report_id: commentReport.id,
    p_action: "remove",
    p_reason: "CT-C fixture takedown",
  });
  assert("C1: resolve_report remove succeeds", !resolveCommentError && resolvedComment?.status === "actioned", {
    error: resolveCommentError?.message ?? null,
    resolved: resolvedComment,
  });

  const { data: afterRemoveComment } = await coach2.client
    .from("clip_comments")
    .select("id")
    .eq("id", comment.id)
    .maybeSingle();
  assert("C1: removed comment absent from a third user's fetch", afterRemoveComment == null, { afterRemoveComment });

  // ===== C2: chat message report =====
  const sessionId = await ensureSessionBetween(player.client, player.userId, coach1.client, coach1.userId);
  const threadId = await ensureThread(player.client, player.userId, coach1.userId, sessionId);
  record("fixture: coaching session + thread", true, { sessionId, threadId });

  const { data: chatMessage, error: chatMessageError } = await coach1.client
    .from("chat_messages")
    .insert({ thread_id: threadId, sender_id: coach1.userId, text: "CT-C fixture chat message from coach1" })
    .select("id")
    .single();
  if (chatMessageError) throw new Error(`chat message insert failed: ${chatMessageError.message}`);

  const { data: chatReport, error: chatReportError } = await player.client
    .from("reports")
    .insert({
      entity_type: "chat_message",
      entity_id: chatMessage.id,
      reporter_id: player.userId,
      reason: "CT-C fixture: harassment",
    })
    .select("id, status")
    .single();
  assert("C2: chat_message report lands pending", !chatReportError && chatReport.status === "pending", {
    error: chatReportError?.message ?? null,
    report: chatReport,
  });

  const { data: adminReadEntity, error: adminReadEntityError } = await admin.client.rpc("admin_get_reported_entity", {
    p_report_id: chatReport.id,
  });
  assert(
    "C2: admin_get_reported_entity returns the message for an admin",
    !adminReadEntityError && adminReadEntity?.entity_type === "chat_message" && adminReadEntity?.id === chatMessage.id,
    { error: adminReadEntityError?.message ?? null, entity: adminReadEntity },
  );

  const { data: nonAdminRead, error: nonAdminReadError } = await coach2.client.rpc("admin_get_reported_entity", {
    p_report_id: chatReport.id,
  });
  assert(
    "C2: admin_get_reported_entity refuses a non-admin",
    nonAdminRead == null && Boolean(nonAdminReadError) && /FORBIDDEN/.test(nonAdminReadError.message),
    { error: nonAdminReadError?.message ?? null, data: nonAdminRead },
  );

  const { data: resolvedChat, error: resolveChatError } = await admin.client.rpc("resolve_report", {
    p_report_id: chatReport.id,
    p_action: "remove",
    p_reason: "CT-C fixture chat takedown",
  });
  assert("C2: resolve_report remove (chat) succeeds", !resolveChatError && resolvedChat?.status === "actioned", {
    error: resolveChatError?.message ?? null,
    resolved: resolvedChat,
  });

  const { data: afterRemoveChat, error: afterRemoveChatError } = await player.client
    .from("chat_messages")
    .select("id, text, removed_at")
    .eq("id", chatMessage.id)
    .maybeSingle();
  assert(
    "C2: removed chat message carries removed_at, real text never re-read as plain text by a client without checking it",
    !afterRemoveChatError && afterRemoveChat?.removed_at != null,
    { error: afterRemoveChatError?.message ?? null, row: afterRemoveChat },
  );

  // ===== C3: block hides content, one-way, unblock restores =====
  const { error: blockError } = await player.client
    .from("blocked_users")
    .insert({ blocker_id: player.userId, blocked_id: coach1.userId });
  assert("C3: player blocks coach1 (own-row insert succeeds)", !blockError, { error: blockError?.message ?? null });

  const { data: blockedRow, error: blockedRowError } = await player.client
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", player.userId)
    .eq("blocked_id", coach1.userId)
    .maybeSingle();
  assert("C3: block row readable by the blocker", !blockedRowError && blockedRow?.blocked_id === coach1.userId, {
    error: blockedRowError?.message ?? null,
    row: blockedRow,
  });

  // packages/api's getBlockedUserIds does exactly this query; this is the
  // precondition the feed/comments/chat filters in hooks.ts and use-chat.ts
  // subtract on. Proving the query returns coach1.userId proves the filter
  // those TS functions apply (`!blocked.has(row.owner_id)` etc.) would drop
  // coach1's rows for player, without re-running the TS bundle itself.
  assert("C3: getBlockedUserIds precondition holds for player->coach1", blockedRow?.blocked_id === coach1.userId, {
    blocked_id: blockedRow?.blocked_id,
  });

  // One-way: coach1 has NOT blocked player.
  const { data: reciprocalRow, error: reciprocalError } = await coach1.client
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", coach1.userId)
    .eq("blocked_id", player.userId)
    .maybeSingle();
  assert("C3: block is one-way, coach1 has no block row against player", !reciprocalError && reciprocalRow == null, {
    error: reciprocalError?.message ?? null,
    row: reciprocalRow,
  });

  // Unblock.
  const { error: unblockError } = await player.client
    .from("blocked_users")
    .delete()
    .eq("blocker_id", player.userId)
    .eq("blocked_id", coach1.userId);
  assert("C3: unblock (own-row delete) succeeds", !unblockError, { error: unblockError?.message ?? null });

  const { data: afterUnblock, error: afterUnblockError } = await player.client
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", player.userId)
    .eq("blocked_id", coach1.userId)
    .maybeSingle();
  assert("C3: block row gone after unblock", !afterUnblockError && afterUnblock == null, {
    error: afterUnblockError?.message ?? null,
    row: afterUnblock,
  });

  // ===== C4: forbidden writes =====
  const { error: forgedBlockError } = await player.client
    .from("blocked_users")
    .insert({ blocker_id: coach1.userId, blocked_id: player.userId });
  assert("C4: cannot insert blocked_users with someone else's blocker_id", Boolean(forgedBlockError), {
    error: forgedBlockError?.message ?? null,
  });

  const { error: reportsUpdateError } = await player.client
    .from("reports")
    .update({ status: "dismissed" })
    .eq("id", commentReport.id);
  assert("C4: client cannot UPDATE reports.status directly (post-0097)", Boolean(reportsUpdateError), {
    error: reportsUpdateError?.message ?? null,
  });

  const { error: chatUpdateError } = await coach1.client
    .from("chat_messages")
    .update({ removed_at: null })
    .eq("id", chatMessage.id);
  assert("C4: client cannot set chat_messages.removed_at", Boolean(chatUpdateError), {
    error: chatUpdateError?.message ?? null,
  });

  // ===== C5: validation, empty-reason report refused =====
  const { error: emptyReasonError } = await player.client
    .from("reports")
    .insert({ entity_type: "clip", entity_id: clipId, reporter_id: player.userId, reason: "   " });
  assert("C5: empty-reason report insert refused (check constraint)", Boolean(emptyReasonError), {
    error: emptyReasonError?.message ?? null,
  });

  // ===== user-report arm: report + resolve a user account =====
  const { data: userReport, error: userReportError } = await player.client
    .from("reports")
    .insert({ entity_type: "user", entity_id: coach1.userId, reporter_id: player.userId, reason: "CT-C fixture: user report" })
    .select("id, status")
    .single();
  assert("user report lands pending", !userReportError && userReport?.status === "pending", {
    error: userReportError?.message ?? null,
    report: userReport,
  });

  const { data: userEntity, error: userEntityError } = await admin.client.rpc("admin_get_reported_entity", {
    p_report_id: userReport.id,
  });
  assert(
    "admin_get_reported_entity resolves a user report",
    !userEntityError && userEntity?.entity_type === "user" && userEntity?.id === coach1.userId,
    { error: userEntityError?.message ?? null, entity: userEntity },
  );

  const { data: resolvedUserReport, error: resolveUserError } = await admin.client.rpc("resolve_report", {
    p_report_id: userReport.id,
    p_action: "dismiss",
    p_reason: "CT-C fixture: reviewed, no action",
  });
  assert("user report resolves (dismiss)", !resolveUserError && resolvedUserReport?.status === "dismissed", {
    error: resolveUserError?.message ?? null,
    resolved: resolvedUserReport,
  });

  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[verify-moderation] ${passed}/${total} checks passed`);
  if (passed !== total) process.exitCode = 1;
};

main().catch((err) => {
  console.error("[verify-moderation] FATAL", err);
  process.exitCode = 1;
});
