// ATLITOS v2 — supabase/functions/_shared/http.ts
//
// Small JSON response helpers shared by every function, so every response
// (success or error) carries the same corsHeaders + Content-Type, and every
// error response has the same `{ error: { code, message } }` shape.

import { corsHeaders } from "./cors.ts";
import { AppError } from "./app-error.ts";

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

/**
 * SEC-F7 (P2, audit 2026-09-04). Roughly forty call sites across these
 * functions build `new AppError("INTERNAL", \`... ${err.message}\`, 500)` from a
 * PostgREST or Storage error, and this wrapper used to hand that string
 * straight to the caller. That leaks table and column names, SQLSTATE text,
 * storage object paths and Razorpay response bodies to whoever triggered the
 * error, including an anonymous caller on the public search and playback paths.
 *
 * Fixing it at the throw sites would mean auditing forty of them and trusting
 * the forty-first to remember. Fixing it here, at the one function every
 * response passes through, cannot be forgotten.
 *
 * The split is by STATUS, not by code. Under 500 the message is business
 * meaning the client is supposed to read and often render verbatim
 * (SLOT_TAKEN, PRICE_MISMATCH, OUT_OF_STOCK naming the offending line), so it
 * passes through untouched. At 500 and above the message is diagnostic, so the
 * detail goes to the server log with a correlation id and the client gets that
 * id instead. The CODE is preserved either way, which is what
 * packages/api's mapEdgeFunctionError keys on, so no client behaviour changes.
 */
export function errorResponse(error: AppError): Response {
  // A 429 without Retry-After makes every client guess, and guessing clients
  // retry too fast, which is the traffic the limit exists to shed.
  const retryHeaders = error.retryAfterSeconds !== undefined
    ? { "Retry-After": String(error.retryAfterSeconds) }
    : undefined;

  if (error.status < 500) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      error.status,
      retryHeaders,
    );
  }

  const reference = crypto.randomUUID();
  console.error(`[${reference}] ${error.code}: ${error.message}`);

  return jsonResponse(
    {
      error: {
        code: error.code,
        message: `Something went wrong on our side. Reference ${reference}.`,
        reference,
      },
    },
    error.status,
  );
}

/**
 * Wraps a function body so any AppError thrown anywhere in the call graph
 * (validation, auth, RPC error mapping, Razorpay call failures) becomes the
 * right JSON error response, and anything unexpected becomes a generic 500
 * INTERNAL rather than leaking implementation detail to the client.
 */
export async function withErrorHandling(
  req: Request,
  handler: (req: Request) => Promise<Response>,
): Promise<Response> {
  try {
    return await handler(req);
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err);
    }
    // errorResponse logs the detail with its own correlation id; this second
    // line carries the stack, which the AppError string does not.
    console.error("Unhandled edge function error:", err);
    return errorResponse(
      new AppError(
        "INTERNAL",
        err instanceof Error ? err.message : "Unexpected non-Error throw.",
        500,
      ),
    );
  }
}
