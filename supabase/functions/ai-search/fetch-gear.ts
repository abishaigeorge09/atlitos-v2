// ATLITOS v2 — supabase/functions/ai-search/fetch-gear.ts
//
// Gear candidates: the owned catalogue behind its flag, the affiliate
// catalogue through full text recall (0136), and the vector recall path
// (ADR-011 D1). Moved out of index.ts unchanged in Phase L0 (ADR-014 component
// boundaries; docs/PLAN-SEARCH-LOCATION-AFFILIATE.md L0-T2). Phase L1 adds rank
// carry through and fuzzy expansion here (ADR-014 D2, D3).
//
// `background` lives here because the vector recall's cache write is its first
// user; index.ts imports it for the spend record after a rerank.

import { AppError } from "../_shared/app-error.ts";
import { type Candidate, capitalize, type ParsedIntent, type Sport, VECTOR_SIMILARITY_FLOOR } from "./search-core.ts";
import { recordVoyageSpend } from "./spend-guard.ts";
import { embeddingsMode, embedTexts } from "../_shared/embeddings.ts";

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// deno-lint-ignore no-explicit-any
export async function fetchProducts(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  // The OWNED catalogue is hidden while shop.owned_enabled is false (the
  // launch setting). The shop screen filtered these out client side, but home
  // search did not, so owned products the shop hides were offered there.
  // Checked here, once, for every caller.
  const { data: flag } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "shop.owned_enabled")
    .eq("public", true)
    .maybeSingle();
  if (flag?.value !== true) return [];

  let q = supabase
    .from("products")
    .select("id, title, description, sport, base_price")
    .eq("active", true)
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load products: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return rows.map((r): Candidate => ({
    entityType: "gear",
    entityId: r.id as string,
    title: (r.title as string) ?? "Product",
    subtitle: capitalize((r.sport as string) ?? "Gear"),
    sport: (r.sport as Sport) ?? undefined,
    price: numberOrUndefined(r.base_price),
    rating: undefined,
    distanceKm: undefined,
    text: [r.title, r.sport, r.description].filter(Boolean).join(" ").toLowerCase(),
  }));
}

