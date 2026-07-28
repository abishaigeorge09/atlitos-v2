#!/usr/bin/env node
// ATLITOS v2 — scripts/seed-affiliate-catalog.mjs
//
// Phase 9 WS4: seeds a small, real-ish AFFILIATE catalog into the two tables
// 0086_affiliate_marketplace.sql added (`affiliate_products` + `product_offers`).
// These are the browse + compare-prices + click-out rows the affiliate pivot
// runs on (PRD-07 section 10), distinct from the owned `products` catalog which
// seed_p4_commerce.sql owns and which this script does not touch.
//
// The catalog is deliberately shaped to prove two things at once:
//   1. WS3 AI search now answers "Babolat under 2000" with a REAL precise match.
//      The Babolat Pure Drive Team is offered on Tennis Hub at 1799 (under 2000)
//      and on Amazon at 2149 (over it), so the query returns the product AND the
//      compare view shows a genuine cross-retailer price spread.
//   2. The honesty gate still tells the truth: Wilson gear is all priced over
//      2000, so "Wilson racket under 2000" still returns the honest broaden line
//      rather than filler.
//
// Every product carries brand / skill_level / age_range, the exact columns WS3
// reads to answer precise brand + price + skill queries.
//
// Writes go through the SERVICE ROLE key: `product_offers.price` and the offer
// rows are ingested content with no client write policy (a client that could
// set the price could rewrite what it is about to be shown). This mirrors how
// prices are meant to arrive from a retailer feed, not from a shopper.
//
// Idempotent: fixed literal ids, upsert on conflict. Safe to re-run.
//
// Env required:
//   SUPABASE_SERVICE_ROLE_KEY — from .env.local (service role; offers are
//                               service-role-write only).
//   SUPABASE_URL              — optional, defaults to the project URL below.
//
// Run:
//   node --env-file=.env.local scripts/seed-affiliate-catalog.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    '[seed-affiliate-catalog] SUPABASE_SERVICE_ROLE_KEY is required (offers/prices are ingested, ' +
      'service-role-write only). Run with: node --env-file=.env.local scripts/seed-affiliate-catalog.mjs',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Category ids from seed_p4_commerce.sql (stable literals).
const CAT = {
  cricket: '10000000-0000-0000-0000-000000000001',
  badminton: '10000000-0000-0000-0000-000000000002',
  tennis: '10000000-0000-0000-0000-000000000003',
  football: '10000000-0000-0000-0000-000000000004',
};

