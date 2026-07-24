import { useMemo } from "react";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type {
  ApiError,
  AppRole,
  BookingSource,
  Clip,
  ClipStatus,
  Comment,
  Court,
  CourtBooking,
  CourtBookingStatus,
  Json,
  SearchInput,
  SearchResponse,
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

    /** v1 `register`. `handle_new_user()` (0001_identity.sql, updated in
     * 0073_signup_metadata.sql) seeds the `public.users` row, copying name,
     * phone and dob from `raw_user_meta_data`, plus the default `player`
     * role. The post-session update below is a best-effort fallback for
     * environments where 0073 has not been applied; it must never fail the
     * registration itself (when email confirmation is on there is no session
     * here at all, and the trigger is the only path that runs). */
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

      // Best-effort: the trigger already wrote phone/dob (0073). Ignore the
      // result; a unique-phone conflict or a pre-0073 environment must not
      // turn a successful signup into an error.
      await client
        .from("users")
        .update({ phone: input.phone, dob: input.dob })
        .eq("id", data.session.user.id);

      return { session: data.session, needsEmailConfirmation: false };
    },

    /** Resend the signup confirmation email for an account that registered
     * but has not confirmed yet. NOT `requestOtp`: `signInWithOtp` with
     * `shouldCreateUser: false` sends a login code, which an unconfirmed
     * account cannot use; `auth.resend({ type: "signup" })` re-sends the
     * actual confirmation link. */
    async resendSignupEmail(email: string): Promise<void> {
      const { error } = await client.auth.resend({ type: "signup", email });
      if (error) throw mapAuthError(error);
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
  bio: string | null;
  coverUrl: string | null;
  handle: string | null;
  city: string | null;
  state: string | null;
  sports: Sport[];
  roles: AppRole[];
  coachStatus: "pending_review" | "verified" | "rejected" | null;
}

/** Own-profile edit payload (0072 columns + avatar). Every field is optional;
 * only the fields present are written. `null` clears a nullable column. */
export interface UpdateProfileInput {
  bio?: string | null;
  coverUrl?: string | null;
  avatarUrl?: string | null;
  handle?: string;
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
        bio: userRow.bio,
        coverUrl: userRow.cover_url,
        handle: userRow.handle,
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

    /** Own-row profile edit (0072: bio, cover_url, handle; avatar_url from
     * 0001). Explicit `.eq("id", me)` owner filter per CLAUDE.md scoping rule
     * even though `users_update_own` would scope it anyway. The unique index
     * `idx_users_handle_lower` surfaces a duplicate handle as Postgres 23505,
     * mapped here to a friendly VALIDATION error instead of a raw constraint
     * string. */
    async updateProfile(input: UpdateProfileInput): Promise<void> {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw mapAuthError(authError);
      if (!authData.user) throw mapAuthError({ message: "Sign in to edit your profile.", status: 401 });

      const patch: { bio?: string | null; cover_url?: string | null; avatar_url?: string | null; handle?: string } =
        {};
      if (input.bio !== undefined) patch.bio = input.bio;
      if (input.coverUrl !== undefined) patch.cover_url = input.coverUrl;
      if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;
      if (input.handle !== undefined) patch.handle = input.handle.trim().toLowerCase();

      const { error } = await client.from("users").update(patch).eq("id", authData.user.id);
      if (error) {
        if (error.code === "23505" || /idx_users_handle_lower|duplicate key/i.test(error.message)) {
          const friendly: ApiError = {
            code: "VALIDATION",
            message: "That handle is taken. Try another one.",
            status: 409,
          };
          throw friendly;
        }
        throw mapPostgrestError(error);
      }
    },

