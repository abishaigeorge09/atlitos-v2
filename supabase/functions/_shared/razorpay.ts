// ATLITOS v2 — supabase/functions/_shared/razorpay.ts
//
// Minimal Razorpay REST client. Deliberately not the `razorpay` npm SDK: it
// is a thin wrapper over 3 endpoints/computations this repo actually needs
// (order creation, webhook signature verification, client-callback payment
// signature verification), and pinning our own fetch calls keeps the Deno
// edge runtime's cold start small and the surface auditable. Every function
// here reads `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / (for the webhook
// path only) `RAZORPAY_WEBHOOK_SECRET` from `Deno.env`; none of these are
// ever hardcoded or logged, per this task's instructions.

import { AppError } from "./app-error.ts";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
const RAZORPAY_API_BASE_V2 = "https://api.razorpay.com/v2";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new AppError(
      "INTERNAL",
      `Server misconfiguration: ${name} is not set.`,
      500,
    );
  }
  return value;
}

function basicAuthHeader(): string {
  const keyId = requiredEnv("RAZORPAY_KEY_ID");
  const keySecret = requiredEnv("RAZORPAY_KEY_SECRET");
  // btoa is available globally in the Deno edge runtime.
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

// ============================================================================
// Order creation
// ============================================================================

export interface RazorpayOrder {
  id: string;
  entity: "order";
  amount: number; // paise
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  status: string;
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

export interface CreateOrderParams {
  /** Amount in paise (the smallest currency unit), already rounded. */
  amountPaise: number;
  currency?: string;
  /** Our own row id this order is for, echoed back by Razorpay unmodified. */
  receipt?: string;
  /**
   * Carries {domain, entity_id, payment_intent_id} per PAYMENTS.md's shared
   * helper contract, so razorpay-webhook can resolve which row to update
   * without any other lookup. Razorpay requires string values.
   */
  notes: Record<string, string>;
}

export async function createOrder(
  params: CreateOrderParams,
): Promise<RazorpayOrder> {
  const response = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: params.currency ?? "INR",
      receipt: params.receipt,
      notes: params.notes,
      payment_capture: 1,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      "RAZORPAY_ERROR",
      `Razorpay order creation failed (${response.status}): ${detail}`,
      502,
    );
  }

  return (await response.json()) as RazorpayOrder;
}

// ============================================================================
// Signature verification (HMAC SHA-256, hex digest, timing-safe compare)
// ============================================================================

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signatureBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Exported for _shared/notify.ts (SEC-F10): notify-dispatch authorizes on a
 * bare equality against the service role key, which is secret material and so
 * needs the same constant-time treatment the webhook signatures get. Kept here
 * rather than copied there so there is one implementation of this comparison.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verifies `x-razorpay-signature` on an incoming webhook POST: HMAC SHA-256
 * of the raw request body, keyed by RAZORPAY_WEBHOOK_SECRET (the secret
 * configured in the Razorpay dashboard's webhook settings, distinct from
 * RAZORPAY_KEY_SECRET). `rawBody` must be the exact, unparsed request body
 * text; re-serializing parsed JSON would not reproduce the same bytes
 * Razorpay signed.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const webhookSecret = requiredEnv("RAZORPAY_WEBHOOK_SECRET");
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqual(signatureHeader, expected);
}

/**
 * Verifies the signature `react-native-razorpay`'s checkout sheet returns to
 * the client on success: HMAC SHA-256 of `"{order_id}|{payment_id}"`, keyed
 * by RAZORPAY_KEY_SECRET (not the webhook secret; this is Razorpay's
 * documented client-side payment verification formula, a different secret
 * and message shape than the webhook's). Used by verify-payment, the
 * client-callback fallback path.
 */
export async function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): Promise<boolean> {
  if (!signature) return false;
  const keySecret = requiredEnv("RAZORPAY_KEY_SECRET");
  const expected = await hmacSha256Hex(
    keySecret,
    `${razorpayOrderId}|${razorpayPaymentId}`,
  );
  return timingSafeEqual(signature, expected);
}

/** The public key id, safe to return to the client for opening the checkout sheet. */
export function razorpayKeyId(): string {
  return requiredEnv("RAZORPAY_KEY_ID");
}

/**
 * Razorpay puts the webhook event id in the `x-razorpay-event-id` HEADER, not
 * in the JSON body (the body carries entity/account_id/event/payload). That
 * header is what `webhook_events.id` must be keyed on for the insert-before-
 * side-effect idempotency gate to actually deduplicate retries. This was the
 * P2 lesson learned the hard way in razorpay-webhook; it is a helper here so
 * AT-43's transfer.processed/transfer.failed handling cannot repeat it.
 * Falls back to the body's `id` only if the header is absent.
 */
