// ATLITOS v2 — supabase/functions/ai-search/search-core.ts
//
// The pure, side-effect-free core of the AI search endpoint: intent parse,
// candidate scoring, and the PRD-01 FR-16 honesty gate + broaden suggestion.
// Deliberately imports nothing from Deno so a plain TS runner (tsx, or a Deno
// test) can import and exercise every branch without booting the edge server.
// `index.ts` wires this to the Supabase fetch layer and the guarded LLM seam;
// `llm.ts` holds the (env-gated) Claude calls. Keeping the logic here means the
// deterministic path is provable without a network, a key, or a running server
// (BUG-006 verification requirement).

export const SPORTS = ["football", "cricket", "badminton", "tennis"] as const;
export type Sport = (typeof SPORTS)[number];

export const ENTITY_TYPES = ["gear", "coach", "court", "athlete", "clip"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export type SkillLevel = "beginner" | "intermediate" | "advanced";

// --------------------------------------------------------------------------
// Intent
// --------------------------------------------------------------------------

export interface ParsedIntent {
  entityTypes: EntityType[];
  sport: Sport | "general";
  priceMax?: number;
  brand?: string;
  skillLevel?: SkillLevel;
  ageHint?: number;
  timeWindow?: "morning" | "evening";
  // The concrete thing the user named (e.g. "racket"), used to phrase an
  // honest broaden suggestion ("No Babolat rackets under 2000."). Internal
  // signal, not part of the SearchResponse contract's parsedIntent.
  nounHint?: string;
  keywords: string[];
}

// Router tokens map a word to an entity type. A query with none of these
// searches all five types (a broad "show me everything for X").
export const ROUTER_TOKENS: Record<EntityType, string[]> = {
  coach: ["coach", "coaches", "coaching", "trainer", "trainers", "train", "training", "lesson", "lessons", "academy", "mentor", "mentoring"],
  court: ["court", "courts", "venue", "venues", "ground", "grounds", "turf", "turfs", "field", "fields", "pitch", "pitches", "slot", "slots", "booking"],
  gear: ["gear", "buy", "shop", "equipment", "kit", "product", "products", "racket", "rackets", "racquet", "racquets", "bat", "bats", "ball", "balls", "shuttlecock", "shuttlecocks", "shuttle", "shuttles", "shoe", "shoes", "jersey", "glove", "gloves", "socks", "wristband", "helmet", "cone", "cones", "legguard", "legguards"],
  athlete: ["athlete", "athletes", "upa", "upas", "donate", "donation", "donations", "support", "sponsor", "sponsoring", "fund", "funding"],
  clip: ["clip", "clips", "video", "videos", "watch", "highlight", "highlights", "reel", "reels", "clutch"],
};

// A router token that also reads as a concrete product noun the broaden copy
// can name back to the user. Keyed to the singular form we display.
const NOUN_TOKENS: Record<string, string> = {
  racket: "racket", rackets: "racket", racquet: "racket", racquets: "racket",
  bat: "bat", bats: "bat",
  ball: "ball", balls: "ball",
  shuttlecock: "shuttlecock", shuttlecocks: "shuttlecock", shuttle: "shuttlecock", shuttles: "shuttlecock",
  shoe: "shoe", shoes: "shoe",
  jersey: "jersey", glove: "glove", gloves: "glove", helmet: "helmet",
  coach: "coach", coaches: "coach",
  court: "court", courts: "court", turf: "turf", turfs: "turf",
};

export const SPORT_SYNONYMS: Record<string, Sport> = {
  football: "football", soccer: "football", futsal: "football",
  cricket: "cricket",
  badminton: "badminton", shuttle: "badminton",
  tennis: "tennis",
};

// Sports gear brands we recognise as a hard constraint. When present and no
// current product carries the brand, search is honest (empty + broaden) rather
// than substituting a different brand as filler.
export const BRANDS = [
  "babolat", "yonex", "wilson", "head", "prince", "dunlop", "tecnifibre",
  "nike", "adidas", "puma", "asics", "reebok", "cosco", "nivia", "sg", "ss",
  "kookaburra", "spartan", "gray nicolls", "li ning", "lining", "victor",
];

const SKILL_SYNONYMS: Record<string, SkillLevel> = {
  beginner: "beginner", beginners: "beginner", novice: "beginner", newbie: "beginner", starter: "beginner",
  intermediate: "intermediate",
  advanced: "advanced", pro: "advanced", professional: "advanced", expert: "advanced", elite: "advanced",
};

// Words that carry no content signal: location/quality filler, so dropping them
// keeps the text match from being diluted by "near", "best" etc.
export const STOPWORDS = new Set([
  "near", "me", "nearby", "around", "in", "at", "for", "the", "a", "an", "of", "to",
  "and", "with", "my", "best", "top", "good", "great", "cheap", "affordable", "budget",
  "under", "below", "less", "than", "upto", "up", "rs", "rupees", "inr", "price", "priced",
  "find", "show", "search", "looking", "want", "need", "some", "any", "im", "old", "year", "years",
]);

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface IntentOverride {
  entityTypes?: EntityType[];
  sport?: Sport;
  priceMax?: number;
}

export function parseIntent(query: string, override?: IntentOverride): ParsedIntent {
  const tokens = tokenize(query);
  const lower = query.toLowerCase();

  const routed = new Set<EntityType>();
  for (const t of ENTITY_TYPES) {
    if (tokens.some((tok) => ROUTER_TOKENS[t].includes(tok))) routed.add(t);
  }

  // The concrete noun the user named, if any (first match wins).
  let nounHint: string | undefined;
  for (const tok of tokens) {
    if (NOUN_TOKENS[tok]) {
      nounHint = NOUN_TOKENS[tok];
      break;
    }
  }

  let sport: Sport | "general" = "general";
  for (const tok of tokens) {
    if (SPORT_SYNONYMS[tok]) {
      sport = SPORT_SYNONYMS[tok];
      break;
    }
  }
  if (override?.sport) sport = override.sport;

  // Brand: a multi-word brand ("gray nicolls", "li ning") is matched against
  // the raw lowercased string; single-word brands against the token set.
  let brand: string | undefined;
  for (const b of BRANDS) {
    if (b.includes(" ") ? lower.includes(b) : tokens.includes(b)) {
      brand = b;
      break;
    }
  }

  // Skill level.
  let skillLevel: SkillLevel | undefined;
  for (const tok of tokens) {
    if (SKILL_SYNONYMS[tok]) {
      skillLevel = SKILL_SYNONYMS[tok];
      break;
    }
  }

  // Age: "10 year old", "10-year-old" (tokenized to "10 year old"), "age 10".
  let ageHint: number | undefined;
  const ageMatch = lower.match(/(\d{1,2})[\s-]*(?:year|yr)|age\s*(\d{1,2})/);
  if (ageMatch) {
    const n = Number(ageMatch[1] ?? ageMatch[2]);
    if (Number.isFinite(n) && n > 0 && n < 100) ageHint = n;
  }

  // Price ceiling: "under 1500", "below 1500", "< 1500", or a bare "1500 rupees".
  let priceMax = override?.priceMax;
  const ceilMatch = lower.match(/(?:under|below|less than|upto|up to|<)\s*(?:rs\.?\s*)?(\d{2,7})/);
  if (ceilMatch) priceMax = Number(ceilMatch[1]);
  else {
    const rsMatch = lower.match(/(?:rs\.?\s*)(\d{2,7})|(\d{2,7})\s*(?:rupees|rs\b|inr)/);
    if (rsMatch) priceMax = Number(rsMatch[1] ?? rsMatch[2]);
  }

  let timeWindow: "morning" | "evening" | undefined;
  if (tokens.includes("morning")) timeWindow = "morning";
  else if (tokens.includes("evening") || tokens.includes("night")) timeWindow = "evening";

  const sportTokens = new Set(Object.keys(SPORT_SYNONYMS));
  const routerTokens = new Set(Object.values(ROUTER_TOKENS).flat());
  const brandTokens = new Set(BRANDS.flatMap((b) => b.split(" ")));
  const skillTokens = new Set(Object.keys(SKILL_SYNONYMS));
  const keywords = tokens.filter(
    (tok) =>
      tok.length > 2 &&
      !STOPWORDS.has(tok) &&
      !sportTokens.has(tok) &&
      !routerTokens.has(tok) &&
      !brandTokens.has(tok) &&
      !skillTokens.has(tok) &&
      !/^\d+$/.test(tok),
  );

  let entityTypes: EntityType[];
  if (override?.entityTypes && override.entityTypes.length > 0) entityTypes = override.entityTypes;
  else if (routed.size > 0) entityTypes = [...routed];
  else entityTypes = [...ENTITY_TYPES];

  return { entityTypes, sport, priceMax, brand, skillLevel, ageHint, timeWindow, nounHint, keywords };
}

// --------------------------------------------------------------------------
// Candidates + scoring
// --------------------------------------------------------------------------

export interface Candidate {
  entityType: EntityType;
  entityId: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  sport?: Sport;
  price?: number;
  rating?: number;
  distanceKm?: number;
  text: string; // lowercased searchable blob
}

export interface ScoredHit {
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

export const EARTH_KM = 6371;
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

const MAX_DISTANCE_KM = 25;
const NEUTRAL = 0.5;

const W_TEXT = 0.4;
const W_RATING = 0.25;
const W_PRICE = 0.2;
const W_DISTANCE = 0.15;

export function scoreCandidates(candidates: Candidate[], intent: ParsedIntent): ScoredHit[] {
  const priceBounds = new Map<EntityType, { min: number; max: number }>();
  for (const t of ENTITY_TYPES) {
    const prices = candidates.filter((c) => c.entityType === t && typeof c.price === "number").map((c) => c.price as number);
    if (prices.length > 0) priceBounds.set(t, { min: Math.min(...prices), max: Math.max(...prices) });
  }

  const hits: ScoredHit[] = [];
  for (const c of candidates) {
    let textScore = NEUTRAL;
    let textReal = false;
    if (intent.keywords.length > 0) {
      const hitCount = intent.keywords.filter((k) => c.text.includes(k)).length;
      textScore = hitCount / intent.keywords.length;
      textReal = hitCount > 0;
    }

    let ratingScore = NEUTRAL;
    let ratingReal = false;
    if (typeof c.rating === "number" && c.rating > 0) {
      ratingScore = Math.min(1, c.rating / 5);
      ratingReal = true;
    }

    let priceScore = NEUTRAL;
    let priceReal = false;
    if (typeof c.price === "number") {
      if (intent.priceMax !== undefined) {
        priceScore = c.price <= intent.priceMax ? 1 - 0.5 * (c.price / intent.priceMax) : 0.15;
        priceReal = true;
      } else {
        const b = priceBounds.get(c.entityType);
        if (b && b.max > b.min) {
          priceScore = 1 - (c.price - b.min) / (b.max - b.min);
          priceReal = true;
        }
      }
    }

    let distanceScore = NEUTRAL;
    let distanceReal = false;
    if (typeof c.distanceKm === "number") {
      distanceScore = Math.max(0, 1 - c.distanceKm / MAX_DISTANCE_KM);
      distanceReal = true;
    }

    const rankScore = W_TEXT * textScore + W_RATING * ratingScore + W_PRICE * priceScore + W_DISTANCE * distanceScore;

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

// --------------------------------------------------------------------------
// PRD-01 FR-16: honesty gate + broaden suggestion
// --------------------------------------------------------------------------

// Below this best-of-set rankScore, even hard-constraint-passing hits are
// treated as too weak to show as a real recommendation.
export const CONFIDENCE_FLOOR = 0.3;

function key(c: { entityType: EntityType; entityId: string }): string {
  return `${c.entityType}:${c.entityId}`;
}

function plural(noun: string): string {
  return /s$/.test(noun) ? noun : `${noun}s`;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// A candidate clears the HARD constraints when: it carries any brand the query
// named, it is within any stated price ceiling (priceless rows are not price
// constrained), and, when the query has content keywords, it matches at least
// one (the relevance floor).
function passesHardConstraints(c: Candidate, intent: ParsedIntent): boolean {
  if (intent.brand && !c.text.includes(intent.brand)) return false;
  if (intent.priceMax !== undefined && typeof c.price === "number" && c.price > intent.priceMax) return false;
  if (intent.keywords.length > 0 && !intent.keywords.some((k) => c.text.includes(k))) return false;
  return true;
}

export interface HonestyResult {
  qualified: Set<string>; // "type:id" keys to keep
  broaden?: string; // set only when the honest answer is an empty result set
}

/**
 * The FR-16 gate. Returns the set of candidate keys worth showing, and — only
 * when that set is empty or too weak — a SPECIFIC broaden suggestion derived
 * from the most removable constraint the query actually carried, never a
 * generic "try another search".
 */
export function evaluateHonesty(candidates: Candidate[], scored: ScoredHit[], intent: ParsedIntent): HonestyResult {
  const qualifying = candidates.filter((c) => passesHardConstraints(c, intent));
  const qualifiedKeys = new Set(qualifying.map(key));

  if (qualifying.length > 0) {
    const bestScore = Math.max(
      ...scored.filter((h) => qualifiedKeys.has(key(h))).map((h) => h.rankScore),
    );
    if (bestScore >= CONFIDENCE_FLOOR) {
      return { qualified: qualifiedKeys };
    }
    // Passed the hard filters but nothing is a confident match: fall through to
    // an honest broaden rather than surfacing weak filler.
  }

  return { qualified: new Set<string>(), broaden: buildBroaden(candidates, intent) };
}

/**
 * Build the specific broaden line. Names what was searched (brand, noun, price)
 * and then lists the removable constraints in order of specificity, deriving a
 * concrete raised price from the current catalog where a price ceiling blocked
 * results. Copy obeys house style: no emojis, no em-dashes, no hyphens.
 */
export function buildBroaden(candidates: Candidate[], intent: ParsedIntent): string {
  const noun = intent.nounHint
    ? plural(intent.nounHint)
    : intent.entityTypes.length === 1
      ? plural(entityNoun(intent.entityTypes[0]))
      : "matches";

  const priceClause = intent.priceMax !== undefined ? ` under ${intent.priceMax}` : "";
  const sportClause = intent.sport !== "general" ? ` ${cap(intent.sport)}` : "";

  // Lead sentence.
  let lead: string;
  if (intent.brand) {
    // Name brand, noun and price only, e.g. "No Babolat rackets under 2000."
    lead = `No ${cap(intent.brand)} ${noun}${priceClause}.`;
  } else if (intent.priceMax !== undefined) {
    lead = `No${sportClause} ${noun} under ${intent.priceMax}.`;
  } else if (intent.keywords.length > 0) {
    lead = `No matches for "${intent.keywords.join(" ")}".`;
  } else {
    lead = `No${sportClause} ${noun} found.`;
  }

  // Removable-constraint options, most specific first.
  const opts: string[] = [];

  // Price raise: cheapest catalog item that matches everything EXCEPT price and
  // brand, priced above the current ceiling, rounded up to the next 1000.
  if (intent.priceMax !== undefined) {
    const relaxable = candidates
      .filter((c) => typeof c.price === "number" && (c.price as number) > (intent.priceMax as number))
      .filter((c) => intent.keywords.length === 0 || intent.keywords.some((k) => c.text.includes(k)) || !!intent.nounHint)
      .map((c) => c.price as number);
    if (relaxable.length > 0) {
      const target = Math.ceil(Math.min(...relaxable) / 1000) * 1000;
      if (target > intent.priceMax) opts.push(`raising to ${target}`);
    }
  }

  if (intent.brand) opts.push("removing the brand");
  if (intent.timeWindow) opts.push(`removing ${intent.timeWindow}`);
  if (opts.length === 0 && intent.skillLevel) opts.push(`removing ${intent.skillLevel}`);
  if (opts.length === 0 && intent.keywords.length > 0) opts.push(`removing ${intent.keywords[intent.keywords.length - 1]}`);
  if (opts.length === 0 && intent.sport !== "general") opts.push("searching all sports");

  if (opts.length === 0) return `${lead} Try a broader search.`;

  let tail: string;
  if (opts.length === 1) tail = `Try ${opts[0]}.`;
  else if (opts.length === 2) tail = `Try ${opts[0]}, or ${opts[1]}.`;
  else tail = `Try ${opts.slice(0, -1).join(", ")}, or ${opts[opts.length - 1]}.`;

  return `${lead} ${tail}`;
}

function entityNoun(t: EntityType): string {
  switch (t) {
    case "gear":
      return "product";
    case "coach":
      return "coach";
    case "court":
      return "court";
    case "athlete":
      return "athlete";
    case "clip":
      return "clip";
  }
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