    /** Live handle availability for the edit screen. Reads the public
     * `public_profiles` view case-insensitively (`ilike` with no wildcard is
     * case-insensitive equality) and excludes the caller's own row so keeping
     * your current handle always reads as available. `%` and `_` are LIKE
     * wildcards, so they are escaped: an unescaped `_` in a handle would make
     * `a_c` match `abc` and misreport a free handle as taken. */
    async isHandleAvailable(handle: string): Promise<boolean> {
      const normalized = handle.trim().toLowerCase();
      if (!normalized) return false;
      const { data: authData } = await client.auth.getUser();

      const pattern = normalized.replace(/[\\%_]/g, "\\$&");
      let query = client.from("public_profiles").select("id").ilike("handle", pattern).limit(1);
      if (authData.user) query = query.neq("id", authData.user.id);

      const { data, error } = await query;
      if (error) throw mapPostgrestError(error);
      return (data ?? []).length === 0;
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

/**
 * v1 `search.aiSearch` -> `ai-search` edge function (API-MAPPING.md "search",
 * AT-144). The v1 heuristic runs server side (keyword to entityTypes, weighted
 * distance/price/rating score) behind the same request/response contract; this
 * hook only shapes the request and relays the ranked, RLS-scoped results. The
 * function itself is the sole visibility boundary, so this never re-filters and
 * never trusts a broad query to be safe.
 */
export function useSearch(client: AtlitosClient) {
  return {
    async search(input: SearchInput): Promise<SearchResponse> {
      if (!input.query.trim()) {
        return { query: input.query, parsedIntent: { entityTypes: [], sport: "general", keywords: [] }, results: [] };
      }
      const { data, error } = await client.functions.invoke("ai-search", {
        body: {
          query: input.query.trim(),
          entityTypes: input.entityTypes,
          sport: input.sport,
          priceMax: input.priceMax,
          lat: input.lat,
          lng: input.lng,
          city: input.city,
          limit: input.limit,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);
      return data as SearchResponse;
    },
  };
}

export type UseSearchResult = ReturnType<typeof useSearch>;

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

// P4: shop and wishlist (gear) are implemented in `use-shop.ts` (AT-74 to
// AT-80, Track C), which owns both `useShop` and `useWishlist` and re-exports
// them from the package root. The placeholders that used to stand here were
// removed rather than left beside the real implementations, because
// `index.ts` re-exports both files and two exports of the same name would
// collide. See API-MAPPING.md "shop" and "wishlist (gear)".

// ---------------------------------------------------------------------------
// clutch. PostgREST reads (`clips`/`clip_comments`/`creator_stats`, RLS public
// read restricted to `status='published'`, owner reads their own in any
// status) + RPC (`toggle_clip_like`, `toggle_follow`) + Edge Function
// (`stream-upload-url`, `stream-webhook`, `get-clip-playback-url`). See
// API-MAPPING.md "clutch" and VIDEO.md for the upload/playback pipeline.
//
// TYPING NOTE: the clutch tables/RPCs land in Track A's schema migrations
// (0041-0047) and its regenerated `Database` type. Until that regenerated
// type is on this branch, `client.from("clips")`/`client.rpc("toggle_...")`
// have no literal to match, so this lane routes its PostgREST/RPC calls
// through an intentionally-untyped view of the same client (`untyped()`
// below) and re-narrows every result into the row interfaces declared here.
// This is the only escape hatch; edge-function invokes and auth stay on the
// typed client. When Track A's `Database` type merges, swap `untyped(client)`
// back to `client` and delete the local row interfaces, no call-site changes.
// ---------------------------------------------------------------------------

/** One page of the vertical feed. `nextCursor` is the last row's `created_at`
 * for keyset pagination; null when the page was not full (end of feed). */
export interface ClutchFeedPage {
  clips: Clip[];
  nextCursor: string | null;
}

/** One page of a clip's comments (keyset on `created_at`, oldest first). */
export interface ClutchCommentPage {
  comments: Comment[];
  nextCursor: string | null;
}

/** Creator/own profile header aggregate, from the `creator_stats` view plus
 * the `public_profiles` display columns (0072: handle, bio, cover_url). */
export interface CreatorProfile {
  id: string;
  name: string;
  channel: string;
  avatarUrl: string | null;
  handle: string | null;
  bio: string | null;
  coverUrl: string | null;
  clipCount: number;
  followerCount: number;
  followingCount: number;
  totalLikes: number;
  followedByMe: boolean;
}

/** One row of a Following/Followers list: the followed or following user's
 * public display columns from `public_profiles`. */
export interface FollowListEntry {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

/** `stream-upload-url` response. The client PUTs the MP4 to `uploadUrl`, or
 * uses supabase-js `uploadToSignedUrl(path, token, file)` against `bucket`. */
export interface ClipUploadTicket {
  clipId: string;
  uploadUrl: string;
  token: string;
  path: string;
  bucket: string;
  status: ClipStatus;
}

/** `stream-webhook` (on-upload finalizer) response. */
export interface ClipUploadResult {
  clipId: string;
  status: ClipStatus;
  outcome: string;
}

/** `get-clip-playback-url` response. Short-lived (300s) signed MP4 URL,
 * minted per visible card and refreshed on expiry, never stored. */
export interface ClipPlayback {
  clipId: string;
  url: string;
  thumbUrl: string | null;
  expiresIn: number;
  status: ClipStatus;
}

export interface ClipLikeResult {
  liked: boolean;
  likesCount: number;
}

export interface FollowResult {
  following: boolean;
  followerCount: number;
}

export interface UploadClipInput {
  caption: string;
  sport: Sport;
  /** Set only when re-requesting a URL for a clip row that already exists
   * (retry after a dropped upload); omit for a fresh post. */
  clipId?: string;
}

const CLUTCH_PAGE_SIZE = 10;

// NOTE: the column is `thumb_path` on `clips` (0042; the same column
// stream-webhook writes and get-clip-playback-url/get-clip-moderation-url
// read). The select previously named a non-existent `thumb_url`, so every
// feed/detail/creator/profile read 400'd ("column clips.thumb_url does not
// exist"); under F1's unmemoized-hook render loop those 400s were queued
// behind the storm and surfaced as perpetually-"pending" requests rather than
// a visible error, which is why the feed never left its spinner. Selecting the
// real column lets the feed populate; the row is mapped to `Clip.thumbUrl`
// below (a poster path the card resolves, not a signed URL).
// NOTE: creator/commenter identity embeds go through the `public_profiles`
// definer view (0072: the ONLY cross-user read surface for users), never the
// base `users` table. Base-table RLS is own-row/admin only, and PostgREST
// embeds enforce the embedded table's RLS, so a `users:owner_id` embed came
// back null for every row not owned by the caller and the whole feed rendered
// the "Athlete" fallback. The `!owner_id`/`!user_id` hints resolve the FK to
// users through the view; the `users:` alias preserves the row shapes below.
const CLIP_FEED_SELECT =
  "id, owner_id, caption, sport, status, likes_count, comment_count, created_at, thumb_path, users:public_profiles!owner_id ( name, channel_name, avatar_url )";

const CLIP_COMMENT_SELECT =
  "id, clip_id, user_id, text, created_at, users:public_profiles!user_id ( name, channel_name )";

interface ClipUserJoin {
  name: string | null;
  channel_name: string | null;
  avatar_url?: string | null;
}

interface ClipFeedRow {
  id: string;
  owner_id: string;
  caption: string;
  sport: Sport;
  status: ClipStatus;
  likes_count: number;
  comment_count: number;
  created_at: string;
  thumb_path: string | null;
  users: ClipUserJoin | null;
}

interface ClipCommentJoinRow {
  id: string;
  clip_id: string;
  user_id: string;
  text: string;
  created_at: string;
  users: ClipUserJoin | null;
}

interface CreatorStatsRow {
  user_id: string;
  published_clips_count: number;
  followers_count: number;
  following_count: number;
  total_likes: number | null;
}

interface PublicProfileRow {
  id: string;
  name: string | null;
  channel_name: string | null;
  avatar_url: string | null;
  handle: string | null;
  bio: string | null;
  cover_url: string | null;
}

/** users.channel_name is the display channel; fall back to the display name,
 * then a neutral default, so a card never renders an empty channel line. */
function channelOf(user: ClipUserJoin | null): string {
  return user?.channel_name ?? user?.name ?? "Athlete";
}

/** True only for an absolute http(s) URL an <Image> can actually load. A bare
 * Supabase storage path (the shape thumb_path holds) is not one, and must not
 * reach an Image source, or it renders blank/broken. */
function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function mapClipRow(row: ClipFeedRow, likedByMe: boolean): Clip {
  return {
    id: row.id,
    ownerId: row.owner_id,
    channel: channelOf(row.users),
    // videoUrl is deliberately absent here: playback is a fresh signed URL
    // minted per visible card via getPlaybackUrl, never carried on the row.
    // thumb_path is a private-`clips`-bucket storage path, not a loadable URL:
    // handing a bare path straight to <Image source={{uri}}> renders a blank
    // (native) or broken (web) poster, the "unbundled path" symptom. Only pass
    // it through if it is already an absolute http(s) URL; a raw storage path
    // stays undefined so the card shows its solid poster surface, never a
    // broken image, until a signed-thumb seam mints a real URL.
    thumbUrl: isHttpUrl(row.thumb_path) ? (row.thumb_path as string) : undefined,
    caption: row.caption,
    sport: row.sport,
    status: row.status,
    likes: row.likes_count,
    commentCount: row.comment_count,
    createdAt: row.created_at,
    likedByMe,
  };
}

function mapCommentRow(row: ClipCommentJoinRow): Comment {
  return {
    id: row.id,
    clipId: row.clip_id,
    userId: row.user_id,
    username: channelOf(row.users),
    text: row.text,
    createdAt: row.created_at,
  };
}

export function useClutch(client: AtlitosClient) {
  // Memoize the returned api object on [client] so it keeps a STABLE identity
  // across renders. The Clutch screens consume it as
  // `const clutch = useClutch(supabase); const load = useCallback(..., [clutch]);
  // useEffect(load, [load])`. Before this memo `useClutch` returned a fresh
  // object literal every render, so `clutch` changed identity every render,
  // `load` changed with it, and the effect refired forever, an unbounded
  // ~55 req/s render/request loop (F1 in the P5 web verification, systemic
  // across feed/detail/creator/profile and native). `supabase` is a module
  // singleton with a stable identity, so this memo resolves once and never
  // recomputes; every inner function lives inside the builder and is stable
  // for the same reason. This is the single root-cause fix, so none of the
  // four consuming screens change. The sibling hooks (useShop/useCourts/...)
  // do not memoize because their consumers never feed the returned object into
  // an effect dependency array; the Clutch screens do, which is why the fix
  // belongs here.
  return useMemo(() => makeClutchApi(client), [client]);
}

/** Hydrates an ordered follow id list into FollowListEntry rows through the
 * `public_profiles` view, preserving the follows ordering. An id whose
 * profile row is missing (account deleted racing the read) is dropped rather
 * than rendered as a blank row. */
async function followProfiles(db: SupabaseClient, ids: string[]): Promise<FollowListEntry[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("public_profiles")
    .select("id, name, avatar_url, handle")
    .in("id", ids)
    .returns<Pick<PublicProfileRow, "id" | "name" | "avatar_url" | "handle">[]>();
  if (error) throw mapPostgrestError(error);

  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is Pick<PublicProfileRow, "id" | "name" | "avatar_url" | "handle"> => row != null)
    .map((row) => ({ id: row.id, name: row.name ?? "Athlete", handle: row.handle, avatarUrl: row.avatar_url }));
}

function makeClutchApi(client: AtlitosClient) {
  // See TYPING NOTE above: the clutch tables/RPCs are not yet in the
  // generated `Database` type on this branch. `db` is the same client with
  // its schema generic widened so `from`/`rpc` accept the clutch relations;
  // every result is re-narrowed through the row interfaces above.
  const db = client as unknown as SupabaseClient;

  async function likedClipIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { data: authData } = await client.auth.getUser();
    // A guest (anonymous session) has no likes; skip the round trip.
    if (!authData.user || authData.user.is_anonymous) return new Set();

    const { data, error } = await db
      .from("clip_likes")
      .select("clip_id")
      .eq("user_id", authData.user.id)
      .in("clip_id", ids)
      .returns<{ clip_id: string }[]>();
    if (error) throw mapPostgrestError(error);
    return new Set((data ?? []).map((r) => r.clip_id));
  }

  return {
    /** v1 `clutch.feed`. Keyset pagination on `created_at`, newest first.
     * `status='published'` is filtered EXPLICITLY here, never left to RLS:
     * RLS is permissive-OR (an owner can additionally read their own clip in
     * any status), so an unfiltered feed read would surface a signed-in
     * athlete's own `uploading`/`rejected` clips into the public feed
     * (CLAUDE.md's "RLS is not scoping" rule). */
    async getFeed(cursor?: string): Promise<ClutchFeedPage> {
      let query = db
        .from("clips")
        .select(CLIP_FEED_SELECT)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(CLUTCH_PAGE_SIZE);
      if (cursor) query = query.lt("created_at", cursor);

      const { data, error } = await query.returns<ClipFeedRow[]>();
      if (error) throw mapPostgrestError(error);

      const rows = data ?? [];
      const liked = await likedClipIds(rows.map((r) => r.id));
      const last = rows.at(-1);
      return {
        clips: rows.map((r) => mapClipRow(r, liked.has(r.id))),
        nextCursor: rows.length === CLUTCH_PAGE_SIZE && last ? last.created_at : null,
      };
    },

    /** v1 `clutch.get`. A single clip for the post detail screen. RLS lets a
     * guest/other athlete read it only when `published`; the owner can read
     * their own in any status (own-profile deep link into a pending clip). */
    async getClip(clipId: string): Promise<Clip | null> {
      const { data, error } = await db
        .from("clips")
        .select(CLIP_FEED_SELECT)
        .eq("id", clipId)
        .maybeSingle<ClipFeedRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;

      const liked = await likedClipIds([data.id]);
      return mapClipRow(data, liked.has(data.id));
    },

    /** v1 `clutch.comments`. Keyset on `created_at`, oldest first (a comment
     * thread reads top to bottom, unlike the feed). Public read. */
    async getComments(clipId: string, cursor?: string): Promise<ClutchCommentPage> {
      let query = db
        .from("clip_comments")
        .select(CLIP_COMMENT_SELECT)
        .eq("clip_id", clipId)
        .order("created_at", { ascending: true })
        .limit(CLUTCH_PAGE_SIZE);
      if (cursor) query = query.gt("created_at", cursor);

      const { data, error } = await query.returns<ClipCommentJoinRow[]>();
      if (error) throw mapPostgrestError(error);

      const rows = data ?? [];
      const last = rows.at(-1);
      return {
        comments: rows.map(mapCommentRow),
        nextCursor: rows.length === CLUTCH_PAGE_SIZE && last ? last.created_at : null,
      };
    },

    /** v1 `clutch.addComment`. Own-row insert (RLS requires a non-anonymous
     * `auth.uid()`; a guest insert is rejected and surfaces as `403 GUEST`,
     * which the UI pre-empts with the login gate). Returns the created row
     * hydrated with the author's channel for optimistic append. */
    async addComment(clipId: string, text: string): Promise<Comment> {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw mapAuthError(authError);
      if (!authData.user) throw mapAuthError({ message: "Sign in to comment.", status: 401 });

      const { data, error } = await db
        .from("clip_comments")
        .insert({ clip_id: clipId, user_id: authData.user.id, text })
        .select(CLIP_COMMENT_SELECT)
        .single<ClipCommentJoinRow>();
      if (error) throw mapPostgrestError(error);

      return mapCommentRow(data);
    },

    /** v1 `clutch.like` -> `toggle_clip_like` RPC. Atomic toggle that also
     * maintains `clips.likes_count` in the same transaction; the client
     * never writes `clip_likes`/`clips.likes_count` directly (CLAUDE.md).
     * `403 GUEST` if anonymous (UI gates first). */
    async toggleLike(clipId: string): Promise<ClipLikeResult> {
      const { data, error } = await db.rpc("toggle_clip_like", { p_clip_id: clipId });
      if (error) throw mapPostgrestError(error);
      const row = ((Array.isArray(data) ? data[0] : data) ?? null) as
        | { liked?: boolean; likes_count?: number }
        | null;
      return { liked: row?.liked ?? false, likesCount: row?.likes_count ?? 0 };
    },

    /** v1 `clutch.follow` -> `toggle_follow` RPC. Atomic toggle; the client
     * never writes `follows` directly. `403 GUEST` if anonymous. */
    async toggleFollow(followeeId: string): Promise<FollowResult> {
      const { data, error } = await db.rpc("toggle_follow", { p_followee_id: followeeId });
      if (error) throw mapPostgrestError(error);
      const row = ((Array.isArray(data) ? data[0] : data) ?? null) as
        | { following?: boolean; follower_count?: number }
        | null;
      return { following: row?.following ?? false, followerCount: row?.follower_count ?? 0 };
    },

    /** v1 `clutch.creator`. Aggregate header from the `creator_stats` view
     * (public read). `followedByMe` is a separate own-scoped `follows`
     * existence check (a guest is never following anyone). */
    async getCreator(creatorId: string): Promise<CreatorProfile | null> {
      // creator_stats (0041) exposes ONLY the aggregate columns keyed by
      // `user_id`; the display fields (name/channel_name/avatar_url and the
      // 0072 handle/bio/cover_url) come from the `public_profiles` definer
      // view, the sole cross-user read surface for `users` (the base table's
      // RLS is own-row/admin, so a direct `users` read here would silently
      // return null for every creator who is not the caller).
      const { data, error } = await db
        .from("creator_stats")
        .select("user_id, published_clips_count, followers_count, following_count, total_likes")
        .eq("user_id", creatorId)
        .maybeSingle<CreatorStatsRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;

      const { data: profileRow, error: profileError } = await db
        .from("public_profiles")
        .select("id, name, channel_name, avatar_url, handle, bio, cover_url")
        .eq("id", creatorId)
        .maybeSingle<PublicProfileRow>();
      if (profileError) throw mapPostgrestError(profileError);

      let followedByMe = false;
      const { data: authData } = await client.auth.getUser();
      if (authData.user && !authData.user.is_anonymous) {
        const { count, error: followError } = await db
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("follower_id", authData.user.id)
          .eq("followee_id", creatorId);
        if (followError) throw mapPostgrestError(followError);
        followedByMe = (count ?? 0) > 0;
      }

      return {
        id: data.user_id,
        name: profileRow?.name ?? "Athlete",
        channel: profileRow?.channel_name ?? profileRow?.name ?? "Athlete",
        avatarUrl: profileRow?.avatar_url ?? null,
        handle: profileRow?.handle ?? null,
        bio: profileRow?.bio ?? null,
        coverUrl: profileRow?.cover_url ?? null,
        clipCount: data.published_clips_count,
        followerCount: data.followers_count,
        followingCount: data.following_count,
        totalLikes: Number(data.total_likes ?? 0),
        followedByMe,
      };
    },

    /** The accounts `userId` follows, newest follow first, capped at 100 for
     * v1 (no pagination). Two reads rather than a PostgREST embed: `follows`
     * with an EXPLICIT `follower_id` filter (public-read table, CLAUDE.md
     * scoping rule), then the display columns from `public_profiles`. */
    async listFollowing(userId: string): Promise<FollowListEntry[]> {
      const { data, error } = await db
        .from("follows")
        .select("followee_id, created_at")
        .eq("follower_id", userId)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<{ followee_id: string; created_at: string }[]>();
      if (error) throw mapPostgrestError(error);
      return followProfiles(db, (data ?? []).map((r) => r.followee_id));
    },

    /** The accounts following `userId`, newest first, capped at 100. Same
     * two-read shape as listFollowing with the EXPLICIT `followee_id` filter. */
    async listFollowers(userId: string): Promise<FollowListEntry[]> {
      const { data, error } = await db
        .from("follows")
        .select("follower_id, created_at")
        .eq("followee_id", userId)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<{ follower_id: string; created_at: string }[]>();
      if (error) throw mapPostgrestError(error);
      return followProfiles(db, (data ?? []).map((r) => r.follower_id));
    },

    /** The caller's liked clips for the profile's liked grid, newest like
     * first. EXPLICIT owner filter on `clip_likes` (public-read table) AND an
     * explicit `clips.status = 'published'` on the inner join (RLS is
     * permissive-OR: without it the caller's like on their own since-removed
     * clip would surface into the grid). Rows come back in the same shape as
     * the feed select so ClutchPostCard's thumb variant renders unchanged;
     * likedByMe is true by construction. */
    async listLikedClips(): Promise<Clip[]> {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw mapAuthError(authError);
      if (!authData.user || authData.user.is_anonymous) return [];

      const { data, error } = await db
        .from("clip_likes")
        .select(`created_at, clips!inner ( ${CLIP_FEED_SELECT} )`)
        .eq("user_id", authData.user.id)
        .eq("clips.status", "published")
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<{ created_at: string; clips: ClipFeedRow }[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map((row) => mapClipRow(row.clips, true));
    },

    /** A creator's public grid: their `published` clips, newest first. The
     * explicit `status='published'` filter is the same RLS-is-not-scoping
     * guard as the feed (a visitor must not see a creator's pending clips). */
    async getCreatorClips(creatorId: string): Promise<Clip[]> {
      const { data, error } = await db
        .from("clips")
        .select(CLIP_FEED_SELECT)
        .eq("owner_id", creatorId)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .returns<ClipFeedRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map((r) => mapClipRow(r, false));
    },

    /** The signed-in athlete's own clips for their own Clutch profile, in
     * ANY status (an `uploading`/`processing`/`rejected` clip must show on
     * the owner's own grid per PRD-01 FR-44), so this deliberately does NOT
     * filter by status. RLS scopes the read to the caller's own rows. */
    async getMyClips(): Promise<Clip[]> {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw mapAuthError(authError);
      if (!authData.user) return [];

      const { data, error } = await db
        .from("clips")
        .select(CLIP_FEED_SELECT)
        .eq("owner_id", authData.user.id)
        .order("created_at", { ascending: false })
        .returns<ClipFeedRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map((r) => mapClipRow(r, false));
    },

    /** v1 `clutch.upload` step 1 -> `stream-upload-url` edge function. Mints
     * the one-time signed Storage upload URL and creates the `clips` row in
     * `uploading` status server side; the client then PUTs the MP4 to
     * `uploadUrl` (or `uploadToSignedUrl(path, token, file)`), never writing
     * the clip row itself. See VIDEO.md. */
    async requestUploadUrl(input: UploadClipInput): Promise<ClipUploadTicket> {
      const { data, error } = await client.functions.invoke("stream-upload-url", {
        body: { caption: input.caption, sport: input.sport, clip_id: input.clipId },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        clipId: string;
        uploadUrl: string;
        token: string;
        path: string;
        bucket: string;
        status: ClipStatus;
      };
      return body;
    },

    /** v1 `clutch.upload` step 3 -> `stream-webhook` (on-upload finalizer).
     * Called after the MP4 PUT completes; flips the clip to `ready` (into the
     * moderation queue) and stores the client-captured thumbnail path. */
    async finalizeUpload(clipId: string, thumbPath?: string): Promise<ClipUploadResult> {
      const { data, error } = await client.functions.invoke("stream-webhook", {
        body: { clip_id: clipId, thumb_path: thumbPath },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as { clipId: string; status: ClipStatus; outcome: string };
      return body;
    },

    /** v1 feed/detail playback -> `get-clip-playback-url` edge function.
     * Returns a SHORT-LIVED (300s) signed MP4 URL; call it per visible card
     * and refresh on expiry, never store or hardcode the URL, never read the
     * raw storage path (the bucket is private). 403 for a removed/rejected
     * clip, or a non-owner reading an unpublished one. See VIDEO.md. */
    async getPlaybackUrl(clipId: string): Promise<ClipPlayback> {
      const { data, error } = await client.functions.invoke("get-clip-playback-url", {
        body: { clip_id: clipId },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        clipId: string;
        url: string;
        thumbUrl: string | null;
        expiresIn: number;
        status: ClipStatus;
      };
      return body;
    },
  };
}

export type UseClutchResult = ReturnType<typeof useClutch>;

// P6: empower (hub, UPA profile, donate, My Impact) is implemented in
// `use-empower.ts` (AT-123, Track D), which owns `useEmpower` and re-exports it
// from the package root. The placeholder that used to stand here was removed
// rather than left beside the real implementation, because `index.ts`
// re-exports both files and two exports of the same name would collide (the
// same split `use-shop.ts` established). See API-MAPPING.md "empower".

// TODO(P3/P8): wallet, notifications, help. RPC (get_coach_wallet_balance,
// get_my_transactions) + PostgREST (notifications, support_tickets). See
// API-MAPPING.md "wallet / notifs / help".
export function useWallet(_client: AtlitosClient) {
  throw new Error("useWallet is not implemented yet, see API-MAPPING.md wallet / notifs / help");
}
