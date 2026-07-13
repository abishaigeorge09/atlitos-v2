import type { Session } from "@supabase/supabase-js";
import type {
  AppRole,
  BookingSource,
  Court,
  CourtBooking,
  CourtBookingStatus,
  Json,
  Sport,
  TimeSlot,
} from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapAuthError, mapEdgeFunctionError, mapPostgrestError } from "./errors";

/**
 * Domain hooks. Each domain below wraps the v1 `services/api.ts` function of
 * the same name in a typed hook that calls the v2 lane recorded in
 * docs/architecture/API-MAPPING.md (PostgREST, RPC, Edge Function, or
 * Supabase Auth). Screens never change when a mock swaps for the real call,
 * only the body of the matching hook here does.
 *
 * P1 fills in auth + profile (identity/auth migrations, 0001-0004); every
 * other domain still throws until its own schema migration lands (see
 * docs/PLAN.md "Schema domains").
 */

// ---------------------------------------------------------------------------
// auth. Supabase Auth lane. See API-MAPPING.md "auth".
// ---------------------------------------------------------------------------

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  dob: string; // ISO date, "YYYY-MM-DD"
  password: string;
}

export interface AuthResult {
  session: Session | null;
  /** True when Supabase Auth email confirmation is required and no session
   * was returned yet; the caller should show a "check your email" state
   * rather than treat this as a failure. */
  needsEmailConfirmation: boolean;
}

function isEmail(identifier: string): boolean {
  return identifier.includes("@");
}

export function useAuth(client: AtlitosClient) {
  return {
    /** v1 `login`. Accepts an email or a phone number as `identifier`. */
    async login(identifier: string, password: string): Promise<Session> {
      const { data, error } = isEmail(identifier)
        ? await client.auth.signInWithPassword({ email: identifier, password })
        : await client.auth.signInWithPassword({ phone: identifier, password });
      if (error) throw mapAuthError(error);
      if (!data.session) throw mapAuthError({ message: "No session returned after login." });
      return data.session;
    },

    /** v1 `register`. `handle_new_user()` (0001_identity.sql) seeds the
     * `public.users` row (name only) and the default `player` role on
     * insert; this hook follows up with phone/dob once a session exists,
     * since those two columns are not populated by the trigger. */
    async register(input: RegisterInput): Promise<AuthResult> {
      const { data, error } = await client.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { name: input.name, phone: input.phone, dob: input.dob } },
      });
      if (error) throw mapAuthError(error);

      if (!data.session) {
        return { session: null, needsEmailConfirmation: true };
      }

      const { error: profileError } = await client
        .from("users")
        .update({ phone: input.phone, dob: input.dob })
        .eq("id", data.session.user.id);
      if (profileError) throw mapPostgrestError(profileError);

      return { session: data.session, needsEmailConfirmation: false };
    },

    /** v1 `requestOtp`. Used for both the forgot-password flow (existing
     * user) and email/phone OTP login (PRD-01 login screen's OTP option). */
    async requestOtp(identifier: string, options?: { createUserIfMissing?: boolean }): Promise<void> {
      const shouldCreateUser = options?.createUserIfMissing ?? false;
      const { error } = isEmail(identifier)
        ? await client.auth.signInWithOtp({ email: identifier, options: { shouldCreateUser } })
        : await client.auth.signInWithOtp({ phone: identifier, options: { shouldCreateUser } });
      if (error) throw mapAuthError(error);
    },

    /** v1 `verifyOtp`. Returns a session, "client treats it as the v1
     * resetToken" per API-MAPPING.md, i.e. the caller can immediately call
     * `resetPassword` on the session this establishes. */
    async verifyOtp(identifier: string, token: string): Promise<Session> {
      const { data, error } = isEmail(identifier)
        ? await client.auth.verifyOtp({ email: identifier, token, type: "email" })
        : await client.auth.verifyOtp({ phone: identifier, token, type: "sms" });
      if (error) throw mapAuthError(error);
      if (!data.session) throw mapAuthError({ message: "No session returned after OTP verification." });
      return data.session;
    },

    /** v1 `resetPassword`. Called on the session `verifyOtp` established. */
    async resetPassword(password: string): Promise<void> {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw mapAuthError(error);
    },

    /** v1 `continueAsGuest`. An anonymous auth user with zero `user_roles`
     * rows is the guest state everywhere else (RLS.md). */
    async continueAsGuest(): Promise<Session> {
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw mapAuthError(error);
      if (!data.session) throw mapAuthError({ message: "No session returned for guest sign-in." });
      return data.session;
    },

    async signOut(): Promise<void> {
      const { error } = await client.auth.signOut();
      if (error) throw mapAuthError(error);
    },
  };
}

