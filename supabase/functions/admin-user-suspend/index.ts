// ATLITOS v2 — supabase/functions/admin-user-suspend/index.ts
//
// POST { user_id, action: "suspend" | "reinstate", reason } with an ADMIN's
// own JWT. LAUNCH Phase 4, Track B. PRD-04 FR-34..FR-38, FR-53.
// PHASE-4-STATUS.md CT-B / decision 3 ("suspension is three legs, not one").
//
// This function exists for exactly one reason SQL cannot cover: leg (a) of
// suspension, a GoTrue ban via `auth.admin.updateUserById`, requires the
// Supabase Auth ADMIN API, which no Postgres RPC can reach. The other two
// legs are NOT duplicated here:
//
//   - leg (b), the row write + one audit_log row, is `admin_suspend_user` /
//     `admin_reinstate_user` (0096), called below through the CALLER'S OWN
//     JWT (`userScopedClient`), never the service role, so `has_role('admin')`
//     and `auth.uid()` inside those RPCs see the real acting admin, exactly
//     the `admin-order-advance` pattern (AT-82) this function copies.
//   - leg (c), the restrictive RLS policies, needs no action here; they are
//     schema, not a runtime call.
//
// ORDER MATTERS: the RPC runs first. If the row write is refused (VALIDATION,
// self-suspend, admin-on-admin, already in that state, not found), this
// function never touches GoTrue. If the RPC succeeds but the GoTrue ban call
// then fails, the row says suspended/active while the ban did not take —
// reported as INTERNAL with the row state already changed rather than
// silently retried, so the caller sees a real error instead of a false
// success. This two-system order is a documented tradeoff, not a bug: undoing
// the row write on a GoTrue failure would need its own compensating
// transaction and this endpoint is not called at a rate where that has come
// up.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";

interface SuspendBody {
  user_id?: string;
  action?: string;
  reason?: string | null;
}

/**
 * Same shape as `admin-order-advance`'s `requireAdmin` (AT-82): validates the
 * bearer token against GoTrue, then confirms the admin role by reading
 * `user_roles` THROUGH THE CALLER'S OWN JWT, never `app_metadata` (that claim
 * is only present on the signed ACCESS TOKEN, not on GoTrue's `getUser()`
 * response — verified wrong once already in this codebase, see that
 * function's header comment).
 */
async function requireAdmin(req: Request): Promise<{ id: string }> {
  const userClient = userScopedClient(req);

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new AppError("UNAUTHENTICATED", "Invalid or expired session.", 401);
  }

  const { data: roleRow, error: roleError } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError || !roleRow) {
    throw new AppError("FORBIDDEN", "Admin role required.", 403);
  }

  return { id: data.user.id };
}

// GoTrue's ban_duration accepts a duration string or "none" to lift a ban.
// There is no "forever" literal, so a suspension bans for 10 years (87600h),
// matching PHASE-4-STATUS.md CT-B verbatim. A reinstate re-runs the same call
// with "none", which is what actually lifts a GoTrue ban (setting it to "0h"
// does not).
const SUSPEND_BAN_DURATION = "87600h";
const REINSTATE_BAN_DURATION = "none";

Deno.serve((req) =>
  withErrorHandling(req, async (req) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
      throw new AppError("VALIDATION", "Use POST.", 405);
    }

    await requireAdmin(req);

    let body: SuspendBody;
    try {
      body = await req.json();
    } catch {
      throw new AppError("VALIDATION", "Request body must be JSON.", 400);
    }

    const userId = body.user_id?.trim();
    if (!userId) {
      throw new AppError("VALIDATION", "user_id is required.", 400);
    }

    const action = body.action;
    if (action !== "suspend" && action !== "reinstate") {
      throw new AppError("VALIDATION", 'action must be "suspend" or "reinstate".', 400);
    }

    if (action === "suspend") {
      const reason = body.reason?.trim();
      if (!reason) {
        throw new AppError("VALIDATION", "A reason is required to suspend a user.", 400);
      }
    }

    // Leg (b): the row write + the one audit_log row, under the CALLER'S own
    // JWT so `has_role('admin')` / `auth.uid()` inside the RPC resolve to the
    // real admin. `userScopedClient`, not `serviceRoleClient`, deliberately.
    const callerClient = userScopedClient(req);
    const rpcName = action === "suspend" ? "admin_suspend_user" : "admin_reinstate_user";

    const { data: userRow, error: rpcError } = await callerClient.rpc(rpcName, {
      p_user_id: userId,
      p_reason: body.reason?.trim() || null,
    });

    if (rpcError) {
      throw appErrorFromPostgrestMessage(rpcError.message);
    }
    if (!userRow) {
      throw new AppError("NOT_FOUND", `User ${userId} does not exist.`, 404);
    }

    const updated = userRow as { id: string; status: string };

    // Leg (a): the GoTrue ban. Service role required; no client JWT can call
    // the Auth admin API.
    const admin = serviceRoleClient();
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: action === "suspend" ? SUSPEND_BAN_DURATION : REINSTATE_BAN_DURATION,
    });

    if (banError) {
      throw new AppError(
        "INTERNAL",
        `User ${userId} row is now "${updated.status}" but the GoTrue ban update failed: ${banError.message}. The row and the auth ban are now out of sync; retry this action or fix the ban directly.`,
        500,
      );
    }

    return jsonResponse({
      user_id: updated.id,
      status: updated.status,
    });
  })
);
