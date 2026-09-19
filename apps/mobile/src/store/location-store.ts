import * as Location from 'expo-location';
import { create } from 'zustand';

/**
 * `location-store`: the single source of truth for "where is this athlete
 * right now" that the Courts vertical slice (and, later, Home/AI Search,
 * PRD-01 FR-12) sorts and hydrates distance from. Not built in Phase 1
 * (PHASE-1-STATUS.md's Home tab ships with no location fetching at all
 * yet); this is the first real consumer, scoped to what Courts needs.
 *
 * PRD-01 FR-12: "Location is requested at first Home load or first search,
 * whichever occurs first, with a rationale shown before the OS permission
 * prompt; declining falls back to manual city selection." The Courts index
 * screen is this app's first real "first load" trigger today, so it calls
 * `requestLocation()` once on mount; the rationale copy lives in the
 * screen (a Text row above the permission prompt), not here, this store
 * only holds state and the platform call.
 *
 * Fallback (Track D defect 8): when permission is denied/unavailable, the
 * caller may pass the athlete's own profile city (`me.city`); it becomes the
 * DISPLAY city, with no coordinates faked for it (distance sort simply
 * skips when coords are null). Only when no profile city exists does the
 * store fall back to the fixed Hyderabad city AND coords, matching the v1
 * fixture data's "all Hyderabad-based" seed (SPEC.md section 6's Seed data
 * note) so distance sorting has something real to compute against. The
 * profile city arrives as a call-site argument (courts/index.tsx reads it
 * from session-store) rather than this store importing session-store, to
 * keep the stores cycle-free.
 */

export type LocationStatus =
  | 'idle'
  | 'loading'
  | 'granted'
  | 'denied'
  | 'unavailable'
  /** The athlete named their own city after a denial or a timeout. Distinct
   * from `granted` because there are no coordinates behind it, and distinct
   * from `denied` because there is nothing left for the user to fix. */
  | 'manual';

export interface Coordinates {
  lat: number;
  lng: number;
}

const FALLBACK_CITY = 'Hyderabad';
const FALLBACK_COORDS: Coordinates = { lat: 17.385, lng: 78.4867 };

// ---------------------------------------------------------------------------
// Deadlines. Track 3 finding: Courts showed "Finding your location..." forever
// on a simulator, in both themes. It never resolved and it never failed.
//
// ROOT CAUSE, and it is NOT the HTTP one. `packages/api/src/client.ts` already
// wraps every supabase fetch in an AbortController deadline (SCALE-INGRESS Gap
// A). Nothing here goes through fetch: `requestForegroundPermissionsAsync` and
// `getCurrentPositionAsync` are expo-location NATIVE MODULE calls over the
// bridge, and neither takes a timeout. A simulator with no location simulated,
// and a real device indoors with a cold GPS, both leave
// `getCurrentPositionAsync` pending indefinitely: no resolve, no reject. The
// permission call hangs the same way while the OS dialog is on screen and the
// user never answers it. So the store sat in `loading` and the two honest
// terminal states it already had (`denied`, `unavailable`) were unreachable.
//
// Same SHAPE as the fetch bug (an await that never settles bypasses the whole
// degrade path behind it), different mechanism, and therefore a separate fix:
// a fetch level timeout could not have caught this one.
// ---------------------------------------------------------------------------

/** The OS permission dialog. Generous, because this budget is spent waiting on
 * a human reading a prompt, not on a network. Past it we stop claiming to be
 * finding anything and let them choose a city. */
export const LOCATION_PERMISSION_TIMEOUT_MS = 20_000;

/** A single position fix once permission is granted. A cold GPS indoors is
 * routinely slower than this, which is exactly why the terminal state offers a
 * retry rather than pretending the device has no location hardware. */
export const LOCATION_FIX_TIMEOUT_MS = 12_000;

/** Reverse geocode is decoration (the display city name only), so it gets the
 * shortest budget of the three: nothing downstream waits on it. */
export const LOCATION_GEOCODE_TIMEOUT_MS = 6_000;

/** Resolves to `TIMED_OUT` rather than rejecting, so a caller can tell "we
 * stopped waiting" apart from "the platform said no", which are different
 * states with different copy and different ways forward. */
