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
//
// The code is bound to the caller: Apple's /auth/token reply carries an
// id_token whose `sub` is the Apple user the code was issued to, and it must
// equal the caller's own Apple identity (auth.identities, provider 'apple').
// Otherwise one account could park another person's Apple token on itself.
//
// Errors: 500 APPLE_NOT_CONFIGURED when APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID or
// APPLE_SIGNIN_PRIVATE_KEY is unset; 403 FORBIDDEN when the account has no
// Apple identity or the code belongs to a different Apple user; 400
// VALIDATION when Apple refuses the code.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient } from "../_shared/supabase.ts";
import { AppleRequestError, appleConfigured, exchangeAppleAuthorizationCode } from "../_shared/apple.ts";

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

    if (!appleConfigured()) {
      throw new AppError("APPLE_NOT_CONFIGURED", "Sign in with Apple is not configured on the server.", 500);
    }

    // Only an account that actually signed in with Apple has anything to
    // revoke. Checked against GoTrue's own identity list, not the client's word.
    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(user.id);
    if (authUserError || !authUser.user) {
      throw new AppError("INTERNAL", "Could not load the account.", 500);
    }
    // GoTrue serialises an identity's provider_id as `id`; identity_data.sub
    // carries the same Apple user id and is the fallback.
    const appleSubjects = new Set<string>();
    for (const identity of authUser.user.identities ?? []) {
      if (identity.provider !== "apple") continue;
      const providerId = (identity as { id?: unknown }).id;
      const dataSub = (identity.identity_data as { sub?: unknown } | undefined)?.sub;
      if (typeof providerId === "string" && providerId) appleSubjects.add(providerId);
      if (typeof dataSub === "string" && dataSub) appleSubjects.add(dataSub);
    }
    if (appleSubjects.size === 0) {
      throw new AppError("FORBIDDEN", "This account did not sign in with Apple.", 403);
    }

    let exchange: Awaited<ReturnType<typeof exchangeAppleAuthorizationCode>>;
    try {
      exchange = await exchangeAppleAuthorizationCode(code);
    } catch (err) {
      if (err instanceof AppleRequestError) {
        console.error(`apple-token-store: ${err.message}`);
        throw new AppError("VALIDATION", "Apple refused the sign in code.", 400);
      }
      throw err;
    }

    // Bind the code to the caller. Nothing is stored on a mismatch.
    if (!exchange.subject || !appleSubjects.has(exchange.subject)) {
      throw new AppError("FORBIDDEN", "This sign in code belongs to a different Apple account.", 403);
    }
    const refreshToken = exchange.refreshToken;

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