// Affiliate catalog (0086, WS4). External products priced per-retailer in
// `product_offers`; the candidate carries the CHEAPEST in-stock offer as its
// price so a "brand under N" query compares against the best available price,
// and folds `brand`, `skill_level` and `age_range` into the searchable text so
// the WS3 honesty gate can treat brand as a hard constraint. Same public
// `active = true` scope as the owned catalog. Emitted as `entityType: "gear"`
// so affiliate and owned gear rank against each other in one result set; the
// `entityId` is prefixed `affiliate:` so the client can route it to the compare
// view rather than the owned PDP.
// `ids`, when given, hydrates exactly those affiliate_products rows (the
// D1 vector-recall path: `match_affiliate_products` returns ids + similarity,
// this fetch turns them into the same Candidate shape the keyword path
// already produces, so scoring/honesty never need a second code path). The
// sport filter is intentionally NOT applied in that mode: the vector match
// itself is the relevance signal for those rows (AC-11-2 names no sport
// filter either), and re-filtering by the deterministic parse's guessed
// sport would silently drop a correct vector hit whose sport the parser
// missed.
// deno-lint-ignore no-explicit-any
export async function fetchAffiliateProducts(supabase: any, intent: ParsedIntent, ids?: string[]): Promise<Candidate[]> {
  const SELECT = "id, title, brand, sport, skill_level, age_range, description, image_url, product_offers ( price, in_stock )";

  // Keyword recall (0136). The old path read the first 50 active rows in no
  // order and scored those, so on a catalogue of hundreds a product that
  // exactly matched the query was often never looked at. Now the query's
  // meaningful terms go through the full text index and the best ranked
  // products are recalled; scoring and the honesty gate still decide what is
  // shown. A query with no terms ("tennis") lists newest first, by sport.
  if (!ids) {
    const terms = [...new Set([...intent.keywords, intent.brand, intent.nounHint].filter((t): t is string => !!t && t.length >= 2))];
    if (terms.length > 0) {
      const { data: ranked, error: rankError } = await supabase.rpc("search_affiliate_product_ids", {
        p_terms: terms,
        p_sport: intent.sport === "general" ? null : intent.sport,
        p_limit: 50,
      });
      if (rankError) throw new AppError("INTERNAL", `Failed to search affiliate products: ${rankError.message}`, 500);
      ids = ((ranked ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (ids.length === 0) return [];
    }
  }

  let q = supabase.from("affiliate_products").select(SELECT).eq("active", true);
  if (ids) {
    if (ids.length === 0) return [];
    q = q.in("id", ids);
  } else {
    if (intent.sport !== "general") q = q.eq("sport", intent.sport);
    q = q.order("created_at", { ascending: false }).limit(50);
  }

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load affiliate products: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return rows.map((r): Candidate => {
    const offers = Array.isArray(r.product_offers) ? (r.product_offers as Array<Record<string, unknown>>) : [];
    const inStockPrices = offers
      .filter((o) => o.in_stock !== false)
      .map((o) => Number(o.price))
      .filter((p) => Number.isFinite(p));
    const allPrices = offers.map((o) => Number(o.price)).filter((p) => Number.isFinite(p));
    // Cheapest in-stock offer, falling back to the cheapest offer overall so a
    // fully-sold-out product still carries a price for the ceiling test.
    const price = inStockPrices.length > 0 ? Math.min(...inStockPrices) : allPrices.length > 0 ? Math.min(...allPrices) : undefined;
    const brand = (r.brand as string) ?? "";
    return {
      entityType: "gear",
      entityId: `affiliate:${r.id as string}`,
      title: (r.title as string) ?? "Product",
      subtitle: [brand, capitalize((r.sport as string) ?? "Gear")].filter(Boolean).join(" . "),
      imageUrl: typeof r.image_url === "string" ? r.image_url : undefined,
      sport: (r.sport as Sport) ?? undefined,
      price,
      rating: undefined,
      distanceKm: undefined,
      // brand / skill_level / age_range are the WS3 attributes: folding them into
      // the text blob is what lets `passesHardConstraints` match `intent.brand`
      // against a real Babolat row and answer "Babolat under 2000" precisely.
      text: [r.title, brand, r.sport, r.skill_level, r.age_range, r.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });
}

// --------------------------------------------------------------------------
// Vector recall (ADR-011 D1): query embedding, cached, then
// match_affiliate_products. Both the cache table and the RPC are service
// role only (AC-11-7), so this always runs against `svc`, never the caller's
// own JWT client.
// --------------------------------------------------------------------------

const QUERY_CACHE_TTL_MS = 10 * 60 * 1000;

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface VectorMatch {
  id: string;
  similarity: number;
}

/**
 * Embeds `query` (cache-first, 10 minute TTL, `query_embedding_cache`) and
 * recalls candidate affiliate product ids through `match_affiliate_products`.
 * Returns `null` on ANY failure (Voyage down, RPC error, cache read/write
 * error) so the caller's only job is "did this succeed", never inspecting
 * partial state; per D1/FR-42, a failure here degrades the request to
 * vector-less results, never an error response.
 *
 * Records a Voyage spend entry ONLY when a fresh (non-cached) call actually
 * ran against the real Voyage API (`embeddingsMode() === "voyage"`); a cache
 * hit or the offline stub never costs anything and never touches the ledger.
 */
/** The cache row for a query, read early so it can overlap the table reads
 * (it is a read, not a spend; only the Voyage call waits for the gate). */
// deno-lint-ignore no-explicit-any
export async function readQueryCache(svc: any, query: string): Promise<{ hash: string; cached: { embedding: string; created_at: string } | null }> {
  const hash = await sha256Hex(query.toLowerCase().trim());
  const { data, error } = await svc
    .from("query_embedding_cache")
    .select("embedding, created_at")
    .eq("query_hash", hash)
    .maybeSingle();
  return { hash, cached: !error && data ? (data as { embedding: string; created_at: string }) : null };
}

/** Runs a promise after the response is sent when the runtime allows it
 * (`EdgeRuntime.waitUntil`), otherwise lets it float. Used for the two
 * bookkeeping writes on the search path (cache write, spend record) that
 * cost a Mumbai round trip each and that no response depends on. */
export function background(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const swallowed = p.then(() => {}, () => {});
  if (rt?.waitUntil) rt.waitUntil(swallowed);
}

// deno-lint-ignore no-explicit-any
export async function recallByVector(svc: any, query: string, pre: { hash: string; cached: { embedding: string; created_at: string } | null }): Promise<VectorMatch[] | null> {
  try {
    const { hash, cached } = pre;

    let vector: number[] | null = null;
    if (cached) {
      const age = Date.now() - new Date(cached.created_at as string).getTime();
      if (age < QUERY_CACHE_TTL_MS) {
        try {
          const parsed = JSON.parse(cached.embedding as string);
          if (Array.isArray(parsed)) vector = parsed as number[];
        } catch {
          vector = null; // malformed cache row: fall through to a fresh embed.
        }
      }
    }

    let spentVoyage = false;
    if (!vector) {
      const modeBeforeCall = embeddingsMode();
      const [fresh] = await embedTexts([query], "query");
      vector = fresh;
      spentVoyage = modeBeforeCall === "voyage";

      // Best-effort cache write, off the response path; a failure to cache
      // never fails the request.
      background(
        svc
          .from("query_embedding_cache")
          .upsert(
            { query_hash: hash, embedding: JSON.stringify(vector), created_at: new Date().toISOString() },
            { onConflict: "query_hash" },
          ),
      );
    }

    const { data: matches, error: matchError } = await svc.rpc("match_affiliate_products", {
      query_embedding: JSON.stringify(vector),
      match_threshold: VECTOR_SIMILARITY_FLOOR,
      match_count: 20,
    });
    if (matchError) {
      console.error(`[ai-search] match_affiliate_products errored, skipping vector recall: ${matchError.message}`);
      return null;
    }

    if (spentVoyage) background(recordVoyageSpend(svc));

    return ((matches ?? []) as Array<{ id: string; similarity: number }>).map((m) => ({
      id: m.id,
      similarity: Number(m.similarity),
    }));
  } catch (err) {
    console.error("[ai-search] vector recall failed, skipping:", err);
    return null;
  }
}