// affiliate_products. Fixed ids under the a0000000 range so they never collide
// with the owned catalog's 20000000 ids.
const PRODUCTS = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    title: 'Babolat Pure Drive Team Tennis Racket',
    brand: 'Babolat',
    sport: 'tennis',
    category_id: CAT.tennis,
    skill_level: 'intermediate',
    age_range: 'adult',
    description:
      'The Pure Drive Team is a lighter Pure Drive built for control and easy power. A trusted all court racket for club and improving players.',
    image_url: 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=640',
  },
  {
    id: 'a0000000-0000-0000-0000-000000000002',
    title: 'Babolat Boost Drive Tennis Racket',
    brand: 'Babolat',
    sport: 'tennis',
    category_id: CAT.tennis,
    skill_level: 'beginner',
    age_range: 'adult',
    description:
      'A light, forgiving frame for beginners picking up their first proper racket. Big sweet spot, easy to swing.',
    image_url: 'https://images.unsplash.com/photo-1595435742656-5272d0b3fa82?w=640',
  },
  {
    id: 'a0000000-0000-0000-0000-000000000003',
    title: 'Yonex Astrox 99 Pro Badminton Racket',
    brand: 'Yonex',
    sport: 'badminton',
    category_id: CAT.badminton,
    skill_level: 'advanced',
    age_range: 'adult',
    description:
      'A head heavy power racket for attacking singles play. Stiff shaft, steep smashes, built for advanced competitors.',
    image_url: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=640',
  },
  {
    id: 'a0000000-0000-0000-0000-000000000004',
    title: 'Wilson Pro Staff 97 Tennis Racket',
    brand: 'Wilson',
    sport: 'tennis',
    category_id: CAT.tennis,
    skill_level: 'advanced',
    age_range: 'adult',
    description:
      'A precise, control oriented player frame in the Pro Staff line. Best for advanced players who supply their own power.',
    image_url: 'https://images.unsplash.com/photo-1617083277624-3d0f0f0c6c6a?w=640',
  },
  {
    id: 'a0000000-0000-0000-0000-000000000005',
    title: 'Nike Court Lite Tennis Shoes',
    brand: 'Nike',
    sport: 'tennis',
    category_id: CAT.tennis,
    skill_level: 'intermediate',
    age_range: 'adult',
    description:
      'Durable hard court tennis shoes with a supportive midfoot and a drag resistant toe. Everyday match and practice shoe.',
    image_url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=640',
  },
  {
    id: 'a0000000-0000-0000-0000-000000000006',
    title: 'Asics Gel Rocket Court Shoes',
    brand: 'Asics',
    sport: 'badminton',
    category_id: CAT.badminton,
    skill_level: 'intermediate',
    age_range: 'adult',
    description:
      'Lightweight indoor court shoes with gel cushioning and a non marking sole. Good lateral grip for badminton and squash.',
    image_url: 'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=640',
  },
  {
    id: 'a0000000-0000-0000-0000-000000000007',
    title: 'SG Player Edition English Willow Cricket Bat',
    brand: 'SG',
    sport: 'cricket',
    category_id: CAT.cricket,
    skill_level: 'intermediate',
    age_range: 'adult',
    description:
      'Grade 2 English willow bat with a mid blade sweet spot. A well balanced all round bat for club cricketers.',
    image_url: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=640',
  },
  {
    id: 'a0000000-0000-0000-0000-000000000008',
    title: 'Kookaburra Kids Cricket Bat Size 4',
    brand: 'Kookaburra',
    sport: 'cricket',
    category_id: CAT.cricket,
    skill_level: 'beginner',
    age_range: 'kids',
    description:
      'A light Kashmir willow size 4 bat sized for younger players learning the game. Easy pickup, forgiving edges.',
    image_url: 'https://images.unsplash.com/photo-1607734834519-d8576ae60ea6?w=640',
  },
];

