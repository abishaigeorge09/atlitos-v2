// ATLITOS v2 — supabase/functions/complete-session/index.ts
//
// POST { session_id } with the COACH's own JWT.
// Epic AT-11, story AT-41. Requirements: PRD-02 FR-15, PRD-02 FR-25.
//
// Marking a session complete is the money event. This function is the only
// way that event may happen, because it is the only place that does both
// halves of it atomically enough to matter:
//
//   1. `session_transition(session_id, 'complete')` called with the COACH's
//      own JWT (an anon-key client carrying their bearer token, not the
//      service-role client). That RPC is `security definer` and reads
//      `auth.uid()`, so it is what enforces "only the assigned coach", "only
//      from accepted", and "only after the scheduled end time" (TOO_EARLY).
//      Under the service-role key `auth.uid()` is null and the RPC would
//      reject outright, which is why two clients are used here, deliberately.
//   2. The balanced `ledger_entries` group, written by the SERVICE-ROLE
//      client, per CLAUDE.md: "ledger writes happen only in edge functions
//      running under the service role".
//
// The group is SCHEMA.md's worked example verbatim, for a session priced at
// 1000 with a 100 platform fee:
//
//   debit  platform            1000.00   clearing
//   credit coach <coach_id>     900.00   session earnings
//   credit platform             100.00   platform fee
//
// Debits equal credits, which `assert_ledger_group_balanced` (a deferred
// constraint trigger, 0010) re-checks at commit regardless of what this file
// believes. The fee is read server side from the same `fee_config` table
// courts use; the client never computes or submits an amount.
//
// **Idempotency, three layers deep**, because AT-41 requires that a second
// complete call cannot double credit:
//
//   a. `session_transition` itself refuses a second 'complete' with
//      INVALID_TRANSITION, since the session is no longer `accepted`.
//   b. Before writing, this function checks for an existing coach-credit
//      ledger row for this session id and returns `already_accrued` if one
//      exists. This is what makes the backfill path in (c) safe.
//   c. If the transition fails but the session is ALREADY `completed` and has
//      no accrual, the accrual is written anyway. That closes the one real
//      gap in this design: `session_transition` is granted to `authenticated`,
//      so a client could in principle call the RPC directly and complete a
//      session without ever reaching this function, leaving the coach
//      uncredited. Calling complete-session afterwards repairs it rather than
//      failing with INVALID_TRANSITION and silently losing the coach's money.
//      Track C's coach session detail screen must still call THIS function,
//      not the bare RPC; the repair path is a safety net, not the contract.
//
// The fee is snapshotted on `sessions.platform_fee` at booking time (AT-40),
// so an admin editing `fee_config` between booking and completion cannot
// change what this session accrues. `fee_config` is re-read only as a
// fallback for rows predating that snapshot.
//
// This does NOT call Razorpay. Money leaves the platform's account only when
// the coach explicitly taps Transfer (AT-43), per PAYMENTS.md's on-demand
// transfer model.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
  userScopedClient,
} from "../_shared/supabase.ts";
import { getActiveFeeConfig, round2 } from "../_shared/fee-config.ts";

