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
//   The service-role client is deliberately never constructed here; search has
//   no money leg and must not bypass RLS.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { userScopedClient } from "../_shared/supabase.ts";

import {
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
} from "./search-core.ts";
import { llmEnabled, llmParseIntent, llmRerank } from "./llm.ts";

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
// deno-lint-ignore no-explicit-any
async function fetchAffiliateProducts(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  let q = supabase
    .from("affiliate_products")
    .select("id, title, brand, sport, skill_level, age_range, description, image_url, product_offers ( price, in_stock )")
    .eq("active", true)
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

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

    const override: IntentOverride = {
      entityTypes: body.entityTypes,
      sport: body.sport,
      priceMax: body.priceMax,
    };

    // Deterministic parse is always the baseline. When the LLM key is present,
    // refine it with Claude's structured parse (guarded: null on any failure).
    let intent = parseIntent(body.query, override);
    if (llmEnabled()) {
      const refined = await llmParseIntent(body.query).catch(() => null);
      intent = mergeIntent(intent, refined);
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
    const scored = scoreCandidates(candidates, intent).sort((a, b) => b.rankScore - a.rankScore);

    // FR-16 honesty gate: keep only hard-constraint-qualified, confident hits.
    const honesty = evaluateHonesty(candidates, scored, intent);
    if (honesty.broaden) {
      return jsonResponse({ query: body.query, parsedIntent: intent, results: [], broaden: honesty.broaden }, 200);
    }

    const qualified = scored.filter((h) => honesty.qualified.has(`${h.entityType}:${h.entityId}`));

    // LLM rerank (guarded) refines order + rankReason over the qualified set;
    // absent key or failure keeps the deterministic order.
    const reranked = llmEnabled() ? await llmRerank(body.query, qualified).catch(() => qualified) : qualified;
    const results = reranked.slice(0, body.limit);

    return jsonResponse({ query: body.query, parsedIntent: intent, results }, 200);
  })
);
