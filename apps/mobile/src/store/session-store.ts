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
  // P0-4 (Phase 3 LAUNCH, 1000-user readiness). continueAsGuest's own quick
  // retries (packages/api useAuth) exhausted, so the app is NOT stranded on
  // a login wall: it proceeds to Home on whatever the `anon` role can
  // already read (public browse policies, public thumb buckets), pure
  // client degradation, no RLS/bucket widened. A slower jittered background
  // remint (session-store's scheduleBackgroundRemint) keeps trying; success
  // fires onAuthStateChange, which moves status straight to "guest" with no
  // reinstall or user action needed. Any authenticated tap already gates
  // through requiresAuthGate the same as a real guest, so nothing here needs
  // its own gate logic.
  | "guest_unminted"
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

  /** P0-4: called once continueAsGuest's own retries are exhausted. Flips
   * status to "guest_unminted" (Home renders on the anon role's public
   * reads) and starts a slower background remint loop that keeps retrying
   * until either it succeeds (onAuthStateChange takes it from there) or the
   * app is backgrounded/torn down.
   *
   * `lastErrorCode` is the ApiError code that exhausted the quick path.
   * `RATE_LIMITED` gets a much longer first interval, because GoTrue's anon
   * bucket refills one token every 120 seconds and a 2 second retry against
   * it is guaranteed waste that also starves everyone else on the same IP. */
  enterGuestUnminted: (lastErrorCode?: ApiError["code"]) => void;

  /** SCALE-INGRESS.md section 2. True once the background remint loop has
   * spent its whole attempt budget without minting a session. The app stays
   * fully usable on the anon role's public reads; this exists so the UI can
   * say something TRUE ("some features need a connection, tap to retry")
   * instead of a spinner that will never resolve, and so the loop stops
   * hammering a per-IP bucket it is provably losing. */
  guestMintGaveUp: boolean;

  /** User-initiated retry of the guest mint, offered by the degraded banner
   * once `guestMintGaveUp` is true. Restarts the backoff from its shortest
   * interval. A person tapping a button is the one signal worth spending a
   * token on, because it is the one that is not automated amplification. */
  retryGuestMint: () => void;

  /** SCALE-INGRESS.md Gap B. True once the background profile retry loop has
   * spent its budget on a signed-in user whose `getMe()` keeps failing. The
   * user is already inside the app by then (they are never held on a wall);
   * this only drives the banner's copy and its manual retry. */
  meGaveUp: boolean;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: "loading",
  session: null,
  me: null,
  meLoading: false,
  meError: null,
  hydrated: false,
  guestMintGaveUp: false,
  meGaveUp: false,

  needsOnboarding: () => {
    const { me } = get();
    return me != null && !me.city;
  },

  refreshMe: async () => {
    // Stale-refresh guard (same shape as the search requestSeq guard from
    // BUG-001). Stamp this in-flight refresh with the user id it was started
    // for and a monotonic token; if the session changes underneath it before
    // getMe resolves (a different account signs in, or the user signs out),
    // the result is discarded so `me` never belongs to a different user than
    // the current session.
    const token = ++meRefreshToken;
    const startedForUserId = get().session?.user.id ?? null;
    set({ meLoading: true, meError: null });
    try {
      const me = await profile.getMe();
      if (token !== meRefreshToken) return; // a newer refresh superseded this one
      const currentUserId = get().session?.user.id ?? null;
      if (currentUserId !== startedForUserId) return; // session changed underneath
      if (me && me.id !== currentUserId) return; // fetched row is not this session's user
      set({ me, meLoading: false, meGaveUp: false });
      resetProfileRetry();
    } catch (error) {
      if (token !== meRefreshToken) return;
      const currentUserId = get().session?.user.id ?? null;
      if (currentUserId !== startedForUserId) return;
      set({ meError: error as ApiError, meLoading: false });
      // SCALE-INGRESS.md Gap B. getMe() is FIVE network calls (one GoTrue
      // /auth/v1/user plus four PostgREST reads) and it throws on three of
      // them, so at 10,000 returning users a 1% transient error rate is 100
      // people who used to be pinned to a full screen wall. They now enter
      // the app on whatever is cached and this retries quietly behind them.
      if (get().me == null) scheduleProfileRetry();
    }
  },

  continueAsGuest: async () => {
    // auth.continueAsGuest retries signInAnonymously with backoff before
    // surfacing failure (packages/api hooks). onAuthStateChange picks up the
    // resulting session and sets status.
    await auth.continueAsGuest();
  },

  signOut: async () => {
    await auth.signOut();
    set({ me: null });
  },

  enterGuestUnminted: (lastErrorCode?: ApiError["code"]) => {
    const alreadyUnminted = get().status === "guest_unminted";
    set({ status: "guest_unminted", hydrated: true });
    // A fresh cycle (not already unminted, e.g. a NEW mint attempt after a
    // prior one eventually succeeded and the user later signed out) starts
    // the backoff over from its shortest interval rather than continuing
    // from wherever a stale prior loop left off.
    if (!alreadyUnminted) resetBackgroundRemint();
    scheduleBackgroundRemint(lastErrorCode);
  },

  retryGuestMint: () => {
    if (get().status !== "guest_unminted") return;
    resetBackgroundRemint();
    scheduleBackgroundRemint();
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

/** Monotonic stamp for the in-flight `refreshMe`. Every call bumps it; a
 * refresh whose stamp is stale by the time getMe resolves is ignored, so a
 * session change never lets an older user's profile land on the new session. */
let meRefreshToken = 0;

// ---------------------------------------------------------------------------
// P0-4 background guest remint (Phase 3 LAUNCH, 1000-user readiness).
//
// continueAsGuest already retries signInAnonymously 3 times with a short
// linear backoff (packages/api useAuth); by the time enterGuestUnminted
// fires, that quick path is exhausted (a 429 from the anon rate limit, or a
// real outage). Rather than give up, this keeps trying in the background
// with a SLOWER jittered exponential backoff (2s doubling to a 60s cap, +/-
// 30% jitter so many devices retrying at once do not resync onto the same
// tick), for as long as the app stays on "guest_unminted". The moment
// signInAnonymously succeeds, Supabase's own onAuthStateChange listener
// (startSessionListener, applySession below) picks up the new session and
// moves status straight to "guest": no polling of status needed here beyond
// the guard that stops the loop once something else already changed it
// (a real sign in, or the loop's own success).
//
// This is pure client retry logic. It touches no RLS policy and no storage
// bucket ACL: whatever renders while unminted is exactly what the `anon`
// role already reads, per the phase plan's decision 3 (P0-4 sessionless
// path is client degradation ONLY).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SCALE-INGRESS.md section 2 correction. As originally written this loop had
// NO attempt ceiling and NO give-up state, and every tick called
// `auth.continueAsGuest()`, which was itself 3 requests. Measured amplification
// was 192 requests per hour per failing device against 1 for a healthy one,
// forever.
//
// That is worse than wasteful, it is actively contagious. The GoTrue anon
// bucket is per EGRESS IP: capacity 30, refill 1 token per 120 s. Behind one
// carrier NAT, N already-failed devices firing 3 requests a minute each
// contend with every brand-new user for that single token, so a new arrival's
// chance of winning it is roughly 1/(6N+1). Ten failed devices turn a 2 minute
// per-IP outage into an expected ~2 hour wait for everyone behind that IP.
// Jitter does not help: it desynchronises devices, and a token bucket measures
// only the aggregate arrival RATE, which jitter leaves untouched.
//
// Three changes, all of which reduce the arrival rate rather than reshuffling
// it:
//   1. A hard attempt ceiling. The loop stops.
//   2. A 15 minute backoff cap instead of 60 seconds.
//   3. A RATE_LIMITED floor of 120 s, the bucket's own refill interval. A
//      retry sooner than that cannot possibly find a token.
//
// Worst case per device is now 33 requests spread over ~32 minutes and then
// silence, against 192 per hour forever. On the rate limited path (where
// continueAsGuest no longer burns 3 requests per call, see packages/api) it is
// 11 requests, none closer together than 2 minutes.
// ---------------------------------------------------------------------------

/** Ticks before the loop gives up and says so. */
const MAX_REMINT_ATTEMPTS = 10;
/** Backoff ceiling. 60 s was far too tight against a bucket that refills
 * every 120 s: it guaranteed at least two doomed attempts per token. */
const REMINT_BACKOFF_CAP_MS = 15 * 60_000;
/** GoTrue's documented anon bucket refills 1 token per 120 s per IP. Never
 * retry a refusal faster than the resource can possibly recover. */
const RATE_LIMITED_FLOOR_MS = 120_000;

let remintTimer: ReturnType<typeof setTimeout> | null = null;
let remintAttempt = 0;

function resetBackgroundRemint(): void {
  if (remintTimer) clearTimeout(remintTimer);
  remintTimer = null;
  remintAttempt = 0;
  useSessionStore.setState({ guestMintGaveUp: false });
}

function scheduleBackgroundRemint(lastErrorCode?: ApiError["code"]): void {
  if (remintTimer) return; // a retry is already pending

  if (remintAttempt >= MAX_REMINT_ATTEMPTS) {
    // Give up, and say so. The app stays entirely usable: status remains
    // "guest_unminted", so every public browse surface still renders on the
    // anon role exactly as before. What stops is the request storm, and what
    // starts is a banner offering a manual retry, which is the one retry
    // signal that is a person rather than a timer.
    useSessionStore.setState({ guestMintGaveUp: true });
    return;
  }

  remintAttempt += 1;
  let base = Math.min(REMINT_BACKOFF_CAP_MS, 2_000 * 2 ** (remintAttempt - 1));
  if (lastErrorCode === "RATE_LIMITED") base = Math.max(base, RATE_LIMITED_FLOOR_MS);
  const jitter = base * (0.7 + Math.random() * 0.6);

  remintTimer = setTimeout(() => {
    remintTimer = null;
    if (useSessionStore.getState().status !== "guest_unminted") {
      // Something else already resolved this (a real sign in, a manual
      // sign out, or a previous tick's own success); stop the loop.
      remintAttempt = 0;
      return;
    }
    auth.continueAsGuest().catch((error: unknown) => {
      scheduleBackgroundRemint((error as ApiError | undefined)?.code);
    });
    // On success, onAuthStateChange's applySession call sets status to
    // "guest" before this promise's .then would even run, so there is
    // nothing to do here on the happy path; remintAttempt resets the next
    // time enterGuestUnminted starts a fresh loop from status "signed_out".
  }, jitter);
}

// ---------------------------------------------------------------------------
// SCALE-INGRESS.md Gap B: the signed-in profile retry.
//
// Same shape as the guest remint above and for the same reason: a returning
// signed-in user whose getMe() failed is now let into the app rather than held
// on a wall, so something has to keep trying behind them. It carries the same
// ceiling and the same cap, because a signed-in user hitting a saturated
// PostgREST pool is exactly as capable of amplifying the outage as a guest is.
// ---------------------------------------------------------------------------

const MAX_PROFILE_RETRIES = 6;
const PROFILE_BACKOFF_CAP_MS = 5 * 60_000;

let profileTimer: ReturnType<typeof setTimeout> | null = null;
let profileAttempt = 0;

function resetProfileRetry(): void {
  if (profileTimer) clearTimeout(profileTimer);
  profileTimer = null;
  profileAttempt = 0;
}

function scheduleProfileRetry(): void {
  if (profileTimer) return;

  if (profileAttempt >= MAX_PROFILE_RETRIES) {
    useSessionStore.setState({ meGaveUp: true });
    return;
  }

  profileAttempt += 1;
  const base = Math.min(PROFILE_BACKOFF_CAP_MS, 3_000 * 2 ** (profileAttempt - 1));
  const jitter = base * (0.7 + Math.random() * 0.6);

  profileTimer = setTimeout(() => {
    profileTimer = null;
    const state = useSessionStore.getState();
    // Signed out, or the profile arrived some other way: nothing left to do.
    if (state.status !== "signed_in" || state.me != null) {
      profileAttempt = 0;
      return;
    }
    void state.refreshMe(); // its own catch re-arms this loop on failure
  }, jitter);
}

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

  if (session) {
    // A session exists, by whatever route (the remint loop finally won, a
    // real sign in, a token refresh). Both degraded banners are stale now,
    // and the remint loop has nothing left to chase.
    resetBackgroundRemint();
  }

  if (status === "signed_in") {
    // Clear the previous user's profile BEFORE the async refresh so a new
    // login never renders the prior account's role (the "new account
    // auto-tagged coach" bug). If the same user's session just refreshed
    // (token refresh), keep `me` to avoid a needless loading flash; only a
    // different user id wipes it.
    const prevMe = useSessionStore.getState().me;
    if (!prevMe || prevMe.id !== session!.user.id) {
      useSessionStore.setState({ me: null, meLoading: true, meError: null });
    }
    resetProfileRetry();
    useSessionStore.setState({ meGaveUp: false });
    void useSessionStore.getState().refreshMe();
  } else {
    resetProfileRetry();
    useSessionStore.setState({ me: null, meLoading: false, meError: null, meGaveUp: false });
  }
}