export type UseAuthResult = ReturnType<typeof useAuth>;

// ---------------------------------------------------------------------------
// profile. PostgREST (getMe) + RPC (setupPlayer, setupCoach). See
// API-MAPPING.md "profile".
// ---------------------------------------------------------------------------

export interface MeRow {
  id: string;
  name: string;
  phone: string | null;
  dob: string | null;
  avatarUrl: string | null;
  city: string | null;
  state: string | null;
  sports: Sport[];
  roles: AppRole[];
  coachStatus: "pending_review" | "verified" | "rejected" | null;
}

export interface CompletePlayerSetupInput {
  sports: Sport[];
  avatarUrl?: string | null;
  city: string;
  state: string;
}

/** Full coach onboarding wizard payload, kept as `unknown`-safe jsonb on the
 * server (0004_player_and_coach_setup_rpc.sql): coach_profiles gets the
 * columns that exist today (sport, experienceYears, coachingStyle,
 * specialization, bio, city, state); sessionTypes and availabilityWindows
 * are preserved verbatim in verification_requests.payload until their own
 * tables land in a future coaching-domain migration (see that migration's
 * header comment). */
export interface SubmitCoachVerificationPayload {
  sport: Sport;
  experienceYears: number;
  coachingStyle?: string;
  specialization?: string[];
  bio?: string;
  city: string;
  state: string;
  certificates: Array<{ name: string; storagePath: string | null }>;
  sessionTypes: Array<{ name: string; durationMinutes: number; price: number }>;
  availabilityWindows: Array<{ dayOfWeek: number; from: string; to: string }>;
}

export function useProfile(client: AtlitosClient) {
  return {
    /** v1 `getMe`. RLS restricts every read here to the caller's own row. */
    async getMe(): Promise<MeRow | null> {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw mapAuthError(authError);
      if (!authData.user) return null;

      const [{ data: userRow, error: userError }, { data: roleRows, error: roleError }, { data: coachRow }] =
        await Promise.all([
          client.from("users").select("*").eq("id", authData.user.id).maybeSingle(),
          client.from("user_roles").select("role").eq("user_id", authData.user.id),
          client.from("coach_profiles").select("status").eq("user_id", authData.user.id).maybeSingle(),
        ]);

      if (userError) throw mapPostgrestError(userError);
      if (roleError) throw mapPostgrestError(roleError);
      if (!userRow) return null;

      return {
        id: userRow.id,
        name: userRow.name,
        phone: userRow.phone,
        dob: userRow.dob,
        avatarUrl: userRow.avatar_url,
        city: userRow.city,
        state: userRow.state,
        sports: userRow.sports ?? [],
        roles: (roleRows ?? []).map((r) => r.role as AppRole),
        coachStatus: coachRow?.status ?? null,
      };
    },

    /** v1 `setupPlayer` -> `complete_player_setup` RPC. */
    async completePlayerSetup(input: CompletePlayerSetupInput): Promise<void> {
      const { error } = await client.rpc("complete_player_setup", {
        p_sports: input.sports,
        // The generated function-arg type omits Postgres's real nullability
        // (p_avatar_url is a plain `text` param, which does accept SQL
        // NULL); the RPC body does
        // `avatar_url = coalesce(p_avatar_url, avatar_url)` specifically so
        // passing null here preserves whatever avatar_url already is.
        p_avatar_url: (input.avatarUrl ?? null) as string,
        p_city: input.city,
        p_state: input.state,
      });
      if (error) throw mapPostgrestError(error);
    },

    /** v1 `setupCoach` -> `submit_coach_verification` RPC. Returns the new
     * `verification_requests.id`. */
    async submitCoachVerification(payload: SubmitCoachVerificationPayload): Promise<string> {
      // Json (packages/types) requires an index signature that a closed
      // interface never structurally satisfies; the payload's own shape is
      // the real contract (see SubmitCoachVerificationPayload above), this
      // cast only satisfies the RPC's generic jsonb argument type.
      const { data, error } = await client.rpc("submit_coach_verification", {
        p_payload: payload as unknown as Json,
      });
      if (error) throw mapPostgrestError(error);
      return data as string;
    },
  };
}

