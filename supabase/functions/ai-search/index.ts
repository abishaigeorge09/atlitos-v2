// ATLITOS v2 — supabase/functions/ai-search/index.ts
//
// POST /search, the v1 `aiSearch` contract (API-MAPPING.md "search").
// Body: { query, entityTypes?, sport?, priceMax?, lat?, lng?, city?, limit? }
//   query is the free-text the SearchBar collected. Everything else is an
//   optional narrowing the client already knows (its location store, an
//   explicit segment). All of it is advisory; the server re-derives intent
//   from `query` regardless (parseIntent below).
//
// Response: { query, parsedIntent, results: SearchHit[] } sorted rankScore desc.
//
// Epic AT-3, story AT-144. The v1 heuristic ported verbatim behind the same
// request/response contract: a keyword parse routes the query to entity types
// (gear|coach|court|athlete|clip), then a weighted distance/price/rating/text
// score ranks the rows. Track E extended the v1 three-type union with
// athletes (verified UPAs, PRD-06) and clips (published Clutch posts,
// PRD-01) behind the identical `SearchHit` shape; `SearchEntityType`
// (packages/types enums.ts) carries all five now. Drills remain out of the
// contract (no PRD asks for them in search).
//
// VISIBILITY (CLAUDE.md: "RLS is a floor, not scoping"). Two independent guards
// keep a non-public row from ever reaching a caller:
//   1. Every table is read through `userScopedClient(req)`, the caller's own
//      JWT, so RLS applies to them exactly as PostgREST would apply it. A guest
//      passes the anon session and gets only the anon-visible policies.
//   2. Every query ALSO carries its own explicit public filter, so even a
//      privileged caller (an admin, or a coach/partner who owns unverified
//      rows) gets only the publicly-visible set out of THIS endpoint:
//        - coaches: read from the `coach_profiles_public` view (status =
//          'verified' baked in), never the base table.
//        - courts: `active = true` AND an inner join asserting
//          `venues.status = 'verified'`.
//        - products: `active = true`.
//        - athletes: `upa_applications.status = 'verified'`, the same
//          explicit scope use-empower.ts's `listUpas` applies (that table
//          also carries an own-row policy for the applicant, any status).
//        - clips: `clips.status = 'published'`, the same explicit scope
//          hooks.ts's `getFeed` applies (own-row policy covers the uploader's
//          non-published clips otherwise).
//   The service-role client is deliberately never constructed here; search has
//   no money leg and must not bypass RLS.
//
// LLM RE-RANK SEAM. `rerank()` is a pure post-processing pass over the already
// heuristically-scored candidates. Today it is the identity function. Swapping
// in an LLM re-rank is entirely inside that one function: it receives the query
// and the scored candidates and returns them reordered. Nothing else in this
// file (the visibility queries, the contract shape) changes.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { userScopedClient } from "../_shared/supabase.ts";

const SPORTS = ["football", "cricket", "badminton", "tennis"] as const;
type Sport = (typeof SPORTS)[number];

