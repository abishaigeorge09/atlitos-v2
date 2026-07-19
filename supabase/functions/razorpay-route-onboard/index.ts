// ATLITOS v2 — supabase/functions/razorpay-route-onboard/index.ts
//
// POST { owner_type, venue_id? } with the caller's own JWT. Epic AT-42.
// Implements PRD-02 FR-27 (a coach must have a Route linked account in
// status `active` before Transfer is enabled) and clears the carried-forward
// P2 debt on PRD-03 FR-24 (a partner can view their payout account's
// verification status and re-attempt linking if failed). One function serves
// both `owner_type` values, per PAYMENTS.md's Route section and
// PHASE-3-STATUS.md's note that the court partner side becomes reachable
// through this function even though its portal screens are not in P3 scope.
//
// Flow:
//   1. Validate the caller's own JWT (never a client-supplied user id) and
//      that they actually own the coach profile or venue being onboarded.
//   2. Look up the existing `payout_accounts` row for (owner_type, owner_id).
//   3. If it already carries a `razorpay_account_id`, this call is a POLL,
//      not a create: re-read the linked account and its Route product
//      configuration from Razorpay, sync `status`, return the existing row.
//      Re-invoking never creates a duplicate sub-merchant.
//   4. Otherwise create the linked account, request the `route` product
//      (the call that actually starts KYC), and persist the account id and
//      mapped status.
//   5. Return the hosted onboarding link for the KYC hand-off.
//
// Two invariants this function is the sole guardian of:
//
//   - `payout_accounts` rows are written ONLY here, under the service role.
//     0010_payments_core.sql revokes insert/update/delete on the table from
//     `authenticated` and `anon` outright, so there is no client path to it
//     even by accident; this function is the whole write surface, and
//     CLAUDE.md's financial invariant names `payout_accounts` explicitly.
//   - Status sync on this one path is POLL-based, not webhook-driven. That is
//     PAYMENTS.md's stated, intentional exception to "webhook confirms
//     everything": Route does not emit linked-account status changes in the
//     same event stream as payments, so the client re-invokes this function
//     on return from the hosted flow and step 3 above reconciles. AT-43 owns
//     `transfer.*` webhook handling; nothing here touches webhooks, though
//     `_shared/razorpay.ts`'s `webhookEventId` helper is now in place so that
//     story reads the event id from the x-razorpay-event-id HEADER (the P2
//     lesson) rather than from the body.
//
// Expected blocker: Razorpay Route may not be enabled on the founder's test
// account yet. When it is not, the Razorpay call fails and surfaces as
// `503 ROUTE_UNAVAILABLE` carrying the upstream description verbatim. That
// is deliberately NOT swallowed or stubbed into a fake success: a payout
// account that reports itself onboarded when no sub-merchant exists would be
// a money-bearing lie, and PRD-02 FR-27 gates the Transfer button on exactly
// this status. The row is left at `not_started` and the founder enables Route
// in the dashboard.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import {
  createLinkedAccount,
  fetchLinkedAccount,
  fetchRouteProduct,
  hostedOnboardingUrl,
  mapPayoutAccountStatus,
  type PayoutAccountStatus,
  type RazorpayProductConfiguration,
  requestRouteProduct,
} from "../_shared/razorpay.ts";

type OwnerType = "coach" | "court_partner";

interface RouteOnboardRequestBody {
  owner_type: OwnerType;
  /** Required for court_partner, ignored for coach. */
  venue_id?: string;
}

interface PayoutAccountRow {
  id: string;
  owner_type: string;
  owner_id: string;
  razorpay_account_id: string | null;
  status: PayoutAccountStatus;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequestBody(raw: unknown): RouteOnboardRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  const ownerType = body.owner_type;

  if (ownerType !== "coach" && ownerType !== "court_partner") {
    throw new AppError(
      "VALIDATION",
      "owner_type must be coach or court_partner.",
      400,
    );
  }

  if (ownerType === "court_partner") {
    if (typeof body.venue_id !== "string" || !UUID_RE.test(body.venue_id)) {
      throw new AppError(
        "VALIDATION",
        "venue_id must be a valid uuid for owner_type court_partner.",
        400,
      );
    }
    return { owner_type: ownerType, venue_id: body.venue_id };
  }

