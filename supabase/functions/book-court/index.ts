// ATLITOS v2 — supabase/functions/book-court/index.ts
//
// POST { court_id, date, slot_start, slot_end } with the athlete's own JWT.
// Epic AT-4 / AT-11. Implements API-MAPPING.md's `courts.book` edge
// function and PAYMENTS.md's `book-court` sequence:
//
//   1. Validate slot availability via the SQL helper (get_court_available_slots),
//      which also returns the peak-adjusted price for that slot — this is
//      the re-pricing step; the client never submits a price for us to
//      compare against, so there is no PRICE_MISMATCH branch in this
//      function (nothing client-supplied to mismatch).
//   2. Insert the court_bookings row as `pending_payment` (0011/0012_courts_payment_state*.sql).
//      A `23505` unique-index violation here (the real concurrency guard,
//      the availability check above is only an optimistic pre-check) is
//      caught and returned as `409 SLOT_TAKEN`.
//   3. Create the Razorpay order (notes: {domain: 'court', entity_id:
//      booking id, payment_intent_id}), insert `payment_intents`.
//   4. Return the order details for the client to open the checkout sheet.
//      The booking is NOT confirmed by this response; only
//      razorpay-webhook / verify-payment flip it to `confirmed`, per
//      PAYMENTS.md's "payment confirmation is webhook-driven, never
//      client-driven" principle.
//
// Note on the `notes.domain` value: this task's brief describes it as
// "court_booking"; the actual `payment_domain` enum (0010_payments_core.sql)
// only has `'court'`, and `payment_intents.domain`/`ledger_entries.domain`
// must use that exact enum value for razorpay-webhook's domain switch to
// resolve correctly, so `'court'` is what is actually sent, not the brief's
// prose wording. SCHEMA.md's column values are the source of truth per
// CLAUDE.md's stated precedence.
//
// Walk-in variant (API-MAPPING.md: "portal-court's walk-in form calls
// [book-court], partner-scoped variant, same function, service-role bypasses
// payment for a walk-in flagged booking_source='walk_in'"), added in this
// pass for apps/portal-court's Live Today "record a walk in" action
// (PRD-03 FR-17). Request shape is distinguished by `booking_source:
// "walk_in"` in the body; everything above this comment (self-service) is
// unchanged. Key differences from the self-service path below:
//
//   - Caller is the venue partner/staff's own JWT, not an athlete's. There
//     is no RLS-backed read to lean on here (this function always runs as
//     service_role, which bypasses RLS), so `assertCourtPartnerOrStaff`
//     below re-derives the exact same ownership check
//     `public.is_court_partner_or_staff` enforces at the database layer,
//     in TypeScript, against the caller's real `auth.uid()` from
//     `getAuthenticatedUser` (never a client-supplied id).
//   - No Razorpay order: the booking is inserted directly as `confirmed`
//     (0011_courts_payment_state.sql's header note 5: "the walk-in booking
//     path ... inserts a row that is confirmed immediately since no payment
//     is collected"), skipping `pending_payment` entirely.
//   - A `payment_intents` row is still created (`status: "captured"`, a
//     synthetic `razorpay_order_id` since none exists) and a balanced
//     `ledger_entries` group is still written, matching PRD-03's payment
//     touchpoints section verbatim: "the same server side re-pricing and
//     ledger write path is used for walk ins as for athlete self service
//     bookings; the portal never writes a payment_intent or ledger_entries
//     row directly." The three-leg group shape is copied from
//     `_shared/finalize-court-booking-payment.ts` rather than imported,
//     since that helper's own idempotency gate (`update ... where status =
//     'created'`) and its `court_booking_confirm_payment` RPC call assume a
//     pre-existing `pending_payment` booking mid-checkout, neither of which
//     applies to a walk-in that is confirmed on insert.
//   - `price_override` (PRD-03 FR-17: "price defaults to the current
//     pricing rule and is editable only with a reason logged") requires
//     `price_override_reason`; both are written to `audit_log` alongside the
//     walk-in creation itself, since this is the one write path in the
//     courts domain that runs as service_role and can actually satisfy
//     audit_log's zero authenticated/anon grant (0009_courts.sql's header
//     note 3 explicitly punts this to "edge-function/admin scope").

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { createOrder, razorpayKeyId } from "../_shared/razorpay.ts";
import { getActiveFeeConfig, round2 } from "../_shared/fee-config.ts";

