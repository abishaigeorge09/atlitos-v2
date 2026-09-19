import type { Db, Sport } from "@atlitos/types";

import { parseRpcError, type CommerceError } from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 admin, PRD-07 section 10 (affiliate model). The one place apps/admin
// talks to the affiliate gear catalog (0086: affiliate_products + product_offers).
// Same posture as pages/drills/api.ts: EVERY mutation routes through a 0120
// admin RPC, never a table write. The tables carry no client write grant at
// all, so a direct insert from the browser is refused by the database, not
// merely discouraged here.
//
//   * admin_upsert_affiliate_product(p_id, ...)  create (p_id null) or edit
//   * admin_set_affiliate_product_active(p_id, p_active)  list or delist
//   * admin_upsert_product_offer(product, retailer, price, url, ...)  one
//     retailer line; (product, retailer) is unique so re-entering a retailer
//     updates its price in place
//   * admin_delete_product_offer(p_id)  remove a wrong retailer line
//
// Reads: 0120 adds an admin SELECT policy on both tables so this list is the
// one surface that sees delisted products (the shopper surface keeps its
// active = true filter). Every narrowing is applied as its own explicit
// filter, per the permissive-OR rule in CLAUDE.md.

export type { CommerceError };

export type AffiliateProductRow = Db.AffiliateProductRow;
export type ProductOfferRow = Db.ProductOfferRow;

// ---- shop search: ingest + catalog health (Phase S2, PRD-07 section 11) --
// FR-44, FR-45, FR-49, FR-50, FR-52; ADR-011 D3, D4. The `_health` suffixed
// types below carry the columns Track C's `0123_gear_ingest_health.sql`
// lands on `affiliate_products` and `product_offers` (health_status,
// health_checked_at, auto_delisted_at, image_path; canonical_url,
// retailer_key, last_check_outcome, consecutive_failures,
// last_price_change_at). They are declared here rather than added to
// `packages/types/src/db/rows.ts` because that file is Track C's, not this
// track's, to change; once C's migration lands the base `Db` rows gain the
// same columns and this file's extensions become a no-op superset.

/** `product_fetch_log.outcome`: the five offer outcomes plus `unparsed`, which
 * only ever appears on the log (a 200 no strategy parsed; the offer itself is
 * recorded as `gone`). `product_offers.last_check_outcome` is the five. */
export type OfferOutcome = "ok" | "price_changed" | "out_of_stock" | "gone" | "blocked" | "unparsed";
export type OfferCheckOutcome = Exclude<OfferOutcome, "unparsed">;

export interface HealthOfferRow extends ProductOfferRow {
  canonical_url: string | null;
  retailer_key: string | null;
  last_check_outcome: OfferCheckOutcome | null;
  consecutive_failures: number;
  last_price_change_at: string | null;
}

export interface HealthAffiliateProductRow extends AffiliateProductRow {
  health_status: OfferOutcome | null;
  health_checked_at: string | null;
  auto_delisted_at: string | null;
  image_path: string | null;
}

export interface GearInput {
  id?: string | null;
  title: string;
  brand: string | null;
  sport: Sport | null;
  categoryId: string | null;
  skillLevel: string | null;
  ageRange: string | null;
  description: string | null;
  imageUrl: string | null;
}

export interface OfferInput {
  retailer: string;
  price: number;
  affiliateUrl: string;
  inStock: boolean;
}

export interface GearListFilters {
  sport?: Sport;
  active?: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
}

/** A product with its offers folded in for the list and show screens. */
export interface GearWithOffers extends HealthAffiliateProductRow {
  offers: HealthOfferRow[];
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw parseRpcError(error.message);
  return data as T;
}