  return { owner_type: ownerType };
}

interface OwnerContext {
  ownerType: OwnerType;
  /** coach_profiles.user_id for a coach, venues.id for a court partner. */
  ownerId: string;
  /** What Razorpay shows as the sub-merchant's legal business name. */
  legalBusinessName: string;
  contactName: string;
  phone?: string;
}

/**
 * Resolves and authorizes the owner being onboarded. This function runs as
 * service_role (RLS bypassed), so ownership is re-derived here in TypeScript
 * against the caller's real `auth.uid()`, exactly the way book-court's
 * `assertCourtPartnerOrStaff` does for the walk-in path. A caller can only
 * ever onboard their own coach profile or a venue they are the partner on.
 *
 * Venue staff are deliberately NOT accepted for court_partner: unlike
 * recording a walk-in, this binds a bank account that platform money is paid
 * out to, so only `venues.partner_user_id` qualifies.
 */
async function resolveOwner(
  supabase: ReturnType<typeof serviceRoleClient>,
  userId: string,
  body: RouteOnboardRequestBody,
): Promise<OwnerContext> {
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("name, phone")
    .eq("id", userId)
    .maybeSingle<{ name: string; phone: string | null }>();

  if (userError) {
    throw new AppError(
      "INTERNAL",
      `Failed to load user profile: ${userError.message}`,
      500,
    );
  }
  if (!userRow) {
    throw new AppError("NOT_FOUND", "User profile not found.", 404);
  }

  if (body.owner_type === "coach") {
    const { data: coach, error: coachError } = await supabase
      .from("coach_profiles")
      .select("user_id, status")
      .eq("user_id", userId)
      .maybeSingle<{ user_id: string; status: string }>();

    if (coachError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load coach profile: ${coachError.message}`,
        500,
      );
    }
    if (!coach) {
      throw new AppError(
        "FORBIDDEN",
        "A coach profile is required to set up a payout account.",
        403,
      );
    }

    return {
      ownerType: "coach",
      ownerId: coach.user_id,
      legalBusinessName: userRow.name,
      contactName: userRow.name,
      phone: userRow.phone ?? undefined,
    };
  }

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .select("id, name, partner_user_id")
    .eq("id", body.venue_id!)
    .maybeSingle<{ id: string; name: string; partner_user_id: string }>();

  if (venueError) {
    throw new AppError(
      "INTERNAL",
      `Failed to load venue: ${venueError.message}`,
      500,
    );
  }
  if (!venue) {
    throw new AppError("NOT_FOUND", "Venue not found.", 404);
  }
  if (venue.partner_user_id !== userId) {
    throw new AppError(
      "FORBIDDEN",
      "Only the venue partner can set up its payout account.",
      403,
    );
  }

  return {
    ownerType: "court_partner",
    ownerId: venue.id,
    legalBusinessName: venue.name,
    contactName: userRow.name,
    phone: userRow.phone ?? undefined,
  };
}

/** Reads the existing row, or creates it at `not_started`, for this owner. */
async function loadOrCreatePayoutAccount(
  supabase: ReturnType<typeof serviceRoleClient>,
  owner: OwnerContext,
): Promise<PayoutAccountRow> {
  const { data: existing, error: selectError } = await supabase
    .from("payout_accounts")
    .select("id, owner_type, owner_id, razorpay_account_id, status")
    .eq("owner_type", owner.ownerType)
    .eq("owner_id", owner.ownerId)
    .maybeSingle<PayoutAccountRow>();

  if (selectError) {
    throw new AppError(
      "INTERNAL",
      `Failed to load payout account: ${selectError.message}`,
      500,
    );
  }
  if (existing) return existing;

  const { data: inserted, error: insertError } = await supabase
    .from("payout_accounts")
    .insert({
      owner_type: owner.ownerType,
      owner_id: owner.ownerId,
      status: "not_started",
    })
    .select("id, owner_type, owner_id, razorpay_account_id, status")
    .single<PayoutAccountRow>();

  if (insertError) {
    // 23505 on the (owner_type, owner_id) unique constraint means a
    // concurrent invocation won the race. Re-read rather than failing: the
    // whole point of this function is that calling it twice is safe.
    if (insertError.code === "23505") {
      const { data: raced } = await supabase
        .from("payout_accounts")
        .select("id, owner_type, owner_id, razorpay_account_id, status")
        .eq("owner_type", owner.ownerType)
        .eq("owner_id", owner.ownerId)
        .single<PayoutAccountRow>();
      if (raced) return raced;
    }
    throw new AppError(
      "INTERNAL",
      `Failed to create payout account: ${insertError.message}`,
      500,
    );
  }

  return inserted;
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    const body = parseRequestBody(await request.json().catch(() => null));
    const user = await getAuthenticatedUser(request);
    const supabase = serviceRoleClient();

    const owner = await resolveOwner(supabase, user.id, body);
    const account = await loadOrCreatePayoutAccount(supabase, owner);

    // ---- Idempotent path: a sub-merchant already exists, so poll and sync.
    if (account.razorpay_account_id) {
      const linkedAccount = await fetchLinkedAccount(account.razorpay_account_id);
      let product: RazorpayProductConfiguration | null = null;
      try {
        product = await fetchRouteProduct(account.razorpay_account_id);
      } catch (err) {
        // A missing product configuration is a legitimate mid-onboarding
        // state, not a failure of this call; the account status alone still
        // maps to something sensible. Anything Route-entitlement related
        // still propagates.
        if (err instanceof AppError && err.code === "ROUTE_UNAVAILABLE") throw err;
        console.error("Failed to read Route product configuration:", err);
      }

      const status = mapPayoutAccountStatus(linkedAccount, product);

      if (status !== account.status) {
        const { error: updateError } = await supabase
          .from("payout_accounts")
          .update({ status })
          .eq("id", account.id);
        if (updateError) {
          throw new AppError(
            "INTERNAL",
            `Failed to sync payout account status: ${updateError.message}`,
            500,
          );
        }
      }

      return jsonResponse({
        payout_account_id: account.id,
        owner_type: account.owner_type,
        owner_id: account.owner_id,
        razorpay_account_id: account.razorpay_account_id,
        status,
        onboarding_url: hostedOnboardingUrl(product),
        created: false,
      }, 200);
    }

    // ---- Create path: no sub-merchant yet.
    const email = user.email;
    if (!email) {
      throw new AppError(
        "VALIDATION",
        "An email address on your account is required before payout setup.",
        400,
      );
    }

    const linkedAccount = await createLinkedAccount({
      email,
      phone: owner.phone,
      legalBusinessName: owner.legalBusinessName,
      businessType: owner.ownerType === "coach" ? "individual" : "partnership",
      contactName: owner.contactName,
      notes: {
        owner_type: owner.ownerType,
        owner_id: owner.ownerId,
        payout_account_id: account.id,
      },
    });

    // Persist the account id BEFORE requesting the product. If the product
    // call then fails, a re-invocation takes the poll path above against the
    // sub-merchant that already exists, rather than creating a second one.
    const { error: linkError } = await supabase
      .from("payout_accounts")
      .update({ razorpay_account_id: linkedAccount.id, status: "pending" })
      .eq("id", account.id);

    if (linkError) {
      throw new AppError(
        "INTERNAL",
        `Failed to persist razorpay_account_id: ${linkError.message}`,
        500,
      );
    }

    const product = await requestRouteProduct(linkedAccount.id);
    const status = mapPayoutAccountStatus(linkedAccount, product);

    const { error: statusError } = await supabase
      .from("payout_accounts")
      .update({ status })
      .eq("id", account.id);

    if (statusError) {
      throw new AppError(
        "INTERNAL",
        `Failed to persist payout account status: ${statusError.message}`,
        500,
      );
    }

    return jsonResponse({
      payout_account_id: account.id,
      owner_type: account.owner_type,
      owner_id: account.owner_id,
      razorpay_account_id: linkedAccount.id,
      status,
      onboarding_url: hostedOnboardingUrl(product),
      created: true,
    }, 200);
  })
);