interface BookCourtRequestBody {
  court_id: string;
  date: string;
  slot_start: string;
  slot_end: string;
  booking_source?: "self_service" | "walk_in";
  walk_in_name?: string;
  walk_in_phone?: string;
  price_override?: number;
  price_override_reason?: string;
}

interface CourtRow {
  id: string;
  active: boolean;
  venue_id: string;
  venues: { status: string; partner_user_id: string } | null;
}

interface AvailableSlotRow {
  slot_start: string;
  slot_end: string;
  price: number;
}

interface CourtBookingRow {
  id: string;
  court_id: string;
  date: string;
  slot_start: string;
  slot_end: string;
  subtotal: number;
  gst: number;
  platform_fee: number;
  total: number;
  status: string;
}

interface PaymentIntentRow {
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function normalizeTime(value: string): string {
  // Postgres `time` round-trips as "HH:MM:SS" (sometimes with fractional
  // seconds); normalize both the client's input and the RPC's output to
  // "HH:MM:SS" so string comparison is exact either way.
  const [h, m, s] = value.split(":");
  return `${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}:${(s ?? "00").slice(0, 2).padStart(2, "0")}`;
}

function parseRequestBody(raw: unknown): BookCourtRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  const { court_id, date, slot_start, slot_end, booking_source } = body;

  if (typeof court_id !== "string" || !UUID_RE.test(court_id)) {
    throw new AppError("VALIDATION", "court_id must be a valid uuid.", 400);
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    throw new AppError("VALIDATION", "date must be an ISO date (YYYY-MM-DD).", 400);
  }
  if (typeof slot_start !== "string" || !TIME_RE.test(slot_start)) {
    throw new AppError("VALIDATION", "slot_start must be a time (HH:MM or HH:MM:SS).", 400);
  }
  if (typeof slot_end !== "string" || !TIME_RE.test(slot_end)) {
    throw new AppError("VALIDATION", "slot_end must be a time (HH:MM or HH:MM:SS).", 400);
  }
  if (
    booking_source !== undefined &&
    booking_source !== "self_service" &&
    booking_source !== "walk_in"
  ) {
    throw new AppError("VALIDATION", "booking_source must be self_service or walk_in.", 400);
  }

  const parsed: BookCourtRequestBody = { court_id, date, slot_start, slot_end };
  if (booking_source === "walk_in") {
    parsed.booking_source = "walk_in";
    if (body.walk_in_name !== undefined) {
      if (typeof body.walk_in_name !== "string" || body.walk_in_name.trim() === "") {
        throw new AppError("VALIDATION", "walk_in_name must be a non empty string.", 400);
      }
      parsed.walk_in_name = body.walk_in_name.trim();
    }
    if (body.walk_in_phone !== undefined) {
      if (typeof body.walk_in_phone !== "string") {
        throw new AppError("VALIDATION", "walk_in_phone must be a string.", 400);
      }
      parsed.walk_in_phone = body.walk_in_phone.trim();
    }
    if (body.price_override !== undefined) {
      if (typeof body.price_override !== "number" || body.price_override < 0) {
        throw new AppError("VALIDATION", "price_override must be a non negative number.", 400);
      }
      if (
        typeof body.price_override_reason !== "string" ||
        body.price_override_reason.trim() === ""
      ) {
        throw new AppError(
          "VALIDATION",
          "price_override_reason is required when price_override is set.",
          400,
        );
      }
      parsed.price_override = body.price_override;
      parsed.price_override_reason = body.price_override_reason.trim();
    }
  }

  return parsed;
}

