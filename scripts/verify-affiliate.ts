// Verification harness for Phase 9 WS4 (affiliate marketplace + WS3 handoff).
// Proves against the LIVE project (not a hand-shaped pool) that:
//   1. The Babolat Pure Drive Team exists with an offer UNDER 2000 and a higher
//      offer, so the compare view has a real cross-retailer spread.
//   2. Running the REAL WS3 search core over the REAL affiliate + owned catalog,
//      "Babolat under 2000" now returns the Babolat product with a rankReason,
//      instead of the WS3 broaden message.
//   3. The honesty gate still tells the truth: "Wilson racket under 2000"
//      (Wilson gear is all priced over 2000) still returns EMPTY + a broaden.
//
// This mirrors index.ts's fetch layer (fetchProducts + fetchAffiliateProducts):
// owned products carry base_price, affiliate products carry their cheapest
// in-stock offer price and fold brand/skill_level/age_range into the text blob.
//
// Run: node --env-file=.env.local node_modules/.bin/tsx scripts/verify-affiliate.ts

import { createClient } from '@supabase/supabase-js';

import {
  type Candidate,
  evaluateHonesty,
  parseIntent,
  scoreCandidates,
  type Sport,
} from '../supabase/functions/ai-search/search-core.ts';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('[verify-affiliate] SUPABASE_SERVICE_ROLE_KEY required. Run with node --env-file=.env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` -- ${detail}` : ''}`);
}

async function ownedCandidates(sport: Sport | 'general'): Promise<Candidate[]> {
  let q = supabase.from('products').select('id, title, description, sport, base_price').eq('active', true);
  if (sport !== 'general') q = q.eq('sport', sport);
  const { data } = await q;
  return (data ?? []).map((r): Candidate => ({
    entityType: 'gear',
    entityId: r.id,
    title: r.title,
    subtitle: r.sport ?? 'Gear',
    sport: (r.sport as Sport) ?? undefined,
    price: r.base_price ?? undefined,
    text: [r.title, r.sport, r.description].filter(Boolean).join(' ').toLowerCase(),
  }));
}

async function affiliateCandidates(sport: Sport | 'general'): Promise<Candidate[]> {
  let q = supabase
    .from('affiliate_products')
    .select('id, title, brand, sport, skill_level, age_range, description, product_offers ( price, in_stock )')
    .eq('active', true);
  if (sport !== 'general') q = q.eq('sport', sport);
  const { data } = await q;
  return (data ?? []).map((r): Candidate => {
    const offers = (r.product_offers ?? []) as Array<{ price: number; in_stock: boolean }>;
    const inStock = offers.filter((o) => o.in_stock).map((o) => Number(o.price));
    const price = inStock.length > 0 ? Math.min(...inStock) : undefined;
    return {
      entityType: 'gear',
      entityId: `affiliate:${r.id}`,
      title: r.title,
      subtitle: [r.brand, r.sport].filter(Boolean).join(' . '),
      sport: (r.sport as Sport) ?? undefined,
      price,
      text: [r.title, r.brand, r.sport, r.skill_level, r.age_range, r.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    };
  });
}

async function search(query: string) {
  const intent = parseIntent(query);
  const want = new Set(intent.entityTypes);
  const sport = intent.sport;
  const owned = want.has('gear') ? await ownedCandidates(sport) : [];
  const affiliate = want.has('gear') ? await affiliateCandidates(sport) : [];
  const candidates = [...owned, ...affiliate].filter((c) => want.has(c.entityType));
  const scored = scoreCandidates(candidates, intent).sort((a, b) => b.rankScore - a.rankScore);
  const honesty = evaluateHonesty(candidates, scored, intent);
  if (honesty.broaden) return { intent, results: [], broaden: honesty.broaden };
  const qualified = scored.filter((h) => honesty.qualified.has(`${h.entityType}:${h.entityId}`));
  return { intent, results: qualified, broaden: undefined as string | undefined };
}

async function main() {
  console.log('=== ATLITOS WS4 affiliate verification (LIVE project, real search core) ===\n');

  // 1. SQL proof: Babolat under 2000 + higher offer.
  const { data: babolat } = await supabase
    .from('affiliate_products')
    .select('id, title, brand, skill_level, age_range, product_offers ( retailer, price, in_stock )')
    .eq('id', 'a0000000-0000-0000-0000-000000000001')
    .single();
  const offers = (babolat?.product_offers ?? []) as Array<{ retailer: string; price: number; in_stock: boolean }>;
  const under = offers.filter((o) => Number(o.price) < 2000);
  const over = offers.filter((o) => Number(o.price) >= 2000);
  check('1. Babolat Pure Drive Team exists', !!babolat, babolat?.title);
  check('1. has an in-stock offer under 2000', under.some((o) => o.in_stock), under.map((o) => `${o.retailer} ${o.price}`).join(', '));
  check('1. has a higher offer (real spread)', over.length > 0, over.map((o) => `${o.retailer} ${o.price}`).join(', '));

  // 2. "Babolat under 2000" now returns the real product (not the broaden).
  const b = await search("I'm a 10-year-old beginner at tennis, want a racket and a Babolat under 2000");
  check('2. intent.brand === babolat', b.intent.brand === 'babolat', String(b.intent.brand));
  check('2. intent.priceMax === 2000', b.intent.priceMax === 2000, String(b.intent.priceMax));
  check('2. NO broaden message now', b.broaden === undefined, String(b.broaden));
  const babolatHit = b.results.find((r) => r.entityId === 'affiliate:a0000000-0000-0000-0000-000000000001');
  check('2. returns the real Babolat Pure Drive Team', !!babolatHit, babolatHit ? `${babolatHit.title} @ ${babolatHit.price} (${babolatHit.rankReason})` : b.results.map((r) => r.title).join(', '));
  check('2. every returned Babolat hit is <= 2000', b.results.filter((r) => r.title.toLowerCase().includes('babolat')).every((r) => (r.price ?? 0) <= 2000));
  check('2. hit carries a rankReason', !!babolatHit?.rankReason, babolatHit?.rankReason);

  // 3. Honesty still holds: Wilson (all over 2000) returns an honest broaden.
  const w = await search('Wilson racket under 2000');
  check('3. Wilson under 2000 is empty', w.results.length === 0, w.results.map((r) => r.title).join(', '));
  check('3. Wilson returns an honest broaden', !!w.broaden && w.broaden.toLowerCase().includes('wilson'), String(w.broaden));

  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[verify-affiliate] error:', e);
  process.exit(1);
});
