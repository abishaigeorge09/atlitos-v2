// ATLITOS v2 — supabase/functions/ai-search/llm.ts
//
// The GUARDED LLM path for AI search. Everything here is gated on the
// `ANTHROPIC_API_KEY` Supabase edge secret. When the key is ABSENT, none of
// this runs and the caller (index.ts) uses the deterministic keyword parse and
// score. When PRESENT, Claude (a) parses the natural language query into
// structured intent and (b) reranks the SQL-fetched candidates with a short
// rankReason per hit.
//
// Two invariants make this safe to ship before the key exists:
//   1. Nothing here is imported by the deterministic path, and every call is
//      wrapped in try/catch with a hard AbortController timeout, so a slow,
//      failed, or rate-limited model call degrades to keyword search and never
//      blocks or errors the response.
//   2. No key is hardcoded. It is read only from Deno.env at call time. The
//      founder activates the LLM with:
//        supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//      (see docs/qa/BUG-LEDGER.md BUG-006). Until then this module is inert.

import type { EntityType, ParsedIntent, ScoredHit, SkillLevel, Sport } from "./search-core.ts";
import { ENTITY_TYPES, SPORTS } from "./search-core.ts";

// Haiku for latency and cost on a per-keystroke search path. Swap to
// claude-sonnet-5 if reranking quality warrants it; the request shape is
// identical (adaptive thinking, no sampling params).
const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const INTENT_TIMEOUT_MS = 3500;
const RERANK_TIMEOUT_MS = 4000;

export function llmEnabled(): boolean {
  const key = getKey();
  return typeof key === "string" && key.length > 0;
}

function getKey(): string | undefined {
  // Deno.env is the only source. Never a literal, never a request field.
  try {
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    return env?.get?.("ANTHROPIC_API_KEY") || undefined;
  } catch {
    return undefined;
  }
}

async function callClaude(body: unknown, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const key = getKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    // Timeout, network error, abort: the caller falls back to deterministic.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Pull the first text block out of a Messages API response.
function firstText(msg: Record<string, unknown> | null): string | null {
  if (!msg) return null;
  const content = msg.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
      const t = (block as Record<string, unknown>).text;
      if (typeof t === "string") return t;
    }
  }
  return null;
}

function safeJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Model wrapped JSON in prose or a code fence: extract the first object.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// --------------------------------------------------------------------------
// (a) Intent parse
// --------------------------------------------------------------------------

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entityTypes: { type: "array", items: { type: "string", enum: [...ENTITY_TYPES] } },
    sport: { type: "string", enum: [...SPORTS, "general"] },
    priceMax: { type: ["number", "null"] },
    brand: { type: ["string", "null"] },
    skillLevel: { type: ["string", "null"], enum: ["beginner", "intermediate", "advanced", null] },
    ageHint: { type: ["number", "null"] },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: ["entityTypes", "sport", "priceMax", "brand", "skillLevel", "ageHint", "keywords"],
} as const;

const INTENT_SYSTEM =
  "You parse a shopper's natural language query for an Indian sports super app into structured search intent. " +
  "entityTypes is any of: gear (products to buy), coach, court (venues to book), athlete (to donate to), clip (videos). " +
  "sport is one of football, cricket, badminton, tennis, or general. priceMax is the rupee ceiling if the user gave one, else null. " +
  "brand is a lowercased gear brand if named (e.g. babolat, yonex, nike), else null. skillLevel is beginner, intermediate, or advanced if implied, else null. " +
  "ageHint is the user's age in years if stated, else null. keywords are the remaining concrete content words (product nouns, features), lowercased, excluding sport, brand, and filler words. " +
  "Return only the structured object.";

/**
 * Parse intent with Claude. Returns null on absent key, timeout, error, or an
 * unusable response so the caller keeps the deterministic parse. The result is
 * merged OVER the deterministic intent (hybrid), never replacing it wholesale.
 */
