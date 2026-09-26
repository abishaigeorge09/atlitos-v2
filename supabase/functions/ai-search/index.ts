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
//
// Phase S1 Track B (PRD-07 FR-40, FR-42; ADR-011 D1) extends the SAME gate to
// also cover a Voyage query-embedding call and `match_affiliate_products`
// recall (see `recallByVector` below); the response additionally gains
// `"vector": boolean`. `mode` keeps its pre-existing meaning ("did Claude
// actually parse/rerank"), so an existing caller sees no contract change.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";

import {
  candidateKey,
  ENTITY_TYPES,
  type EntityType,
  evaluateHonesty,
  type IntentOverride,
  parseIntent,
  scoreCandidates,
  type Sport,
  SPORTS,
} from "./search-core.ts";
import { llmEnabled, llmRerank } from "./llm.ts";
import { evaluateAiSearchGate, recordAiSpend } from "./spend-guard.ts";
// Phase L0 (ADR-014 component boundaries): the fetch layer lives in three
// modules; this file parses the request, runs the gate and the reads in
// parallel, and assembles the response. Behaviour is unchanged, proven by
// scripts/verify-search-eval.mjs --baseline-diff against the baseline recorded
// before the split.
import { background, fetchAffiliateProducts, fetchProducts, readQueryCache, recallByVector } from "./fetch-gear.ts";
import { courtBroaden, fetchCourts } from "./fetch-courts.ts";
import { fetchAthletes, fetchClips, fetchCoaches } from "./fetch-people.ts";

// --------------------------------------------------------------------------
// Request
// --------------------------------------------------------------------------

/** Below this length the query takes the deterministic path only (see the
 * LATENCY note in the handler). The shop screen sends from 2 characters. */
const MIN_AI_QUERY_CHARS = 3;

interface SearchRequestBody {
  query: string;
  entityTypes?: EntityType[];
  sport?: Sport;
  priceMax?: number;
  lat?: number;
  lng?: number;
  city?: string;
  limit: number;
  /** false while the shopper is still typing: skip Claude's rerank and
   * return the deterministic order. Default true (contract unchanged). */
  rerank: boolean;
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

  const rerank = body.rerank !== false;

  return { query: body.query.trim(), entityTypes, sport, priceMax, lat, lng, city, limit, rerank };
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
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
    // below MAY run (Claude's intent parse/rerank, and now Voyage's query
    // embedding, D1: "gates the Voyage call with the same per-user throttle
    // and daily budget it gates Claude with"). `spendAllowed` is that raw
    // gate outcome. `useLlm` additionally requires the Anthropic key to
    // actually be configured; `useVector` has no such extra requirement,
    // since `embedTexts` degrades to the offline stub on its own when no
    // Voyage key is present. The response's own `mode` field keeps its
    // PRE-EXISTING meaning ("did Claude actually parse/rerank this request"),
    // reported as `useLlm` below, not the raw spend gate: a Voyage-only
    // request with no Anthropic key configured must still report
    // `mode: "keyword"`, exactly as it did before this phase, so an existing
    // caller reading `mode` sees no contract change (ADR-011: "ai-search's
    // external contract is unchanged").
    // LATENCY (2026-09-19, measured on production: 4.5 to 8.0 s per keystroke,
    // the REST catalogue read is 0.3 s). Three changes, each earning its place:
    //   1. A query shorter than MIN_AI_QUERY_CHARS is a keystroke, not a
    //      question. It takes the deterministic path only: no gate RPCs, no
    //      Voyage, no Claude. Nothing semantic can be read from "ba".
    //   2. Claude no longer parses intent on the request path. The
    //      deterministic parser already reads sport, brand, price ceiling,
    //      skill and age; the parse call cost about 2 s per request and its
    //      merge rarely changed a field. `llmParseIntent` stays in llm.ts for
    //      an offline evaluation, not for the hot path.
    //   3. The spend gate and the embedding cache read run IN PARALLEL with
    //      the six table reads; the cache write and the spend records run
    //      after the response (EdgeRuntime.waitUntil). The database is in
    //      ap-south-1 and a caller outside India is served by another edge
    //      region, so every sequential round trip is a cross region hop;
    //      the client also pins `x-region: ap-south-1` (packages/api).
    //   4. `rerank: false` in the body skips Claude's rerank. The shop screen
    //      sends it while the shopper is typing and drops it on submit, so a
    //      keystroke costs no Claude call and the settled query gets the
    //      visible AI (order and rankReason) once. Second production
    //      measurement: with the rerank on, "badminton" still took 6.0 s;
    //      the rerank was 2.5 of it and the gate 0.9.
    // The rerank is bounded by RERANK_TIMEOUT_MS and RERANK_MAX_CANDIDATES
    // and only runs when there is more than one hit to order.
    const shortQuery = body.query.length < MIN_AI_QUERY_CHARS;
    const intent = parseIntent(body.query, override);
    const want = new Set(intent.entityTypes);

