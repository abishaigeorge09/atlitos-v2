import { useMemo } from "react";
import type {
  ApiError,
  AvailabilityWindow,
  CoachProfile,
  Session,
  SessionFrequency,
  SessionStatus,
  Sport,
  TimeSlot,
} from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapEdgeFunctionError, mapPostgrestError } from "./errors";
import { readRefundSummary, type RefundSummary } from "./refunds";

/**
 * `@atlitos/api`'s athlete-side coaching domain hook (AT-52/53/54, Track D).
 * Deliberately a separate export from `hooks.ts`'s `useCoaches`/`useSessions`
 * placeholders (still unimplemented TODO stubs there): those two names are
 * reserved for whichever track fills in the coach-facing surface (accept,
 * decline, complete-session, availability editing), this file is only the
 * player-facing read/browse/book/manage half of the same two Postgres
 * domains, per docs/architecture/API-MAPPING.md "coaches" and "sessions".
 *
 * Every mutation below is a `SECURITY DEFINER` RPC or a `service_role` edge
 * function; this file never writes `sessions.status`, `payment_intents`, or
 * `ledger_entries` directly (CLAUDE.md's financial invariant).
 */

// ---------------------------------------------------------------------------
// coaches (discovery + profile). PostgREST reads only, no mutation lane here.
// See API-MAPPING.md "coaches".
// ---------------------------------------------------------------------------

export interface CoachListFilters {
  sport?: Sport;
  /** The athlete's current city (location store). `coach_profiles` carries
   * no lat/lng (unlike `venues`), so "reflects the current location
   * context" (PRD-01 FR-20) is a same-city-first sort, not a haversine
   * distance the way courts does it; there is no coordinate to compute one
   * from without adding a column outside this story's scope. */
  city?: string;
}

export interface CoachListItem {
  userId: string;
  name: string;
  avatarUrl?: string;
  sport: Sport;
  experienceYears: number;
  rating: number;
  ratingCount: number;
  city: string;
  /** Lowest active `session_types.price` for this coach; undefined if the
   * coach has no active session type yet (should not happen for a verified
   * coach in steady state, but a freshly verified profile could still be
   * mid setup). */
  priceFrom?: number;
}

interface CoachProfilePublicRow {
  user_id: string;
  sport: Sport;
  experience_years: number;
  rating: number;
  rating_count: number;
  city: string;
  bio: string | null;
  coaching_style: string | null;
  specialization: string[] | null;
}

interface PublicProfileRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
}

interface SessionTypeRow {
  id: string;
  coach_id: string;
  name: string;
  duration_minutes: number;
  price: number;
  active: boolean;
}

interface AvailabilityWindowRow {
  coach_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
}

function byCityFirst(city?: string) {
  return (a: { city: string }, b: { city: string }) => {
    if (!city) return 0;
    const aMatch = a.city === city ? 0 : 1;
    const bMatch = b.city === city ? 0 : 1;
    return aMatch - bMatch;
  };
}

