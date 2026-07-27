// ATLITOS v2 — CO domain (coaching sessions + training groups).
//
// Same discipline as courts.spec.ts: money moves only through the deployed
// edge functions/RPCs, capture is completed via helpers/money.mjs's signed
// synthetic-payment-id test rail, and every money claim is re-proved against
// ledger_entries/payment_intents via helpers/sql.mjs, never taken from a
// 200 status code alone.
//
// No portal UI exists for coaching (it is athlete-app + admin only, and the
// athlete app's Razorpay checkout sheet is out of scope for the same reason
// documented in helpers/money.mjs), so this whole file is SQL/edge-function
// driven. It still runs inside Playwright, against the deployed backend, so
// it is guarded to a single project to avoid running four times over.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callFunction, capturePayment } from "../../helpers/money.mjs";
import { personaSession } from "../../helpers/persona.mjs";
import { assertIsolation, serviceClient } from "../../helpers/sql.mjs";
import { expect, test } from "../../fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "athlete-web", "CO spec runs only under the athlete-web project");
});

// SUPABASE_SERVICE_ROLE_KEY is founder-supplied at runtime only, not
// vendored here. Cases that re-prove a money/state claim directly via
// serviceClient() skip cleanly when it is absent, so the edge-function/RPC
// portions of this file still run.
const NEEDS_SERVICE_KEY = !process.env.SUPABASE_SERVICE_ROLE_KEY;

const COACH1_ID = "5b262cf1-8f95-45df-b453-0802013f82a1";
const SESSION_TYPE_ID = "d11093c3-ef7f-42e0-ad7b-f93c10c5d422"; // coach1, "Batting Basics", price 1000, 60 min

function yesterdayIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Books a Batting Basics session for `player` against coach1, dated
 * YESTERDAY at 10:00-11:00 IST (inside coach1's every-day 10:00-18:00
 * availability window, per the live fixture data). book-session has no
 * "date must be in the future" guard, only the day-of-week availability
 * check and the partial-unique-index concurrency guard, so a past date is
 * accepted and its scheduled end time is already behind `now()` the moment
 * it is booked — the only way to reach `complete`'s TOO_EARLY gate without
 * a real wall-clock wait in a spec run. */
async function bookYesterdaySession(playerToken, tag, slotStart = "10:00") {
  const date = yesterdayIso();
  return callFunction("book-session", playerToken, {
    session_type_id: SESSION_TYPE_ID,
    frequency: "one_time",
    date,
    slot_start: slotStart,
    expected_total: 1000,
    focus_area: `e2e ${tag}`,
  });
}

