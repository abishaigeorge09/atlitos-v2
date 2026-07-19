// ATLITOS v2 — supabase/functions/book-session/index.ts
//
// POST with the athlete's own JWT:
//   { session_type_id, frequency, date, slot_start,
//     focus_area?, location?, expected_total }
//
// Epic AT-5 / AT-11, story AT-40. Requirements: PRD-01 FR-22, FR-23, FR-24;
// PRD-02 FR-24. Mirrors book-court's shape exactly, per PAYMENTS.md's
// "book-session / book-court" sequence:
//
//   1. Re-price server side from `session_types.price` and the active
//      `fee_config` row for (`sessions`, `platform_fee_flat`). The client
//      submits `expected_total` (the number its BillSummary displayed) and a
//      mismatch returns `409 PRICE_MISMATCH` with no session row and no
//      Razorpay order, per PRD-01 FR-23: "a mismatch blocks payment and
//      surfaces a price-changed message rather than charging the client's
//      number". This is the one shape difference from book-court, which has
//      no client-supplied total to compare against because its price comes
//      from a slot helper the client cannot pre-compute.
//   2. Check the slot is inside a coach availability window for that weekday
//      and is not already held (get_coach_busy_slots), an optimistic
//      pre-check only.
//   3. Insert the `sessions` row as `requested` (0018_coaching.sql header
//      note 3: a session's first persisted state is `requested`, there is no
//      pending_payment state in this domain). The partial unique index
//      `sessions_coach_date_slot_unique` is the real concurrency guard; a
//      `23505` here returns `409 SLOT_TAKEN` before Razorpay is ever called.
//   4. Create `payment_intents` (domain `session`), then the Razorpay order
//      with notes {domain, entity_id, payment_intent_id}, then backfill the
//      real order id, then link the intent onto the session row.
//   5. Return the order for the client to open the checkout sheet. Nothing
//      here confirms payment: capture is finalized only by
//      `_shared/finalize-payment.ts`, reached from razorpay-webhook or
//      verify-payment, per PAYMENTS.md's "payment confirmation is
//      webhook-driven, never client-driven".
//
// On a Razorpay failure after the session row exists, the row is released via
// the service-role-only RPC `session_abandon_unpaid` (0024), never a raw
// status UPDATE from this function, so the state machine stays the database's
// job (CLAUDE.md's financial invariant). `cancelled` is excluded from the
// partial unique index, so releasing the row frees the slot immediately
// rather than leaving an unpayable session squatting it.
//
// Pricing model, resolved against SCHEMA.md rather than inferred: the
// platform fee is carved OUT of the coach's price, not added on top of it.
// SCHEMA.md's worked example is explicit ("a session priced at 1000 with a
// 100 platform fee" debits platform 1000, credits coach 900, credits platform
// 100), and PRD-01 FR-31 asks for a separate platform fee ROW in the
// BillSummary only for courts, never for sessions. So `sessions.price` is the
// coach's list price, `sessions.platform_fee` is the platform's cut of it,
// and `sessions.total` (what the athlete is charged) equals `price`.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { createOrder, razorpayKeyId } from "../_shared/razorpay.ts";
import { getActiveFeeConfig, round2 } from "../_shared/fee-config.ts";

interface BookSessionRequestBody {
  session_type_id: string;
  frequency: "one_time" | "weekly" | "monthly";
  date: string;
  slot_start: string;
  focus_area?: string;
  location?: string;
  expected_total: number;
}

interface SessionTypeRow {
  id: string;
  coach_id: string;
  duration_minutes: number;
  price: number;
  active: boolean;
  coach_profiles: { status: string } | null;
}

interface AvailabilityWindowRow {
  start_time: string;
  end_time: string;
}

interface BusySlotRow {
  date: string;
  slot_start: string;
}

interface SessionRow {
  id: string;
  status: string;
  date: string;
  slot_start: string;
  slot_end: string;
  price: number;
  platform_fee: number;
  total: number;
}

interface PaymentIntentRow {
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const FREQUENCIES = ["one_time", "weekly", "monthly"] as const;

/** Postgres `time` round-trips as "HH:MM:SS"; normalize both sides for exact compare. */
function normalizeTime(value: string): string {
  const [h, m, s] = value.split(":");
  return `${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}:${
    (s ?? "00").slice(0, 2).padStart(2, "0")
  }`;
}

function timeToMinutes(value: string): number {
  const [h, m] = normalizeTime(value).split(":");
  return Number(h) * 60 + Number(m);
}

function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function parseRequestBody(raw: unknown): BookSessionRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  const {
    session_type_id,
    frequency,
    date,
    slot_start,
    focus_area,
    location,
    expected_total,
  } = body;

