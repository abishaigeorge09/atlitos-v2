// ATLITOS v2 — supabase/functions/admin-order-advance/index.ts
//
// POST { order_id, to_status, note?, location? } with an ADMIN's own JWT.
// Epic P4, story AT-82. Requirements: PRD-04 FR-22, FR-23, FR-26;
// PHASE-4-STATUS.md gate clause 2.
//
// This function exists because advancing an order is TWO writes that must not
// be able to diverge, and neither of them can be done by a client:
//
//   1. `order_transition` (0035, AT-69) moves `orders.status` and writes the
//      `order_timeline` row in one transaction. It is granted to
//      `service_role` ONLY, so no client can reach it, by grant and not by
//      convention. Its header names this function as the intended caller.
//   2. One `audit_log` row. `audit_log` carries no authenticated write policy
//      and no write grant at all (0003_moderation_audit.sql), so a client
//      could not write it even if it could reach the RPC.
//
// That is the AT-61 rule from PAYMENTS.md applied to orders: if a transition
// has a consequence that is not written inside the same function, the
// transition does not belong to `authenticated`. A bare RPC call would advance
// the parcel and leave the admin action unaudited, which is the whole point of
// the action being audited.
//
// PRD-04 FR-26 ("no order status field is ever mutated by a direct client side
// table update from apps/admin") therefore holds by construction: 0032 grants
// apps/admin SELECT on orders and nothing else, so the admin UI physically
// cannot write a status even if someone tried.
//
// ============================================================================
// WHAT THIS FUNCTION DOES NOT DO: CANCEL
//
// 0035's machine allows `placed -> cancelled`, and this function refuses it
// with CANCEL_NOT_AVAILABLE rather than relaying it. A cancelled order that
// was paid for owes the shopper their money back, and `admin-order-refund` is
// explicitly NOT a P4 story (PHASE-4-STATUS.md open question 5, PRD-07
// section 8). Relaying a cancel today would perform half a money event and
// drop the other half, which is precisely the hole AT-61 closed for sessions.
// When the refund path lands, this branch is what should be opened, together
// with the refund call, not before it.
//
// The forward edges (placed -> shipped -> in_transit -> delivered) have no
// money consequence at all, which is why they are safe to drive from here.
//
// ============================================================================
// THE SKIP IS REJECTED BY THE DATABASE, NOT BY THIS FILE
//
// There is deliberately NO client-side or edge-side "is this the next status"
// check. `order_transition` owns the machine and raises
// `INVALID_TRANSITION: order <id> cannot move from placed to delivered`, which
// `appErrorFromPostgrestMessage` maps back to a 409 with code
// INVALID_TRANSITION. Re-implementing the machine here would give it a second
// definition that could drift from the first, and would mean the rejection
// under test was this file's opinion rather than the database's guarantee.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";

/** The forward lifecycle this function is allowed to drive (PRD-04 FR-22). */
const ADVANCEABLE_STATUSES = ["shipped", "in_transit", "delivered"] as const;
type AdvanceableStatus = (typeof ADVANCEABLE_STATUSES)[number];

interface AdvanceBody {
  order_id?: string;
  to_status?: string;
  note?: string | null;
  location?: string | null;
}

/**
 * Validates the caller's bearer token against GoTrue, then confirms they hold
 * the admin role by reading `user_roles` THROUGH THE CALLER'S OWN JWT
 * (`user_roles_select_own`, 0001_identity.sql, lets any authenticated user
 * read their own rows). This is the same check `apps/admin`'s authProvider
 * makes at login, so the edge function and the app agree on who is an admin.
 *
 * NOT `data.user.app_metadata.roles`, which is the obvious thing to reach for
 * and is WRONG HERE. `has_role()` in SQL reads
 * `auth.jwt() -> 'app_metadata' -> 'roles'`, a claim that
 * `custom_access_token_hook` mints into the ACCESS TOKEN at sign in. GoTrue's
 * `getUser()` returns the stored `raw_app_meta_data` row instead, which is
 * only `{provider, providers}` and never carries `roles`. Verified against
 * this project: the signed token's claim is `["player","admin"]` while
 * `/auth/v1/user` reports no roles at all for the same account. An
 * app_metadata check here would therefore have refused every legitimate admin
 * with FORBIDDEN while looking perfectly correct in review.
 *
 * The service-role client used below cannot answer this question either: it
 * has no `auth.uid()`, so `has_role()` evaluates false under it.
 */