const ENTITY_TYPES = ["gear", "coach", "court", "athlete", "clip"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

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
// Intent parse (keyword -> entityTypes + sport + priceMax + keywords)
// --------------------------------------------------------------------------

interface ParsedIntent {
  entityTypes: EntityType[];
  sport: Sport | "general";
  priceMax?: number;
  timeWindow?: "morning" | "evening";
  keywords: string[];
}

// Router tokens map a word to an entity type. A query with none of these
// searches all three types (a broad "show me everything for X").
const ROUTER_TOKENS: Record<EntityType, string[]> = {
  coach: ["coach", "coaches", "coaching", "trainer", "trainers", "train", "training", "lesson", "lessons", "academy", "mentor", "mentoring"],
  court: ["court", "courts", "venue", "venues", "ground", "grounds", "turf", "turfs", "field", "fields", "pitch", "pitches", "slot", "slots", "booking"],
  gear: ["gear", "buy", "shop", "equipment", "kit", "product", "products", "racket", "rackets", "racquet", "bat", "bats", "ball", "balls", "shuttlecock", "shuttlecocks", "shoe", "shoes", "jersey", "glove", "gloves", "socks", "wristband", "helmet", "cone", "cones", "legguard", "legguards"],
  athlete: ["athlete", "athletes", "upa", "upas", "donate", "donation", "donations", "support", "sponsor", "sponsoring", "fund", "funding"],
  clip: ["clip", "clips", "video", "videos", "watch", "highlight", "highlights", "reel", "reels", "clutch"],
};

const SPORT_SYNONYMS: Record<string, Sport> = {
  football: "football", soccer: "football", futsal: "football",
  cricket: "cricket",
  badminton: "badminton", shuttle: "badminton",
  tennis: "tennis",
};

// Words that carry no content signal: they are location/quality filler, so
// dropping them keeps the text match from being diluted by "near", "best" etc.
const STOPWORDS = new Set([
  "near", "me", "nearby", "around", "in", "at", "for", "the", "a", "an", "of", "to",
  "and", "with", "my", "best", "top", "good", "great", "cheap", "affordable", "budget",
  "under", "below", "less", "than", "upto", "up", "rs", "rupees", "inr", "price", "priced",
  "find", "show", "search", "looking", "want", "need", "some", "any",
]);

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function parseIntent(query: string, override?: Partial<SearchRequestBody>): ParsedIntent {
  const tokens = tokenize(query);

  const routed = new Set<EntityType>();
  for (const t of ENTITY_TYPES) {
    if (tokens.some((tok) => ROUTER_TOKENS[t].includes(tok))) routed.add(t);
  }

  let sport: Sport | "general" = "general";
  for (const tok of tokens) {
    if (SPORT_SYNONYMS[tok]) {
      sport = SPORT_SYNONYMS[tok];
      break;
    }
  }
  if (override?.sport) sport = override.sport;

  // Price ceiling: "under 1500", "below 1500", "< 1500", or a bare "1500 rupees".
  let priceMax = override?.priceMax;
  const ceilMatch = query.toLowerCase().match(/(?:under|below|less than|upto|up to|<)\s*(?:rs\.?\s*)?(\d{2,7})/);
  if (ceilMatch) priceMax = Number(ceilMatch[1]);
  else {
    const rsMatch = query.toLowerCase().match(/(?:rs\.?\s*)(\d{2,7})|(\d{2,7})\s*(?:rupees|rs\b|inr)/);
    if (rsMatch) priceMax = Number(rsMatch[1] ?? rsMatch[2]);
  }

  let timeWindow: "morning" | "evening" | undefined;
  if (tokens.includes("morning")) timeWindow = "morning";
  else if (tokens.includes("evening") || tokens.includes("night")) timeWindow = "evening";

  const sportTokens = new Set(Object.keys(SPORT_SYNONYMS));
  const routerTokens = new Set(Object.values(ROUTER_TOKENS).flat());
  const keywords = tokens.filter(
    (tok) =>
      tok.length > 2 &&
      !STOPWORDS.has(tok) &&
      !sportTokens.has(tok) &&
      !routerTokens.has(tok) &&
      !/^\d+$/.test(tok),
  );

  // Explicit segment from the client wins over the keyword router; if the
  // router found nothing and the client sent nothing, we search everything.
  let entityTypes: EntityType[];
  if (override?.entityTypes && override.entityTypes.length > 0) entityTypes = override.entityTypes;
  else if (routed.size > 0) entityTypes = [...routed];
  else entityTypes = [...ENTITY_TYPES];

  return { entityTypes, sport, priceMax, timeWindow, keywords };
}

// --------------------------------------------------------------------------
// Candidates + scoring
// --------------------------------------------------------------------------

interface Candidate {
  entityType: EntityType;
  entityId: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  sport?: Sport;
  price?: number; // rupees; coach = cheapest session type, court = per hour, gear = base
  rating?: number; // 0..5, only where a real rating exists (coaches)
  distanceKm?: number;
  text: string; // lowercased searchable blob
}

interface ScoredHit {
  entityType: EntityType;
  entityId: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  sport?: Sport;
  price?: number;
  distanceKm?: number;
  rankScore: number; // 0..1
  rankReason: string;
}

const EARTH_KM = 6371;
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

const MAX_DISTANCE_KM = 25; // beyond this a result scores ~0 on proximity
const NEUTRAL = 0.5; // the score a signal contributes when it does not apply

// Weights over the four v1 signals. Text relevance leads, then the three the
// contract names (rating, price, distance).
const W_TEXT = 0.4;
const W_RATING = 0.25;
const W_PRICE = 0.2;
const W_DISTANCE = 0.15;

function scoreCandidates(candidates: Candidate[], intent: ParsedIntent): ScoredHit[] {
  // Price normalization is per entity type: a coach session and a court hour
  // and a bat are not comparable, so cheaper-is-better is computed within a
  // type, not across the whole pool.
  const priceBounds = new Map<EntityType, { min: number; max: number }>();
  for (const t of ENTITY_TYPES) {
    const prices = candidates.filter((c) => c.entityType === t && typeof c.price === "number").map((c) => c.price as number);
    if (prices.length > 0) priceBounds.set(t, { min: Math.min(...prices), max: Math.max(...prices) });
  }

  const hits: ScoredHit[] = [];
  for (const c of candidates) {
    // Text signal: fraction of content keywords present in the row's blob.
    let textScore = NEUTRAL;
    let textReal = false;
    if (intent.keywords.length > 0) {
      const hitCount = intent.keywords.filter((k) => c.text.includes(k)).length;
      textScore = hitCount / intent.keywords.length;
      textReal = hitCount > 0;
    }

    // Rating signal: only real where the row actually carries a rating.
    let ratingScore = NEUTRAL;
    let ratingReal = false;
    if (typeof c.rating === "number" && c.rating > 0) {
      ratingScore = Math.min(1, c.rating / 5);
      ratingReal = true;
    }

    // Price signal.
    let priceScore = NEUTRAL;
    let priceReal = false;
    if (typeof c.price === "number") {
      if (intent.priceMax !== undefined) {
        priceScore = c.price <= intent.priceMax ? 1 - 0.5 * (c.price / intent.priceMax) : 0.15;
        priceReal = true;
      } else {
        const b = priceBounds.get(c.entityType);
        if (b && b.max > b.min) {
          priceScore = 1 - (c.price - b.min) / (b.max - b.min); // cheaper ranks higher
          priceReal = true;
        }
      }
    }

    // Distance signal.
    let distanceScore = NEUTRAL;
    let distanceReal = false;
    if (typeof c.distanceKm === "number") {
      distanceScore = Math.max(0, 1 - c.distanceKm / MAX_DISTANCE_KM);
      distanceReal = true;
    }

    const rankScore = W_TEXT * textScore + W_RATING * ratingScore + W_PRICE * priceScore + W_DISTANCE * distanceScore;

    // rankReason: the dominant *real* contributor, so the tag never claims a
    // signal (e.g. "Top rated") that did not actually apply to this row.
    const contributions: { key: string; value: number; real: boolean }[] = [
      { key: "distance", value: W_DISTANCE * distanceScore, real: distanceReal },
      { key: "rating", value: W_RATING * ratingScore, real: ratingReal },
      { key: "price", value: W_PRICE * priceScore, real: priceReal },
      { key: "text", value: W_TEXT * textScore, real: textReal },
    ].filter((x) => x.real);
    contributions.sort((a, b) => b.value - a.value);
    const top = contributions[0]?.key;

    let rankReason: string;
    switch (top) {
      case "distance":
        rankReason = typeof c.distanceKm === "number" ? `Closest, ${c.distanceKm.toFixed(1)}km` : "Nearby";
        break;
      case "rating":
        rankReason = "Top rated";
        break;
      case "price":
        rankReason = intent.priceMax !== undefined ? "Within your budget" : "Best price match";
        break;
      case "text":
        rankReason = "Strong match";
        break;
      default:
        rankReason = "Relevant";
    }

    hits.push({
      entityType: c.entityType,
      entityId: c.entityId,
      title: c.title,
      subtitle: c.subtitle,
      imageUrl: c.imageUrl,
      sport: c.sport,
      price: c.price,
      distanceKm: c.distanceKm,
      rankScore: Math.round(rankScore * 1000) / 1000,
      rankReason,
    });
  }

  return hits;
}

/**
 * The LLM re-rank seam. Today the identity function over the heuristically
 * scored hits (already sorted by rankScore). To swap in an LLM re-rank, replace
 * ONLY this body: send `query` + the candidate hits to the model, take back the
 * reordered ids, and re-emit `hits` in that order (optionally rewriting
 * rankReason from the model's rationale). The request/response contract and the
 * visibility queries above are untouched by that swap, per PLAN.md.
 */
// deno-lint-ignore require-await
async function rerank(_query: string, hits: ScoredHit[]): Promise<ScoredHit[]> {
  return hits;
}

// --------------------------------------------------------------------------
// Fetch layer — every query publicly-scoped (see file header)
// --------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function fetchCoaches(supabase: any, intent: ParsedIntent, city?: string): Promise<Candidate[]> {
  let q = supabase
    .from("coach_profiles_public") // view: status = 'verified' only
    .select("user_id, sport, city, state, bio, specialization, coaching_style, rating, rating_count")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load coaches: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.user_id as string);

  // Names/avatars from the public_profiles view; cheapest active session type
  // from session_types (its public policy is is_verified_coach, so this cannot
  // surface a price for an unverified coach either).
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
      subtitle: [capitalize(r.sport as string), cityStr].filter(Boolean).join(" . "),
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
  // active courts under a VERIFIED venue only: the explicit public scope on
  // top of RLS. venues!inner drops any court whose venue is not verified.
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
      // Court ratings live in an aggregate RPC (get_court_rating_summary) gated
      // by court_bookings RLS; computing it per candidate is out of scope for
      // the heuristic, so proximity/price/text rank courts.
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
    .eq("active", true) // explicit public scope on top of RLS
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
    rating: undefined, // products carry no rating column
    distanceKm: undefined, // gear ships, proximity does not apply
    text: [r.title, r.sport, r.description].filter(Boolean).join(" ").toLowerCase(),
  }));
}