test.describe("CO: coaching sessions @money", () => {
  test("CO-01 requested -> accepted -> completed -> rated in order; rating recorded exactly once @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    const [player, coach1] = await Promise.all([personaSession("player"), personaSession("coach1")]);

    const booked = await bookYesterdaySession(player.token, "CO01");
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    expect(booked.json.status).toBe("requested");
    const sessionId = booked.json.session_id;

    const captured = await capturePayment(player.token, booked.json.razorpay_order_id, "CO01");
    expect(captured.status, JSON.stringify(captured.json)).toBe(200);

    const accept = await coach1.client.rpc("session_transition", { p_session_id: sessionId, p_action: "accept" });
    expect(accept.error, accept.error?.message).toBeNull();
    expect(accept.data.status).toBe("accepted");

    const complete = await callFunction("complete-session", coach1.token, { session_id: sessionId });
    expect(complete.status, JSON.stringify(complete.json)).toBe(200);
    expect(complete.json.status).toBe("completed");
    expect(["accrued", "already_accrued"]).toContain(complete.json.outcome);

    const rate = await player.client.rpc("rate_session", { p_session_id: sessionId, p_rating: 5, p_remarks: "e2e CO-01" });
    expect(rate.error, rate.error?.message).toBeNull();
    expect(rate.data.rating).toBe(5);

    const secondRate = await player.client.rpc("rate_session", { p_session_id: sessionId, p_rating: 3 });
    expect(secondRate.error, "a second rate_session call must be rejected").toBeTruthy();
    expect(String(secondRate.error.message)).toContain("ALREADY_RATED");

    const sql = serviceClient();
    const { data: row } = await sql.from("sessions").select("status,rating").eq("id", sessionId).single();
    expect(row.status).toBe("completed");
    expect(row.rating).toBe(5);
  });

  test("CO-02 coach earnings equal the ledger aggregate, no client-side sum drift @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    const coach1 = await personaSession("coach1");
    const sql = serviceClient();
    const { data: legs } = await sql
      .from("ledger_entries")
      .select("direction,amount")
      .eq("account_type", "coach")
      .eq("account_ref", COACH1_ID);
    const credit = (legs ?? []).filter((l) => l.direction === "credit").reduce((s, l) => s + Number(l.amount), 0);
    const debit = (legs ?? []).filter((l) => l.direction === "debit").reduce((s, l) => s + Number(l.amount), 0);
    const ledgerBalance = credit - debit;

    const { data: wallet, error } = await coach1.client.rpc("get_coach_wallet_balance");
    expect(error, error?.message).toBeNull();
    const walletRow = Array.isArray(wallet) ? wallet[0] : wallet;
    expect(Number(walletRow.balance)).toBeCloseTo(ledgerBalance, 2);
  });

  test("CO-03 accepting an already-accepted session is rejected INVALID_TRANSITION, zero rows written @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    const [player, coach1] = await Promise.all([personaSession("player"), personaSession("coach1")]);
    const booked = await bookYesterdaySession(player.token, "CO03", "11:00");
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    const sessionId = booked.json.session_id;
    await capturePayment(player.token, booked.json.razorpay_order_id, "CO03");

    const first = await coach1.client.rpc("session_transition", { p_session_id: sessionId, p_action: "accept" });
    expect(first.error, first.error?.message).toBeNull();

    const sql = serviceClient();
    const { count: countBefore } = await sql
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("id", sessionId);

    const second = await coach1.client.rpc("session_transition", { p_session_id: sessionId, p_action: "accept" });
    expect(second.error, "a second accept on an already-accepted session must be rejected").toBeTruthy();
    expect(String(second.error.message)).toContain("INVALID_TRANSITION");

    const { count: countAfter } = await sql
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("id", sessionId);
    expect(countAfter).toBe(countBefore);
  });

  test("CO-04 a declined, already-captured session: the platform gives the money back @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    // CO-04, fixed in 0085 + decline-session-refund. A coach declining an
    // unanswered, already-paid request (`requested` -> `declined`, FR-14) now
    // carries an automatic full refund, exactly like the athlete-initiated
    // `requested` -> `cancelled` edge (cancel-session-refund, FR-35): no
    // service was rendered and no fee was accrued, so the whole captured amount
    // goes back. The bare `session_transition('decline')` RPC now raises
    // USE_EDGE_FUNCTION, so the ONLY decline path is the edge function, which
    // makes the refund unskippable. This test proves: (a) the decline is
    // handled, (b) ledger_entries for the session net to zero after the refund,
    // (c) no orphaned `captured` intent is left behind, and (d) the bare RPC is
    // closed.
    const [player, coach1] = await Promise.all([personaSession("player"), personaSession("coach1")]);
    const booked = await bookYesterdaySession(player.token, "CO04", "12:00");
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    const sessionId = booked.json.session_id;
    const captured = await capturePayment(player.token, booked.json.razorpay_order_id, "CO04");
    expect(captured.status, JSON.stringify(captured.json)).toBe(200);

    const sql = serviceClient();

    // (d) The bare RPC is now closed: a coach calling session_transition
    // directly is refused with USE_EDGE_FUNCTION and the session stays
    // `requested`, so the refund can never be skipped by routing around the
    // edge function.
    const bare = await coach1.client.rpc("session_transition", {
      p_session_id: sessionId,
      p_action: "decline",
      p_reason: "e2e CO-04 attempt via bare RPC",
    });
    expect(bare.error, "session_transition('decline') must be closed to clients").toBeTruthy();
    expect(String(bare.error.message)).toContain("USE_EDGE_FUNCTION");
    const { data: stillRequested } = await sql.from("sessions").select("status").eq("id", sessionId).single();
    expect(stillRequested.status, "a refused bare decline must not move the session").toBe("requested");

    // (a) The decline is handled through the edge function, which issues the
    // refund in the same request.
    const decline = await callFunction("decline-session-refund", coach1.token, {
      session_id: sessionId,
      reason: "e2e CO-04 coach declines a paid request",
    });
    expect(decline.status, JSON.stringify(decline.json)).toBe(200);
    expect(decline.json.status).toBe("declined");
    expect(["processed", "pending"]).toContain(decline.json.refund_status);

    // (b) Ledger nets to zero for the session. A session accrues nothing at
    // capture, so the reversing refund group (debit platform / credit payer)
    // keeps the sum at zero rather than leaving money attributed anywhere.
    const { data: legs } = await sql.from("ledger_entries").select("amount,direction").eq("domain", "session").eq("entity_id", sessionId);
    const debit = (legs ?? []).filter((l) => l.direction === "debit").reduce((s, l) => s + Number(l.amount), 0);
    const credit = (legs ?? []).filter((l) => l.direction === "credit").reduce((s, l) => s + Number(l.amount), 0);
    expect(credit - debit, "ledger for a declined-and-refunded session must net to zero").toBeCloseTo(0, 2);
    if (decline.json.refund_status === "processed") {
      // The reversing group actually moved the full amount, not nothing.
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(1000, 2);
    }

    // (c) No orphaned captured intent: a refunds row exists and the intent is
    // no longer sitting at `captured` with nothing accounting for giving the
    // money back.
    const { data: intent } = await sql
      .from("payment_intents")
      .select("status")
      .eq("domain", "session")
      .eq("entity_id", sessionId)
      .single();
    const { data: refundRow } = await sql.from("refunds").select("status").eq("domain", "session").eq("entity_id", sessionId).maybeSingle();
    expect(refundRow, "a declined, captured request must have a refunds row").toBeTruthy();
    expect(
      intent.status !== "captured",
      `CO-04: session ${sessionId} was declined after capture and the intent is still "${intent.status}"; ` +
        "a declined captured request must reach refunded (or a pending refund on a Razorpay failure), never a stranded captured intent.",
    ).toBe(true);
    if (decline.json.refund_status === "processed") {
      expect(intent.status).toBe("refunded");
    }
  });

  test("CO-05 the requested-cancel refund applies automatically, no admin step @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    const player = await personaSession("player");
    const booked = await bookYesterdaySession(player.token, "CO05", "13:00");
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    const sessionId = booked.json.session_id;
    await capturePayment(player.token, booked.json.razorpay_order_id, "CO05");

    const cancel = await callFunction("cancel-session-refund", player.token, { session_id: sessionId });
    expect(cancel.status, JSON.stringify(cancel.json)).toBe(200);
    expect(cancel.json.status).toBe("cancelled");
    expect(["processed", "pending"]).toContain(cancel.json.refund_status);

    const sql = serviceClient();
    const { data: legs } = await sql.from("ledger_entries").select("amount,direction").eq("domain", "session").eq("entity_id", sessionId);
    if (cancel.json.refund_status === "processed") {
      const debit = (legs ?? []).filter((l) => l.direction === "debit").reduce((s, l) => s + Number(l.amount), 0);
      const credit = (legs ?? []).filter((l) => l.direction === "credit").reduce((s, l) => s + Number(l.amount), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(1000, 2);
    }
  });

  test("CO-06 group join activates the membership; capacity and duplicate-join guards fire before Razorpay @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    const coach1 = await personaSession("coach1");
    const [playerA, playerB, playerC] = await Promise.all([
      personaSession("player"),
      personaSession("partner"),
      personaSession("p2-verify-partner"),
    ]);
    assertIsolation(playerA.userId, playerB.userId, "CO-06 distinct joiners a/b");
    assertIsolation(playerB.userId, playerC.userId, "CO-06 distinct joiners b/c");

    const created = await coach1.client
      .rpc("create_training_group", {
        p_name: `E2E CO-06 ${Date.now()}`,
        p_sport: "cricket",
        p_capacity: 2,
        p_monthly_fee: 500,
      })
      .single();
    expect(created.error, created.error?.message).toBeNull();
    const groupId = created.data.id;

    const [a, b, c] = await Promise.all([
      callFunction("join-group", playerA.token, { group_id: groupId, expected_total: 500 }),
      callFunction("join-group", playerB.token, { group_id: groupId, expected_total: 500 }),
      callFunction("join-group", playerC.token, { group_id: groupId, expected_total: 500 }),
    ]);
    const winners = [a, b, c].filter((r) => r.status === 200);
    const losers = [a, b, c].filter((r) => r.status !== 200);
    expect(winners.length, JSON.stringify({ a: a.json, b: b.json, c: c.json })).toBe(2);
    expect(losers.length).toBe(1);
    expect(losers[0].json.code).toBe("GROUP_FULL");

    // Capture one winner, activate it, and confirm ALREADY_MEMBER fires
    // before Razorpay on a repeat join by the same now-pending/active member.
    const winner = winners[0];
    const captured = await capturePayment(
      [playerA, playerB, playerC][[a, b, c].indexOf(winner)].token,
      winner.json.razorpay_order_id,
      "CO06",
    );
    expect(captured.status, JSON.stringify(captured.json)).toBe(200);

    const sql = serviceClient();
    const { data: membership } = await sql
      .from("group_memberships")
      .select("status")
      .eq("id", winner.json.membership_id)
      .single();
    expect(membership.status).toBe("active");

    const winnerToken = [playerA, playerB, playerC][[a, b, c].indexOf(winner)].token;
    const repeatJoin = await callFunction("join-group", winnerToken, { group_id: groupId, expected_total: 500 });
    expect(repeatJoin.status).not.toBe(200);
    expect(repeatJoin.json.code).toBe("ALREADY_MEMBER");
  });

  test("CO-07 scripts/verify-groups-probes.mjs exits green against the deployed backend @money", async () => {
    // The catalog's own expected outcome for CO-07 IS "script exits green":
    // this is not a new assertion, it is a Playwright-harness wrapper around
    // the standalone probe script (Groups phase, Track A clause 7) that
    // already covers oversell/RLS/mark_attendance for training groups end to
    // end, run for real against the deployed edge functions/RPCs with its
    // own anon-key logins. No SUPABASE_SERVICE_ROLE_KEY dependency at all
    // (confirmed by reading the script before wiring this in), so it runs
    // regardless of NEEDS_SERVICE_KEY.
    test.setTimeout(60_000);
    const { code, stdout, stderr } = await new Promise((resolve) => {
      const child = spawn("node", ["scripts/verify-groups-probes.mjs"], { cwd: REPO_ROOT });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    expect(code, `verify-groups-probes.mjs exited nonzero:\n${stderr}\n${stdout}`).toBe(0);

    const out = JSON.parse(stdout);
    expect(out.ids_distinct, "probe users were not distinct (AT-62 shape)").toBe(true);
    expect(out.a_no_oversell, JSON.stringify(out)).toBe(true);
    expect(out.b_direct_insert.ok, JSON.stringify(out.b_direct_insert)).toBe(true);
    expect(out.b_direct_update.ok, JSON.stringify(out.b_direct_update)).toBe(true);
    expect(out.b_anon_reads_active_group).toBe(true);
    expect(out.b_anon_membership_rows).toBe(0);
    expect(out.b_member_sees_only_own?.ok, JSON.stringify(out.b_member_sees_only_own)).toBe(true);
    expect(out.d_ok, JSON.stringify(out)).toBe(true);
  });

  test("CO-08 a non-member of a training group is denied its group chat thread, zero rows @money", async () => {
    // No serviceClient() dependency: every read below is through a persona's
    // own RLS-scoped client, so this runs regardless of NEEDS_SERVICE_KEY.
    const coach1 = await personaSession("coach1");
    const [member, stranger] = await Promise.all([personaSession("player"), personaSession("partner")]);
    assertIsolation(member.userId, stranger.userId, "CO-08 group member vs stranger");

    const created = await coach1.client
      .rpc("create_training_group", {
        p_name: `E2E CO-08 ${Date.now()}`,
        p_sport: "cricket",
        p_capacity: 5,
        p_monthly_fee: 500,
      })
      .single();
    expect(created.error, created.error?.message).toBeNull();
    const groupId = created.data.id;

    const joined = await callFunction("join-group", member.token, { group_id: groupId, expected_total: 500 });
    expect(joined.status, JSON.stringify(joined.json)).toBe(200);
    const captured = await capturePayment(member.token, joined.json.razorpay_order_id, "CO08");
    expect(captured.status, JSON.stringify(captured.json)).toBe(200);

    // The seated member reads their group's chat thread: exactly one row.
    const { data: memberThreads, error: memberErr } = await member.client
      .from("chat_threads")
      .select("id")
      .eq("context_type", "group")
      .eq("context_id", groupId);
    expect(memberErr, memberErr?.message).toBeNull();
    expect(memberThreads?.length, "the seated member could not read their own group's chat thread").toBe(1);
    const threadId = memberThreads[0].id;

    // A non-member (never joined, not the coach) reads the same thread and
    // its member roster: zero rows both times, access denied, not another
    // party's data.
    const { data: strangerThreads, error: strangerThreadErr } = await stranger.client
      .from("chat_threads")
      .select("id")
      .eq("context_type", "group")
      .eq("context_id", groupId);
    if (!strangerThreadErr) {
      expect(strangerThreads ?? [], "a non-member read another group's chat_threads row").toEqual([]);
    }

    const { data: strangerMembers, error: strangerMembersErr } = await stranger.client
      .from("chat_thread_members")
      .select("user_id")
      .eq("thread_id", threadId);
    if (!strangerMembersErr) {
      expect(strangerMembers ?? [], "a non-member read another group's chat_thread_members roster").toEqual([]);
    }

    const { data: strangerMessages, error: strangerMessagesErr } = await stranger.client
      .from("chat_messages")
      .select("id")
      .eq("thread_id", threadId);
    if (!strangerMessagesErr) {
      expect(strangerMessages ?? [], "a non-member read another group's chat_messages").toEqual([]);
    }
  });

  test("CO-09 out-of-range ratings are rejected, a second rating is rejected, coach average recalculates correctly @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    const [player, coach1] = await Promise.all([personaSession("player"), personaSession("coach1")]);
    const booked = await bookYesterdaySession(player.token, "CO09", "14:00");
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    const sessionId = booked.json.session_id;
    const captured = await capturePayment(player.token, booked.json.razorpay_order_id, "CO09");
    expect(captured.status, JSON.stringify(captured.json)).toBe(200);

    const accept = await coach1.client.rpc("session_transition", { p_session_id: sessionId, p_action: "accept" });
    expect(accept.error, accept.error?.message).toBeNull();
    const complete = await callFunction("complete-session", coach1.token, { session_id: sessionId });
    expect(complete.status, JSON.stringify(complete.json)).toBe(200);

    const tooHigh = await player.client.rpc("rate_session", { p_session_id: sessionId, p_rating: 6 });
    expect(tooHigh.error, "a rating of 6 must be rejected").toBeTruthy();
    expect(String(tooHigh.error.message)).toContain("VALIDATION");

    const tooLow = await player.client.rpc("rate_session", { p_session_id: sessionId, p_rating: 0 });
    expect(tooLow.error, "a rating of 0 must be rejected").toBeTruthy();
    expect(String(tooLow.error.message)).toContain("VALIDATION");

    const valid = await player.client.rpc("rate_session", { p_session_id: sessionId, p_rating: 4, p_remarks: "e2e CO-09" });
    expect(valid.error, valid.error?.message).toBeNull();
    expect(valid.data.rating).toBe(4);

    const second = await player.client.rpc("rate_session", { p_session_id: sessionId, p_rating: 5 });
    expect(second.error, "a second rate_session call must be rejected").toBeTruthy();
    expect(String(second.error.message)).toContain("ALREADY_RATED");

    // rate_session recomputes coach_profiles.rating/rating_count FROM the
    // sessions table in the same transaction (0021's own comment: "never
    // incremented in place, so a replay cannot double count"). Re-derive the
    // same aggregate independently and confirm no drift.
    const sql = serviceClient();
    const { data: ratedSessions } = await sql.from("sessions").select("rating").eq("coach_id", COACH1_ID).not("rating", "is", null);
    const ratings = (ratedSessions ?? []).map((r) => Number(r.rating));
    const expectedAvg = ratings.reduce((s, r) => s + r, 0) / ratings.length;

    const { data: profile } = await sql.from("coach_profiles").select("rating,rating_count").eq("user_id", COACH1_ID).single();
    expect(profile.rating_count).toBe(ratings.length);
    expect(Number(profile.rating)).toBeCloseTo(expectedAvg, 2);
  });

  test("CO-10 the coach wallet's balance, lifetime earned, lifetime transferred, and this-month figures all match an independently computed SQL aggregate @money", async () => {
    test.skip(NEEDS_SERVICE_KEY, "needs service role key");
    // CO-02 already re-proves ONLY `balance` against the ledger. This case
    // covers the OTHER three figures get_coach_wallet_balance() returns
    // (0025_wallet_and_transactions_rpcs.sql) that EarningsHeader also
    // renders, each independently recomputed here rather than trusted.
    const coach1 = await personaSession("coach1");
    const { data: wallet, error } = await coach1.client.rpc("get_coach_wallet_balance");
    expect(error, error?.message).toBeNull();
    const walletRow = Array.isArray(wallet) ? wallet[0] : wallet;

    const sql = serviceClient();
    const { data: legs } = await sql
      .from("ledger_entries")
      .select("direction,amount,created_at")
      .eq("account_type", "coach")
      .eq("account_ref", COACH1_ID);
    const credit = (legs ?? []).filter((l) => l.direction === "credit").reduce((s, l) => s + Number(l.amount), 0);
    const debit = (legs ?? []).filter((l) => l.direction === "debit").reduce((s, l) => s + Number(l.amount), 0);

    // Mirrors the RPC's own `date_trunc('month', now() at time zone
    // 'Asia/Kolkata') at time zone 'Asia/Kolkata'` exactly: IST is a fixed
    // UTC+5:30 offset (no DST), so shifting the UTC instant forward,
    // truncating to the first of the month, then shifting back gives the
    // same UTC instant Postgres computes.
    const IST_OFFSET_MS = 5.5 * 3600 * 1000;
    const istNow = new Date(Date.now() + IST_OFFSET_MS);
    const istMonthStartUtcMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0);
    const monthStart = new Date(istMonthStartUtcMs - IST_OFFSET_MS);
    const thisMonth = (legs ?? [])
      .filter((l) => l.direction === "credit" && new Date(l.created_at) >= monthStart)
      .reduce((s, l) => s + Number(l.amount), 0);

    expect(Number(walletRow.balance)).toBeCloseTo(credit - debit, 2);
    expect(Number(walletRow.lifetime_earned)).toBeCloseTo(credit, 2);
    expect(Number(walletRow.lifetime_transferred)).toBeCloseTo(debit, 2);
    expect(Number(walletRow.this_month)).toBeCloseTo(thisMonth, 2);
  });

  test("CO-11 editing a future weekday's availability window leaves an already-accepted session untouched; only future slot generation changes @money", async () => {
    // No serviceClient() dependency: every read/write below is through
    // coach1's own RLS-scoped client (owner read/write on
    // coach_availability_windows and sessions), so this runs regardless of
    // NEEDS_SERVICE_KEY.
    const coach1 = await personaSession("coach1");
    const player = await personaSession("player");

    // Far enough out (28-34 days) that it cannot collide with any other
    // CO-* test's fixed "yesterday" fixture. Randomized (day offset AND
    // slot, both within the original 10:00-18:00 window but before the
    // 14:00 shrink point below) rather than a single fixed slot, the same
    // reason courts.spec.ts's pickAvailableSlot searches instead of
    // hardcoding one: sessions_coach_date_slot_unique makes a fixed
    // (coach, date, slot) pair collide with itself on a same-day rerun of
    // this exact test (confirmed live), which is not a product defect.
    const targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() + 28 + Math.floor(Math.random() * 7));
    const dateStr = targetDate.toISOString().slice(0, 10);
    const dayOfWeek = targetDate.getUTCDay();
    const slotHour = 10 + Math.floor(Math.random() * 3); // 10, 11, or 12
    const slotMinute = ["00", "15", "30", "45"][Math.floor(Math.random() * 4)];
    const slotStart = `${String(slotHour).padStart(2, "0")}:${slotMinute}`;

    const { data: windowRow, error: windowErr } = await coach1.client
      .from("coach_availability_windows")
      .select("id,start_time,end_time")
      .eq("coach_id", COACH1_ID)
      .eq("day_of_week", dayOfWeek)
      .single();
    expect(windowErr, windowErr?.message).toBeNull();
    const originalStartTime = windowRow.start_time;

    // Book + accept a real session at slotStart on targetDate, inside the
    // ORIGINAL every-day 10:00-18:00 window (confirmed live before writing
    // this file).
    const booked = await callFunction("book-session", player.token, {
      session_type_id: SESSION_TYPE_ID,
      frequency: "one_time",
      date: dateStr,
      slot_start: slotStart,
      expected_total: 1000,
      focus_area: "e2e CO-11 already-accepted",
    });
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    const sessionId = booked.json.session_id;
    const accept = await coach1.client.rpc("session_transition", { p_session_id: sessionId, p_action: "accept" });
    expect(accept.error, accept.error?.message).toBeNull();
    expect(accept.data.status).toBe("accepted");

    try {
      // Shrink the window so slotStart falls OUTSIDE it going forward
      // (PRD-02 FR-23: editing availability is an UPDATE in place, not a
      // superseding row, so this takes effect immediately for future slot
      // checks). slotHour is always < 14, so this always excludes it.
      const { error: updateErr } = await coach1.client
        .from("coach_availability_windows")
        .update({ start_time: "14:00" })
        .eq("id", windowRow.id);
      expect(updateErr, updateErr?.message).toBeNull();

      // The already-accepted session is completely unaffected.
      const { data: sessionAfter, error: sessionAfterErr } = await coach1.client
        .from("sessions")
        .select("status,slot_start,slot_end")
        .eq("id", sessionId)
        .single();
      expect(sessionAfterErr, sessionAfterErr?.message).toBeNull();
      expect(sessionAfter.status).toBe("accepted");
      expect(sessionAfter.slot_start).toMatch(new RegExp(`^${slotStart}`));

      // A NEW booking attempt at the SAME slotStart on a DIFFERENT date with
      // the SAME day_of_week (7 days later) is now refused: future slot
      // generation reflects the edited window.
      const nextWeek = new Date(targetDate);
      nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
      const blocked = await callFunction("book-session", player.token, {
        session_type_id: SESSION_TYPE_ID,
        frequency: "one_time",
        date: nextWeek.toISOString().slice(0, 10),
        slot_start: slotStart,
        expected_total: 1000,
        focus_area: "e2e CO-11 future-blocked",
      });
      expect(blocked.status).not.toBe(200);
      expect(blocked.json.code).toBe("SLOT_TAKEN");
    } finally {
      // Restore unconditionally: coach1's every-day 10:00-18:00 availability
      // is a shared fixture bookYesterdaySession and other CO-* tests assume
      // holds.
      await coach1.client
        .from("coach_availability_windows")
        .update({ start_time: originalStartTime })
        .eq("id", windowRow.id);
    }
  });
});