export const gearApi = {
  // Phase S1 Track B (PRD-07 FR-43; ADR-011 D2). After a create or edit, kick
  // off (never block on) the embedding write: `gear-embed` is the ONE place
  // `affiliate_products.embedding` is written (AC-11-7), always under its own
  // service role, and this call carries only the id. Failure is ignored here
  // on purpose: an embedding gap self-heals through the nightly sweep
  // (`{ sweep: true }`), and a shopper still finds the product through the
  // deterministic keyword path with a null embedding (FR-43).
  upsertProduct: async (input: GearInput) => {
    const product = await callRpc<AffiliateProductRow>("admin_upsert_affiliate_product", {
      p_id: input.id ?? null,
      p_title: input.title,
      p_brand: input.brand,
      p_sport: input.sport,
      p_category_id: input.categoryId,
      p_skill_level: input.skillLevel,
      p_age_range: input.ageRange,
      p_description: input.description,
      p_image_url: input.imageUrl,
    });
    void supabaseClient.functions.invoke("gear-embed", { body: { productId: product.id } }).catch(() => {});
    return product;
  },

  setProductActive: (id: string, active: boolean) =>
    callRpc<AffiliateProductRow>("admin_set_affiliate_product_active", { p_id: id, p_active: active }),

  upsertOffer: (productId: string, offer: OfferInput) =>
    callRpc<ProductOfferRow>("admin_upsert_product_offer", {
      p_affiliate_product_id: productId,
      p_retailer: offer.retailer,
      p_price: offer.price,
      p_affiliate_url: offer.affiliateUrl,
      p_in_stock: offer.inStock,
      p_currency: "INR",
    }),

  deleteOffer: (offerId: string) => callRpc<void>("admin_delete_product_offer", { p_id: offerId }),
};

const PRODUCT_SELECT =
  "id,title,brand,sport,category_id,skill_level,age_range,description,image_url,active,created_at,updated_at," +
  "health_status,health_checked_at,auto_delisted_at,image_path";
const OFFER_SELECT =
  "id,affiliate_product_id,retailer,price,currency,affiliate_url,in_stock,last_checked_at,created_at,updated_at," +
  "canonical_url,retailer_key,last_check_outcome,consecutive_failures,last_price_change_at";

export async function fetchGear(filters: GearListFilters = {}): Promise<GearWithOffers[]> {
  let query = supabaseClient.from("affiliate_products").select(PRODUCT_SELECT).order("created_at", { ascending: false });
  if (filters.sport) query = query.eq("sport", filters.sport);
  if (filters.active !== undefined) query = query.eq("active", filters.active);
  const { data, error } = await query;
  if (error) throw parseRpcError(error.message);
  const products = (data as unknown as HealthAffiliateProductRow[]) ?? [];
  if (products.length === 0) return [];

  const { data: offers, error: offersError } = await supabaseClient
    .from("product_offers")
    .select(OFFER_SELECT)
    .in(
      "affiliate_product_id",
      products.map((p) => p.id),
    )
    .order("price", { ascending: true });
  if (offersError) throw parseRpcError(offersError.message);
  const byProduct = new Map<string, HealthOfferRow[]>();
  for (const offer of (offers as unknown as HealthOfferRow[]) ?? []) {
    const list = byProduct.get(offer.affiliate_product_id) ?? [];
    list.push(offer);
    byProduct.set(offer.affiliate_product_id, list);
  }
  return products.map((p) => ({ ...p, offers: byProduct.get(p.id) ?? [] }));
}

export async function fetchGearItem(id: string): Promise<GearWithOffers | null> {
  const { data, error } = await supabaseClient
    .from("affiliate_products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw parseRpcError(error.message);
  if (!data) return null;
  const { data: offers, error: offersError } = await supabaseClient
    .from("product_offers")
    .select(OFFER_SELECT)
    .eq("affiliate_product_id", id)
    .order("price", { ascending: true });
  if (offersError) throw parseRpcError(offersError.message);
  return { ...(data as unknown as HealthAffiliateProductRow), offers: (offers as unknown as HealthOfferRow[]) ?? [] };
}

export async function fetchCategories(): Promise<CategoryOption[]> {
  const { data, error } = await supabaseClient.from("categories").select("id,name").order("name");
  if (error) throw parseRpcError(error.message);
  return (data as CategoryOption[]) ?? [];
}

// ---- ingest: "Add from a link" (FR-44, FR-45, FR-47, ADR-011 D3) ---------

export interface IngestDraft {
  title: string;
  brand: string | null;
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  imageUrl: string | null;
  canonicalUrl: string | null;
  description: string | null;
}

export interface IngestFetchResult {
  draft: IngestDraft;
  retailerKey: string | null;
  warnings: string[];
}

export interface IngestSaveResult {
  productId: string;
  offerId: string;
  imagePath: string;
}

/**
 * Reads a `FunctionsHttpError`'s response body so a 422 refusal (FR-47,
 * "Could not read a product from this page") reaches the caller as a real
 * message instead of "Edge Function returned a non-2xx status code", same
 * shape `advanceOrder` in pages/commerce/api.ts already established.
 */
async function readFunctionError(error: unknown): Promise<CommerceError> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as { error?: { code?: string; message?: string } };
      if (body?.error) {
        return { code: body.error.code ?? "INGEST_FAILED", message: body.error.message ?? "Could not read a product from this page." };
      }
    } catch {
      // body was not JSON; fall through to the generic message below
    }
  }
  const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
  return { code: "INTERNAL", message };
}