/**
 * Re-derives `public.is_court_partner_or_staff(court_id)` in TypeScript: this
 * function always runs as service_role (bypasses RLS), so there is no
 * RLS-backed read to lean on for the walk-in path the way the self-service
 * path leans on the athlete's own JWT implicitly. `court` here already
 * carries `venues.partner_user_id` from the shared lookup above.
 */
async function assertCourtPartnerOrStaff(
  supabase: ReturnType<typeof serviceRoleClient>,
  userId: string,
  venueId: string,
  partnerUserId: string | undefined,
): Promise<void> {
  if (partnerUserId === userId) return;

  const { data: staffRow, error } = await supabase
    .from("venue_staff")
    .select("id")
    .eq("venue_id", venueId)
    .eq("user_id", userId)
    .not("accepted_at", "is", null)
    .maybeSingle();

  if (error) {
    throw new AppError("INTERNAL", `Failed to check venue staff: ${error.message}`, 500);
  }
  if (!staffRow) {
    throw new AppError(
      "FORBIDDEN",
      "Venue partner or staff role required to record a walk in.",
      403,
    );
  }
}

/**
 * Walk-in booking: confirmed on insert, no Razorpay order, cash collected at
 * the desk. See this file's header comment for the full rationale. Returns
 * the same `{ booking_id, bill }` response shape shoppers get from the
 * self-service path (minus the Razorpay fields, which do not apply), so
 * portal-court's walk-in dialog can render `BillSummary` from the same
 * `bill` object either way.
 */