async function requireAdmin(req: Request): Promise<string> {
  const userClient = userScopedClient(req);

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new AppError("UNAUTHENTICATED", "Invalid or expired session.", 401);
  }

  // Explicitly scoped by user_id as well as role, per CLAUDE.md: RLS is a
  // floor, not the scoping mechanism.
  const { data: roleRow, error: roleError } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError || !roleRow) {
    throw new AppError("FORBIDDEN", "Admin role required.", 403);
  }

  return data.user.id;
}

Deno.serve((req) =>
  withErrorHandling(req, async (req) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
      throw new AppError("VALIDATION", "Use POST.", 405);
    }

    const actorId = await requireAdmin(req);

    let body: AdvanceBody;
    try {
      body = await req.json();
    } catch {
      throw new AppError("VALIDATION", "Request body must be JSON.", 400);
    }

    const orderId = body.order_id?.trim();
    if (!orderId) {
      throw new AppError("VALIDATION", "order_id is required.", 400);
    }

    const toStatus = body.to_status?.trim();
    if (!toStatus) {
      throw new AppError("VALIDATION", "to_status is required.", 400);
    }

    if (toStatus === "cancelled") {
      // See the CANCEL block in the header.
      throw new AppError(
        "CANCEL_NOT_AVAILABLE",
        "Cancelling an order needs the refund path, which is not built yet.",
        409,
      );
    }

    if (!ADVANCEABLE_STATUSES.includes(toStatus as AdvanceableStatus)) {
      throw new AppError(
        "VALIDATION",
        `to_status must be one of ${ADVANCEABLE_STATUSES.join(", ")}.`,
        400,
      );
    }

    // PRD-04 FR-23: a location or a note is required. Enforced server side
    // and not only in the form, because "requires" has to be true of the API.
    const note = body.note?.trim() || null;
    const location = body.location?.trim() || null;
    if (!note && !location) {
      throw new AppError(
        "VALIDATION",
        "A location or a note is required to advance an order.",
        400,
      );
    }

    const supabase = serviceRoleClient();

    // 1. The transition. This writes the order_timeline row too, in the same
    //    transaction, and raises INVALID_TRANSITION on any skip or backward
    //    move. Nothing here second-guesses it.
    const { data: order, error: transitionError } = await supabase.rpc(
      "order_transition",
      {
        p_order_id: orderId,
        p_to_status: toStatus,
        p_actor_id: actorId,
        p_note: note,
        p_location: location,
      },
    );

    if (transitionError) {
      throw appErrorFromPostgrestMessage(transitionError.message);
    }
    if (!order) {
      throw new AppError("NOT_FOUND", `Order ${orderId} does not exist.`, 404);
    }

    const advanced = order as { id: string; status: string; order_number: string };

    // 2. Exactly one audit_log row (PRD-04 FR-23, FR-53). Written after the
    //    transition succeeded, so a rejected advance leaves no audit row
    //    claiming something happened.
    const { error: auditError } = await supabase.from("audit_log").insert({
      actor_id: actorId,
      action: "order.advance",
      entity_type: "order",
      entity_id: advanced.id,
      before: { status: toStatusPrevious(toStatus) },
      after: { status: advanced.status },
      note: [location, note].filter(Boolean).join(", ") || null,
    });

    if (auditError) {
      throw new AppError(
        "INTERNAL",
        `Order ${advanced.id} advanced but the audit row failed: ${auditError.message}`,
        500,
      );
    }

    return jsonResponse({
      order_id: advanced.id,
      order_number: advanced.order_number,
      status: advanced.status,
    });
  })
);

/**
 * The status an order must have been in for `to` to have been accepted. Safe
 * to derive rather than re-read: `order_transition` has already proven the
 * edge was legal, and each of these three targets has exactly one predecessor
 * in the machine, so there is no ambiguity to resolve.
 */
function toStatusPrevious(to: string): string {
  if (to === "shipped") return "placed";
  if (to === "in_transit") return "shipped";
  return "in_transit";
}
