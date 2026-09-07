// ATLITOS v2 — supabase/functions/delete-account/index.ts
//
// POST with the member's own JWT, no body. App Store guideline 5.1.1(v):
// an account created in the app must be deletable in the app.
//
// Two steps, in this order, and the order matters:
//
//   1. `delete_my_account()` (0093), called with the member's OWN JWT. The RPC
//      takes no user id and targets auth.uid(), so this function cannot be
//      turned into a delete-anyone weapon even though it holds a service-role
//      client for step 2. That is the whole reason the target is not a
//      parameter. It purges personal data, retains money-bearing rows against
//      an anonymized users row, and stamps `deleted_at`.
//
//   2. Scrub the auth identity under the service role. Step 1 cannot reach
//      `auth.users`, so without this the member's email and phone would
//      survive a deletion request, which is the personal data the request was
//      about. The address is randomized rather than nulled because GoTrue
//      requires uniqueness, not absence, and randomizing frees the real
//      address for a future signup. `ban_duration` is belt and braces: 0093's
//      token hook already refuses this account, and the ban makes it refuse at
//      the GoTrue layer too, before any hook runs.
//
// Step 2 failing after step 1 succeeded leaves an account that is deleted
// everywhere the member can observe (no access, no personal data) but whose
// auth row still holds an email. That is reported as a 500 so it is visible,
// and it is safe to retry: step 1 is idempotent by design.
//
// Deliberately NOT deleting the auth.users row. `public.users.id` references
// it `on delete cascade`, and `orders.user_id` has no on-delete action at all,
// so the delete would either fail outright for any member who has ordered, or
// cascade away `payment_intents` and orphan every `ledger_entries` row that
// referenced them. See 0093's header for the full reasoning.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
  userScopedClient,
} from "../_shared/supabase.ts";

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    // Resolves identity AND refuses an already-deleted or suspended account.
    const user = await getAuthenticatedUser(request);

    // Step 1, as the member. Never as the service role: the RPC's
    // authorization IS auth.uid(), so a service-role call would target nobody.
    const { error: rpcError } = await userScopedClient(request).rpc(
      "delete_my_account",
    );
    if (rpcError) {
      throw new AppError(
        "INTERNAL",
        `Account deletion failed: ${rpcError.message}`,
        500,
      );
    }

    // Step 2, service role, because auth.users is out of reach of a user JWT.
    const { error: authError } = await serviceRoleClient().auth.admin
      .updateUserById(user.id, {
        email: `deleted+${user.id}@deleted.atlitos.invalid`,
        user_metadata: {},
        ban_duration: "876000h", // 100 years, GoTrue has no "forever"
      });
    if (authError) {
      throw new AppError(
        "INTERNAL",
        `Account data was removed but the sign-in identity was not scrubbed: ${authError.message}`,
        500,
      );
    }

    return jsonResponse({ deleted: true });
  }));
