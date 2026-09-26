// ATLITOS v2 - scripts/lib/search-eval-metrics.mjs
//
// Pure ranking metrics for the search evaluation harness
// (scripts/verify-search-eval.mjs; ADR-014 D1; docs/PLAN-SEARCH-LOCATION-AFFILIATE.md
// section 1.3). No I/O, no network, so scripts/lib/search-eval-metrics.test.ts can
// prove every formula against a hand computed example.
//
// Conventions, stated once so nobody has to reverse engineer them:
//   - A ranking is an array of grades (0 to 3) in result order. An unjudged hit
//     is grade 0 (ADR-014 D1: "unjudged hit counts 0").
//   - Gain is 2^grade - 1, discount is log2(rank + 1) with rank starting at 1.
//   - The ideal ranking is every judged grade for the query sorted descending,
//     so IDCG is computed from the judgments, not from what came back.
//   - NDCG is UNDEFINED (null) when no judged item has grade > 0: there is
//     nothing to rank. The caller reports such a query under honest empty
//     accuracy instead and says how many it excluded from NDCG.

export const THRESHOLDS = Object.freeze({
  constraintPrecision: 1.0,
  ndcgOverall: 0.85,
  ndcgClass: 0.75,
  precisionAt5: 0.8,
  hitAt1: 0.9,
  recallAt5: 0.8,
  honestEmpty: 1.0,
  courtWindow: 1.0,
  answerGrounding: 1.0,
  unjudgedRate: 0.1,
  degradedNdcg: 0.7,
  degradedConstraintPrecision: 1.0,
  maxWallMs: 3000,
});

export function gain(grade) {
  return 2 ** grade - 1;
}

/** Discounted cumulative gain over the first k grades. */
export function dcgAt(grades, k = 10) {
  let s = 0;
  const n = Math.min(k, grades.length);
  for (let i = 0; i < n; i++) s += gain(grades[i] ?? 0) / Math.log2(i + 2);
  return s;
}

/**
 * NDCG@k. `ranked` is the result grades in order; `pool` is every judged grade
 * for the query (any order). Returns null when the pool has no positive grade.
 */
export function ndcgAt(ranked, pool, k = 10) {
  const ideal = [...pool].sort((a, b) => b - a);
  const idcg = dcgAt(ideal, k);
  if (idcg === 0) return null;
  return dcgAt(ranked, k) / idcg;
}

/**
 * Precision at k with a relevance cutoff. The denominator is min(k, R) where R
 * is how many judged items clear the cutoff, so a query with three right
 * answers can still score 1.0 by returning all three first. Null when R is 0.
 */
export function precisionAt(ranked, pool, k = 5, minGrade = 2) {
  const r = pool.filter((g) => g >= minGrade).length;
  if (r === 0) return null;
  const hits = ranked.slice(0, k).filter((g) => g >= minGrade).length;
  return hits / Math.min(k, r);
}

/** Hit@1: the first result is a grade 3 item. Null when no grade 3 exists. */
export function hitAt1(ranked, pool) {
  if (!pool.some((g) => g === 3)) return null;
  return ranked[0] === 3 ? 1 : 0;
}

/** Recall@k over grade 3 items: |grade 3 in top k| / min(k, |grade 3|). */
export function recallAt(ranked, pool, k = 5) {
  const r = pool.filter((g) => g === 3).length;
  if (r === 0) return null;
  return ranked.slice(0, k).filter((g) => g === 3).length / Math.min(k, r);
}

/** Mean of the non-null values, with the count used. */
export function mean(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return { value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: v.length };
}

/** Numbers inside a sentence, commas and a leading rupee sign stripped. */
export function numbersIn(text) {
  return [...String(text).replace(/(\d),(\d)/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** True when the string carries an em dash, en dash, a hyphen or an emoji. */
export function hasDashOrEmoji(text) {
  return /[–—-]|\p{Extended_Pictographic}/u.test(String(text));
}
