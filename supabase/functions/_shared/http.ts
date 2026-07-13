// ATLITOS v2 — supabase/functions/_shared/http.ts
//
// Small JSON response helpers shared by every function, so every response
// (success or error) carries the same corsHeaders + Content-Type, and every
// error response has the same `{ error: { code, message } }` shape.

import { corsHeaders } from "./cors.ts";
import { AppError } from "./app-error.ts";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(error: AppError): Response {
  return jsonResponse(
    { error: { code: error.code, message: error.message } },
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
    console.error("Unhandled edge function error:", err);
    return errorResponse(
      new AppError(
        "INTERNAL",
        "An unexpected error occurred. Please try again.",
        500,
      ),
    );
  }
}
