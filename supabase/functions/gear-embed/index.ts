// ATLITOS v2 — supabase/functions/gear-embed/index.ts
//
// Phase S1 Track B (PRD-07 FR-43; ADR-011 D2). The ONE write path to
// `affiliate_products.embedding` (AC-11-7). Two calls, same function:
//   POST { productId: string }         -- embed one row
//   POST { sweep: true, limit?: number } -- embed every row where
//                                           `embedding is null` (the nightly
//                                           backfill's target set; no separate
//                                           `embedding_pending` column, D2)
//
// AUTH: service-role key OR an admin JWT (has_role via the caller's own
// token, the admin-order-advance pattern in _shared land). Anon is always
// refused 401/403. Called by apps/admin/src/pages/gear/api.ts right after
// `admin_upsert_affiliate_product` resolves, and by the nightly sweep
// (service role) as backfill. NEVER called by `ai-search` (component
// boundary, ADR-011 "Component design").
//
// WRITE POSTURE: the embedding column itself is only ever written under the
// SERVICE ROLE client, even when the caller authenticated as an admin, so an
// admin's JWT never needs (and never gets) UPDATE on `affiliate_products` to
// use this path (AC-11-6/11-7's "no client writes `embedding`" holds for the
// admin app too, just via a different door).
//
// FAILURE MODE (D2): on any embedding failure the column is left null and the
// failure is reported to Sentry; the product still appears through the
// deterministic keyword path in `ai-search`, since `embedding IS NULL` rows
// are just not eligible for the vector recall branch. This function itself
// never 500s for an individual row's embedding failure inside a sweep; it
// counts the row as `failed` and moves on.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { isServiceRoleToken, serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";
import { captureEdgeError } from "../_shared/sentry.ts";
import { embeddingsMode, embedTexts } from "../_shared/embeddings.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

interface AffiliateProductDocRow {
  id: string;
  title: string | null;
  brand: string | null;
  sport: string | null;
  skill_level: string | null;
  age_range: string | null;
  description: string | null;
}

const DEFAULT_SWEEP_LIMIT = 200;

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Refuses anon outright; accepts the service-role key as-is (the nightly
 * sweep and the admin app's own service-role callers use this), or an
 * authenticated caller holding the `admin` role, read through THEIR OWN JWT
 * (never the service role, and explicitly scoped by user_id as well as role
 * per CLAUDE.md: RLS is a floor, not the scoping mechanism). Mirrors
 * admin-order-advance/index.ts's `requireAdmin`.
 */
async function requireServiceRoleOrAdmin(req: Request): Promise<void> {
  if (isServiceRoleToken(bearerToken(req))) {
    return; // service role: the nightly sweep, or a trusted server caller.
  }

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
}

interface GearEmbedBody {
  productId?: string;
  sweep?: boolean;
  limit?: number;
}

function parseBody(raw: unknown): GearEmbedBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  if (body.sweep === true) {
    const limit = typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
      ? Math.min(1000, Math.floor(body.limit))
      : DEFAULT_SWEEP_LIMIT;
    return { sweep: true, limit };
  }
  if (typeof body.productId === "string" && body.productId.trim().length > 0) {
    return { productId: body.productId.trim() };
  }
  throw new AppError("VALIDATION", "Provide either { productId } or { sweep: true }.", 400);
}

/** title, brand, sport, skill_level, age_range, description joined; the D2/D1 document text. */
function documentText(row: AffiliateProductDocRow): string {
  return [row.title, row.brand, row.sport, row.skill_level, row.age_range, row.description]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");
}

async function fetchRows(svc: AnySupabaseClient, ids: string[]): Promise<AffiliateProductDocRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await svc
    .from("affiliate_products")
    .select("id, title, brand, sport, skill_level, age_range, description")
    .in("id", ids);
  if (error) throw new AppError("INTERNAL", `Failed to load affiliate_products: ${error.message}`, 500);
  return (data ?? []) as AffiliateProductDocRow[];
}

/** Voyage accepts up to 128 inputs per call; 64 keeps a request well under
 * the token ceiling for long descriptions. */
const EMBED_BATCH_SIZE = 64;

/**
 * Embeds the rows in batches of EMBED_BATCH_SIZE (one Voyage call per batch,
 * not one per row: the first production sweep on 2026-09-19 embedded 3 of 8
 * and lost the other 5 to Voyage's per-minute request limit with a call per
 * row) and writes each row on its own. A row with empty document text is
 * counted failed without a call. A batch whose Voyage call fails counts every
 * row in it as failed and leaves their columns null (D2); the rest of the
 * sweep continues. Never throws for a per-row or per-batch failure.
 */
async function embedAndWrite(
  svc: AnySupabaseClient,
  rows: AffiliateProductDocRow[],
): Promise<{ embedded: number; failed: number }> {
  let embedded = 0;
  let failed = 0;

  const withText: Array<{ row: AffiliateProductDocRow; text: string }> = [];
  for (const row of rows) {
    const text = documentText(row);
    if (!text) {
      failed++;
      await captureEdgeError(new Error("Empty document text"), { fn: "gear-embed", productId: row.id });
      continue;
    }
    withText.push({ row, text });
  }

  for (let start = 0; start < withText.length; start += EMBED_BATCH_SIZE) {
    const batch = withText.slice(start, start + EMBED_BATCH_SIZE);
    let vectors: number[][];
    try {
      vectors = await embedTexts(batch.map((b) => b.text), "document");
      if (vectors.length !== batch.length) throw new Error(`embedTexts returned ${vectors.length} vectors for ${batch.length} texts`);
    } catch (err) {
      failed += batch.length;
      await captureEdgeError(err, { fn: "gear-embed", stage: "batch-embed", productIds: batch.map((b) => b.row.id) });
      continue;
    }
    for (let i = 0; i < batch.length; i++) {
      const vector = vectors[i];
      const row = batch[i].row;
      try {
        if (!vector || vector.length === 0) throw new Error("embedTexts returned no vector");
        const { error } = await svc
          .from("affiliate_products")
          .update({ embedding: JSON.stringify(vector) })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
        embedded++;
      } catch (err) {
        failed++;
        await captureEdgeError(err, { fn: "gear-embed", productId: row.id });
        // Embedding stays null (D2): no partial write, no retry inside this call.
      }
    }
  }

  return { embedded, failed };
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    await requireServiceRoleOrAdmin(request);

    const body = parseBody(await request.json().catch(() => null));
    const svc = serviceRoleClient();
    const mode = embeddingsMode();

    if (body.sweep) {
      const { data, error } = await svc
        .from("affiliate_products")
        .select("id")
        .is("embedding", null)
        .limit(body.limit ?? DEFAULT_SWEEP_LIMIT);
      if (error) throw new AppError("INTERNAL", `Failed to load sweep candidates: ${error.message}`, 500);
      const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      const rows = await fetchRows(svc, ids);
      const { embedded, failed } = await embedAndWrite(svc, rows);
      return jsonResponse({ embedded, failed, mode }, 200);
    }

    const rows = await fetchRows(svc, [body.productId as string]);
    if (rows.length === 0) {
      throw new AppError("NOT_FOUND", "No affiliate product with that id.", 404);
    }
    const { embedded, failed } = await embedAndWrite(svc, rows);
    return jsonResponse({ embedded, failed, mode }, 200);
  })
);
