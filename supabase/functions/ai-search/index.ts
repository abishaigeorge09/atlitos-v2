// ATLITOS v2 — supabase/functions/ai-search/index.ts
//
// POST /search, the v1 `aiSearch` contract (API-MAPPING.md "search").
// Body: { query, entityTypes?, sport?, priceMax?, lat?, lng?, city?, limit? }
//   query is the free-text the SearchBar collected. Everything else is an
//   optional narrowing the client already knows (its location store, an
//   explicit segment). All of it is advisory; the server re-derives intent
//   from `query` regardless (parseIntent in search-core.ts).
//
// Response: { query, parsedIntent, results: SearchHit[], broaden? } sorted
//   rankScore desc. `broaden` is set only when the honest answer is an EMPTY
//   result set (PRD-01 FR-16): a specific suggestion derived from the most
//   removable constraint, never generic filler.
//
// Epic AT-3, story AT-144. Two paths behind the same contract:
//   - DETERMINISTIC (default, no key needed): keyword parse + weighted score
//     (search-core.ts), with a real honesty threshold so a query with no true
//     match returns EMPTY + a broaden suggestion rather than top-N filler.
//   - LLM (guarded, BUG-006): when the `ANTHROPIC_API_KEY` edge secret is set,
//     Claude parses intent and reranks candidates (llm.ts). Absent key, slow
//     call, or failure all degrade to the deterministic path; the LLM never
//     blocks or errors the response.
//
// VISIBILITY (CLAUDE.md: "RLS is a floor, not scoping"). Two independent guards
// keep a non-public row from ever reaching a caller:
//   1. Every table is read through `userScopedClient(req)`, the caller's own
//      JWT, so RLS applies to them exactly as PostgREST would apply it.
//   2. Every query ALSO carries its own explicit public filter:
//        - coaches: `coach_profiles_public` view (status = 'verified' baked in).
//        - courts: `active = true` AND `venues.status = 'verified'` inner join.
//        - products: `active = true`.
//        - athletes: `upa_applications.status = 'verified'`.
//        - clips: `clips.status = 'published'`.
//   The service-role client is used for exactly ONE narrow purpose (below),
//   never for any of the reads above: search has no money leg and must not
//   bypass RLS for the data itself.
//
// THROTTLE + BUDGET (LAUNCH Phase 3 Track B, P1-5; PHASE-3-STATUS.md CT-2,
// CT-3). Before any LLM call, `evaluateAiSearchGate` (spend-guard.ts) checks a
// per-user token bucket AND the day's spend against `ai_search_daily_budget()`.
// Over either, the request degrades to the deterministic keyword path, never
// an error (Settled decision 5). This is the one place this function
// constructs a SERVICE ROLE client: `take_rate_limit_token` and
// `record_ai_spend`/`ai_search_daily_budget`/`ai_spend_daily` are service_role
// only grants (CT-2, CT-3), and none of them touch a data table this function
// searches. Response gains `"mode": "llm" | "keyword"`, naming which path the
// gate actually took.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";

import {
  candidateKey,
  type Candidate,
  capitalize,
  ENTITY_TYPES,
  type EntityType,
  evaluateHonesty,
  haversineKm,
  type IntentOverride,
  type ParsedIntent,
  parseIntent,
  scoreCandidates,
  type Sport,
  SPORTS,
  VECTOR_SIMILARITY_FLOOR,
} from "./search-core.ts";
import { llmEnabled, llmParseIntent, llmRerank } from "./llm.ts";
import { evaluateAiSearchGate, recordAiSpend, recordVoyageSpend } from "./spend-guard.ts";
import { embeddingsMode, embedTexts } from "../_shared/embeddings.ts";

// --------------------------------------------------------------------------
// Request
// --------------------------------------------------------------------------

interface SearchRequestBody {
  query: string;
  entityTypes?: EntityType[];
  sport?: Sport;
  priceMax?: number;
  lat?: number;
  lng?: number;
  city?: string;
  limit: number;
}

