// ATLITOS v2 - scripts/lib/search-eval-metrics.test.ts
//
// Unit proof of the harness metrics against examples computed BY HAND, not by
// the module under test (docs/PLAN-SEARCH-LOCATION-AFFILIATE.md L0-T1 gate).
//
// Run: apps/portal-court/node_modules/.bin/tsx scripts/lib/search-eval-metrics.test.ts
//
// NDCG worked example, grades in result order [3, 2, 0, 1], judged pool
// [3, 3, 2, 1, 0]. Gain 2^g - 1, discount log2(rank + 1).
//   DCG  = 7/log2(2) + 3/log2(3) + 0/log2(4) + 1/log2(5)
//        = 7 + 3/1.5849625 + 0 + 1/2.3219281
//        = 7 + 1.8927893 + 0.4306766            = 9.3234658
//   IDCG over [3, 3, 2, 1, 0]
//        = 7/1 + 7/1.5849625 + 3/2 + 1/2.3219281 + 0
//        = 7 + 4.4165083 + 1.5 + 0.4306766       = 13.3471848
//   NDCG = 9.3234658 / 13.3471848                = 0.6985343

// @ts-expect-error plain ESM module without type declarations
import * as m from './search-eval-metrics.mjs';

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`);
  if (!ok) failed += 1;
}
const near = (a: number | null, b: number, eps = 1e-6) => a !== null && Math.abs(a - b) < eps;

const dcg = m.dcgAt([3, 2, 0, 1], 10);
check('DCG of [3,2,0,1] is 9.3234658 (hand computed)', near(dcg, 9.3234658, 1e-6), dcg);
const idcg = m.dcgAt([3, 3, 2, 1, 0], 10);
check('IDCG of [3,3,2,1,0] is 13.3471848 (hand computed)', near(idcg, 13.3471848, 1e-6), idcg);
const ndcg = m.ndcgAt([3, 2, 0, 1], [0, 1, 3, 2, 3], 10);
check('NDCG@10 is 0.6985343, and the pool order does not matter', near(ndcg, 0.6985343, 1e-6), ndcg);
check('NDCG@10 of the ideal order is exactly 1', m.ndcgAt([3, 3, 2, 1], [3, 3, 2, 1, 0]) === 1);
check('NDCG is null when nothing in the pool is relevant', m.ndcgAt([0, 0], [0, 0, 0]) === null);
check('NDCG@2 cuts the ranking at 2: [0,3] over pool [3] is 7/log2(3)/7 = 0.6309298', near(m.ndcgAt([0, 3], [3], 2), 1 / Math.log2(3), 1e-9), m.ndcgAt([0, 3], [3], 2));
check('an unjudged hit counts 0: [0,3] is worse than [3,0]', (m.ndcgAt([0, 3], [3]) as number) < (m.ndcgAt([3, 0], [3]) as number));

check('P@5 with 3 relevant items, all 3 on top, is 1 (denominator min(5, R))', m.precisionAt([2, 3, 2, 0, 0], [3, 2, 2, 0, 0, 0]) === 1);
check('P@5 counts grade 2 and above only: [1,1,2,0,0] with R=5 is 1/5', near(m.precisionAt([1, 1, 2, 0, 0], [2, 2, 2, 2, 2, 1]), 0.2), m.precisionAt([1, 1, 2, 0, 0], [2, 2, 2, 2, 2, 1]));
check('P@5 is null when nothing is relevant', m.precisionAt([0], [0, 1]) === null);

check('Hit@1 is 1 when the first hit is grade 3', m.hitAt1([3, 0], [3]) === 1);
check('Hit@1 is 0 when the grade 3 item is second', m.hitAt1([1, 3], [3, 1]) === 0);
check('Hit@1 is 0 on an empty result list', m.hitAt1([], [3]) === 0);

check('Recall@5: 2 of 3 grade 3 items in the top 5 is 0.6667', near(m.recallAt([3, 0, 3, 0, 0, 3], [3, 3, 3]), 2 / 3), m.recallAt([3, 0, 3, 0, 0, 3], [3, 3, 3]));
check('Recall@5 with 8 grade 3 items and 5 in the top 5 is 1', m.recallAt([3, 3, 3, 3, 3], Array(8).fill(3)) === 1);
check('Recall@5 on an empty result list is 0', m.recallAt([], [3]) === 0);

check('numbersIn reads 2,149 and 1,799 from a rupee sentence', JSON.stringify(m.numbersIn('Cheapest is ₹1,799 on Flipkart, ₹2,149 on Amazon, checked 3 h ago')) === '[1799,2149,3]', m.numbersIn('Cheapest is ₹1,799 on Flipkart, ₹2,149 on Amazon, checked 3 h ago'));
check('hasDashOrEmoji catches an em dash', m.hasDashOrEmoji('No courts — try later'));
check('hasDashOrEmoji passes plain copy', !m.hasDashOrEmoji('No Yonex rackets under 1000. Try removing the brand.'));

console.log(failed ? `\nFAILED ${failed} check(s)` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