  if (typeof session_type_id !== "string" || !UUID_RE.test(session_type_id)) {
    throw new AppError("VALIDATION", "session_type_id must be a valid uuid.", 400);
  }
  if (
    typeof frequency !== "string" ||
    !FREQUENCIES.includes(frequency as typeof FREQUENCIES[number])
  ) {
    throw new AppError(
      "VALIDATION",
      "frequency must be one_time, weekly, or monthly.",
      400,
    );
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    throw new AppError("VALIDATION", "date must be an ISO date (YYYY-MM-DD).", 400);
  }
  if (typeof slot_start !== "string" || !TIME_RE.test(slot_start)) {
    throw new AppError(
      "VALIDATION",
      "slot_start must be a time (HH:MM or HH:MM:SS).",
      400,
    );
  }
  if (typeof expected_total !== "number" || !Number.isFinite(expected_total)) {
    throw new AppError(
      "VALIDATION",
      "expected_total is required and must be a number.",
      400,
    );
  }
  if (focus_area !== undefined && typeof focus_area !== "string") {
    throw new AppError("VALIDATION", "focus_area must be a string.", 400);
  }
  if (location !== undefined && typeof location !== "string") {
    throw new AppError("VALIDATION", "location must be a string.", 400);
  }

  return {
    session_type_id,
    frequency: frequency as BookSessionRequestBody["frequency"],
    date,
    slot_start,
    focus_area: typeof focus_area === "string" ? focus_area.trim() || undefined : undefined,
    location: typeof location === "string" ? location.trim() || undefined : undefined,
    expected_total,
  };
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

    const slotStart = normalizeTime(body.slot_start);

    // ------------------------------------------------------------------
    // 1. Session type must exist, be active, and belong to a verified coach.
    // ------------------------------------------------------------------
    const { data: sessionType, error: typeError } = await supabase
      .from("session_types")
      .select("id, coach_id, duration_minutes, price, active, coach_profiles(status)")
      .eq("id", body.session_type_id)
      .maybeSingle<SessionTypeRow>();

    if (typeError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load session type: ${typeError.message}`,
        500,
      );
    }
    if (
      !sessionType ||
      !sessionType.active ||
      sessionType.coach_profiles?.status !== "verified"
    ) {
      throw new AppError("NOT_FOUND", "Session type not found or not bookable.", 404);
    }

    if (sessionType.coach_id === user.id) {
      throw new AppError("VALIDATION", "A coach cannot book their own session.", 400);
    }

    const slotEnd = minutesToTime(
      timeToMinutes(slotStart) + sessionType.duration_minutes,
    );
    if (timeToMinutes(slotEnd) <= timeToMinutes(slotStart)) {
      // The session would wrap past midnight, which `check (slot_end >
      // slot_start)` on the table would reject anyway. Catch it here so the
      // athlete gets a real message rather than a constraint violation.
      throw new AppError(
        "VALIDATION",
        "This session would run past midnight. Pick an earlier slot.",
        400,
      );
    }

    // ------------------------------------------------------------------
    // 2. Slot must sit inside one of the coach's availability windows for
    //    that weekday (PRD-02 FR-22) and must not already be held
    //    (PRD-01 FR-22: "the slot step only shows availability the coach has
    //    not already sold or blocked"; re-checked here because the client's
    //    list can be stale). Both are optimistic: step 3's unique index is
    //    the only guard that actually closes the race.
    // ------------------------------------------------------------------
    const dayOfWeek = new Date(`${body.date}T00:00:00Z`).getUTCDay();

    const { data: windows, error: windowsError } = await supabase
      .from("coach_availability_windows")
      .select("start_time, end_time")
      .eq("coach_id", sessionType.coach_id)
      .eq("day_of_week", dayOfWeek)
      .lte("effective_from", body.date)
      .returns<AvailabilityWindowRow[]>();

    if (windowsError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load availability windows: ${windowsError.message}`,
        500,
      );
    }

    const fitsAWindow = (windows ?? []).some(
      (w) =>
        timeToMinutes(w.start_time) <= timeToMinutes(slotStart) &&
        timeToMinutes(w.end_time) >= timeToMinutes(slotEnd),
    );
    if (!fitsAWindow) {
      throw new AppError(
        "SLOT_TAKEN",
        "The coach is not available at this time.",
        409,
      );
    }

    const { data: busySlots, error: busyError } = await supabase.rpc(
      "get_coach_busy_slots",
      {
        p_coach_id: sessionType.coach_id,
        p_from: body.date,
        p_to: body.date,
      },
    );

    if (busyError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load busy slots: ${busyError.message}`,
        500,
      );
    }

    const isBusy = ((busySlots ?? []) as BusySlotRow[]).some(
      (slot) => normalizeTime(slot.slot_start) === slotStart,
    );
    if (isBusy) {
      throw new AppError(
        "SLOT_TAKEN",
        "The requested slot is no longer available.",
        409,
      );
    }

