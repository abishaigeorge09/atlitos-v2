import type { AuthProvider } from "@refinedev/core";

import { supabaseClient } from "./supabaseClient";

// PRD-04 FR-1/FR-2/FR-3: only a user holding the admin role in user_roles
// may sign in to apps/admin, every read/write is scoped by the signed in
// admin's own JWT (no service role key in this bundle, see
// supabaseClient.ts), and a revoked role signs the admin out on their next
// check. The JWT's app_metadata.roles claim is minted at sign in by
// custom_access_token_hook (RLS.md), but this provider re-verifies against
// the user_roles table directly on every login and every check rather than
// trusting the cached JWT claim, per the task brief ("after login check
// has_role admin via user_roles select"). user_roles_select_own (0001_identity.sql)
// lets any authenticated user read their own rows, admin or not, so this
// query succeeds before the admin gate decision is made.
async function hasAdminRole(userId: string): Promise<boolean> {
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) {
    return false;
  }

  return data !== null;
}

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error || !data?.user) {
      return {
        success: false,
        error: {
          name: "LoginError",
          message: error?.message ?? "Sign in failed",
        },
      };
    }

    const isAdmin = await hasAdminRole(data.user.id);

    if (!isAdmin) {
      // The account authenticated fine but does not hold the admin role.
      // Sign out immediately so no session, cached or otherwise, persists
      // for a non-admin account (FR-1: any non-admin credentials are
      // rejected with a generic authentication error at login).
      await supabaseClient.auth.signOut();
      return {
        success: false,
        error: {
          name: "AccessDenied",
          message: "This account does not have admin access.",
        },
      };
    }

    return {
      success: true,
      redirectTo: "/",
    };
  },
  logout: async () => {
    await supabaseClient.auth.signOut();
    return {
      success: true,
      redirectTo: "/login",
    };
  },
  check: async () => {
    const { data } = await supabaseClient.auth.getSession();

    if (!data?.session) {
      return {
        authenticated: false,
        redirectTo: "/login",
        logout: true,
      };
    }

    // FR-3: an admin whose role was revoked fails on their next session
    // refresh/check, not just at the original login.
    const isAdmin = await hasAdminRole(data.session.user.id);

    if (!isAdmin) {
      await supabaseClient.auth.signOut();
      return {
        authenticated: false,
        redirectTo: "/login",
        logout: true,
        error: {
          name: "AccessDenied",
          message: "This account no longer has admin access.",
        },
      };
    }

    return { authenticated: true };
  },
  onError: async (error) => {
    return { error };
  },
  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser();

    if (!data?.user) {
      return null;
    }

    return {
      id: data.user.id,
      name: data.user.email,
    };
  },
};