interface SessionRow {
  id: string;
  coach_id: string;
  player_id: string;
  status: string;
  price: number;
  platform_fee: number;
  total: number;
  payment_intent_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequestBody(raw: unknown): { session_id: string } {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const { session_id } = raw as Record<string, unknown>;
  if (typeof session_id !== "string" || !UUID_RE.test(session_id)) {
    throw new AppError("VALIDATION", "session_id must be a valid uuid.", 400);
  }
  return { session_id };
}

/** True if this session already has an earnings accrual group. */
async function hasAccrual(
  supabase: ReturnType<typeof serviceRoleClient>,
  sessionId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("id")
    .eq("domain", "session")
    .eq("entity_id", sessionId)
    .eq("account_type", "coach")
    .limit(1);

  if (error) {
    throw new AppError(
      "INTERNAL",
      `Failed to check existing accrual for session ${sessionId}: ${error.message}`,
      500,
    );
  }
  return (data ?? []).length > 0;
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    const body = parseRequestBody(await request.json().catch(() => null));
    const user = await getAuthenticatedUser(request);
    const asCoach = userScopedClient(request);
    const supabase = serviceRoleClient();

    // Run the state machine as the coach. Everything this RPC enforces
    // (coach identity, accepted -> completed, TOO_EARLY) stays the database's
    // job; this function adds no second opinion about who may complete what.
    const { data: transitioned, error: transitionError } = await asCoach
      .rpc("session_transition", {
        p_session_id: body.session_id,
        p_action: "complete",
      })
      .single<SessionRow>();

    let session: SessionRow;

    if (transitionError) {
      // Repair path (see header note c): the session is already completed but
      // was never accrued. Anything else is the RPC's error, relayed with its
      // own code so the client sees TOO_EARLY / FORBIDDEN / NOT_FOUND rather
      // than a flattened 500.
      const { data: existing } = await supabase
        .from("sessions")
        .select("id, coach_id, player_id, status, price, platform_fee, total, payment_intent_id")
        .eq("id", body.session_id)
        .maybeSingle<SessionRow>();

      const repairable =
        existing !== null &&
        existing !== undefined &&
        existing.status === "completed" &&
        existing.coach_id === user.id &&
        !(await hasAccrual(supabase, body.session_id));

      if (!repairable) {
        throw appErrorFromPostgrestMessage(transitionError.message);
      }
      session = existing as SessionRow;
    } else {
      session = transitioned;
    }

    // Idempotency gate (b): never write a second group for one session.
    if (await hasAccrual(supabase, session.id)) {
      return jsonResponse({
        session_id: session.id,
        status: session.status,
        outcome: "already_accrued",
      });
    }

    // The money must actually have been collected before the platform owes
    // the coach anything. A completed session with no captured payment is an
    // anomaly worth failing loudly on rather than silently crediting against
    // funds that never arrived, or silently skipping and losing the coach's
    // earnings with no trace.
    if (!session.payment_intent_id) {
      throw new AppError(
        "PAYMENT_NOT_CAPTURED",
        "This session has no payment attached, so earnings cannot be accrued.",
        409,
      );
    }

    const { data: intent, error: intentError } = await supabase
      .from("payment_intents")
      .select("id, status")
      .eq("id", session.payment_intent_id)
      .maybeSingle<{ id: string; status: string }>();

    if (intentError) {
      throw new AppError(
        "INTERNAL",
        `Failed to read payment_intent for session ${session.id}: ${intentError.message}`,
        500,
      );
    }
    if (!intent || intent.status !== "captured") {
      throw new AppError(
        "PAYMENT_NOT_CAPTURED",
        "This session's payment has not been captured, so earnings cannot be accrued.",
        409,
      );
    }

    // Amounts. The snapshot on the session row is authoritative (it was
    // derived from fee_config at booking time and is what the athlete was
    // shown); fee_config is re-read only if a row somehow carries no fee.
    const gross = round2(session.total);
    let platformFee = round2(session.platform_fee);
    if (!(platformFee > 0)) {
      const feeConfig = await getActiveFeeConfig(
        supabase,
        "sessions",
        "platform_fee_flat",
      );
      platformFee = round2(feeConfig.value);
    }
    const coachPayable = round2(gross - platformFee);

    if (coachPayable <= 0) {
      throw new AppError(
        "INTERNAL",
        `Session ${session.id} would credit the coach ${coachPayable}, which ledger_entries rejects.`,
        500,
      );
    }

    const entryGroupId = crypto.randomUUID();

    // One insert call = one INSERT statement = one atomic write of the whole
    // balanced group. ledger_entries is insert-only for every role including
    // service_role (0010), so a correction is always a new reversing group.
    const { error: ledgerError } = await supabase.from("ledger_entries").insert([
      {
        entry_group_id: entryGroupId,
        payment_intent_id: intent.id,
        account_type: "platform",
        account_ref: null,
        direction: "debit",
        amount: gross,
        domain: "session",
        entity_id: session.id,
        description: `Clearing: session ${session.id} completed`,
      },
      {
        entry_group_id: entryGroupId,
        payment_intent_id: intent.id,
        account_type: "coach",
        account_ref: session.coach_id,
        direction: "credit",
        amount: coachPayable,
        domain: "session",
        entity_id: session.id,
        description: `Session earnings, session ${session.id}`,
      },
      {
        entry_group_id: entryGroupId,
        payment_intent_id: intent.id,
        account_type: "platform",
        account_ref: null,
        direction: "credit",
        amount: platformFee,
        domain: "session",
        entity_id: session.id,
        description: `Platform fee, session ${session.id}`,
      },
    ]);

    if (ledgerError) {
      throw new AppError(
        "INTERNAL",
        `Failed to write ledger_entries for session ${session.id}: ${ledgerError.message}`,
        500,
      );
    }

    return jsonResponse({
      session_id: session.id,
      status: session.status,
      outcome: "accrued",
      accrual: {
        entry_group_id: entryGroupId,
        gross,
        platform_fee: platformFee,
        coach_payable: coachPayable,
      },
    });
  })
);