export function webhookEventId(
  req: Request,
  parsedBody?: { id?: string },
): string | null {
  return req.headers.get("x-razorpay-event-id") ?? parsedBody?.id ?? null;
}

// ============================================================================
// Route: linked (sub-merchant) accounts
//
// PAYMENTS.md "Route: linked accounts and transfers". Razorpay's current
// onboarding surface is the v2 Accounts API plus a per-product configuration:
//
//   POST /v2/accounts                      -> create the linked account
//   GET  /v2/accounts/:id                  -> poll its status
//   POST /v2/accounts/:id/products         -> request the `route` product
//   GET  /v2/accounts/:id/products/:pid    -> poll activation + hosted link
//
// Onboarding is a two-step handshake because an account exists before it is
// entitled to anything: the product configuration is what actually starts
// KYC, and its response is what carries the hosted onboarding URL the coach
// or partner is handed off to. Everything below shares `razorpayRequest`
// with the order path above, so AT-43's `POST /v1/transfers` needs no second
// client, just another call site.
// ============================================================================

/** Shared authenticated JSON call. `path` is absolute from the version root. */
export async function razorpayRequest<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  version: "v1" | "v2" = "v1",
): Promise<T> {
  const base = version === "v2" ? RAZORPAY_API_BASE_V2 : RAZORPAY_API_BASE;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw routeApiError(method, path, response.status, text);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Turns a Razorpay error body into the right AppError. The distinction that
 * matters operationally: if Route is simply not enabled on this merchant
 * account (the expected state on a fresh test account until the founder
 * enables it in the Razorpay dashboard), that is `ROUTE_UNAVAILABLE` and no
 * amount of retrying or client-side handling fixes it. Everything else is a
 * generic `RAZORPAY_ERROR` 502. The upstream description is preserved
 * verbatim in the message either way, because the exact wording is the only
 * thing that tells the founder what to switch on.
 */
function routeApiError(
  method: string,
  path: string,
  status: number,
  rawBody: string,
): AppError {
  let description = rawBody;
  let upstreamCode = "";
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { code?: string; description?: string };
    };
    description = parsed.error?.description ?? rawBody;
    upstreamCode = parsed.error?.code ?? "";
  } catch {
    // Non-JSON body (HTML error page, empty). Keep the raw text.
  }

  const haystack = `${upstreamCode} ${description}`.toLowerCase();

  // Razorpay signals "Route is not enabled here" in TWO different shapes, and
  // AT-43 found the second one the hard way. Both captured 2026-07-20 against
  // the live `rzp_test` credentials, on an account whose ordinary APIs work
  // (`GET /v1/orders` returns 200):
  //
  //   POST /v2/accounts  -> 400 {"code":"BAD_REQUEST_ERROR","description":
  //     "Route feature not enabled for the merchant","source":"business",
  //     "step":"linked_account_create"}
  //   POST /v1/transfers -> 400 {"code":"BAD_REQUEST_ERROR","description":
  //     "The requested URL was not found on the server.","source":"internal",
  //     "step":"NA"}
  //
  // The onboarding endpoint says so in words. The transfers endpoint is not
  // ROUTED AT ALL on a non-Route merchant, so it answers as though it does
  // not exist, with no mention of Route anywhere in the body. Classifying
  // that as a generic RAZORPAY_ERROR 502 would tell the founder "Razorpay had
  // a problem" when the truth is "this account is not entitled to this API",
  // which is a different action (enable Route) and a different urgency.
  //
  // The URL-not-found clause is therefore deliberately scoped to the Route
  // paths. On any other path, a 404-shaped body means this repo is calling an
  // endpoint that genuinely does not exist, which is our bug and must stay a
  // loud 502 rather than being excused as an entitlement gap.
  const isRoutePath = /^\/(transfers|accounts)/.test(path);
  const urlNotFound = /requested url was not found/.test(haystack);

  const notEntitled =
    status === 401 ||
    status === 403 ||
    /not\s+(enabled|activated|allowed|authori[sz]ed)/.test(haystack) ||
    /(feature|product|route|marketplace).*(not\s+(enabled|available|activated)|unauthori[sz]ed)/
      .test(haystack) ||
    /merchant\s+is\s+not\s+/.test(haystack) ||
    (isRoutePath && urlNotFound);

  if (notEntitled) {
    return new AppError(
      "ROUTE_UNAVAILABLE",
      `Razorpay Route is not enabled on this account. ${method} ${path} returned ${status}: ${description}`,
      503,
    );
  }

  return new AppError(
    "RAZORPAY_ERROR",
    `Razorpay ${method} ${path} failed (${status}): ${description}`,
    502,
  );
}

