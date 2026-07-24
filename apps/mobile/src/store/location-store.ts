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

export type LocationStatus = 'idle' | 'loading' | 'granted' | 'denied' | 'unavailable';

export interface Coordinates {
  lat: number;
  lng: number;
}

const FALLBACK_CITY = 'Hyderabad';
const FALLBACK_COORDS: Coordinates = { lat: 17.385, lng: 78.4867 };

interface LocationState {
  status: LocationStatus;
  coords: Coordinates | null;
  city: string;
  /** True once `requestLocation` has resolved at least once (granted,
   * denied, or unavailable); lets a screen avoid re-requesting on every
   * mount while still allowing an explicit user-triggered retry. */
  requested: boolean;
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

  requestLocation: async (profileCity) => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });

    // Denial/failure fallback: a real profile city is shown as itself with
    // NO coordinates (never fake coords for a city we do not know); the
    // Hyderabad coords remain only for the fully unknown case.
    const fallBack = (status: LocationStatus) => {
      if (profileCity) {
        set({ status, coords: null, city: profileCity, requested: true });
      } else {
        set({ status, coords: FALLBACK_COORDS, city: FALLBACK_CITY, requested: true });
      }
    };

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        fallBack('denied');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords: Coordinates = { lat: position.coords.latitude, lng: position.coords.longitude };

      // Reverse geocode is best-effort, a failure here still leaves real
      // coordinates for distance sorting, only the display city name falls
      // back.
      let city = get().city;
      try {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: coords.lat,
          longitude: coords.lng,
        });
        city = place?.city ?? place?.subregion ?? city;
      } catch {
        // Reverse geocode unavailable (offline, unsupported on web in some
        // browsers); coordinates are still good, keep the previous city.
      }

      set({ status: 'granted', coords, city, requested: true });
    } catch {
      fallBack('unavailable');
    }
  },

  setManualCity: (city: string) => set({ city }),
}));