// product_offers. Each offer is one retailer selling one product at one price.
// Retailers span Amazon, Tennis Hub, Decathlon and Cricket Store; every product
// is on at least two so the compare view has a spread. `affiliate_url` is the
// commission-bearing outbound link the click-out opens.
const OFFERS = [
  // Babolat Pure Drive Team — THE proof: under 2000 on Tennis Hub, higher on Amazon.
  offer('001', 'a0000000-0000-0000-0000-000000000001', 'Tennis Hub', 1799.0, 'https://www.tennishub.in/babolat-pure-drive-team?aff=atlitos'),
  offer('002', 'a0000000-0000-0000-0000-000000000001', 'Amazon', 2149.0, 'https://www.amazon.in/dp/B08PDT4?tag=atlitos-21'),
  offer('003', 'a0000000-0000-0000-0000-000000000001', 'Decathlon', 1999.0, 'https://www.decathlon.in/p/babolat-pure-drive-team?aff=atlitos'),
  // Babolat Boost Drive — both under 2000.
  offer('004', 'a0000000-0000-0000-0000-000000000002', 'Amazon', 1499.0, 'https://www.amazon.in/dp/B07BOOST?tag=atlitos-21'),
  offer('005', 'a0000000-0000-0000-0000-000000000002', 'Tennis Hub', 1650.0, 'https://www.tennishub.in/babolat-boost-drive?aff=atlitos'),
  // Yonex Astrox 99 Pro.
  offer('006', 'a0000000-0000-0000-0000-000000000003', 'Amazon', 18990.0, 'https://www.amazon.in/dp/B08ASTROX?tag=atlitos-21'),
  offer('007', 'a0000000-0000-0000-0000-000000000003', 'Decathlon', 18490.0, 'https://www.decathlon.in/p/yonex-astrox-99-pro?aff=atlitos'),
  // Wilson Pro Staff — all over 2000 (keeps the honest-broaden proof true).
  offer('008', 'a0000000-0000-0000-0000-000000000004', 'Amazon', 16999.0, 'https://www.amazon.in/dp/B08PROSTAFF?tag=atlitos-21'),
  offer('009', 'a0000000-0000-0000-0000-000000000004', 'Tennis Hub', 15499.0, 'https://www.tennishub.in/wilson-pro-staff-97?aff=atlitos'),
  // Nike Court Lite shoes.
  offer('010', 'a0000000-0000-0000-0000-000000000005', 'Amazon', 4295.0, 'https://www.amazon.in/dp/B08NIKECL?tag=atlitos-21'),
  offer('011', 'a0000000-0000-0000-0000-000000000005', 'Decathlon', 3999.0, 'https://www.decathlon.in/p/nike-court-lite?aff=atlitos'),
  // Asics Gel Rocket shoes.
  offer('012', 'a0000000-0000-0000-0000-000000000006', 'Amazon', 4499.0, 'https://www.amazon.in/dp/B08ASICSGR?tag=atlitos-21'),
  offer('013', 'a0000000-0000-0000-0000-000000000006', 'Decathlon', 4199.0, 'https://www.decathlon.in/p/asics-gel-rocket?aff=atlitos'),
  // SG Player Edition bat.
  offer('014', 'a0000000-0000-0000-0000-000000000007', 'Amazon', 4999.0, 'https://www.amazon.in/dp/B08SGPLAYER?tag=atlitos-21'),
  offer('015', 'a0000000-0000-0000-0000-000000000007', 'Cricket Store', 4599.0, 'https://www.cricketstoreonline.in/sg-player-edition?aff=atlitos'),
  // Kookaburra kids bat (one currently out of stock at the cheaper retailer, so
  // the compare view exercises the "sold out here" state too).
  offer('016', 'a0000000-0000-0000-0000-000000000008', 'Cricket Store', 1299.0, 'https://www.cricketstoreonline.in/kookaburra-kids-size-4?aff=atlitos', false),
  offer('017', 'a0000000-0000-0000-0000-000000000008', 'Amazon', 1449.0, 'https://www.amazon.in/dp/B08KOOKKIDS?tag=atlitos-21'),
];

function offer(seq, productId, retailer, price, url, inStock = true) {
  return {
    id: `b0000000-0000-0000-0000-000000000${seq}`,
    affiliate_product_id: productId,
    retailer,
    price,
    currency: 'INR',
    affiliate_url: url,
    in_stock: inStock,
    last_checked_at: new Date().toISOString(),
  };
}

async function main() {
  console.log(`[seed-affiliate-catalog] upserting ${PRODUCTS.length} products + ${OFFERS.length} offers into ${SUPABASE_URL}`);

  const { error: pErr } = await supabase
    .from('affiliate_products')
    .upsert(PRODUCTS.map((p) => ({ ...p, active: true })), { onConflict: 'id' });
  if (pErr) {
    console.error('[seed-affiliate-catalog] affiliate_products upsert failed:', pErr.message);
    process.exit(1);
  }

  const { error: oErr } = await supabase
    .from('product_offers')
    .upsert(OFFERS, { onConflict: 'id' });
  if (oErr) {
    console.error('[seed-affiliate-catalog] product_offers upsert failed:', oErr.message);
    process.exit(1);
  }

  // Proof read-back: the Babolat under 2000 case.
  const { data: babolat } = await supabase
    .from('affiliate_products')
    .select('id, title, brand, skill_level, age_range, product_offers ( retailer, price, in_stock )')
    .eq('id', 'a0000000-0000-0000-0000-000000000001')
    .single();

  console.log('\n[seed-affiliate-catalog] Babolat proof:');
  console.log(`  ${babolat.title}  (brand ${babolat.brand}, ${babolat.skill_level}, ${babolat.age_range})`);
  for (const o of (babolat.product_offers ?? []).sort((a, b) => a.price - b.price)) {
    const under = o.price < 2000 ? '  <- under 2000' : '';
    console.log(`    ${o.retailer.padEnd(14)} ${o.price}${under}`);
  }
  console.log('\n[seed-affiliate-catalog] done.');
}

main().catch((err) => {
  console.error('[seed-affiliate-catalog] unexpected error:', err);
  process.exit(1);
});
