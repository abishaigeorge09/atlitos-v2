import type { AtlitosClient } from "./client";

/**
 * Domain hooks placeholder. Each domain below wraps the v1
 * `services/api.ts` function of the same name in a typed hook that calls
 * the v2 lane recorded in docs/architecture/API-MAPPING.md (PostgREST, RPC,
 * Edge Function, or Supabase Auth). Screens never change when a mock swaps
 * for the real call, only the body of the matching hook here does.
 *
 * P1 fills these in against the identity/auth migrations; every other
 * domain follows once its schema migration lands (see docs/PLAN.md
 * "Schema domains"). Nothing here is called yet, this file only records the
 * shape and the source doc each domain implements against.
 */

// TODO(P1): auth. Supabase Auth lane (signInWithPassword, signUp, signInWithOtp,
// verifyOtp, updateUser, signInAnonymously). See API-MAPPING.md "auth".
export function useAuth(_client: AtlitosClient) {
  throw new Error("useAuth is not implemented yet, see API-MAPPING.md auth");
}

// TODO(P1): profile. PostgREST (getMe, updateMe) + RPC (setupPlayer,
// setupCoach). See API-MAPPING.md "profile".
export function useProfile(_client: AtlitosClient) {
  throw new Error("useProfile is not implemented yet, see API-MAPPING.md profile");
}

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