function parseRequestBody(raw: unknown): SearchRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.query !== "string" || body.query.trim().length === 0) {
    throw new AppError("VALIDATION", "query is required.", 400);
  }
  if (body.query.length > 200) {
    throw new AppError("VALIDATION", "query is too long.", 400);
  }

  let entityTypes: EntityType[] | undefined;
  if (Array.isArray(body.entityTypes)) {
    entityTypes = body.entityTypes.filter(
      (t): t is EntityType => typeof t === "string" && (ENTITY_TYPES as readonly string[]).includes(t),
    );
    if (entityTypes.length === 0) entityTypes = undefined;
  }

  let sport: Sport | undefined;
  if (typeof body.sport === "string" && (SPORTS as readonly string[]).includes(body.sport)) {
    sport = body.sport as Sport;
  }

  const priceMax = numberOrUndefined(body.priceMax);
  const lat = numberOrUndefined(body.lat);
  const lng = numberOrUndefined(body.lng);
  const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : undefined;

  let limit = 20;
  const rawLimit = numberOrUndefined(body.limit);
  if (rawLimit !== undefined) limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));

  return { query: body.query.trim(), entityTypes, sport, priceMax, lat, lng, city, limit };
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// --------------------------------------------------------------------------
// Intent: deterministic parse, optionally refined by the LLM (hybrid)
// --------------------------------------------------------------------------

/**
 * Merge a partial LLM intent OVER the deterministic parse. The deterministic
 * parse is always the baseline (so results are stable and cheap when the key is
 * absent or the model fails); LLM fields only overwrite where the model
 * returned a usable value. A brand the model finds re-derives nounHint via the
 * deterministic parse's own nounHint, which the model does not compute.
 */
function mergeIntent(base: ParsedIntent, llm: Partial<ParsedIntent> | null): ParsedIntent {
  if (!llm) return base;
  return {
    ...base,
    entityTypes: llm.entityTypes && llm.entityTypes.length > 0 ? llm.entityTypes : base.entityTypes,
    sport: llm.sport ?? base.sport,
    priceMax: llm.priceMax ?? base.priceMax,
    brand: llm.brand ?? base.brand,
    skillLevel: llm.skillLevel ?? base.skillLevel,
    ageHint: llm.ageHint ?? base.ageHint,
    keywords: llm.keywords && llm.keywords.length > 0 ? llm.keywords : base.keywords,
  };
}

