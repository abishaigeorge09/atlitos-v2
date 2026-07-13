// ATLITOS v2 — supabase/functions/_shared/cors.ts
//
// Shared CORS headers for every edge function in this directory. portal-court
// (a browser app) calls book-court/verify-payment directly from the client,
// so every function's OPTIONS preflight and every actual response must carry
// these, not just the mobile app's native fetch (which never preflights).

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Call at the top of every function's Deno.serve handler. */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