// deno-lint-ignore no-explicit-any
async function fetchAthletes(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  // Same view/filter the empower hooks read for the UPA hub (use-empower.ts
  // listUpas): `upa_applications` explicitly scoped to `status = 'verified'`,
  // the RLS-is-not-scoping guard, because the table also carries an own-row
  // policy for the applicant in any status.
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
      // No price or distance term applies to an athlete to support: text and
      // rating (absent, so neutral) rank these, not a purchase/proximity axis.
      rating: undefined,
      distanceKm: undefined,
      text: [r.story_headline, r.sport, region, state].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

// deno-lint-ignore no-explicit-any
async function fetchClips(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  // Published only, the same RLS-is-not-scoping guard the Clutch feed hook
  // applies (useClutch.getFeed): `clips` also carries an own-row policy for
  // the uploader in any status.
  let q = supabase
    .from("clips")
    .select("id, caption, sport, likes_count, thumb_path")
    .eq("status", "published")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load clips: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // likes_count stands in for the rating signal (no 0..5 rating on a clip);
  // normalize onto the same 0..5 scale scoreCandidates expects so it weighs
  // consistently against coaches' real ratings.
  const maxLikes = Math.max(1, ...rows.map((r) => Number(r.likes_count) || 0));

  return rows.map((r): Candidate => {
    const thumb = r.thumb_path as string | null;
    return {
      entityType: "clip",
      entityId: r.id as string,
      title: (r.caption as string) ?? "Clip",
      subtitle: capitalize((r.sport as string) ?? "Clip"),
      // thumb_path is a private-bucket storage key, not a loadable URL (see
      // hooks.ts mapClipRow); only pass through an already-absolute URL.
      imageUrl: typeof thumb === "string" && /^https?:\/\//.test(thumb) ? thumb : undefined,
      sport: r.sport as Sport,
      rating: (Math.min(1, (Number(r.likes_count) || 0) / maxLikes) * 5) || undefined,
      distanceKm: undefined,
      text: [r.caption, r.sport].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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

    // The caller's own JWT client. Search is public discovery, so a guest
    // (anonymous session) is a valid caller; verify_jwt still holds because a
    // guest carries an anon session token, like get-clip-playback-url.
    const supabase = userScopedClient(request);

    const intent = parseIntent(body.query, {
      entityTypes: body.entityTypes,
      sport: body.sport,
      priceMax: body.priceMax,
    });

    const want = new Set(intent.entityTypes);
    const [coaches, courts, products, athletes, clips] = await Promise.all([
      want.has("coach") ? fetchCoaches(supabase, intent, body.city) : Promise.resolve([]),
      want.has("court") ? fetchCourts(supabase, intent, body.lat, body.lng) : Promise.resolve([]),
      want.has("gear") ? fetchProducts(supabase, intent) : Promise.resolve([]),
      want.has("athlete") ? fetchAthletes(supabase, intent) : Promise.resolve([]),
      want.has("clip") ? fetchClips(supabase, intent) : Promise.resolve([]),
    ]);

    const candidates = [...coaches, ...courts, ...products, ...athletes, ...clips];
    const scored = scoreCandidates(candidates, intent).sort((a, b) => b.rankScore - a.rankScore);
    const ranked = (await rerank(body.query, scored)).slice(0, body.limit);

    return jsonResponse({ query: body.query, parsedIntent: intent, results: ranked }, 200);
  })
);
