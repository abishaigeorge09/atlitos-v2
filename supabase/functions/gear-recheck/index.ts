// ATLITOS v2 — supabase/functions/gear-recheck/index.ts
//
// Phase S2 Track D (PRD-07 FR-48, FR-51, FR-52; ADR-011 D4; AC-11-4). The
// nightly catalogue health sweep. Re-fetches every in-stock offer's page
// (or every offer of one product, on demand), records the outcome, and
// auto-delists a product whose every offer has gone/blocked for 7
// consecutive checks.
//
// Two calls, same function:
//   POST { sweep: true, limit?: number }  -- every in-stock offer of an
//                                             active product, oldest
//                                             last_checked_at first, capped
//                                             at `limit` (default 200)
//   POST { productId: string }            -- every offer of that one
//                                             product, regardless of
//                                             in_stock (used by the admin
//                                             "Re-check now" button, FR-50)
//
// AUTH: service-role key OR an admin JWT (has_role via the caller's own
// token). Mirrors gear-embed's `requireServiceRoleOrAdmin` exactly. Anon is
// always refused 401.
//
// Outcome enum (ADR-011 D4, docs/PLAN-SHOP-SEARCH.md Contracts): ok,
// price_changed, out_of_stock, gone, blocked. Only gone/blocked increment
// `product_offers.consecutive_failures`; every other outcome resets it to 0
// (an out-of-stock page is a successful fetch, not a failure). A 200 whose
// page no extraction strategy can parse is logged to `product_fetch_log`
// with its OWN outcome `unparsed`, but the offer's `last_check_outcome`
// becomes `gone` (the enum on `product_offers` has no `unparsed` value; the
// distinction lives in the log, not the offer row).
//
// `blocked` covers robots.txt, a size-cap trip, an invalid URL (all
// `fetchPage`'s own `blocked: true`), OR an HTTP 403/429/5xx/network error
// AFTER one retry (ADR-011 D3/D4's "blocked" is deliberately broader than
// just robots for the health sweep: any of those is a retailer refusing the
// bot, and none of them is evidence the product itself is gone).
//
// FR-52's AI assessment runs ONLY on the unparsed-200 branch, reuses the
// SAME `ai_spend_daily` ledger `ai-search`'s spend guard uses
// (`recordAiSpend`, imported directly rather than duplicated), gated by the
// same daily budget RPC. `llm.ts`'s `callClaude` is not exported (it is
// `ai-search`'s own internal helper), so the actual Anthropic call here is a
// small, focused implementation following the identical guarded shape
// (env-only key, hard timeout, never throws, degrades to `ai_suggestion:
// null` on any failure) rather than widening that module's public surface
// for one caller.
//
// One offer failing (a thrown error mid-fetch, an unexpected extraction
// exception) never stops the sweep: every offer is processed inside its own
// try/catch, and an unexpected failure is treated as `blocked` (a
// conservative, non-terminal outcome) and reported to Sentry.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";
import { captureEdgeError } from "../_shared/sentry.ts";
import { fetchPage, type FetchPageResult } from "../_shared/fetch-page.ts";
import { extractProduct, type ProductDraft, type RetailerExtractorMap } from "../_shared/extract-product.ts";
import { recordAiSpend } from "../ai-search/spend-guard.ts";
import { llmEnabled } from "../ai-search/llm.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const DEFAULT_SWEEP_LIMIT = 200;
const DEFAULT_MAX_PER_MINUTE = 10; // fallback for an offer with no retailer_programmes match
const AI_SUGGESTION_MODEL = "claude-haiku-4-5-20251001";
const AI_SUGGESTION_TIMEOUT_MS = 4000;
const AI_SUGGESTION_TEXT_CAP_BYTES = 6 * 1024;

type Outcome = "ok" | "price_changed" | "out_of_stock" | "gone" | "blocked";
type LogOutcome = Outcome | "unparsed";

