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

function timingSafeEqual(a: string, b: string): boolean {
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
