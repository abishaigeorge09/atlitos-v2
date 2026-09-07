import { makeAuthApi, makeProfileApi, type MeRow } from "@atlitos/api";
import type { ApiError } from "@atlitos/types";
import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";

import { supabase } from "@/lib/supabase";

/**
 * `session-store`: the single source of truth for who is using the app right
 * now, driven entirely by `supabase.auth.onAuthStateChange` (PRD-01 FR-1,
 * FR-10). Every route group ((auth), (onboarding), (tabs)) reads `status`
 * from this store to decide what to render; nothing else in the app calls
 * `supabase.auth.getSession()` directly.
 *
 * Guest mode (PRD-01 section 3.1, FR-1 to FR-5) is a real Supabase anonymous
 * auth session (`signInAnonymously`, API-MAPPING.md "auth" `continueAsGuest`)
 * with zero `user_roles` rows, per RLS.md: "anon ... or a Supabase anonymous
 * auth session (this is the v1 'guest')". `session.user.is_anonymous` is
 * what this store checks to tell a guest apart from a signed-in player/coach.
 */

export type SessionStatus =
  | "loading" // auth state not yet resolved on app start
  | "signed_out" // no session at all
  | "guest" // anonymous session (Continue as guest)
  | "signed_in"; // real player/coach session

export type OnboardingStep = "role_select" | "player_setup" | "coach_setup" | "done";

// Module scope, outside React: these MUST be the plain factories, never the
// `useAuth`/`useProfile` hooks, which call useMemo and would throw "Invalid
// hook call" here.
const auth = makeAuthApi(supabase);
const profile = makeProfileApi(supabase);

interface SessionState {
  status: SessionStatus;
  session: Session | null;
  me: MeRow | null;
  meLoading: boolean;
  meError: ApiError | null;

  /** True once the first `onAuthStateChange` event (or the initial
   * `getSession()` seed) has resolved. Splash uses this, not `status`
   * directly, to avoid a flash of the wrong route. */
  hydrated: boolean;

  /** Derived per PRD-01 FR-8: a signed-in user who has not yet set a city
   * (the player setup wizard's minimum completion bar) still needs
   * onboarding. There is no explicit "onboarding_complete" column in
   * SCHEMA.md; city is the field every onboarding path (player or coach
   * setup) requires, so its presence is the completion signal. */
  needsOnboarding: () => boolean;

  refreshMe: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: "loading",
  session: null,
  me: null,
  meLoading: false,
  meError: null,
  hydrated: false,

  needsOnboarding: () => {
    const { me } = get();
    return me != null && !me.city;
  },

  refreshMe: async () => {
    set({ meLoading: true, meError: null });
    try {
      const me = await profile.getMe();
      set({ me, meLoading: false });
    } catch (error) {
      set({ meError: error as ApiError, meLoading: false });
    }
  },

  continueAsGuest: async () => {
    await auth.continueAsGuest();
    // onAuthStateChange picks up the resulting session and sets status.
  },

  signOut: async () => {
    await auth.signOut();
    set({ me: null });
  },
}));

/**
 * Session selectors. Use these with `useSessionStore(...)` instead of
 * hand-rolling `status === 'guest'` at call sites, so the guest-gate
 * distinction stays consistent across the app:
 *
 *   - `selectIsSignedIn` / `selectRequiresAuthGate`: an AUTH GATE. Any tap
 *     that would fire an authenticated RPC (like, follow, comment, book,
 *     pay, load an owner-scoped list) must gate on `requiresAuthGate`, i.e.
 *     trigger for everyone who is not signed in. That covers a real guest
 *     session AND a cold web visitor who deep-linked to an interactive
 *     screen and still has no session at all (`signed_out`), AND the brief
 *     `loading` window before auth resolves. Gating only on `=== 'guest'`
 *     let a `signed_out` visitor's tap skip the LoginGateModal and hit the
 *     real RPC, which 401'd (QA AUTH-09, CL-03, CL-04, FO-09).
 *   - `selectIsGuest`: DISPLAY ONLY. Reserve `=== 'guest'` for copy or data
 *     paths that are genuinely specific to an anonymous guest session (the
 *     local guest wishlist store, guest-only routing on splash), which must
 *     NOT engage for a `signed_out`/`loading` visitor mid-bootstrap.
 */
export const selectIsSignedIn = (s: SessionState): boolean => s.status === "signed_in";
export const selectIsGuest = (s: SessionState): boolean => s.status === "guest";
export const selectRequiresAuthGate = (s: SessionState): boolean => s.status !== "signed_in";

let listenerStarted = false;

/** Starts the one `onAuthStateChange` subscription for the app. Called once
 * from the root layout on mount; safe to call more than once (idempotent). */
export function startSessionListener(): void {
  if (listenerStarted) return;
  listenerStarted = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session);
  });

  // Seed the initial state immediately rather than waiting for the first
  // onAuthStateChange callback, which can lag slightly behind app start.
  supabase.auth.getSession().then(({ data }) => applySession(data.session));
}

function applySession(session: Session | null): void {
  const isGuest = session?.user.is_anonymous === true;
  const status: SessionStatus = !session ? "signed_out" : isGuest ? "guest" : "signed_in";

  useSessionStore.setState({ status, session, hydrated: true });

  if (status === "signed_in") {
    void useSessionStore.getState().refreshMe();
  } else {
    useSessionStore.setState({ me: null, meError: null });
  }
}