/** `payout_accounts.status` (0010_payments_core.sql's enum). */
export type PayoutAccountStatus =
  | "not_started"
  | "pending"
  | "active"
  | "needs_attention"
  | "failed";

export interface RazorpayLinkedAccount {
  id: string;
  type: "standard" | "route";
  /** created | activated | needs_clarification | under_review | suspended */
  status?: string;
  email?: string;
  legal_business_name?: string;
  activated_at?: number;
}

export interface RazorpayProductConfiguration {
  id: string;
  product_name: string;
  /**
   * requested | under_review | needs_clarification | activated | rejected.
   * This, not the account's own `status`, is the field that reflects how far
   * KYC has actually progressed for the Route product specifically.
   */
  activation_status?: string;
  requirements?: unknown[];
  /**
   * Razorpay returns the hosted onboarding hand-off here on accounts that
   * have hosted onboarding provisioned. Both spellings are read because the
   * field name differs across Razorpay's own documented samples and cannot
   * be pinned down against a live account until Route is enabled.
   */
  onboarding_url?: string;
  hosted_onboarding_url?: string;
}

export interface CreateLinkedAccountParams {
  email: string;
  phone?: string;
  legalBusinessName: string;
  /** Razorpay's business_type; individual is correct for a solo coach. */
  businessType: string;
  contactName: string;
  /** Echoed back unmodified; carries our owner_type/owner_id for support. */
  notes: Record<string, string>;
}

export async function createLinkedAccount(
  params: CreateLinkedAccountParams,
): Promise<RazorpayLinkedAccount> {
  return await razorpayRequest<RazorpayLinkedAccount>(
    "POST",
    "/accounts",
    {
      email: params.email,
      phone: params.phone,
      type: "route",
      legal_business_name: params.legalBusinessName,
      business_type: params.businessType,
      contact_name: params.contactName,
      notes: params.notes,
    },
    "v2",
  );
}

export async function fetchLinkedAccount(
  accountId: string,
): Promise<RazorpayLinkedAccount> {
  return await razorpayRequest<RazorpayLinkedAccount>(
    "GET",
    `/accounts/${accountId}`,
    undefined,
    "v2",
  );
}

/**
 * Requests the `route` product on a linked account. This is the call that
 * actually starts KYC and yields the hosted onboarding hand-off; creating
 * the account alone does not.
 */
export async function requestRouteProduct(
  accountId: string,
): Promise<RazorpayProductConfiguration> {
  return await razorpayRequest<RazorpayProductConfiguration>(
    "POST",
    `/accounts/${accountId}/products`,
    { product_name: "route", tnc_accepted: true },
    "v2",
  );
}

export async function fetchRouteProduct(
  accountId: string,
): Promise<RazorpayProductConfiguration | null> {
  const result = await razorpayRequest<
    { items?: RazorpayProductConfiguration[] } | RazorpayProductConfiguration[]
  >("GET", `/accounts/${accountId}/products`, undefined, "v2");

  const items = Array.isArray(result) ? result : (result.items ?? []);
  return items.find((item) => item.product_name === "route") ?? items[0] ?? null;
}

/**
 * Maps Razorpay's linked-account and product-configuration states onto our
 * `payout_account_status` enum. The product's `activation_status` wins when
 * present because it is the Route-specific signal; the account's own status
 * is the fallback for the window between account creation and the product
 * request. `not_started` is deliberately never returned here: it means "we
 * have not called Razorpay at all", which only the caller knows.
 */
export function mapPayoutAccountStatus(
  account: RazorpayLinkedAccount | null,
  product: RazorpayProductConfiguration | null,
): PayoutAccountStatus {
  const signal = (product?.activation_status ?? account?.status ?? "")
    .toLowerCase();

  switch (signal) {
    case "activated":
      return "active";
    case "needs_clarification":
      return "needs_attention";
    case "rejected":
    case "suspended":
      return "failed";
    case "created":
    case "requested":
    case "under_review":
      return "pending";
    default:
      return "pending";
  }
}

/** The hosted KYC link to hand the coach or partner off to, if Razorpay gave one. */
export function hostedOnboardingUrl(
  product: RazorpayProductConfiguration | null,
): string | null {
  return product?.onboarding_url ?? product?.hosted_onboarding_url ?? null;
}
