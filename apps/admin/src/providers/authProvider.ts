import type { AuthProvider } from "@refinedev/core";

import { supabaseClient } from "./supabaseClient";

// TODO(P1): wire real Supabase auth (session check, admin role gate via
// identity/roles migration, redirect to a proper sign in screen). This stub
// only satisfies the Refine AuthProvider contract so the shell renders and
// routes without crashing.
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

    return {
      success: true,
      redirectTo: "/",
    };
  },
  logout: async () => {
    await supabaseClient.auth.signOut();
    return {
      success: true,
      redirectTo: "/",
    };
  },
  check: async () => {
    const { data } = await supabaseClient.auth.getSession();

    if (data?.session) {
      return { authenticated: true };
    }

    return {
      authenticated: false,
      redirectTo: "/",
      logout: true,
    };
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