    // ------------------------------------------------------------------
    // 3. Re-price server side and compare to the client's displayed total.
    //    Nothing client-supplied reaches Razorpay: `total` below is derived
    //    entirely from session_types and fee_config.
    // ------------------------------------------------------------------
    const price = round2(sessionType.price);
    const feeConfig = await getActiveFeeConfig(
      supabase,
      "sessions",
      "platform_fee_flat",
    );
    const platformFee = round2(feeConfig.value);
    const total = price; // fee is carved out of price, see the header note.

    if (platformFee >= price) {
      // The coach's ledger credit would be zero or negative, which
      // ledger_entries' `check (amount > 0)` rejects. This is a fee_config
      // misconfiguration, not something the athlete can act on.
      throw new AppError(
        "INTERNAL",
        `Platform fee ${platformFee} is not less than session price ${price}.`,
        500,
      );
    }

    if (round2(body.expected_total) !== total) {
      throw new AppError(
        "PRICE_MISMATCH",
        "The price changed since this session was priced. Review the total and try again.",
        409,
      );
    }

    // ------------------------------------------------------------------
    // 4. Insert the session as `requested`. 23505 -> SLOT_TAKEN, before any
    //    Razorpay call, so a losing racer is never charged.
    // ------------------------------------------------------------------
    const { data: session, error: insertError } = await supabase
      .from("sessions")
      .insert({
        coach_id: sessionType.coach_id,
        player_id: user.id,
        session_type_id: sessionType.id,
        frequency: body.frequency,
        date: body.date,
        slot_start: slotStart,
        slot_end: slotEnd,
        focus_area: body.focus_area ?? null,
        location: body.location ?? null,
        status: "requested",
        price,
        platform_fee: platformFee,
        total,
      })
      .select("id, status, date, slot_start, slot_end, price, platform_fee, total")
      .single<SessionRow>();

    if (insertError) {
      if (insertError.code === "23505") {
        throw new AppError(
          "SLOT_TAKEN",
          "This slot was just booked by someone else.",
          409,
        );
      }
      throw new AppError(
        "INTERNAL",
        `Failed to create session: ${insertError.message}`,
        500,
      );
    }

    // ------------------------------------------------------------------
    // 5. payment_intents first (placeholder order id), then Razorpay, then
    //    backfill. Same sequence book-court follows, so the webhook's
    //    notes.payment_intent_id always resolves to a row that already
    //    exists by the time Razorpay calls back.
    // ------------------------------------------------------------------
    const { data: intent, error: intentInsertError } = await supabase
      .from("payment_intents")
      .insert({
        user_id: user.id,
        domain: "session",
        entity_id: session.id,
        amount: total,
        status: "created",
        razorpay_order_id: `pending:${session.id}`,
      })
      .select("id")
      .single<PaymentIntentRow>();

    if (intentInsertError || !intent) {
      await supabase
        .rpc("session_abandon_unpaid", { p_session_id: session.id })
        .then(() => undefined, () => undefined);
      throw new AppError(
        "INTERNAL",
        `Failed to create payment_intent: ${intentInsertError?.message}`,
        500,
      );
    }

    try {
      const amountPaise = Math.round(total * 100);
      const order = await createOrder({
        amountPaise,
        currency: "INR",
        receipt: session.id,
        notes: {
          domain: "session",
          entity_id: session.id,
          payment_intent_id: intent.id,
        },
      });

      const { error: intentUpdateError } = await supabase
        .from("payment_intents")
        .update({ razorpay_order_id: order.id })
        .eq("id", intent.id);

      if (intentUpdateError) {
        throw new AppError(
          "INTERNAL",
          `Failed to persist razorpay_order_id: ${intentUpdateError.message}`,
          500,
        );
      }

      const { error: linkError } = await supabase
        .from("sessions")
        .update({ payment_intent_id: intent.id })
        .eq("id", session.id);

      if (linkError) {
        throw new AppError(
          "INTERNAL",
          `Failed to link payment_intent to session: ${linkError.message}`,
          500,
        );
      }

      return jsonResponse(
        {
          session_id: session.id,
          status: session.status,
          razorpay_order_id: order.id,
          key_id: razorpayKeyId(),
          amount: amountPaise,
          currency: "INR",
          bill: { price, platform_fee: platformFee, total },
        },
        200,
      );
    } catch (err) {
      // Razorpay (or the backfill) failed: release the slot immediately via
      // the RPC rather than leaving an unpayable session holding it. Best
      // effort, the original error is still what the client sees.
      await supabase
        .rpc("session_abandon_unpaid", { p_session_id: session.id })
        .then(() => undefined, () => undefined);
      await supabase
        .from("payment_intents")
        .update({ status: "failed" })
        .eq("id", intent.id);

      if (err instanceof AppError) throw err;
      throw appErrorFromPostgrestMessage(
        err instanceof Error ? err.message : "INTERNAL: unknown error",
      );
    }
  })
);
