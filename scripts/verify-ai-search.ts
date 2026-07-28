// Verification harness for Phase 9 WS3 (BUG-006): proves the deterministic
// honesty threshold + broaden suggestion over the CURRENT seed catalog, with NO
// ANTHROPIC_API_KEY set. Run:
//   node_modules/.bin/tsx scripts/verify-ai-search.ts
//
// It imports the PURE search core (no Deno, no network) and mirrors index.ts:
// parse intent -> filter a seed-shaped candidate pool by sport + entityTypes
// (what the fetch layer does) -> score -> honesty gate. This exercises the same
// code the edge function runs on the deterministic (no-key) path.

import {
  type Candidate,
  evaluateHonesty,
  type ParsedIntent,
  parseIntent,
  scoreCandidates,
} from '../supabase/functions/ai-search/search-core.ts';

// --- Seed-shaped candidate pool (from supabase/seed/seed_p4_commerce.sql plus
// a couple of coaches/courts). Prices are the real seed base prices. ---
const PRODUCTS: Candidate[] = [
  prod('p-cri-bat', 'Professional Cricket Bat', 'cricket', 1500),
  prod('p-cri-gloves', 'Leather Cricket Gloves', 'cricket', 350),
  prod('p-cri-helmet', 'Cricket Helmet with Grill', 'cricket', 800),
  prod('p-cri-balls', 'Pack of Cricket Balls', 'cricket', 600),
  prod('p-cri-legguards', 'Cricket Legguards', 'cricket', 450),
  prod('p-bad-racket', 'Badminton Racket Pro Series', 'badminton', 950),
  prod('p-bad-shuttle', 'Badminton Shuttlecocks Pack', 'badminton', 350),
  prod('p-bad-shoes', 'Badminton Court Shoes', 'badminton', 1200),
  prod('p-ten-racket', 'Tennis Racket Carbon Series', 'tennis', 2500),
  prod('p-ten-balls', 'Tennis Ball Canister', 'tennis', 200),
  prod('p-ten-wrist', 'Tennis Wristband', 'tennis', 150),
  prod('p-foot-ball', 'Professional Football', 'football', 850),
];

const COACHES: Candidate[] = [
  coach('c-ten-1', 'Ravi Kumar', 'tennis', 'Chennai', 4.6, 500),
  coach('c-cri-1', 'Sana Iyer', 'cricket', 'Mumbai', 4.8, 400),
];

const COURTS: Candidate[] = [
  court('ct-ten-1', 'Baseline Tennis Court', 'tennis', 'Chennai', 600),
  court('ct-cri-1', 'Marina Cricket Ground', 'cricket', 'Chennai', 800),
];

const POOL: Candidate[] = [...PRODUCTS, ...COACHES, ...COURTS];

function prod(id: string, title: string, sport: Candidate['sport'], price: number): Candidate {
  return {
    entityType: 'gear',
    entityId: id,
    title,
    subtitle: cap(sport ?? 'gear'),
    sport,
    price,
    text: `${title} ${sport}`.toLowerCase(),
  };
}
function coach(id: string, name: string, sport: Candidate['sport'], city: string, rating: number, price: number): Candidate {
  return {
    entityType: 'coach',
    entityId: id,
    title: name,
    subtitle: `${cap(sport ?? '')} . ${city}`,
    sport,
    price,
    rating,
    text: `${name} ${sport} ${city}`.toLowerCase(),
  };
}
function court(id: string, name: string, sport: Candidate['sport'], city: string, price: number): Candidate {
  return {
    entityType: 'court',
    entityId: id,
    title: name,
    subtitle: `${name} . ${city}`,
    sport,
    price,
    text: `${name} ${sport} ${city}`.toLowerCase(),
  };
}
function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Mirror the edge fetch layer: sport + entityTypes filter, then score + honesty.
function run(query: string): { intent: ParsedIntent; results: ReturnType<typeof scoreCandidates>; broaden?: string } {
  const intent = parseIntent(query);
  const want = new Set(intent.entityTypes);
  const candidates = POOL.filter(
    (c) => want.has(c.entityType) && (intent.sport === 'general' || c.sport === intent.sport),
  );
  const scored = scoreCandidates(candidates, intent).sort((a, b) => b.rankScore - a.rankScore);
  const honesty = evaluateHonesty(candidates, scored, intent);
  if (honesty.broaden) return { intent, results: [], broaden: honesty.broaden };
  const qualified = scored.filter((h) => honesty.qualified.has(`${h.entityType}:${h.entityId}`));
  return { intent, results: qualified };
}