const TIMED_OUT = Symbol('location-timeout');

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface LocationState {
  status: LocationStatus;
  coords: Coordinates | null;
  city: string;
  /** True once `requestLocation` has resolved at least once (granted,
   * denied, or unavailable); lets a screen avoid re-requesting on every
   * mount while still allowing an explicit user-triggered retry. */
  requested: boolean;
  /** False when the OS will no longer show the permission dialog (the athlete
   * denied it and iOS/Android now answer silently). Drives which way forward a
   * screen offers: retrying the prompt is pointless here, opening Settings is
   * not. Meaningless unless `status` is `denied`. */
  canAskAgain: boolean;
  /** True when the terminal state was reached by a DEADLINE rather than by an
   * answer from the platform. Same `unavailable` status, different copy: "we
   * gave up waiting" is retryable in a way that "this device has no location"
   * is not. */
  timedOut: boolean;
  /** `profileCity` is the athlete's own `me.city`, when known; used as the
   * display city on denial/failure instead of pretending they are in
   * Hyderabad. */
  requestLocation: (profileCity?: string | null) => Promise<void>;
  setManualCity: (city: string) => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  status: 'idle',
  coords: null,
  city: FALLBACK_CITY,
  requested: false,
  canAskAgain: true,
  timedOut: false,

  requestLocation: async (profileCity) => {
    if (get().status === 'loading') return;
    // A retry after a manual city keeps that city on screen until the new
    // attempt produces something better, rather than flashing back to the
    // Hyderabad default.
    set({ status: 'loading', timedOut: false });

    // Denial/failure fallback: a real profile city is shown as itself with
    // NO coordinates (never fake coords for a city we do not know); the
    // Hyderabad coords remain only for the fully unknown case.
    const fallBack = (status: LocationStatus, options?: { canAskAgain?: boolean; timedOut?: boolean }) => {
      const flags = {
        requested: true,
        canAskAgain: options?.canAskAgain ?? true,
        timedOut: options?.timedOut ?? false,
      };
      if (profileCity) {
        set({ status, coords: null, city: profileCity, ...flags });
      } else {
        set({ status, coords: FALLBACK_COORDS, city: FALLBACK_CITY, ...flags });
      }
    };

    try {
      // Deadline 1: the OS dialog. Unanswered, this call never settles.
      const permission = await withDeadline(
        Location.requestForegroundPermissionsAsync(),
        LOCATION_PERMISSION_TIMEOUT_MS,
      );
      if (permission === TIMED_OUT) {
        fallBack('unavailable', { timedOut: true });
        return;
      }
      if (permission.status !== 'granted') {
        // `canAskAgain` false means the OS will not show the dialog again, so
        // "Try again" is a dead button and Settings is the only way forward.
        fallBack('denied', { canAskAgain: permission.canAskAgain });
        return;
      }

      // Deadline 2: the position fix. This is the one that hung on the
      // simulator: permission granted, no location simulated, pending forever.
      const position = await withDeadline(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        LOCATION_FIX_TIMEOUT_MS,
      );
      if (position === TIMED_OUT) {
        fallBack('unavailable', { timedOut: true });
        return;
      }
      const coords: Coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };

      // Reverse geocode is best-effort, a failure OR a hang here still leaves
      // real coordinates for distance sorting, only the display city name
      // falls back.
      let city = get().city;
      try {
        const places = await withDeadline(
          Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng }),
          LOCATION_GEOCODE_TIMEOUT_MS,
        );
        if (places !== TIMED_OUT) {
          const [place] = places;
          city = place?.city ?? place?.subregion ?? city;
        }
      } catch {
        // Reverse geocode unavailable (offline, unsupported on web in some
        // browsers); coordinates are still good, keep the previous city.
      }

      set({ status: 'granted', coords, city, requested: true, canAskAgain: true, timedOut: false });
    } catch {
      fallBack('unavailable');
    }
  },

  // A named city is a city, not a position: any coordinates still held are
  // from somewhere else, and keeping them would sort distances from a place
  // the athlete just told us they are not in.
  setManualCity: (city: string) =>
    set({ status: 'manual', city, coords: null, requested: true, timedOut: false }),
}));