/**
 * `fetch` writes nothing (FR-44): no product row, no offer row, no image
 * copy. The draft is for review only until `ingestSave` is called.
 */
export async function ingestFetch(url: string): Promise<IngestFetchResult> {
  const { data, error } = await supabaseClient.functions.invoke("gear-ingest", {
    body: { action: "fetch", url },
  });
  if (error) throw await readFunctionError(error);
  const body = data as { draft: IngestDraft; retailer_key: string | null; warnings?: string[] };
  return { draft: body.draft, retailerKey: body.retailer_key, warnings: body.warnings ?? [] };
}

/**
 * `save` runs the image copy and the two extended admin RPC calls under the
 * admin's own JWT (ADR-011 D3); this client never writes the catalogue
 * tables directly.
 */
export async function ingestSave(url: string, draft: IngestDraft): Promise<IngestSaveResult> {
  const { data, error } = await supabaseClient.functions.invoke("gear-ingest", {
    body: { action: "save", url, draft },
  });
  if (error) throw await readFunctionError(error);
  const body = data as { productId: string; offerId: string; imagePath: string };
  return body;
}

// ---- catalog health (FR-49, FR-50, FR-52, ADR-011 D4) --------------------

const HEALTH_RANK: Record<OfferOutcome | "none", number> = {
  gone: 0,
  blocked: 0,
  unparsed: 1,
  out_of_stock: 2,
  price_changed: 2,
  ok: 3,
  none: 1,
};

export interface HealthRow {
  product: HealthAffiliateProductRow;
  offers: HealthOfferRow[];
  worstOutcome: OfferOutcome | null;
  offersAlive: number;
  offersTotal: number;
  cheapest: { price: number; currency: string; offer: HealthOfferRow } | null;
  daysSinceChecked: number | null;
}

