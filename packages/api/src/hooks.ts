import type { Session } from "@supabase/supabase-js";
import type { AppRole, Json, Sport } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapAuthError, mapPostgrestError } from "./errors";

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

// TODO(P2): courts. Edge Function `book-court` + PostgREST reads + RPC
// `court_booking_transition`/`rate_court_booking`. See API-MAPPING.md "courts".
export function useCourts(_client: AtlitosClient) {
  throw new Error("useCourts is not implemented yet, see API-MAPPING.md courts");
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