export type UseProfileResult = ReturnType<typeof useProfile>;

// ---------------------------------------------------------------------------
// Everything below is still a placeholder: TODO(PN) throws until its own
// schema domain migration lands (see docs/PLAN.md "Schema domains").
// ---------------------------------------------------------------------------

// TODO(P8): search. Edge Function `ai-search`. See API-MAPPING.md "search".
export function useSearch(_client: AtlitosClient) {
  throw new Error("useSearch is not implemented yet, see API-MAPPING.md search");
}

// TODO(P3): coaches. PostgREST list/get + RPC `get_coach_busy_slots`. See
// API-MAPPING.md "coaches".
export function useCoaches(_client: AtlitosClient) {
  throw new Error("useCoaches is not implemented yet, see API-MAPPING.md coaches");
}

// TODO(P3): sessions. Edge Function `book-session` + PostgREST reads + RPC
// `session_transition`/`rate_session`. See API-MAPPING.md "sessions".
export function useSessions(_client: AtlitosClient) {
  throw new Error("useSessions is not implemented yet, see API-MAPPING.md sessions");
}

// ---------------------------------------------------------------------------
// courts. PostgREST reads (courts/venues, RLS restricts to venues.status =
// 'verified') + RPC (`get_court_available_slots`, `court_booking_transition`,
// `rate_court_booking`) + Edge Function (`book-court`, `verify-payment`). See
// API-MAPPING.md "courts", 0009/0011/0012_courts*.sql, PAYMENTS.md.
// ---------------------------------------------------------------------------

export interface CourtListFilters {
  sport?: Sport;
  /** Caller's current coordinates (location store). Used only to hydrate
   * `distanceKm` on each returned court client side (this schema has no
   * PostGIS/geo index yet, see SCHEMA.md); it does not filter the query
   * itself, sorting by distance is the caller's job. */
  near?: { lat: number; lng: number } | null;
}

export interface AvailableSlot {
  from: string;
  to: string;
  price: number;
}

export interface BookCourtInput {
  courtId: string;
  date: string; // ISO date
  slot: TimeSlot;
}

export interface BookCourtResult {
  bookingId: string;
  razorpayOrderId: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  bill: { subtotal: number; gst: number; platformFee: number; total: number };
}

export interface VerifyCourtPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyCourtPaymentResult {
  bookingId: string;
  status: CourtBookingStatus;
  outcome: "captured" | "already_processed";
}

export interface CourtBookingTransitionInput {
  bookingId: string;
  action: "cancel" | "no_show" | "complete" | "reschedule";
  reason?: string;
  newDate?: string;
  newSlotStart?: string;
}

const EARTH_RADIUS_KM = 6371;

/** Great circle distance between two lat/lng points, km. Used only to
 * hydrate `Court.distanceKm` for display/sort; this schema has no
 * server-side geo query (see CourtListFilters.near above). */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

interface CourtQueryRow {
  id: string;
  venue_id: string;
  name: string;
  sport: Sport;
  base_price_per_hour: number;
  active: boolean;
  venues: {
    id: string;
    name: string;
    address: string;
    city: string;
    lat: number | null;
    lng: number | null;
    status: string;
    venue_photos: { storage_path: string; position: number }[] | null;
  } | null;
}

