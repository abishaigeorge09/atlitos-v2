// ATLITOS v2 — supabase/functions/complete-session/index.ts
//
// POST { session_id } with the COACH's own JWT.
// Epic AT-11, story AT-41. Requirements: PRD-02 FR-15, PRD-02 FR-25.
//
// Marking a session complete is the money event. This function is the only
// way that event may happen, because it is the only place that does both
// halves of it atomically enough to matter:
//
//   1. `session_transition_internal(actor, session_id, 'complete')` called
//      with the SERVICE-ROLE client (AT-61, 0027). That RPC is `security
//      definer` and enforces "only the assigned coach", "only from accepted",
//      and "only after the scheduled end time" (TOO_EARLY) against the actor
//      it is handed. The actor is `getAuthenticatedUser()`'s id, validated
//      against GoTrue, never read from the request body. Before 0027 this ran
//      under the coach's own JWT; it moved to the service role because
//      `session_transition` is now closed to `authenticated` callers for this
//      action, which is what makes step 2 unskippable.
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
//   a. the RPC itself refuses a second 'complete' with INVALID_TRANSITION,
//      since the session is no longer `accepted`.
//   b. Before writing, this function checks for an existing coach-credit
//      ledger row for this session id and returns `already_accrued` if one
//      exists. This is what makes the backfill path in (c) safe.
//   c. If the transition fails but the session is ALREADY `completed` and has
//      no accrual, the accrual is written anyway. This used to close a real
//      gap: `session_transition` was granted to `authenticated`, so a client
//      could complete a session without ever reaching this function, leaving
//      the coach uncredited. AT-61 (0027) closed that gap at the source, so
//      the path now only covers rows completed BEFORE 0027 and the case where
//      a previous run of this function died between the transition and the
//      ledger write. Kept, because both are real and both lose the coach's
//      money if unrepaired.
//
// The fee is snapshotted on `sessions.platform_fee` at booking time (AT-40),
// so an admin editing `fee_config` between booking and completion cannot
// change what this session accrues. `fee_config` is re-read only as a
// fallback for rows predating that snapshot.
//
// **Appointments** (2026-10-01, `_shared/coach-payments.ts`): a session booked
// while in-app coach payments are off has no payment_intent. It completes
// through the same RPC, but no ledger group is written and the outcome is
// `completed_offline`, since the athlete paid the coach directly.
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

/**
 * The session's payment_intent, or PAYMENT_NOT_CAPTURED. A completed session
 * with no captured payment is an anomaly worth failing loudly on rather than
 * silently crediting against funds that never arrived, or silently skipping
 * and losing the coach's earnings with no trace.
 */
async function requireCapturedIntent(
  supabase: ReturnType<typeof serviceRoleClient>,
  session: Pick<SessionRow, "id" | "payment_intent_id">,
): Promise<{ id: string; status: string }> {
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
  return intent;
}

/**
 * True for an appointment booked with in-app coach payments off
 * (`_shared/coach-payments.ts`): no payment_intent linked and none ever
 * created for it. Such a session completes with no ledger group, because no
 * money passed through Atlitos; the athlete paid the coach directly. Decided
 * from the session's own data, not the switch, so appointments booked while
 * payments were off still complete after payments are turned back on. A paid
 * booking always has an intent row (book-session creates it before the order),
 * so it can never be mistaken for one.
 */
async function isAppointment(
  supabase: ReturnType<typeof serviceRoleClient>,
  session: Pick<SessionRow, "id" | "payment_intent_id">,
): Promise<boolean> {
  if (session.payment_intent_id) return false;
  const { data, error } = await supabase
    .from("payment_intents")
    .select("id")
    .eq("domain", "session")
    .eq("entity_id", session.id)
    .limit(1);
  if (error) {
    throw new AppError(
      "INTERNAL",
      `Failed to read payment_intents for session ${session.id}: ${error.message}`,
      500,
    );
  }
  return (data ?? []).length === 0;
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
    const supabase = serviceRoleClient();

    // Check the payment BEFORE the transition. The RPC below commits the
    // status change on its own round trip, so a payment failure discovered
    // after it would leave the session `completed` with no accrual, and every
    // retry would land on the repair path and fail the same way. Only runs for
    // the assigned coach on a session the RPC could actually complete; every
    // other caller or state falls through to the RPC's own error (FORBIDDEN,
    // NOT_FOUND, INVALID_TRANSITION) so nothing about the payment leaks.
    const { data: pending } = await supabase
      .from("sessions")
      .select("id, coach_id, status, payment_intent_id")
      .eq("id", body.session_id)
      .maybeSingle<Pick<SessionRow, "id" | "coach_id" | "status" | "payment_intent_id">>();

    if (
      pending &&
      pending.coach_id === user.id &&
      (pending.status === "accepted" || pending.status === "in_progress") &&
      !(await isAppointment(supabase, pending))
    ) {
      await requireCapturedIntent(supabase, pending);
    }

    // Run the state machine under the SERVICE ROLE, via the internal entry
    // point (AT-61, 0027). `session_transition('complete')` now refuses every
    // `authenticated` caller with USE_EDGE_FUNCTION, so that this function is
    // the only path to a completed session and the accrual below cannot be
    // skipped. The coach's identity is still what the RPC enforces; it just
    // arrives as `p_actor_id` rather than `auth.uid()`, because auth.uid() is
    // null under the service-role key. `user.id` comes from
    // getAuthenticatedUser, which validates the bearer token against GoTrue
    // rather than trusting anything in the request body, so this is the same
    // identity the user-scoped client would have presented.
    const { data: transitioned, error: transitionError } = await supabase
      .rpc("session_transition_internal", {
        p_actor_id: user.id,
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

    // An appointment (no payment ever attached) is done once the transition
    // has committed: there is no money to accrue and no ledger group to write.
    if (await isAppointment(supabase, session)) {
      return jsonResponse({
        session_id: session.id,
        status: session.status,
        outcome: "completed_offline",
      });
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
    // the coach anything. The pre-check above already refused an uncaptured
    // session before transitioning it; this re-check covers the repair path
    // and a payment state that changed between the two reads.
    const intent = await requireCapturedIntent(supabase, session);

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