// --------------------------------------------------------------------------
// Fetch layer — every query publicly-scoped (see file header)
// --------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function fetchCoaches(supabase: any, intent: ParsedIntent, city?: string): Promise<Candidate[]> {
  let q = supabase
    .from("coach_profiles_public")
    .select("user_id, sport, city, state, bio, specialization, coaching_style, rating, rating_count")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load coaches: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.user_id as string);

  const [{ data: profiles }, { data: sessionTypes }] = await Promise.all([
    supabase.from("public_profiles").select("id, name, avatar_url").in("id", ids),
    supabase.from("session_types").select("coach_id, price, active").in("coach_id", ids),
  ]);

  const nameById = new Map<string, { name: string; avatar_url: string | null }>();
  for (const p of (profiles ?? []) as Array<Record<string, unknown>>) {
    nameById.set(p.id as string, { name: (p.name as string) ?? "Coach", avatar_url: (p.avatar_url as string) ?? null });
  }
  const minPriceById = new Map<string, number>();
  for (const s of (sessionTypes ?? []) as Array<Record<string, unknown>>) {
    if (!s.active) continue;
    const price = Number(s.price);
    const cid = s.coach_id as string;
    if (!minPriceById.has(cid) || price < (minPriceById.get(cid) as number)) minPriceById.set(cid, price);
  }

  return rows.map((r): Candidate => {
    const uid = r.user_id as string;
    const prof = nameById.get(uid);
    const spec = Array.isArray(r.specialization) ? (r.specialization as string[]) : [];
    const cityStr = (r.city as string) ?? "";
    const distanceKm = city && cityStr && city.toLowerCase() === cityStr.toLowerCase() ? 0 : undefined;
    return {
      entityType: "coach",
      entityId: uid,
      title: prof?.name ?? "Coach",
      // Carry state after city (BUG-002) so two coaches with the same sport and
      // city still read differently in the results row.
      subtitle: [capitalize(r.sport as string), cityStr, r.state as string].filter(Boolean).join(" . "),
      imageUrl: prof?.avatar_url ?? undefined,
      sport: r.sport as Sport,
      price: minPriceById.get(uid),
      rating: typeof r.rating === "number" ? r.rating : Number(r.rating) || undefined,
      distanceKm,
      text: [prof?.name, r.sport, cityStr, r.state, r.bio, r.coaching_style, spec.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });
}

// deno-lint-ignore no-explicit-any
async function fetchCourts(supabase: any, intent: ParsedIntent, lat?: number, lng?: number): Promise<Candidate[]> {
  let q = supabase
    .from("courts")
    .select("id, name, sport, base_price_per_hour, venues!inner(id, name, city, address, lat, lng, status)")
    .eq("active", true)
    .eq("venues.status", "verified")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load courts: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return rows.map((r): Candidate => {
    const venue = (r.venues ?? {}) as Record<string, unknown>;
    const vLat = numberOrUndefined(venue.lat);
    const vLng = numberOrUndefined(venue.lng);
    let distanceKm: number | undefined;
    if (lat !== undefined && lng !== undefined && vLat !== undefined && vLng !== undefined) {
      distanceKm = Math.round(haversineKm(lat, lng, vLat, vLng) * 10) / 10;
    }
    const cityStr = (venue.city as string) ?? "";
    return {
      entityType: "court",
      entityId: r.id as string,
      title: (r.name as string) ?? (venue.name as string) ?? "Court",
      subtitle: [venue.name, cityStr].filter(Boolean).join(" . "),
      sport: r.sport as Sport,
      price: numberOrUndefined(r.base_price_per_hour),
      rating: undefined,
      distanceKm,
      text: [r.name, r.sport, venue.name, cityStr, venue.address].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

// deno-lint-ignore no-explicit-any
async function fetchProducts(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
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
async function fetchAffiliateProducts(supabase: any, intent: ParsedIntent, ids?: string[]): Promise<Candidate[]> {
  let q = supabase
    .from("affiliate_products")
    .select("id, title, brand, sport, skill_level, age_range, description, image_url, product_offers ( price, in_stock )")
    .eq("active", true)
    .limit(50);
  if (ids) {
    if (ids.length === 0) return [];
    q = supabase
      .from("affiliate_products")
      .select("id, title, brand, sport, skill_level, age_range, description, image_url, product_offers ( price, in_stock )")
      .eq("active", true)
      .in("id", ids);
  } else if (intent.sport !== "general") {
    q = q.eq("sport", intent.sport);
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

// deno-lint-ignore no-explicit-any
async function fetchAthletes(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  let q = supabase
    .from("upa_applications")
    .select("id, story_headline, sport, region, state, photo_url")
    .eq("status", "verified")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load athletes: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return rows.map((r): Candidate => {
    const region = (r.region as string) ?? "";
    const state = (r.state as string) ?? "";
    return {
      entityType: "athlete",
      entityId: r.id as string,
      title: (r.story_headline as string) ?? "Athlete",
      subtitle: [capitalize((r.sport as string) ?? ""), region || state].filter(Boolean).join(" . "),
      imageUrl: typeof r.photo_url === "string" ? r.photo_url : undefined,
      sport: r.sport as Sport,
      rating: undefined,
      distanceKm: undefined,
      text: [r.story_headline, r.sport, region, state].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

// deno-lint-ignore no-explicit-any
async function fetchClips(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  let q = supabase
    .from("clips")
    .select("id, caption, sport, likes_count, thumb_path")
    .eq("status", "published")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load clips: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const maxLikes = Math.max(1, ...rows.map((r) => Number(r.likes_count) || 0));

  return rows.map((r): Candidate => {
    const thumb = r.thumb_path as string | null;
    return {
      entityType: "clip",
      entityId: r.id as string,
      title: (r.caption as string) ?? "Clip",
      subtitle: capitalize((r.sport as string) ?? "Clip"),
      imageUrl: typeof thumb === "string" && /^https?:\/\//.test(thumb) ? thumb : undefined,
      sport: r.sport as Sport,
      rating: (Math.min(1, (Number(r.likes_count) || 0) / maxLikes) * 5) || undefined,
      distanceKm: undefined,
      text: [r.caption, r.sport].filter(Boolean).join(" ").toLowerCase(),
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

interface VectorMatch {
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
// deno-lint-ignore no-explicit-any
async function recallByVector(svc: any, query: string): Promise<VectorMatch[] | null> {
  try {
    const hash = await sha256Hex(query.toLowerCase().trim());

    let vector: number[] | null = null;
    const { data: cached, error: cacheReadError } = await svc
      .from("query_embedding_cache")
      .select("embedding, created_at")
      .eq("query_hash", hash)
      .maybeSingle();
    if (!cacheReadError && cached) {
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

      // Best-effort cache write; a failure to cache never fails the request.
      await svc
        .from("query_embedding_cache")
        .upsert(
          { query_hash: hash, embedding: JSON.stringify(vector), created_at: new Date().toISOString() },
          { onConflict: "query_hash" },
        )
        .then(
          () => {},
          () => {},
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

    if (spentVoyage) await recordVoyageSpend(svc);

    return ((matches ?? []) as Array<{ id: string; similarity: number }>).map((m) => ({
      id: m.id,
      similarity: Number(m.similarity),
    }));
  } catch (err) {
    console.error("[ai-search] vector recall failed, skipping:", err);
    return null;
  }
}

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    const body = parseRequestBody(await request.json().catch(() => null));

    const supabase = userScopedClient(request);
    // Validated against GoTrue, never a client-supplied id; a guest's
    // anonymous session still resolves to a real user id here (verify_jwt is
    // true for this function, so there is always a session to validate).
    const { id: userId } = await getAuthenticatedUser(request);

    const override: IntentOverride = {
      entityTypes: body.entityTypes,
      sport: body.sport,
      priceMax: body.priceMax,
    };

    // The one narrow service-role client this function constructs (see file
    // header): passed to the CT-2/CT-3 rate-limit and spend RPCs, and (Phase
    // S1 Track B, ADR-011 D1) to the vector recall's cache table and
    // `match_affiliate_products` RPC, both service-role only. Never to a
    // data read of the entity tables `fetch*` reads above.
    const svc = serviceRoleClient();

    // The CT-2/CT-3 gate decides ONCE per request whether ANY paid AI call
    // below may run (Claude's intent parse/rerank, and now Voyage's query
    // embedding, D1: "gates the Voyage call with the same per-user throttle
    // and daily budget it gates Claude with"). `useLlm` additionally requires
    // the Anthropic key to actually be configured; `useVector` has no such
    // extra requirement, since `embedTexts` degrades to the offline stub on
    // its own when no Voyage key is present.
    const gate = await evaluateAiSearchGate(svc, userId);
    const useLlm = gate.mode === "llm" && llmEnabled();
    const useVector = gate.mode === "llm";

    // Deterministic parse is always the baseline. When the gate allows it,
    // refine it with Claude's structured parse (guarded: falls back on any
    // failure, and the fallback still records nothing since usage is null).
    let intent = parseIntent(body.query, override);
    if (useLlm) {
      const { intent: refined, usage } = await llmParseIntent(body.query).catch(
        () => ({ intent: null, usage: null }),
      );
      intent = mergeIntent(intent, refined);
      if (usage) await recordAiSpend(svc, usage.inputTokens, usage.outputTokens);
    }

    const want = new Set(intent.entityTypes);
    const [coaches, courts, products, affiliateProducts, athletes, clips] = await Promise.all([
      want.has("coach") ? fetchCoaches(supabase, intent, body.city) : Promise.resolve([]),
      want.has("court") ? fetchCourts(supabase, intent, body.lat, body.lng) : Promise.resolve([]),
      want.has("gear") ? fetchProducts(supabase, intent) : Promise.resolve([]),
      want.has("gear") ? fetchAffiliateProducts(supabase, intent) : Promise.resolve([]),
      want.has("athlete") ? fetchAthletes(supabase, intent) : Promise.resolve([]),
      want.has("clip") ? fetchClips(supabase, intent) : Promise.resolve([]),
    ]);

    const candidates = [...coaches, ...courts, ...products, ...affiliateProducts, ...athletes, ...clips];

    // Vector recall (ADR-011 D1): ADDS candidates the keyword path missed,
    // never re-weights or removes anything the deterministic path already
    // found. Scoped to `gear`, the only entity type FR-40 names, and only
    // over `affiliate_products` (the ADR's own non-goal excludes the OWNED
    // catalogue). `vector` in the response reports whether this path
    // actually ran (spend allowed AND the recall call itself succeeded), so a
    // caller can tell "no vector signal at all" from "vector ran, found
    // nothing" without inspecting results.
    let vector = false;
    const similarityByKey = new Map<string, number>();
    if (useVector && want.has("gear")) {
      const matches = await recallByVector(svc, body.query);
      if (matches) {
        vector = true;
        const existingIds = new Set(affiliateProducts.map((c) => c.entityId));
        const newIds = matches
          .filter((m) => !existingIds.has(`affiliate:${m.id}`))
          .map((m) => m.id);
        const hydrated = await fetchAffiliateProducts(supabase, intent, newIds);
        for (const c of hydrated) candidates.push(c);
        // candidateKey shape is `${entityType}:${entityId}`, and entityId for
        // affiliate rows is itself `affiliate:${id}` (see fetchAffiliateProducts).
        for (const m of matches) {
          similarityByKey.set(candidateKey({ entityType: "gear", entityId: `affiliate:${m.id}` }), m.similarity);
        }
      }
    }

    const scored = scoreCandidates(candidates, intent).sort((a, b) => b.rankScore - a.rankScore);

    // FR-16 honesty gate: keep only hard-constraint-qualified, confident hits.
    // similarityByKey lets a vector-only recall (zero keyword hits) still
    // clear the relevance floor once its cosine similarity clears
    // VECTOR_SIMILARITY_FLOOR (D1); brand/price constraints are unaffected.
    const honesty = evaluateHonesty(candidates, scored, intent, similarityByKey);
    if (honesty.broaden) {
      return jsonResponse(
        { query: body.query, parsedIntent: intent, results: [], broaden: honesty.broaden, mode: gate.mode, vector },
        200,
      );
    }

    const qualified = scored.filter((h) => honesty.qualified.has(candidateKey(h)));

    // A vector-only hit (recalled purely via similarity, no keyword overlap)
    // gets an honest rankReason naming why it is here, rather than whatever
    // scoreCandidates's keyword-blind fallback ("Relevant") would say.
    for (const hit of qualified) {
      const key = candidateKey(hit);
      if (similarityByKey.has(key) && !affiliateProducts.some((c) => candidateKey(c) === key)) {
        hit.rankReason = "similar to your query";
      }
    }

    // LLM rerank (guarded) refines order + rankReason over the qualified set;
    // gated off (absent key, throttled, or over budget) or a call failure
    // both keep the deterministic order.
    let results = qualified;
    if (useLlm) {
      const { hits: reranked, usage } = await llmRerank(body.query, qualified).catch(
        () => ({ hits: qualified, usage: null }),
      );
      results = reranked;
      if (usage) await recordAiSpend(svc, usage.inputTokens, usage.outputTokens);
    }

    return jsonResponse(
      { query: body.query, parsedIntent: intent, results: results.slice(0, body.limit), mode: gate.mode, vector },
      200,
    );
  })
);