interface OfferRow {
  id: string;
  affiliate_product_id: string;
  retailer: string;
  price: number;
  currency: string;
  affiliate_url: string;
  canonical_url: string | null;
  retailer_key: string | null;
  in_stock: boolean;
  consecutive_failures: number;
}

interface RetailerProgrammeRow {
  key: string;
  url_patterns: string[] | null;
  extractor: RetailerExtractorMap | null;
  fetch_policy: { maxPerMinute?: number } | null;
}

// ---------------------------------------------------------------------------
// Auth: service-role key OR admin JWT. Mirrors gear-embed's
// requireServiceRoleOrAdmin, admin-order-advance's requireAdmin pattern.
// ---------------------------------------------------------------------------
function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireServiceRoleOrAdmin(req: Request): Promise<void> {
  const token = bearerToken(req);
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (token && serviceRoleKey && token === serviceRoleKey) {
    return; // service role: the nightly Actions sweep, or a trusted server caller.
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

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------
interface SweepBody {
  sweep: true;
  limit: number;
}
interface ProductBody {
  productId: string;
}

function parseBody(raw: unknown): SweepBody | ProductBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  if (body.sweep === true) {
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
        ? Math.min(1000, Math.floor(body.limit))
        : DEFAULT_SWEEP_LIMIT;
    return { sweep: true, limit };
  }
  if (typeof body.productId === "string" && body.productId.trim().length > 0) {
    return { productId: body.productId.trim() };
  }
  throw new AppError("VALIDATION", "Provide either { sweep: true, limit? } or { productId }.", 400);
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------
async function loadSweepOffers(svc: AnySupabaseClient, limit: number): Promise<OfferRow[]> {
  const { data: activeProducts, error: activeError } = await svc
    .from("affiliate_products")
    .select("id")
    .eq("active", true);
  if (activeError) throw new AppError("INTERNAL", `Failed to load active products: ${activeError.message}`, 500);
  const activeIds = ((activeProducts ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (activeIds.length === 0) return [];

  const { data, error } = await svc
    .from("product_offers")
    .select(
      "id, affiliate_product_id, retailer, price, currency, affiliate_url, canonical_url, retailer_key, in_stock, consecutive_failures",
    )
    .eq("in_stock", true)
    .in("affiliate_product_id", activeIds)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new AppError("INTERNAL", `Failed to load offers for the sweep: ${error.message}`, 500);
  return (data ?? []) as OfferRow[];
}

async function loadProductOffers(svc: AnySupabaseClient, productId: string): Promise<OfferRow[]> {
  const { data: product, error: productError } = await svc
    .from("affiliate_products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (productError) throw new AppError("INTERNAL", `Failed to load product: ${productError.message}`, 500);
  if (!product) throw new AppError("NOT_FOUND", "No affiliate product with that id.", 404);

  const { data, error } = await svc
    .from("product_offers")
    .select(
      "id, affiliate_product_id, retailer, price, currency, affiliate_url, canonical_url, retailer_key, in_stock, consecutive_failures",
    )
    .eq("affiliate_product_id", productId);
  if (error) throw new AppError("INTERNAL", `Failed to load offers for product ${productId}: ${error.message}`, 500);
  return (data ?? []) as OfferRow[];
}

async function loadProgrammes(
  svc: AnySupabaseClient,
  retailerKeys: string[],
): Promise<Map<string, RetailerProgrammeRow>> {
  const map = new Map<string, RetailerProgrammeRow>();
  if (retailerKeys.length === 0) return map;
  const { data, error } = await svc
    .from("retailer_programmes")
    .select("key, url_patterns, extractor, fetch_policy")
    .in("key", retailerKeys);
  if (error) throw new AppError("INTERNAL", `Failed to load retailer_programmes: ${error.message}`, 500);
  for (const row of (data ?? []) as RetailerProgrammeRow[]) {
    map.set(row.key, row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Rate limiting: space requests per retailer_key group per
// retailer_programmes.fetch_policy.maxPerMinute (ADR-011 D4). Offers with no
// matching programme (retailer_key null, or a key not found) share one
// "unknown" bucket at the conservative default.
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RetailerLimiter {
  private lastFetchAt = new Map<string, number>();

  constructor(private readonly maxPerMinuteByKey: Map<string, number>) {}

  async waitForTurn(bucketKey: string): Promise<void> {
    const maxPerMinute = this.maxPerMinuteByKey.get(bucketKey) ?? DEFAULT_MAX_PER_MINUTE;
    const minIntervalMs = maxPerMinute > 0 ? Math.ceil(60_000 / maxPerMinute) : 0;
    const last = this.lastFetchAt.get(bucketKey);
    const now = Date.now();
    if (last !== undefined && minIntervalMs > 0) {
      const elapsed = now - last;
      if (elapsed < minIntervalMs) {
        await sleep(minIntervalMs - elapsed);
      }
    }
    this.lastFetchAt.set(bucketKey, Date.now());
  }
}

// ---------------------------------------------------------------------------
// Fetch with one retry on a transient-looking failure (403/429/5xx/network
// error/timeout). robots.txt/size-cap/invalid-URL blocks (fetchPage's own
// `blocked: true`) are never retried, a retry cannot change a static
// robots.txt rule.
// ---------------------------------------------------------------------------
function isTransientFailureStatus(status: number): boolean {
  return status === 0 || status === 403 || status === 429 || status >= 500;
}

class TargetRefused extends Error {}

async function fetchWithRetry(url: string, allowedHosts: string[]): Promise<FetchPageResult> {
  const first = await fetchPage(url, allowedHosts);
  if (first.blocked) return first;
  if (!isTransientFailureStatus(first.status)) return first;
  return await fetchPage(url, allowedHosts);
}

// ---------------------------------------------------------------------------
// FR-52: AI suggestion on an unparsed 200. A small, focused, guarded call
// mirroring ai-search/llm.ts's own shape (env-only key, hard timeout, never
// throws); llm.ts's `callClaude` is internal to that module, not exported.
// ---------------------------------------------------------------------------
interface AiSuggestion {
  stillSold: boolean;
  price: number | null;
  reason: string;
}
interface AiSuggestionResult {
  suggestion: AiSuggestion | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

async function fetchAiSuggestion(pageText: string): Promise<AiSuggestionResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { suggestion: null, usage: null };

  const capped = pageText.length > AI_SUGGESTION_TEXT_CAP_BYTES ? pageText.slice(0, AI_SUGGESTION_TEXT_CAP_BYTES) : pageText;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SUGGESTION_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: AI_SUGGESTION_MODEL,
        max_tokens: 250,
        system:
          "You read the fetched text of a retailer product page that a mechanical extractor could not parse (no JSON-LD, no Open Graph, no known selector matched). " +
          "Answer whether the product is still sold on this page, and at what price if visible. Be brief and factual, never speculate beyond the text given.",
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                stillSold: { type: "boolean" },
                price: { type: ["number", "null"] },
                reason: { type: "string" },
              },
              required: ["stillSold", "price", "reason"],
            },
          },
        },
        messages: [{ role: "user", content: capped }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { suggestion: null, usage: null };
    const msg = (await res.json()) as Record<string, unknown>;
    const usageBlock = msg.usage as Record<string, unknown> | undefined;
    const usage = usageBlock
      ? {
          inputTokens: typeof usageBlock.input_tokens === "number" ? usageBlock.input_tokens : 0,
          outputTokens: typeof usageBlock.output_tokens === "number" ? usageBlock.output_tokens : 0,
        }
      : null;

    const content = msg.content;
    const textBlock = Array.isArray(content)
      ? content.find((b) => b && typeof b === "object" && (b as Record<string, unknown>).type === "text")
      : null;
    const text = textBlock ? (textBlock as Record<string, unknown>).text : null;
    if (typeof text !== "string") return { suggestion: null, usage };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { suggestion: null, usage };
    }
    if (!parsed || typeof parsed !== "object") return { suggestion: null, usage };
    const p = parsed as Record<string, unknown>;
    if (typeof p.stillSold !== "boolean" || typeof p.reason !== "string") return { suggestion: null, usage };
    const price = typeof p.price === "number" && Number.isFinite(p.price) ? p.price : null;
    return { suggestion: { stillSold: p.stillSold, price, reason: p.reason }, usage };
  } catch {
    // Timeout, network error, abort: never blocks the sweep.
    return { suggestion: null, usage: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reuses the SAME `ai_spend_daily` ledger and `ai_search_daily_budget()` RPC
 * ai-search/spend-guard.ts's own budget gate reads (D1). No per-user
 * throttle here (gear-recheck has no caller identity to throttle by; the
 * sweep's own per-retailer rate limit is the analogous guard on this path).
 * Fails toward "spend nothing" on any read error, matching spend-guard.ts's
 * documented fail-closed posture for AI spend specifically.
 */
async function isOverDailyAiBudget(svc: AnySupabaseClient): Promise<boolean> {
  try {
    const { data: budgetData, error: budgetError } = await svc.rpc("ai_search_daily_budget");
    if (budgetError) return true;
    const budget = typeof budgetData === "number" ? budgetData : Number(budgetData);
    if (!Number.isFinite(budget)) return true;

    const today = new Date().toISOString().slice(0, 10);
    const { data: spendRow, error: spendError } = await svc
      .from("ai_spend_daily")
      .select("est_usd")
      .eq("day", today)
      .maybeSingle();
    if (spendError) return true;

    const spent = spendRow && typeof spendRow.est_usd !== "undefined" ? Number(spendRow.est_usd) : 0;
    if (!Number.isFinite(spent)) return true;
    return spent >= budget;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Per-offer processing
// ---------------------------------------------------------------------------
interface ProcessResult {
  offerId: string;
  affiliateProductId: string;
  outcome: Outcome;
}

async function processOffer(
  svc: AnySupabaseClient,
  offer: OfferRow,
  programme: RetailerProgrammeRow | undefined,
): Promise<ProcessResult> {
  const url = offer.canonical_url ?? offer.affiliate_url;
  let logOutcome: LogOutcome = "blocked";
  let offerOutcome: Outcome = "blocked";
  let httpStatus: number | null = null;
  let priceSeen: number | null = null;
  let inStockSeen: boolean | null = null;
  let notes: string | undefined;
  let aiSuggestion: AiSuggestion | null = null;

  try {
    // Red team 2026-09-18: a stored URL is only ever re-fetched against the
    // hosts of the programme it belongs to; an offer with no programme is a
    // `blocked` outcome, never a fetch (CWE-918).
    if (!programme || !(programme.url_patterns ?? []).length) {
      throw new TargetRefused("No retailer programme for this offer; not fetched.");
    }
    const page = await fetchWithRetry(url, programme.url_patterns ?? []);
    httpStatus = page.status > 0 ? page.status : null;

    if (page.blocked) {
      logOutcome = "blocked";
      offerOutcome = "blocked";
      notes = page.reason;
    } else if (page.status === 404 || page.status === 410) {
      logOutcome = "gone";
      offerOutcome = "gone";
    } else if (isTransientFailureStatus(page.status)) {
      logOutcome = "blocked";
      offerOutcome = "blocked";
      notes = page.reason ?? `HTTP ${page.status}`;
    } else if (page.status >= 200 && page.status < 300) {
      const draft: ProductDraft | null = extractProduct(
        page.html,
        page.finalUrl,
        programme ? { key: programme.key, extractor: programme.extractor } : null,
      );

      if (!draft) {
        // A 200 no strategy could parse. Enum on product_offers has no
        // "unparsed" value; the offer's own outcome degrades to "gone"
        // (ADR-011 D4 / this ticket's contract) while the LOG keeps the
        // more precise "unparsed" for the health page/admin review.
        logOutcome = "unparsed";
        offerOutcome = "gone";

        if (llmEnabled() && !(await isOverDailyAiBudget(svc))) {
          const { suggestion, usage } = await fetchAiSuggestion(page.html);
          aiSuggestion = suggestion;
          if (usage) await recordAiSpend(svc, usage.inputTokens, usage.outputTokens);
        }
      } else {
        priceSeen = draft.price;
        inStockSeen = draft.inStock;
        if (draft.inStock === false) {
          logOutcome = "out_of_stock";
          offerOutcome = "out_of_stock";
        } else if (draft.price !== null && Math.abs(Number(draft.price) - Number(offer.price)) > 0.001) {
          logOutcome = "price_changed";
          offerOutcome = "price_changed";
        } else {
          logOutcome = "ok";
          offerOutcome = "ok";
        }
      }
    } else {
      // Any other unexpected status (redirect loop that never resolved,
      // 1xx, etc.): treat conservatively as blocked, never as gone (gone is
      // reserved for the explicit 404/410 the retailer itself asserted).
      logOutcome = "blocked";
      offerOutcome = "blocked";
      notes = `Unexpected HTTP ${page.status}.`;
    }
  } catch (err) {
    await captureEdgeError(err, { fn: "gear-recheck", offerId: offer.id, stage: "fetch-or-extract" });
    logOutcome = "blocked";
    offerOutcome = "blocked";
    notes = err instanceof Error ? err.message : String(err);
  }

  const consecutiveFailures =
    offerOutcome === "gone" || offerOutcome === "blocked" ? offer.consecutive_failures + 1 : 0;

  const offerUpdate: Record<string, unknown> = {
    last_checked_at: new Date().toISOString(),
    last_check_outcome: offerOutcome,
    consecutive_failures: consecutiveFailures,
  };
  if (offerOutcome === "price_changed" && priceSeen !== null) {
    offerUpdate.price = priceSeen;
    offerUpdate.last_price_change_at = new Date().toISOString();
  }
  if (offerOutcome === "out_of_stock") {
    offerUpdate.in_stock = false;
  } else if (offerOutcome === "ok" || offerOutcome === "price_changed") {
    offerUpdate.in_stock = true;
  }
  // gone/blocked: leave in_stock as-is, a failed fetch is not evidence of
  // stock state either way.

  const { error: updateError } = await svc.from("product_offers").update(offerUpdate).eq("id", offer.id);
  if (updateError) {
    await captureEdgeError(new Error(updateError.message), { fn: "gear-recheck", offerId: offer.id, stage: "offer-update" });
  }

  const { error: logError } = await svc.from("product_fetch_log").insert({
    offer_id: offer.id,
    outcome: logOutcome,
    http_status: httpStatus,
    price_seen: priceSeen,
    in_stock_seen: inStockSeen,
    notes: notes ?? null,
    ai_suggestion: aiSuggestion,
  });
  if (logError) {
    await captureEdgeError(new Error(logError.message), { fn: "gear-recheck", offerId: offer.id, stage: "fetch-log-insert" });
  }

  return { offerId: offer.id, affiliateProductId: offer.affiliate_product_id, outcome: offerOutcome };
}

// ---------------------------------------------------------------------------
// Post-sweep: 7-strike auto-delist (FR-51, AC-11-4) and health_status
// rollup (FR-49's "worst first").
// ---------------------------------------------------------------------------
const SEVERITY_WORST_FIRST: Outcome[] = ["gone", "blocked", "out_of_stock", "price_changed", "ok"];

function worstOutcome(outcomes: Outcome[]): Outcome {
  let worst: Outcome = "ok";
  let worstRank = SEVERITY_WORST_FIRST.length;
  for (const o of outcomes) {
    const rank = SEVERITY_WORST_FIRST.indexOf(o);
    if (rank !== -1 && rank < worstRank) {
      worstRank = rank;
      worst = o;
    }
  }
  return worst;
}

async function finalizeProducts(
  svc: AnySupabaseClient,
  productIds: string[],
): Promise<string[]> {
  const autoDelisted: string[] = [];

  for (const productId of productIds) {
    const { data: offers, error: offersError } = await svc
      .from("product_offers")
      .select("consecutive_failures, last_check_outcome")
      .eq("affiliate_product_id", productId);
    if (offersError || !offers || offers.length === 0) continue;

    const outcomes = (offers as Array<{ last_check_outcome: string | null }>)
      .map((o) => o.last_check_outcome)
      .filter((o): o is Outcome => o === "ok" || o === "price_changed" || o === "out_of_stock" || o === "gone" || o === "blocked");
    const health = outcomes.length > 0 ? worstOutcome(outcomes) : "ok";

    const { error: healthError } = await svc
      .from("affiliate_products")
      .update({ health_status: health, health_checked_at: new Date().toISOString() })
      .eq("id", productId);
    if (healthError) {
      await captureEdgeError(new Error(healthError.message), { fn: "gear-recheck", productId, stage: "health-update" });
    }

    const everyOfferStruck = (offers as Array<{ consecutive_failures: number }>).every((o) => o.consecutive_failures >= 7);
    if (!everyOfferStruck) continue;

    const { data: product, error: productError } = await svc
      .from("affiliate_products")
      .select("active")
      .eq("id", productId)
      .maybeSingle();
    if (productError || !product || product.active === false) continue;

    const { error: delistError } = await svc.rpc("system_auto_delist_affiliate_product", {
      p_id: productId,
      p_reason: "Every offer has been gone or blocked for 7 consecutive nightly checks.",
    });
    if (delistError) {
      await captureEdgeError(new Error(delistError.message), { fn: "gear-recheck", productId, stage: "auto-delist" });
      continue;
    }
    autoDelisted.push(productId);
  }

  return autoDelisted;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
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

    const offers = "sweep" in body ? await loadSweepOffers(svc, body.limit) : await loadProductOffers(svc, body.productId);

    const retailerKeys = [...new Set(offers.map((o) => o.retailer_key).filter((k): k is string => !!k))];
    const programmes = await loadProgrammes(svc, retailerKeys);

    const maxPerMinuteByKey = new Map<string, number>();
    for (const [key, programme] of programmes) {
      maxPerMinuteByKey.set(key, programme.fetch_policy?.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE);
    }
    const limiter = new RetailerLimiter(maxPerMinuteByKey);

    // Grouped by retailer (ADR-011 D4): process one retailer's offers fully
    // before the next, spacing each fetch inside a group per its
    // fetch_policy.maxPerMinute. One offer failing never stops the sweep;
    // processOffer itself never throws.
    const byRetailer = new Map<string, OfferRow[]>();
    for (const offer of offers) {
      const bucket = offer.retailer_key ?? "__unmatched__";
      if (!byRetailer.has(bucket)) byRetailer.set(bucket, []);
      byRetailer.get(bucket)!.push(offer);
    }

    const outcomes: Array<{ offerId: string; outcome: Outcome }> = [];
    const touchedProductIds = new Set<string>();

    for (const [bucket, bucketOffers] of byRetailer) {
      const programme = bucket === "__unmatched__" ? undefined : programmes.get(bucket);
      for (const offer of bucketOffers) {
        await limiter.waitForTurn(bucket);
        const result = await processOffer(svc, offer, programme);
        outcomes.push({ offerId: result.offerId, outcome: result.outcome });
        touchedProductIds.add(result.affiliateProductId);
      }
    }

    const autoDelisted = await finalizeProducts(svc, [...touchedProductIds]);

    return jsonResponse({
      checked: outcomes.length,
      outcomes,
      autoDelisted,
      mode: llmEnabled() ? "llm" : "keyword",
    });
  })
);