export async function llmParseIntent(query: string): Promise<Partial<ParsedIntent> | null> {
  const msg = await callClaude(
    {
      model: MODEL,
      max_tokens: 400,
      system: INTENT_SYSTEM,
      output_config: { format: { type: "json_schema", schema: INTENT_SCHEMA } },
      messages: [{ role: "user", content: query }],
    },
    INTENT_TIMEOUT_MS,
  );

  const parsed = safeJson(firstText(msg));
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;

  const out: Partial<ParsedIntent> = {};

  if (Array.isArray(p.entityTypes)) {
    const et = p.entityTypes.filter(
      (t): t is EntityType => typeof t === "string" && (ENTITY_TYPES as readonly string[]).includes(t),
    );
    if (et.length > 0) out.entityTypes = et;
  }
  if (typeof p.sport === "string" && ([...SPORTS, "general"] as string[]).includes(p.sport)) {
    out.sport = p.sport as Sport | "general";
  }
  if (typeof p.priceMax === "number" && Number.isFinite(p.priceMax) && p.priceMax > 0) out.priceMax = p.priceMax;
  if (typeof p.brand === "string" && p.brand.trim()) out.brand = p.brand.trim().toLowerCase();
  if (typeof p.skillLevel === "string" && ["beginner", "intermediate", "advanced"].includes(p.skillLevel)) {
    out.skillLevel = p.skillLevel as SkillLevel;
  }
  if (typeof p.ageHint === "number" && Number.isFinite(p.ageHint) && p.ageHint > 0 && p.ageHint < 100) out.ageHint = p.ageHint;
  if (Array.isArray(p.keywords)) {
    const kw = p.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.toLowerCase());
    if (kw.length > 0) out.keywords = kw;
  }

  return out;
}

// --------------------------------------------------------------------------
// (b) Rerank
// --------------------------------------------------------------------------

const RERANK_SYSTEM =
  "You rerank sports super app search results for a shopper's query, best first. " +
  "Use only the provided candidates. For each, write a short (max 6 words) human rankReason explaining the fit " +
  "(e.g. 'Beginner friendly tennis racket', 'Closest court, well rated'). No emojis, no dashes. " +
  "Return every candidate id exactly once.";

const RERANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ranking: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, rankReason: { type: "string" } },
        required: ["id", "rankReason"],
      },
    },
  },
  required: ["ranking"],
} as const;

/**
 * Rerank the deterministically-scored hits with Claude, rewriting rankReason.
 * Falls back to the incoming order (already sorted by the hybrid deterministic
 * score) for any id the model drops, so results stay stable and complete even
 * on a partial or failed response. Returns the original hits unchanged on any
 * failure.
 */
export async function llmRerank(query: string, hits: ScoredHit[]): Promise<ScoredHit[]> {
  if (hits.length === 0) return hits;

  const candidates = hits.map((h) => ({
    id: `${h.entityType}:${h.entityId}`,
    type: h.entityType,
    title: h.title,
    subtitle: h.subtitle,
    price: h.price,
  }));

  const msg = await callClaude(
    {
      model: MODEL,
      max_tokens: 900,
      system: RERANK_SYSTEM,
      output_config: { format: { type: "json_schema", schema: RERANK_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Query: ${query}\nCandidates:\n${JSON.stringify(candidates)}`,
        },
      ],
    },
    RERANK_TIMEOUT_MS,
  );

  const parsed = safeJson(firstText(msg));
  if (!parsed || typeof parsed !== "object") return hits;
  const ranking = (parsed as Record<string, unknown>).ranking;
  if (!Array.isArray(ranking)) return hits;

  const byKey = new Map(hits.map((h) => [`${h.entityType}:${h.entityId}`, h]));
  const ordered: ScoredHit[] = [];
  const used = new Set<string>();

  for (const row of ranking) {
    if (!row || typeof row !== "object") continue;
    const id = (row as Record<string, unknown>).id;
    const reason = (row as Record<string, unknown>).rankReason;
    if (typeof id !== "string" || !byKey.has(id) || used.has(id)) continue;
    const hit = byKey.get(id)!;
    ordered.push(typeof reason === "string" && reason.trim() ? { ...hit, rankReason: reason.trim() } : hit);
    used.add(id);
  }

  // Append any hit the model omitted, preserving the deterministic order, so
  // the LLM can reorder but never silently drop a real result.
  for (const h of hits) {
    const k = `${h.entityType}:${h.entityId}`;
    if (!used.has(k)) ordered.push(h);
  }

  return ordered;
}