// --- Assertions ---
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? ` -- ${detail}` : ''}`);
}

console.log('=== ATLITOS WS3 ai-search verification (NO ANTHROPIC_API_KEY) ===\n');

// A. Plain keyword "tennis" returns real results (deterministic browse).
{
  const { results, broaden } = run('tennis');
  check('A. "tennis" returns results', results.length > 0, `${results.length} hits`);
  check('A. "tennis" has no broaden', broaden === undefined);
}

// B. The Babolat NL query -> honest empty + the exact broaden example.
// NOTE (WS4): this POOL is deliberately Babolat-free, so it isolates the WS3
// honesty LOGIC (no-match -> specific broaden). Over the REAL WS4 affiliate
// catalog, which now seeds a Babolat racket under 2000, the same query returns
// the real product; that end-to-end behaviour is proven by
// scripts/verify-affiliate.ts against the live project.
{
  const { intent, results, broaden } = run(
    "I'm a 10-year-old beginner at tennis, want a racket and a Babolat under 2000",
  );
  check('B. intent.brand === babolat', intent.brand === 'babolat', String(intent.brand));
  check('B. intent.sport === tennis', intent.sport === 'tennis', String(intent.sport));
  check('B. intent.priceMax === 2000', intent.priceMax === 2000, String(intent.priceMax));
  check('B. intent.skillLevel === beginner', intent.skillLevel === 'beginner', String(intent.skillLevel));
  check('B. intent.ageHint === 10', intent.ageHint === 10, String(intent.ageHint));
  check('B. intent.nounHint === racket', intent.nounHint === 'racket', String(intent.nounHint));
  check('B. results empty (honest no-match)', results.length === 0);
  const expected = 'No Babolat rackets under 2000. Try raising to 3000, or removing the brand.';
  check('B. broaden matches expected', broaden === expected, `\n      got: ${broaden}\n      exp: ${expected}`);
}

// C. Brand no-match without a price ceiling.
{
  const { results, broaden } = run('Babolat racket');
  check('C. results empty', results.length === 0);
  check('C. broaden = remove brand only', broaden === 'No Babolat rackets. Try removing the brand.', String(broaden));
}

// D. Hybrid keyword fallback (no key): "cricket bat" returns cricket gear.
{
  const { results, broaden } = run('cricket bat');
  check('D. "cricket bat" returns results', results.length > 0, `${results.length} hits`);
  check('D. no broaden', broaden === undefined);
}

// E. Price precision: over-budget racket is DROPPED, not shown as filler.
{
  const { results, broaden } = run('cricket bat under 1000');
  const ids = results.map((r) => r.entityId);
  check('E. results non-empty', results.length > 0, ids.join(','));
  check('E. no broaden', broaden === undefined);
  check('E. over-budget bat (1500) excluded', !ids.includes('p-cri-bat'), ids.join(','));
  check('E. all shown items <= 1000', results.every((r) => (r.price ?? 0) <= 1000));
}

// F. Pure keyword no-match -> honest broaden derived from a keyword.
{
  const { results, broaden } = run('yoga meditation');
  check('F. results empty', results.length === 0);
  check('F. broaden names the query + removable keyword', !!broaden && broaden.includes('yoga meditation') && broaden.toLowerCase().includes('removing'), String(broaden));
}

// House style guard: no emoji / em-dash / hyphen in any broaden copy string.
{
  const broadens = [
    run("I'm a 10-year-old beginner at tennis, want a racket and a Babolat under 2000").broaden,
    run('Babolat racket').broaden,
    run('yoga meditation').broaden,
  ].filter(Boolean) as string[];
  const bad = broadens.filter((b) => /[—–-]/.test(b) || /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(b));
  check('G. broaden copy has no emoji/dash/hyphen', bad.length === 0, bad.join(' | '));
}

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ===`);
process.exit(failures === 0 ? 0 : 1);