export function useCoaching(client: AtlitosClient) {
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
    /** v1 `coaches.list`. Reads `coach_profiles_public`, a definer view
     * already filtered to `status = 'verified'` (0001_identity.sql, per
     * RLS.md: "the base table has no public SELECT policy, public
     * discovery ... reads the view instead"), so this never has to filter
     * status itself the way courts filters `venues.status = 'verified'`
     * explicitly. Batches `public_profiles` (name/avatar) and active
     * `session_types` (price-from) by id afterward rather than embedding,
     * since PostgREST embed metadata is unreliable across a view boundary
     * and `session_types`/`coach_availability_windows` carry the
     * permissive-OR RLS shape RLS.md warns about (an unscoped select
     * already returns every verified coach's rows publicly, so a plain
     * `.in('coach_id', ids)` here is exactly the intended, documented
     * query shape, not a scoping bug). */
    async listCoaches(filters: CoachListFilters = {}): Promise<CoachListItem[]> {
      let query = client.from("coach_profiles_public").select("*");
      if (filters.sport) query = query.eq("sport", filters.sport);

      const { data: coachRows, error: coachError } = await query.returns<CoachProfilePublicRow[]>();
      if (coachError) throw mapPostgrestError(coachError);

      const rows = (coachRows ?? []).filter((row): row is CoachProfilePublicRow & { user_id: string } => !!row.user_id);
      if (rows.length === 0) return [];

      const ids = rows.map((row) => row.user_id);

      const [{ data: profileRows, error: profileError }, { data: typeRows, error: typeError }] = await Promise.all([
        client.from("public_profiles").select("id, name, avatar_url").in("id", ids).returns<PublicProfileRow[]>(),
        client
          .from("session_types")
          .select("id, coach_id, name, duration_minutes, price, active")
          .in("coach_id", ids)
          .eq("active", true)
          .returns<SessionTypeRow[]>(),
      ]);
      if (profileError) throw mapPostgrestError(profileError);
      if (typeError) throw mapPostgrestError(typeError);

      const profileById = new Map((profileRows ?? []).map((row) => [row.id, row]));
      const minPriceByCoach = new Map<string, number>();
      for (const type of typeRows ?? []) {
        const current = minPriceByCoach.get(type.coach_id);
        if (current === undefined || type.price < current) minPriceByCoach.set(type.coach_id, type.price);
      }

      return rows
        .map((row) => {
          const profile = profileById.get(row.user_id);
          return {
            userId: row.user_id,
            name: profile?.name ?? "Coach",
            avatarUrl: profile?.avatar_url ?? undefined,
            sport: row.sport,
            experienceYears: row.experience_years,
            rating: row.rating,
            ratingCount: row.rating_count,
            city: row.city,
            priceFrom: minPriceByCoach.get(row.user_id),
          };
        })
        .sort(byCityFirst(filters.city));
    },

    /** v1 `coaches.get`. Full profile: `coach_profiles_public` row, the
     * coach's own active `session_types` (tiered pricing, FR-21), and
     * `coach_availability_windows` (feeds the availability preview and the
     * booking slot picker below). Certificates are a coach onboarding/
     * verification artifact, not part of PRD-01's athlete-facing profile
     * (FR-21 lists rating, experience, specialization, session types,
     * pricing, availability preview only), so this never fetches them; the
     * domain `CoachProfile.certificates` field is populated `[]` here. */
    async getCoach(coachId: string): Promise<CoachProfile | null> {
      const [
        { data: coachRow, error: coachError },
        { data: profileRow, error: profileError },
        { data: typeRows, error: typeError },
        { data: windowRows, error: windowError },
      ] = await Promise.all([
        client.from("coach_profiles_public").select("*").eq("user_id", coachId).maybeSingle<CoachProfilePublicRow>(),
        client.from("public_profiles").select("id, name, avatar_url").eq("id", coachId).maybeSingle<PublicProfileRow>(),
        client
          .from("session_types")
          .select("id, coach_id, name, duration_minutes, price, active")
          .eq("coach_id", coachId)
          .eq("active", true)
          .returns<SessionTypeRow[]>(),
        client
          .from("coach_availability_windows")
          .select("coach_id, day_of_week, start_time, end_time, effective_from")
          .eq("coach_id", coachId)
          .returns<AvailabilityWindowRow[]>(),
      ]);

      if (coachError) throw mapPostgrestError(coachError);
      if (!coachRow || !coachRow.user_id) return null;
      if (profileError) throw mapPostgrestError(profileError);
      if (typeError) throw mapPostgrestError(typeError);
      if (windowError) throw mapPostgrestError(windowError);

      const availability: AvailabilityWindow[] = (windowRows ?? []).map((window) => ({
        dayOfWeek: window.day_of_week,
        from: window.start_time.slice(0, 5),
        to: window.end_time.slice(0, 5),
        effectiveFrom: window.effective_from,
      }));

      return {
        userId: coachRow.user_id,
        sport: coachRow.sport,
        experienceYears: coachRow.experience_years,
        coachingStyle: coachRow.coaching_style ?? "",
        specialization: coachRow.specialization ?? [],
        sessionTypes: (typeRows ?? []).map((type) => ({
          id: type.id,
          coachId: type.coach_id,
          name: type.name,
          durationMinutes: type.duration_minutes,
          price: type.price,
          active: type.active,
        })),
        availability,
        certificates: [],
        status: "verified",
        rating: coachRow.rating,
        ratingCount: coachRow.rating_count,
        playersCoached: 0,
        bio: coachRow.bio ?? "",
        user: profileRow
          ? {
              id: profileRow.id,
              roles: ["coach"],
              name: profileRow.name ?? "Coach",
              email: "",
              phone: "",
              dob: "",
              avatarUrl: profileRow.avatar_url ?? undefined,
              city: coachRow.city ?? "",
              state: "",
              sports: [coachRow.sport],
              createdAt: "",
            }
          : undefined,
      };
    },

    /** `get_coach_busy_slots(coach_id, from, to)`. `SECURITY DEFINER`, hides
     * every other athlete's session details and returns only the occupied
     * `(date, slot_start)` pairs, per API-MAPPING.md. Read-only preview;
     * `book-session` re-checks authoritatively at booking time. */
    async getCoachBusySlots(coachId: string, from: string, to: string): Promise<{ date: string; slotStart: string }[]> {
      const { data, error } = await client.rpc("get_coach_busy_slots", {
        p_coach_id: coachId,
        p_from: from,
        p_to: to,
      });
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row: { date: string; slot_start: string }) => ({
        date: row.date,
        slotStart: row.slot_start.slice(0, 5),
      }));
    },

    /** v1's booking flow's book -> `book-session` edge function. Creates
     * `sessions` (`requested`) + `payment_intents` server side, re-prices
     * server side (`PRICE_MISMATCH`), returns a Razorpay order for the
     * client to open; never writes a money row or status itself
     * (CLAUDE.md). `slot_end` is intentionally not sent, it is derived
     * server side from `session_types.duration_minutes` (API-MAPPING.md). */
    async bookSession(input: BookSessionInput): Promise<BookSessionResult> {
      const { data, error } = await client.functions.invoke("book-session", {
        body: {
          session_type_id: input.sessionTypeId,
          frequency: input.frequency,
          date: input.date,
          slot_start: input.slotStart,
          focus_area: input.focusArea,
          location: input.location,
          expected_total: input.expectedTotal,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        session_id: string;
        status: SessionStatus;
        razorpay_order_id: string;
        key_id: string;
        amount: number;
        currency: string;
        bill: { price: number; platform_fee: number; total: number };
      };

      return {
        sessionId: body.session_id,
        status: body.status,
        razorpayOrderId: body.razorpay_order_id,
        keyId: body.key_id,
        amountPaise: body.amount,
        currency: body.currency,
        bill: { price: body.bill.price, platformFee: body.bill.platform_fee, total: body.bill.total },
      };
    },

    /** Shared `verify-payment` edge function (API-MAPPING.md: one function,
     * dispatches on `payment_intents.domain`); this reads back the
     * session-named alias of its domain-agnostic response. Idempotent with
     * `razorpay-webhook`, "so the demo works without a public webhook URL"
     * per PAYMENTS.md, same fallback courts already uses. */
    async verifySessionPayment(input: VerifySessionPaymentInput): Promise<VerifySessionPaymentResult> {
      const { data, error } = await client.functions.invoke("verify-payment", {
        body: {
          razorpay_order_id: input.razorpayOrderId,
          razorpay_payment_id: input.razorpayPaymentId,
          razorpay_signature: input.razorpaySignature,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as { session_id: string; status: SessionStatus; outcome: "captured" | "already_processed" };
      return { sessionId: body.session_id, status: body.status, outcome: body.outcome };
    },

    /** v1 `sessions.list`, player side. `sessions` RLS is permissive-OR
     * across `coach_id`/`player_id` (RLS.md), so this explicitly scopes to
     * `player_id = auth.uid()` itself rather than trusting an unscoped
     * select, per this story's own brief. Hydrates `coachName`/
     * `sessionTypeName` via two side-loaded batch queries rather than a
     * PostgREST embed (ambiguous FK path through `coach_profiles`/
     * `coach_profiles_public`, see `getCoach` above for the same choice). */
    async listMySessions(): Promise<Session[]> {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw mapPostgrestError(authError);
      if (!authData.user) return [];

      const { data, error } = await client
        .from("sessions")
        .select("*")
        .eq("player_id", authData.user.id)
        .order("date", { ascending: false })
        .order("slot_start", { ascending: false })
        .returns<SessionRow[]>();
      if (error) throw mapPostgrestError(error);

      return hydrateSessions(client, data ?? []);
    },

    /** v1 `sessions.get`. RLS already scopes reads to the caller's own
     * session (coach or player); an explicit id filter is enough, same
     * shape as `courts.getBooking`. */
    async getSession(sessionId: string): Promise<Session | null> {
      const { data, error } = await client
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle<SessionRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;

      const [hydrated] = await hydrateSessions(client, [data]);
      return hydrated ?? null;
    },

    /** v1 `sessions.cancel`/`sessions.reschedule` -> `session_transition`
     * RPC. `INVALID_TRANSITION`/`SLOT_TAKEN`/`REASON_REQUIRED`/
     * `SESSION_STARTED` surface as the matching `ApiErrorCode`. Reschedule
     * inserts a NEW row and tombstones the original (API-MAPPING.md); the
     * RPC's returned row is that new session, callers must navigate to ITS
     * id, never assume the input id survived. */
    async transitionSession(input: SessionTransitionInput): Promise<Session> {
      const { data, error } = await client.rpc("session_transition", {
        p_session_id: input.sessionId,
        p_action: input.action,
        p_reason: input.reason ?? undefined,
        p_new_date: input.newDate ?? undefined,
        p_new_slot_start: input.newSlotStart ?? undefined,
      });
      if (error) throw mapPostgrestError(error);

      const hydrated = await hydrateSessions(client, [data as unknown as SessionRow]);
      return hydrated[0]!;
    },

    /** v1 `sessions.rate` -> `rate_session` RPC. Only from `completed`,
     * once (`ALREADY_RATED` on a second call); also refreshes
     * `coach_profiles.rating`/`rating_count` server side (API-MAPPING.md),
     * never something this client recomputes. */
    async rateSession(sessionId: string, rating: number, remarks?: string): Promise<Session> {
      const { data, error } = await client.rpc("rate_session", {
        p_session_id: sessionId,
        p_rating: rating,
        p_remarks: remarks ?? undefined,
      });
      if (error) throw mapPostgrestError(error);

      const hydrated = await hydrateSessions(client, [data as unknown as SessionRow]);
      return hydrated[0]!;
    },

    /** PRD-02 FR-19 amendment (2026-07-19), FR-34, FR-35 / PRD-01 FR-26
     * (AT-60). The athlete's self-serve exit from a session still
     * `requested`, before the coach has answered: full automatic refund,
     * no coach involvement. `session_transition` (the `authenticated`
     * RPC above) now refuses this exact edge with `USE_EDGE_FUNCTION`
     * (migration 0027, AT-61), because it is the one transition that also
     * has to move money; the `cancel-session-refund` edge function is the
     * only path that can complete it. It always returns 2xx once the
     * session itself is cancelled (the function cancels before ever
     * calling Razorpay, so a provider outage cannot trap the athlete), and
     * separates that fact from the money outcome via `refund_status`:
     * `processed` (refunded), `pending` (cancelled, refund still in
     * flight, never say "refunded" for this one), or `not_applicable`
     * (nothing was captured to refund). Callers must key UI copy off
     * `refund_status`, never assume `processed` just because the call
     * succeeded. */
    async cancelRequestedSession(sessionId: string): Promise<CancelRequestedSessionResult> {
      const { data, error } = await client.functions.invoke("cancel-session-refund", {
        body: { session_id: sessionId },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        session_id: string;
        status: SessionStatus;
        refund_status: "processed" | "pending" | "not_applicable";
      };

      const session = await this.getSession(body.session_id);
      if (!session) {
        const notFound: ApiError = {
          code: "INTERNAL",
          message: "The session was cancelled but could not be reloaded.",
          status: 500,
        };
        throw notFound;
      }

      return { session, refundStatus: body.refund_status };
    },

    /** AT-148 (AT-88, PRD-02 FR-35). READ the refund owed on a cancelled
     * session so the athlete detail screen can surface its amount and status.
     * Pure read against `refunds` (the payer may select their own row per its
     * RLS); no money is written here. Returns null when no refund exists (an
     * accepted-session cancellation issues none, per PAYMENTS.md). */
    async getSessionRefund(sessionId: string): Promise<RefundSummary | null> {
      return readRefundSummary(client, "session", sessionId);
    },
  }), [client]);
}

export type UseCoachingResult = ReturnType<typeof useCoaching>;

// ---------------------------------------------------------------------------
// sessions (booking + lifecycle). Edge Function (book-session, shared
// verify-payment) + RPC (session_transition, rate_session). See
// API-MAPPING.md "sessions".
// ---------------------------------------------------------------------------

export interface BookSessionInput {
  sessionTypeId: string;
  frequency: SessionFrequency;
  date: string; // ISO date
  slotStart: string; // "HH:MM"
  focusArea?: string;
  location?: string;
  /** Client-computed price, for display only; `book-session` re-derives
   * the authoritative total server side and raises `PRICE_MISMATCH` if
   * this disagrees (CLAUDE.md's financial invariant). */
  expectedTotal: number;
}

export interface BookSessionResult {
  sessionId: string;
  status: SessionStatus;
  razorpayOrderId: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  /** Sessions carve the platform fee OUT of the price (SCHEMA.md): `total`
   * always equals `price`, `platformFee` is the coach's cut of that same
   * amount, never a separate athlete-facing addition. */
  bill: { price: number; platformFee: number; total: number };
}

export interface VerifySessionPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifySessionPaymentResult {
  sessionId: string;
  status: SessionStatus;
  outcome: "captured" | "already_processed";
}

/** See `cancelRequestedSession` above: `refundStatus` is the money outcome,
 * kept separate from cancellation, which has already happened by the time
 * this resolves. */
export interface CancelRequestedSessionResult {
  session: Session;
  refundStatus: "processed" | "pending" | "not_applicable";
}

export interface SessionTransitionInput {
  sessionId: string;
  action: "cancel" | "reschedule";
  reason?: string;
  newDate?: string;
  newSlotStart?: string;
}

interface SessionRow {
  id: string;
  coach_id: string;
  player_id: string;
  session_type_id: string;
  frequency: SessionFrequency;
  date: string;
  slot_start: string;
  slot_end: string;
  focus_area: string | null;
  location: string | null;
  status: SessionStatus;
  price: number;
  platform_fee: number;
  total: number;
  payment_intent_id: string | null;
  rating: number | null;
  remarks: string | null;
  cancellation_reason: string | null;
  decline_reason: string | null;
}

async function hydrateSessions(client: AtlitosClient, rows: SessionRow[]): Promise<Session[]> {
  if (rows.length === 0) return [];

  const coachIds = Array.from(new Set(rows.map((row) => row.coach_id)));
  const typeIds = Array.from(new Set(rows.map((row) => row.session_type_id)));

  const [{ data: profileRows }, { data: typeRows }] = await Promise.all([
    client.from("public_profiles").select("id, name, avatar_url").in("id", coachIds).returns<PublicProfileRow[]>(),
    client.from("session_types").select("id, coach_id, name, duration_minutes, price, active").in("id", typeIds).returns<SessionTypeRow[]>(),
  ]);

  const coachNameById = new Map((profileRows ?? []).map((row) => [row.id, row.name ?? "Coach"]));
  const typeById = new Map((typeRows ?? []).map((row) => [row.id, row]));

  return rows.map((row) => ({
    id: row.id,
    coachId: row.coach_id,
    playerId: row.player_id,
    sessionTypeId: row.session_type_id,
    frequency: row.frequency,
    date: row.date,
    slot: { from: row.slot_start.slice(0, 5), to: row.slot_end.slice(0, 5) },
    focusArea: row.focus_area ?? "",
    location: row.location ?? "",
    status: row.status,
    price: row.price,
    platformFee: row.platform_fee,
    total: row.total,
    paymentIntentId: row.payment_intent_id ?? undefined,
    rating: row.rating ?? undefined,
    remarks: row.remarks ?? undefined,
    declineReason: row.decline_reason ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
    coachName: coachNameById.get(row.coach_id),
    sessionTypeName: typeById.get(row.session_type_id)?.name,
  }));
}

// ---------------------------------------------------------------------------
// Slot generation. FR-22 (PRD-02): "Availability windows ... are the only
// input the custom slot engine uses to generate bookable slots"; there is
// no server RPC that returns ready-made session slots the way courts'
// `get_court_available_slots` does, so the client derives candidates from
// the coach's own `coach_availability_windows` + the chosen session type's
// `duration_minutes`, then subtracts `get_coach_busy_slots`. This is an
// optimistic narrowing only, same as the SLOT_TAKEN doc comment in
// API-MAPPING.md describes: `book-session` is the authoritative check.
// ---------------------------------------------------------------------------

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

function minutesToTime(total: number): string {
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** ISO date "YYYY-MM-DD" -> JS day-of-week (0=Sunday), parsed as a plain
 * calendar date rather than `new Date(iso)` (which parses as UTC midnight
 * and can shift a day depending on the device's timezone offset). */
function dayOfWeekOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-");
  return new Date(Number(y), Number(m ?? 1) - 1, Number(d ?? 1)).getDay();
}

export function computeAvailableSessionSlots(
  windows: AvailabilityWindow[],
  durationMinutes: number,
  dateISO: string,
  busySlots: { date: string; slotStart: string }[],
): TimeSlot[] {
  const weekday = dayOfWeekOf(dateISO);
  const busyStarts = new Set(busySlots.filter((slot) => slot.date === dateISO).map((slot) => slot.slotStart));

  const slots: TimeSlot[] = [];
  for (const window of windows) {
    if (window.dayOfWeek !== weekday) continue;
    if (window.effectiveFrom && window.effectiveFrom > dateISO) continue;

    const windowStart = timeToMinutes(window.from);
    const windowEnd = timeToMinutes(window.to);

    for (let start = windowStart; start + durationMinutes <= windowEnd; start += durationMinutes) {
      const from = minutesToTime(start);
      if (busyStarts.has(from)) continue;
      slots.push({ from, to: minutesToTime(start + durationMinutes) });
    }
  }

  return slots.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
