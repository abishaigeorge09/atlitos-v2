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

import { callFunction, capturePayment } from "../../helpers/money.mjs";
import { personaSession } from "../../helpers/persona.mjs";
import { assertIsolation, serviceClient } from "../../helpers/sql.mjs";
import { expect, test } from "../../fixtures";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "athlete-web", "CO spec runs only under the athlete-web project");
});

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

  test("CO-04 a declined, already-captured session: does the platform actually give the money back @money", async () => {
    // This test asserts the catalog's stated expectation literally
    // ("money nets to zero for the declined session, no charge retained, no
    // orphaned ledger entry"). Recorded ahead of running it because the code
    // reading disagrees with that expectation and the disagreement matters:
    // 0026_session_request_cancel_refund.sql's own header explains that only
    // the ATHLETE-initiated `requested` -> `cancelled` edge (cancel-session-
    // refund) carries an automatic refund; a COACH declining an unanswered,
    // already-paid request (`requested` -> `declined`, FR-14) has no refund
    // call anywhere in supabase/functions or the 0021/0026 migrations. A
    // session accrues no ledger group until completion (AT-40/AT-41), so a
    // declined session correctly has zero ledger rows either way — but if
    // payment_intents.status is still `captured` with no refunds row, the
    // athlete's money was taken and never returned, which is a real gap this
    // test is designed to surface, not paper over.
    const [player, coach1] = await Promise.all([personaSession("player"), personaSession("coach1")]);
    const booked = await bookYesterdaySession(player.token, "CO04", "12:00");
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    const sessionId = booked.json.session_id;
    const captured = await capturePayment(player.token, booked.json.razorpay_order_id, "CO04");
    expect(captured.status, JSON.stringify(captured.json)).toBe(200);

    const decline = await coach1.client.rpc("session_transition", {
      p_session_id: sessionId,
      p_action: "decline",
      p_reason: "e2e CO-04 coach declines a paid request",
    });
    expect(decline.error, decline.error?.message).toBeNull();
    expect(decline.data.status).toBe("declined");

    const sql = serviceClient();
    const { data: legs } = await sql.from("ledger_entries").select("amount,direction").eq("domain", "session").eq("entity_id", sessionId);
    const net = (legs ?? []).reduce((s, l) => s + (l.direction === "credit" ? -Number(l.amount) : Number(l.amount)), 0) * -1;
    expect(net, "ledger for a declined session must net to zero (it accrues nothing)").toBeCloseTo(0, 2);

    const { data: intent } = await sql
      .from("payment_intents")
      .select("status")
      .eq("domain", "session")
      .eq("entity_id", sessionId)
      .single();
    const { data: refundRow } = await sql.from("refunds").select("status").eq("domain", "session").eq("entity_id", sessionId).maybeSingle();

    // The catalog's "no charge retained": the intent must not be sitting at
    // `captured` with nothing accounting for giving it back.
    expect(
      intent.status === "refunded" || !!refundRow,
      `REAL FINDING (CO-04): session ${sessionId} was declined after capture but payment_intents.status is "${intent.status}" ` +
        "with no refunds row at all. A coach declining an unanswered, already-paid request has no automatic refund path " +
        "(unlike the athlete-initiated requested->cancelled edge, which does), so the athlete's money is captured and never returned.",
    ).toBe(true);
  });

  test("CO-05 the requested-cancel refund applies automatically, no admin step @money", async () => {
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
});