async function handleWalkInBooking(
  supabase: ReturnType<typeof serviceRoleClient>,
  user: { id: string },
  body: BookCourtRequestBody,
): Promise<Record<string, unknown>> {
  const slotStart = normalizeTime(body.slot_start);
  const slotEnd = normalizeTime(body.slot_end);

  const { data: court, error: courtError } = await supabase
    .from("courts")
    .select("id, active, venue_id, venues(status, partner_user_id)")
    .eq("id", body.court_id)
    .maybeSingle<CourtRow>();

  if (courtError) {
    throw new AppError("INTERNAL", `Failed to load court: ${courtError.message}`, 500);
  }
  if (!court || !court.active || court.venues?.status !== "verified") {
    throw new AppError("NOT_FOUND", "Court not found or not bookable.", 404);
  }

  await assertCourtPartnerOrStaff(
    supabase,
    user.id,
    court.venue_id,
    court.venues?.partner_user_id,
  );

  const { data: rawAvailableSlots, error: slotsError } = await supabase.rpc(
    "get_court_available_slots",
    { p_court_id: body.court_id, p_date: body.date },
  );

  if (slotsError) {
    throw new AppError(
      "INTERNAL",
      `Failed to load available slots: ${slotsError.message}`,
      500,
    );
  }

  const availableSlots = (rawAvailableSlots ?? []) as AvailableSlotRow[];
  const matchedSlot = availableSlots.find(
    (slot) =>
      normalizeTime(slot.slot_start) === slotStart &&
      normalizeTime(slot.slot_end) === slotEnd,
  );

  if (!matchedSlot) {
    throw new AppError("SLOT_TAKEN", "The requested slot is no longer available.", 409);
  }

  const subtotal = round2(body.price_override ?? matchedSlot.price);
  const gstConfig = await getActiveFeeConfig(supabase, "courts", "gst_percent");
  const platformFeeConfig = await getActiveFeeConfig(supabase, "courts", "platform_fee_flat");
  const gst = round2(subtotal * gstConfig.value);
  const platformFee = round2(platformFeeConfig.value);
  const total = round2(subtotal + gst + platformFee);

  const { data: booking, error: insertError } = await supabase
    .from("court_bookings")
    .insert({
      court_id: body.court_id,
      user_id: null,
      booking_source: "walk_in",
      walk_in_name: body.walk_in_name ?? null,
      walk_in_phone: body.walk_in_phone ?? null,
      created_by_staff_id: user.id,
      date: body.date,
      slot_start: slotStart,
      slot_end: slotEnd,
      subtotal,
      gst,
      platform_fee: platformFee,
      total,
      status: "confirmed",
    })
    .select()
    .single<CourtBookingRow>();

  if (insertError) {
    if (insertError.code === "23505") {
      throw new AppError("SLOT_TAKEN", "This slot was just booked by someone else.", 409);
    }
    throw new AppError("INTERNAL", `Failed to create court_booking: ${insertError.message}`, 500);
  }

  const { data: intent, error: intentInsertError } = await supabase
    .from("payment_intents")
    .insert({
      user_id: user.id,
      domain: "court",
      entity_id: booking.id,
      amount: total,
      status: "captured",
      razorpay_order_id: `walkin:${booking.id}`,
    })
    .select("id")
    .single<PaymentIntentRow>();

  if (intentInsertError || !intent) {
    throw new AppError(
      "INTERNAL",
      `Failed to create payment_intent: ${intentInsertError?.message}`,
      500,
    );
  }

  const { error: bookingIntentLinkError } = await supabase
    .from("court_bookings")
    .update({ payment_intent_id: intent.id })
    .eq("id", booking.id);

  if (bookingIntentLinkError) {
    throw new AppError(
      "INTERNAL",
      `Failed to link payment_intent to booking: ${bookingIntentLinkError.message}`,
      500,
    );
  }

  // Same balanced three-leg group finalizeCourtBookingPaymentCaptured writes
  // for the self-service path (debit platform for the full amount, credit
  // the partner's payable, credit the platform fee leg), so Earnings totals
  // reconcile identically regardless of booking_source.
  const entryGroupId = crypto.randomUUID();
  const partnerPayable = round2(subtotal + gst);

  const { error: ledgerError } = await supabase.from("ledger_entries").insert([
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "debit",
      amount: total,
      domain: "court",
      entity_id: booking.id,
      description: `Clearing: court booking ${booking.id} walk in`,
    },
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "court_partner",
      account_ref: court.venue_id,
      direction: "credit",
      amount: partnerPayable,
      domain: "court",
      entity_id: booking.id,
      description: `Court partner payable, walk in booking ${booking.id}`,
    },
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "credit",
      amount: platformFee,
      domain: "court",
      entity_id: booking.id,
      description: `Platform fee, walk in booking ${booking.id}`,
    },
  ]);

  if (ledgerError) {
    throw new AppError(
      "INTERNAL",
      `Failed to write ledger_entries for booking ${booking.id}: ${ledgerError.message}`,
      500,
    );
  }

  // SEC-F5. The result used to be discarded outright, so a failed audit write
  // on a walk-in that DID create a confirmed booking and a ledger group left no
  // trace anywhere. It is logged rather than thrown: the booking, the payment
  // intent and the ledger group are all committed by this point, and turning
  // that into a 500 would tell the partner their walk-in failed when it did
  // not, which is how double bookings get attempted.
  //
  // ponytail: log, not atomicity. The real fix is one RPC owning the whole
  // walk-in write the way order_transition now owns the advance; that is a
  // four-statement refactor of this handler and belongs in its own change.
  // Upgrade when a walk-in audit gap is actually observed.
  const { error: walkInAuditError } = await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "court_booking.walk_in_create",
    entity_type: "court_bookings",
    entity_id: booking.id,
    after: {
      court_id: body.court_id,
      date: body.date,
      slot_start: slotStart,
      slot_end: slotEnd,
      subtotal,
      total,
      price_overridden: body.price_override !== undefined,
    },
    note: body.price_override_reason ?? null,
  });

  if (walkInAuditError) {
    console.error(
      `SEC-F5: walk-in booking ${booking.id} was confirmed and ledgered but its audit_log row failed: ${walkInAuditError.message}`,
    );
  }

  return {
    booking_id: booking.id,
    status: "confirmed",
    bill: { subtotal, gst, platform_fee: platformFee, total },
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

    if (body.booking_source === "walk_in") {
      return jsonResponse(await handleWalkInBooking(supabase, user, body), 200);
    }

    const slotStart = normalizeTime(body.slot_start);
    const slotEnd = normalizeTime(body.slot_end);

    // 1. Court + venue must exist and be bookable.
    const { data: court, error: courtError } = await supabase
      .from("courts")
      .select("id, active, venue_id, venues(status, partner_user_id)")
      .eq("id", body.court_id)
      .maybeSingle<CourtRow>();

    if (courtError) {
      throw new AppError("INTERNAL", `Failed to load court: ${courtError.message}`, 500);
    }
    if (!court || !court.active || court.venues?.status !== "verified") {
      throw new AppError("NOT_FOUND", "Court not found or not bookable.", 404);
    }

    // 2. Re-price server side: the SQL helper returns exactly the bookable
    // slots for this date (availability windows minus blackouts minus
    // existing non-cancelled bookings), each with its peak-adjusted price,
    // so this single call both validates availability and re-derives the
    // subtotal — no client-supplied price exists to compare against.
    const { data: rawAvailableSlots, error: slotsError } = await supabase
      .rpc("get_court_available_slots", {
        p_court_id: body.court_id,
        p_date: body.date,
      });

    if (slotsError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load available slots: ${slotsError.message}`,
        500,
      );
    }

    const availableSlots = (rawAvailableSlots ?? []) as AvailableSlotRow[];
    const matchedSlot = availableSlots.find(
      (slot) =>
        normalizeTime(slot.slot_start) === slotStart &&
        normalizeTime(slot.slot_end) === slotEnd,
    );

    if (!matchedSlot) {
      throw new AppError(
        "SLOT_TAKEN",
        "The requested slot is no longer available.",
        409,
      );
    }

    const subtotal = round2(matchedSlot.price);
    const gstConfig = await getActiveFeeConfig(supabase, "courts", "gst_percent");
    const platformFeeConfig = await getActiveFeeConfig(
      supabase,
      "courts",
      "platform_fee_flat",
    );
    const gst = round2(subtotal * gstConfig.value);
    const platformFee = round2(platformFeeConfig.value);
    const total = round2(subtotal + gst + platformFee);

    // 3. Insert as pending_payment. The partial unique index
    // (court_bookings_court_date_slot_unique) is the real concurrency
    // guard; the availability check above is only an optimistic pre-check
    // that narrows the race window, it does not close it.
    const { data: booking, error: insertError } = await supabase
      .from("court_bookings")
      .insert({
        court_id: body.court_id,
        user_id: user.id,
        booking_source: "self_service",
        date: body.date,
        slot_start: slotStart,
        slot_end: slotEnd,
        subtotal,
        gst,
        platform_fee: platformFee,
        total,
        status: "pending_payment",
      })
      .select()
      .single<CourtBookingRow>();

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
        `Failed to create court_booking: ${insertError.message}`,
        500,
      );
    }

    // 4. payment_intents row first (placeholder order id), then the real
    // Razorpay order, then backfill the real order id — the exact sequence
    // PAYMENTS.md's shared `createRazorpayOrder` helper documents, so the
    // webhook's `notes.payment_intent_id` always resolves to a row that
    // already exists by the time Razorpay calls back.
    const { data: intent, error: intentInsertError } = await supabase
      .from("payment_intents")
      .insert({
        user_id: user.id,
        domain: "court",
        entity_id: booking.id,
        amount: total,
        status: "created",
        razorpay_order_id: `pending:${booking.id}`,
      })
      .select("id")
      .single<PaymentIntentRow>();

    if (intentInsertError || !intent) {
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
        receipt: booking.id,
        notes: {
          domain: "court",
          entity_id: booking.id,
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

      return jsonResponse(
        {
          booking_id: booking.id,
          razorpay_order_id: order.id,
          key_id: razorpayKeyId(),
          amount: amountPaise,
          currency: "INR",
          bill: { subtotal, gst, platform_fee: platformFee, total },
        },
        200,
      );
    } catch (err) {
      // Razorpay call failed: free the slot immediately (expire the
      // booking via the RPC, never a raw status update) rather than leaving
      // an unpayable booking squatting the slot until a future cleanup job
      // runs. Best-effort: if this cleanup itself fails, the original error
      // is still what the client sees.
      await supabase
        .rpc("court_booking_expire_payment", { p_booking_id: booking.id })
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