function resolveVenuePhotoUrls(client: AtlitosClient, photos: { storage_path: string; position: number }[] | null): string[] {
  return [...(photos ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((photo) => client.storage.from("venue-media").getPublicUrl(photo.storage_path).data.publicUrl);
}

function mapCourtRow(client: AtlitosClient, row: CourtQueryRow, near?: { lat: number; lng: number } | null): Court {
  const venue = row.venues;
  const images = resolveVenuePhotoUrls(client, venue?.venue_photos ?? null);
  const lat = venue?.lat ?? 0;
  const lng = venue?.lng ?? 0;

  return {
    id: row.id,
    venueId: row.venue_id,
    name: row.name,
    location: venue ? `${venue.address}, ${venue.city}` : "",
    city: venue?.city ?? "",
    lat,
    lng,
    sport: row.sport,
    basePricePerHour: row.base_price_per_hour,
    // Hydrated below from a separate aggregate query where needed
    // (getCourt); the list read intentionally skips the extra round trip
    // per court, see listCourts.
    rating: 0,
    ratingCount: 0,
    images,
    active: row.active,
    distanceKm:
      near && venue?.lat != null && venue?.lng != null
        ? haversineKm(near, { lat: venue.lat, lng: venue.lng })
        : undefined,
  };
}

const COURT_SELECT = `
  id, venue_id, name, sport, base_price_per_hour, active,
  venues!inner ( id, name, address, city, lat, lng, status, venue_photos ( storage_path, position ) )
`;

export function useCourts(client: AtlitosClient) {
  return {
    /** v1 `courts.list`. RLS already restricts the `venues!inner` join to
     * `status = 'verified'`; the explicit filter here is defense in depth
     * and lets PostgREST push it down instead of relying on RLS alone. */
    async listCourts(filters: CourtListFilters = {}): Promise<Court[]> {
      let query = client
        .from("courts")
        .select(COURT_SELECT)
        .eq("active", true)
        .eq("venues.status", "verified");

      if (filters.sport) {
        query = query.eq("sport", filters.sport);
      }

      const { data, error } = await query.returns<CourtQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row) => mapCourtRow(client, row, filters.near));
    },

    /** v1 `courts.get`. Rating/ratingCount come from `get_court_rating_summary`
     * (0015_court_rating_summary.sql), not a direct `court_bookings` read:
     * RLS scopes that table to the booking's own athlete or the venue's
     * partner/staff, so a browsing athlete/guest cannot aggregate other
     * athletes' rating rows directly, only through this security-definer
     * function, same "hide the underlying rows, expose only the aggregate"
     * shape `get_court_busy_slots` already uses. */
    async getCourt(courtId: string, near?: { lat: number; lng: number } | null): Promise<Court | null> {
      const [{ data: courtRow, error: courtError }, { data: ratingRows, error: ratingError }] = await Promise.all([
        client.from("courts").select(COURT_SELECT).eq("id", courtId).maybeSingle<CourtQueryRow>(),
        client.rpc("get_court_rating_summary", { p_court_id: courtId }),
      ]);

      if (courtError) throw mapPostgrestError(courtError);
      if (!courtRow) return null;
      if (ratingError) throw mapPostgrestError(ratingError);

      const summary = (ratingRows as { rating: number; rating_count: number }[] | null)?.[0];
      const rating = summary?.rating ?? 0;
      const ratingCount = summary?.rating_count ?? 0;

      return { ...mapCourtRow(client, courtRow, near), rating, ratingCount };
    },

    /** v1 `courts.get`'s slot picker feed. `get_court_available_slots`
     * (0009_courts.sql) already excludes blacked-out and booked slots and
     * returns the peak-adjusted price per slot; this is a read-only
     * preview, `book-court` re-derives the authoritative price server side
     * at booking time regardless of what this returned (PRICE_MISMATCH
     * invariant, CLAUDE.md). */
    async getAvailableSlots(courtId: string, date: string): Promise<AvailableSlot[]> {
      const { data, error } = await client.rpc("get_court_available_slots", {
        p_court_id: courtId,
        p_date: date,
      });
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row: { slot_start: string; slot_end: string; price: number }) => ({
        from: row.slot_start.slice(0, 5),
        to: row.slot_end.slice(0, 5),
        price: row.price,
      }));
    },

    /** v1 `courts.book` -> `book-court` edge function. Creates the
     * `pending_payment` booking + Razorpay order server side; this never
     * writes `court_bookings`/`payment_intents` directly (CLAUDE.md's
     * financial invariant). Throws `SLOT_TAKEN` (409) if the slot was taken
     * between the client's read and this call. */
    async bookCourt(input: BookCourtInput): Promise<BookCourtResult> {
      const { data, error } = await client.functions.invoke("book-court", {
        body: {
          court_id: input.courtId,
          date: input.date,
          slot_start: input.slot.from,
          slot_end: input.slot.to,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        booking_id: string;
        razorpay_order_id: string;
        key_id: string;
        amount: number;
        currency: string;
        bill: { subtotal: number; gst: number; platform_fee: number; total: number };
      };

      return {
        bookingId: body.booking_id,
        razorpayOrderId: body.razorpay_order_id,
        keyId: body.key_id,
        amountPaise: body.amount,
        currency: body.currency,
        bill: {
          subtotal: body.bill.subtotal,
          gst: body.bill.gst,
          platformFee: body.bill.platform_fee,
          total: body.bill.total,
        },
      };
    },

    /** v1's payment confirmation step -> `verify-payment` edge function,
     * the client-callback fallback to `razorpay-webhook` (PAYMENTS.md: "so
     * the demo works without a public webhook URL"). Idempotent with the
     * webhook path, see that function's header comment. */
    async verifyPayment(input: VerifyCourtPaymentInput): Promise<VerifyCourtPaymentResult> {
      const { data, error } = await client.functions.invoke("verify-payment", {
        body: {
          razorpay_order_id: input.razorpayOrderId,
          razorpay_payment_id: input.razorpayPaymentId,
          razorpay_signature: input.razorpaySignature,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as { booking_id: string; status: CourtBookingStatus; outcome: "captured" | "already_processed" };
      return { bookingId: body.booking_id, status: body.status, outcome: body.outcome };
    },

    /** v1 `sessions`-shaped "my bookings" list, courts variant. RLS
     * (`court_bookings_select`) already scopes this to the caller's own
     * bookings (or their venue's, for a partner/staff account, which this
     * player-facing hook never calls as such). */
    async listMyBookings(): Promise<CourtBooking[]> {
      const { data, error } = await client
        .from("court_bookings")
        .select(
          "id, court_id, user_id, booking_source, date, slot_start, slot_end, subtotal, gst, platform_fee, total, status, rating, remarks, cancellation_reason, courts ( name, sport, venues ( name, address, city ) )",
        )
        .order("date", { ascending: false })
        .order("slot_start", { ascending: false })
        .returns<CourtBookingQueryRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map(mapCourtBookingRow);
    },

    /** v1 `courts.get` for a single booking (booking detail screen). */
    async getBooking(bookingId: string): Promise<CourtBooking | null> {
      const { data, error } = await client
        .from("court_bookings")
        .select(
          "id, court_id, user_id, booking_source, date, slot_start, slot_end, subtotal, gst, platform_fee, total, status, rating, remarks, cancellation_reason, courts ( name, sport, venues ( name, address, city ) )",
        )
        .eq("id", bookingId)
        .maybeSingle<CourtBookingQueryRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;

      return mapCourtBookingRow(data);
    },

    /** v1 `courts.cancel`/`courts.reschedule` (also backs a partner's
     * complete/no_show, out of this player-facing app's own call sites) ->
     * `court_booking_transition` RPC. `INVALID_TRANSITION`/`SLOT_TAKEN`/
     * `REASON_REQUIRED` surface as the matching `ApiErrorCode`. */
    async transitionBooking(input: CourtBookingTransitionInput): Promise<CourtBooking> {
      // Not `.single()`: both RPCs are declared `returns public.court_bookings`
      // (one composite row, not `setof`), so PostgREST already returns a
      // bare object rather than a one-element array; `.single()` is for
      // unwrapping a table/set response, and is unnecessary (and
      // occasionally wrong) here.
      const { data, error } = await client.rpc("court_booking_transition", {
        p_booking_id: input.bookingId,
        p_action: input.action,
        p_reason: input.reason ?? undefined,
        p_new_date: input.newDate ?? undefined,
        p_new_slot_start: input.newSlotStart ?? undefined,
      });
      if (error) throw mapPostgrestError(error);

      return mapCourtBookingRpcRow(data as unknown as CourtBookingRpcRow);
    },

    /** v1 `courts.rate` -> `rate_court_booking` RPC. Only from `completed`,
     * once (`ALREADY_RATED` on a second call). */
    async rateBooking(bookingId: string, rating: number, remarks?: string): Promise<CourtBooking> {
      const { data, error } = await client.rpc("rate_court_booking", {
        p_booking_id: bookingId,
        p_rating: rating,
        p_remarks: remarks ?? undefined,
      });
      if (error) throw mapPostgrestError(error);

      return mapCourtBookingRpcRow(data as unknown as CourtBookingRpcRow);
    },
  };
}

export type UseCourtsResult = ReturnType<typeof useCourts>;

interface CourtBookingQueryRow {
  id: string;
  court_id: string;
  user_id: string | null;
  booking_source: BookingSource;
  date: string;
  slot_start: string;
  slot_end: string;
  subtotal: number;
  gst: number;
  platform_fee: number;
  total: number;
  status: CourtBookingStatus;
  rating: number | null;
  remarks: string | null;
  cancellation_reason: string | null;
  courts: {
    name: string;
    sport: Sport;
    venues: { name: string; address: string; city: string } | null;
  } | null;
}

function mapCourtBookingRow(row: CourtBookingQueryRow): CourtBooking {
  return {
    id: row.id,
    courtId: row.court_id,
    userId: row.user_id ?? "",
    bookingSource: row.booking_source,
    date: row.date,
    slot: { from: row.slot_start.slice(0, 5), to: row.slot_end.slice(0, 5) },
    subtotal: row.subtotal,
    gst: row.gst,
    platformFee: row.platform_fee,
    total: row.total,
    status: row.status,
    rating: row.rating ?? undefined,
    remarks: row.remarks ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
    courtName: row.courts?.name,
    sport: row.courts?.sport,
    venueName: row.courts?.venues?.name,
    location: row.courts?.venues ? `${row.courts.venues.address}, ${row.courts.venues.city}` : undefined,
  };
}

interface CourtBookingRpcRow {
  id: string;
  court_id: string;
  user_id: string | null;
  booking_source: BookingSource;
  date: string;
  slot_start: string;
  slot_end: string;
  subtotal: number;
  gst: number;
  platform_fee: number;
  total: number;
  status: CourtBookingStatus;
  rating: number | null;
  remarks: string | null;
  cancellation_reason: string | null;
}

/** RPC responses (`court_booking_transition`/`rate_court_booking`) return
 * the bare `court_bookings` row, no `courts`/`venues` join; callers that
 * need the hydrated name/venue fields re-fetch via `getBooking` after a
 * successful transition (the "query invalidation" this task calls for). */
function mapCourtBookingRpcRow(row: CourtBookingRpcRow): CourtBooking {
  return {
    id: row.id,
    courtId: row.court_id,
    userId: row.user_id ?? "",
    bookingSource: row.booking_source,
    date: row.date,
    slot: { from: row.slot_start.slice(0, 5), to: row.slot_end.slice(0, 5) },
    subtotal: row.subtotal,
    gst: row.gst,
    platformFee: row.platform_fee,
    total: row.total,
    status: row.status,
    rating: row.rating ?? undefined,
    remarks: row.remarks ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
  };
}

// TODO(P4): shop. PostgREST reads + RPC (add_to_cart, update_cart_item) +
// Edge Function `checkout`. See API-MAPPING.md "shop".
export function useShop(_client: AtlitosClient) {
  throw new Error("useShop is not implemented yet, see API-MAPPING.md shop");
}

// TODO(P4): wishlist. RPC `toggle_product_wishlist` + PostgREST list. See
// API-MAPPING.md "wishlist (gear)".
export function useWishlist(_client: AtlitosClient) {
  throw new Error("useWishlist is not implemented yet, see API-MAPPING.md wishlist");
}

// TODO(P5): clutch. PostgREST reads + Edge Function `stream-upload-url` +
// RPC (toggle_clip_like, toggle_follow). See API-MAPPING.md "clutch".
export function useClutch(_client: AtlitosClient) {
  throw new Error("useClutch is not implemented yet, see API-MAPPING.md clutch");
}

// TODO(P6): empower. PostgREST + RPC (get_empower_stats,
// get_my_impact_summary) + Edge Function `donate`. See API-MAPPING.md
// "empower".
export function useEmpower(_client: AtlitosClient) {
  throw new Error("useEmpower is not implemented yet, see API-MAPPING.md empower");
}

// TODO(P3/P8): wallet, notifications, help. RPC (get_coach_wallet_balance,
// get_my_transactions) + PostgREST (notifications, support_tickets). See
// API-MAPPING.md "wallet / notifs / help".
export function useWallet(_client: AtlitosClient) {
  throw new Error("useWallet is not implemented yet, see API-MAPPING.md wallet / notifs / help");
}
