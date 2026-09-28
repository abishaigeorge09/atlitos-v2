// ATLITOS v2 - supabase/functions/apple-token-store/index.ts
//
// POST { authorization_code } with the caller's own JWT, right after a native
// Sign in with Apple. Exchanges the one time code for an Apple refresh token
// and stores it in apple_sign_in_tokens (0139), so delete-account can revoke
// it later (Guideline 5.1.1(v)). Launch runbook 3.4.
//
// The code is short lived and single use, so the app calls this once per
// sign in and never retries with the same code. A later sign in replaces the
// stored token with the newer one.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient } from "../_shared/supabase.ts";
import { exchangeAppleAuthorizationCode } from "../_shared/apple.ts";

Deno.serve((req) =>
  withErrorHandling(req, async (req) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
      throw new AppError("VALIDATION", "Use POST.", 405);
    }

    const body = (await req.json().catch(() => null)) as { authorization_code?: unknown } | null;
    const code = typeof body?.authorization_code === "string" ? body.authorization_code.trim() : "";
    if (!code || code.length > 2048) {
      throw new AppError("VALIDATION", "authorization_code is required.", 400);
    }

    const user = await getAuthenticatedUser(req);
    const admin = serviceRoleClient();

    // Only an account that actually signed in with Apple has anything to
    // revoke. Checked against GoTrue's own identity list, not the client's word.
    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(user.id);
    if (authUserError || !authUser.user) {
      throw new AppError("INTERNAL", "Could not load the account.", 500);
    }
    const hasApple = (authUser.user.identities ?? []).some((identity) => identity.provider === "apple");
    if (!hasApple) {
      throw new AppError("FORBIDDEN", "This account did not sign in with Apple.", 403);
    }

    let refreshToken: string;
    try {
      refreshToken = await exchangeAppleAuthorizationCode(code);
    } catch (err) {
      throw new AppError("VALIDATION", err instanceof Error ? err.message : "Apple token exchange failed.", 400);
    }

    const { error: upsertError } = await admin
      .from("apple_sign_in_tokens")
      .upsert(
        { user_id: user.id, refresh_token: refreshToken, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (upsertError) {
      throw new AppError("INTERNAL", `Failed to store the Apple token: ${upsertError.message}`, 500);
    }

    return jsonResponse({ stored: true });
  })
);