function offerIsAlive(offer: HealthOfferRow): boolean {
  return offer.last_check_outcome !== "gone" && offer.last_check_outcome !== "blocked";
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function worstOutcomeOf(offers: HealthOfferRow[]): OfferOutcome | null {
  if (offers.length === 0) return null;
  let worst: OfferOutcome | null = null;
  let worstRank = Infinity;
  for (const offer of offers) {
    const key = offer.last_check_outcome ?? "none";
    const rank = HEALTH_RANK[key];
    if (rank < worstRank) {
      worstRank = rank;
      worst = offer.last_check_outcome;
    }
  }
  return worst;
}

/** Any offer failing a check hard enough that an admin should look at it. */
export function needsAttention(row: HealthRow): boolean {
  return row.offers.some(
    (o) => o.last_check_outcome === "gone" || o.last_check_outcome === "blocked" || o.last_check_outcome === "out_of_stock",
  );
}

/**
 * Every affiliate product, worst first: gone/blocked, then unparsed, then
 * price_changed/out_of_stock, then ok (FR-49). Reads carry no narrowing
 * filter here on purpose, same as `fetchGear`'s admin-only SELECT policy;
 * this page IS the admin review surface for delisted and listed alike.
 */
export async function fetchHealth(): Promise<HealthRow[]> {
  const { data, error } = await supabaseClient
    .from("affiliate_products")
    .select(PRODUCT_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw parseRpcError(error.message);
  const products = (data as unknown as HealthAffiliateProductRow[]) ?? [];
  if (products.length === 0) return [];

  const { data: offers, error: offersError } = await supabaseClient
    .from("product_offers")
    .select(OFFER_SELECT)
    .in(
      "affiliate_product_id",
      products.map((p) => p.id),
    );
  if (offersError) throw parseRpcError(offersError.message);
  const byProduct = new Map<string, HealthOfferRow[]>();
  for (const offer of (offers as unknown as HealthOfferRow[]) ?? []) {
    const list = byProduct.get(offer.affiliate_product_id) ?? [];
    list.push(offer);
    byProduct.set(offer.affiliate_product_id, list);
  }

  const rows: HealthRow[] = products.map((product) => {
    const productOffers = byProduct.get(product.id) ?? [];
    const alive = productOffers.filter(offerIsAlive);
    const inStockOffers = productOffers.filter((o) => o.in_stock);
    const cheapestOffer = inStockOffers.length > 0 ? inStockOffers.reduce((a, b) => (Number(a.price) <= Number(b.price) ? a : b)) : null;
    return {
      product,
      offers: productOffers,
      worstOutcome: worstOutcomeOf(productOffers),
      offersAlive: alive.length,
      offersTotal: productOffers.length,
      cheapest: cheapestOffer ? { price: Number(cheapestOffer.price), currency: cheapestOffer.currency, offer: cheapestOffer } : null,
      daysSinceChecked: daysSince(product.health_checked_at),
    };
  });

  return rows.sort((a, b) => {
    const rankA = HEALTH_RANK[a.worstOutcome ?? "none"];
    const rankB = HEALTH_RANK[b.worstOutcome ?? "none"];
    if (rankA !== rankB) return rankA - rankB;
    const daysA = a.daysSinceChecked ?? -1;
    const daysB = b.daysSinceChecked ?? -1;
    return daysB - daysA;
  });
}

/**
 * `productId` argument, admin JWT (ADR-011 D4's "Re-check now"), one product
 * only; the `{ sweep: true }` form is the nightly job's, service role only.
 */
export async function recheckProduct(productId: string): Promise<{ checked: number; outcomes: Array<{ offerId: string; outcome: OfferOutcome }> }> {
  const { data, error } = await supabaseClient.functions.invoke("gear-recheck", {
    body: { productId },
  });
  if (error) throw await readFunctionError(error);
  return data as { checked: number; outcomes: Array<{ offerId: string; outcome: OfferOutcome }> };
}

// ---- AI suggestion box (FR-52) --------------------------------------------

export interface FetchLogSuggestion {
  offerId: string;
  fetchedAt: string;
  suggestion: Record<string, unknown>;
}

/**
 * The latest `product_fetch_log` row across every offer of this product that
 * carries a non-null `ai_suggestion`, admin-read-only per ADR-011 D6.
 * Suggestion only, nothing is ever applied automatically (FR-52). Scoped to
 * this product's own offers explicitly (the permissive-OR rule, CLAUDE.md):
 * `product_fetch_log` has no `affiliate_product_id` column of its own, so the
 * offer id list is fetched first and used to narrow the log query.
 */
export async function fetchLatestSuggestions(productId: string): Promise<FetchLogSuggestion | null> {
  const { data: offers, error: offersError } = await supabaseClient
    .from("product_offers")
    .select("id")
    .eq("affiliate_product_id", productId);
  if (offersError) throw parseRpcError(offersError.message);
  const offerIds = ((offers as Array<{ id: string }>) ?? []).map((o) => o.id);
  if (offerIds.length === 0) return null;

  const { data, error } = await supabaseClient
    .from("product_fetch_log")
    .select("offer_id,fetched_at,ai_suggestion")
    .in("offer_id", offerIds)
    .not("ai_suggestion", "is", null)
    .order("fetched_at", { ascending: false })
    .limit(1);
  if (error) throw parseRpcError(error.message);
  const rows = (data as Array<{ offer_id: string; fetched_at: string; ai_suggestion: Record<string, unknown> }>) ?? [];
  const row = rows[0];
  if (!row) return null;
  return { offerId: row.offer_id, fetchedAt: row.fetched_at, suggestion: row.ai_suggestion };
}
