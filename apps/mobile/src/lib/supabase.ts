import "react-native-url-polyfill/auto";

import { createAtlitosClient } from "@atlitos/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

// EXPO_PUBLIC_ prefixed vars are inlined at build time by Expo; process.env
// works in both the Metro dev server and a native/web export.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly in dev rather than silently no-op-ing every Supabase call;
  // apps/mobile/.env must define both, per docs/phases/PHASE-1-SPIKE.md's
  // handoff.
  console.warn(
    "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are missing. Check apps/mobile/.env.",
  );
}

// This app's web target builds with `web.output: "static"` (app.json),
// which loads every route's module graph once in a Node SSR pass with no
// `window` (there is no browser and no native RN runtime, RN's own
// `setUpGlobals.js` is what defines `global.window` on-device). The real
// `AsyncStorage`'s web adapter reads `window.localStorage` unconditionally
// and throws a raw `ReferenceError` during that pass, which crashes the
// export before a single page renders. React Native's `setUpGlobals.js`
// runs before any app code on both native and a real browser, so
// `typeof window !== "undefined"` reliably tells "real runtime" apart from
// "Node SSR pass" here, unlike `Platform.OS`, which is `"web"` in both.
const isServerRenderPass = typeof window === "undefined";

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

/**
 * The one Supabase client instance for the whole app. Every screen reaches
 * Supabase through this (directly for reads/writes the app hooks below don't
 * yet cover, and through `@atlitos/api`'s `useAuth`/`useProfile` for
 * everything the P1 domain hooks own), never a second `createClient` call.
 * AsyncStorage is the session persistence adapter React Native needs (the
 * browser's default localStorage adapter does not exist on native); the
 * no-op fallback only ever activates during the Node SSR export pass above,
 * where nothing reads the client's session back before the process exits.
 */
export const supabase = createAtlitosClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: isServerRenderPass ? noopStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Supabase's token auto-refresh timer only ticks while something calls
// `startAutoRefresh`/`stopAutoRefresh` in step with the app's foreground
// state; without this, a session can silently fail to refresh while the app
// is backgrounded. This is the official RN recipe from Supabase's docs.
// Skipped during the Node SSR export pass (see `isServerRenderPass` above);
// `AppState` has no listeners to notify there and nothing to keep alive.
if (!isServerRenderPass) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