    // The spend gate (three sequential RPC round trips) and the six table
    // reads do not depend on each other, so they run together. The Voyage
    // recall waits for the gate because the gate is what permits the spend.
    const wantVector = !shortQuery && want.has("gear");
    const [gate, coaches, courts, products, affiliateProducts, athletes, clips, cachePre] = await Promise.all([
      shortQuery ? Promise.resolve({ mode: "keyword" as const }) : evaluateAiSearchGate(svc, userId),
      want.has("coach") ? fetchCoaches(supabase, intent, body.city) : Promise.resolve([]),
      want.has("court") ? fetchCourts(supabase, intent, body.lat, body.lng, body.city) : Promise.resolve([]),
      want.has("gear") ? fetchProducts(supabase, intent) : Promise.resolve([]),
      want.has("gear") ? fetchAffiliateProducts(supabase, intent) : Promise.resolve([]),
      want.has("athlete") ? fetchAthletes(supabase, intent) : Promise.resolve([]),
      want.has("clip") ? fetchClips(supabase, intent) : Promise.resolve([]),
      wantVector ? readQueryCache(svc, body.query).catch(() => null) : Promise.resolve(null),
    ]);
    const spendAllowed = gate.mode === "llm";
    const useLlm = spendAllowed && llmEnabled() && body.rerank;
    const useVector = spendAllowed;
    const reportedMode = useLlm ? "llm" : "keyword";

    const vectorMatches = useVector && wantVector && cachePre ? await recallByVector(svc, body.query, cachePre) : null;

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
    if (vectorMatches) {
      vector = true;
      const existingIds = new Set(affiliateProducts.map((c) => c.entityId));
      const newIds = vectorMatches
        .filter((m) => !existingIds.has(`affiliate:${m.id}`))
        .map((m) => m.id);
      const hydrated = await fetchAffiliateProducts(supabase, intent, newIds);
      for (const c of hydrated) candidates.push(c);
      // candidateKey shape is `${entityType}:${entityId}`, and entityId for
      // affiliate rows is itself `affiliate:${id}` (see fetchAffiliateProducts).
      for (const m of vectorMatches) {
        similarityByKey.set(candidateKey({ entityType: "gear", entityId: `affiliate:${m.id}` }), m.similarity);
      }
    }

    const scored = scoreCandidates(candidates, intent).sort((a, b) => b.rankScore - a.rankScore);

    // FR-16 honesty gate: keep only hard-constraint-qualified, confident hits.
    // similarityByKey lets a vector-only recall (zero keyword hits) still
    // clear the relevance floor once its cosine similarity clears
    // VECTOR_SIMILARITY_FLOOR (D1); brand/price constraints are unaffected.
    const honesty = evaluateHonesty(candidates, scored, intent, similarityByKey);
    if (honesty.broaden) {
      // A courts-only search gets a specific answer from real availability
      // ("the soonest is ... tomorrow at 6:00 AM") instead of the generic
      // text-based line, which would suggest deleting the time.
      const broaden = want.size === 1 && want.has("court")
        ? await courtBroaden(supabase, intent, body.lat, body.lng, body.city)
        : honesty.broaden;
      return jsonResponse(
        { query: body.query, parsedIntent: intent, results: [], broaden, mode: reportedMode, vector },
        200,
      );
    }

    const qualified = scored.filter((h) => honesty.qualified.has(candidateKey(h)));

    // A vector-only hit (recalled purely via similarity, ZERO keyword hits on
    // its own text) gets an honest rankReason naming why it is here, rather
    // than whatever scoreCandidates's keyword-blind fallback ("Relevant")
    // would say. Membership in `affiliateProducts` is NOT the right test
    // here: that fetch returns every active affiliate row up to its limit
    // regardless of keyword content (filtering happens later, at scoring/
    // honesty), so a product can be present there and still have zero
    // keyword overlap with THIS query. Re-derive the real signal instead:
    // does intent have keywords, and does this candidate's own text miss
    // every one of them, while it still cleared the vector floor.
    const textByKey = new Map(candidates.map((c) => [candidateKey(c), c.text]));
    for (const hit of qualified) {
      const key = candidateKey(hit);
      const text = textByKey.get(key) ?? "";
      const hasKeywordHit = intent.keywords.length > 0 && intent.keywords.some((k) => text.includes(k));
      if (similarityByKey.has(key) && (intent.keywords.length === 0 || !hasKeywordHit)) {
        hit.rankReason = "similar to your query";
      }
    }

    // LLM rerank (guarded) refines order + rankReason over the qualified set;
    // gated off (absent key, throttled, or over budget) or a call failure
    // both keep the deterministic order.
    let results = qualified;
    if (useLlm && qualified.length > 1) {
      const { hits: reranked, usage } = await llmRerank(body.query, qualified).catch(
        () => ({ hits: qualified, usage: null }),
      );
      results = reranked;
      if (usage) background(recordAiSpend(svc, usage.inputTokens, usage.outputTokens));
    }

    // The rerank may rewrite rankReason in prose. For a court, "when is it
    // free" is a fact from the database, and the thing the shopper asked, so
    // it always wins over the model's wording.
    for (const hit of results) {
      if (hit.slot) hit.rankReason = `Free ${hit.slot.label}`;
    }

    return jsonResponse(
      { query: body.query, parsedIntent: intent, results: results.slice(0, body.limit), mode: reportedMode, vector },
      200,
    );
  })
);
