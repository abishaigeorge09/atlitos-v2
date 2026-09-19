// ATLITOS v2 — supabase/functions/_shared/embeddings.ts
//
// Phase S1 Track B (PRD-07 FR-40, FR-43; ADR-011 D1, D2; PHASE-S1-STATUS.md
// "the hard decision"). One embedding client shared by `gear-embed` (writes
// `affiliate_products.embedding`) and `ai-search` (embeds the query for
// `match_affiliate_products` recall). 1024 dims either way, matching the
// column type `extensions.vector(1024)`.
//
// TWO MODES, same output shape, so nothing downstream branches on which ran:
//   - "voyage": calls the real Voyage API when `VOYAGE_API_KEY` is set AND
//     `VOYAGE_STUB` is not "1". Model from `VOYAGE_MODEL` (default
//     `voyage-3`), `input_type` set to "query" or "document" per the caller's
//     `kind` so Voyage's own asymmetric retrieval tuning applies.
//   - "stub": deterministic, offline, no network and no key. sha256 of the
//     NORMALISED text seeds a PRNG that fills 1024 dims, then the vector is
//     unit-normalised. Equal (normalised) texts always produce equal vectors,
//     which is what makes AC-11-2 provable without a paid key: the stub still
//     clusters near-duplicate product text so `verify-search-hybrid.mjs` can
//     show relative similarity, just not real semantic understanding, hence
//     the gate marks that acceptance criterion STUB rather than PASS in that
//     mode (PHASE-S1-STATUS.md's hard decision, not this file's to relax).
//
// `embeddingsMode()` lets a caller (verify scripts, `gear-embed`'s response)
// report honestly which path actually ran, rather than inferring it from
// environment variables a second time.
//
// Timeout 4s, at most one retry, matching D2's "on Voyage failure the
// embedding stays null" contract: a caller that gets `null` back here must
// treat it exactly like "no embedding available" and move on, never throw
// past this module for a network hiccup.

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const EMBED_DIMS = 1024;
const TIMEOUT_MS = 4000;
const MAX_RETRIES = 1; // one retry beyond the first attempt, per the dispatch contract.

export type EmbeddingKind = "query" | "document";
export type EmbeddingMode = "voyage" | "stub";

function getEnv(name: string): string | undefined {
  try {
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    return env?.get?.(name) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which path `embedTexts` will actually take right now, given the current
 * environment. Computed fresh every call (never cached) so a test harness
 * that flips `VOYAGE_API_KEY`/`VOYAGE_STUB` between calls (verify-gear-embed's
 * "bad key" case) sees the mode it expects without a stale memo.
 */
export function embeddingsMode(): EmbeddingMode {
  const key = getEnv("VOYAGE_API_KEY");
  const stub = getEnv("VOYAGE_STUB");
  if (stub === "1") return "stub";
  if (key && key.length > 0) return "voyage";
  return "stub";
}

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

/**
 * Embed a batch of texts. In "stub" mode this never fails (pure local math).
 * In "voyage" mode a real failure (bad key, timeout, non-2xx, malformed body,
 * after the retry) THROWS rather than silently degrading to the stub: both
 * callers of this module need to know the difference between "got a real
 * embedding" and "did not" so they can apply their OWN failure policy —
 * `gear-embed` leaves the column null and reports to Sentry (D2), `ai-search`
 * skips vector recall for that request and returns `vector: false` (D1). A
 * module that quietly substituted the stub on a Voyage outage would make
 * both of those honesty contracts unprovable.
 */
export async function embedTexts(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
  const mode = embeddingsMode();
  if (mode === "stub") {
    return Promise.all(texts.map((t) => stubEmbeddingAsync(t)));
  }

  const key = getEnv("VOYAGE_API_KEY") as string; // mode === "voyage" implies this is set.
  const model = getEnv("VOYAGE_MODEL") || "voyage-3";

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const vectors = await callVoyage(key, model, texts, kind);
      if (vectors) return vectors;
      lastErr = new Error("Voyage returned a non-2xx response or an unusable body");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function callVoyage(
  key: string,
  model: string,
  texts: string[],
  kind: EmbeddingKind,
): Promise<number[][] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model,
        input_type: kind,
        output_dimension: EMBED_DIMS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    if (!Array.isArray(body.data)) return null;
    const vectors = body.data.map((d) => (Array.isArray(d.embedding) ? d.embedding : null));
    if (vectors.some((v) => v === null || v.length !== EMBED_DIMS)) return null;
    return vectors as number[][];
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------
// Deterministic stub
// --------------------------------------------------------------------------

/** Lowercase, collapse whitespace, trim: two texts differing only in case or spacing embed identically. */
function normalise(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * A tiny, deterministic PRNG (mulberry32) seeded from the sha256 digest of
 * the normalised text. Same text in, same 1024-dim unit vector out, every
 * time, on any machine, with no network and no key. Not a semantic embedding
 * (equal-*meaning* text is not guaranteed close unless it is also equal
 * *text*), which is exactly why PHASE-S1-STATUS.md's hard decision marks
 * AC-11-2 as STUB rather than PASS when this path is what ran.
 */
async function stubEmbeddingAsync(text: string): Promise<number[]> {
  let state = await sha256Seed(normalise(text));

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const vec = new Array<number>(EMBED_DIMS);
  for (let i = 0; i < EMBED_DIMS; i++) {
    // Spread over [-1, 1] rather than [0, 1], keeps the stub from clustering
    // every dimension's sign the same way a single uniform draw would.
    vec[i] = next() * 2 - 1;
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/** First 4 bytes of sha256(text) as an unsigned 32-bit PRNG seed. */
async function sha256Seed(text: string): Promise<number> {
  const data = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
}
