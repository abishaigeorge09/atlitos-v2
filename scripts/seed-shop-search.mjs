#!/usr/bin/env node
// ATLITOS v2 — scripts/seed-shop-search.mjs
//
// Phase S3 Track H (PRD-07 FR-40, FR-41, FR-53). Idempotent fixture seeder for
// the shop search gate: 12 affiliate products across football, cricket, badminton,
// tennis with skill_level in beginner/intermediate/advanced and age_range in
// junior/adult; 30 product_offers across retailers Amazon.in, Flipkart, Decathlon
// with realistic INR prices and affiliate URLs; calls gear-embed for all products
// under service role.
//
// Supports --clean flag to remove previously seeded rows by title prefix.
// Runs ONLY against the local stack (127.0.0.1:54321), never production.
//
// Env required:
//   SUPABASE_SERVICE_ROLE_KEY  — service role key, never the anon/publishable key.
//   SUPABASE_URL               — optional, defaults to http://127.0.0.1:54321.

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'seed-shop-search.mjs');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    '[seed-shop-search] SUPABASE_SERVICE_ROLE_KEY is required (the service role key from supabase/.env or the ' +
      'edge function environment, never the anon/publishable key, never hardcoded).'
  );
  process.exit(1);
}

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SEED_PREFIX = 'Seed Shop ';

// 12 affiliate products across 4 sports, beginner/intermediate/advanced,
// junior/adult. Designed so "light racket for a 12 year old starting badminton"
// should find at least one beginner/junior badminton racket.
const FIXTURES = [
  {
    title: `${SEED_PREFIX}Yonex Voltric Junior Badminton Racket`,
    brand: 'yonex',
    sport: 'badminton',
    skill_level: 'beginner',
    age_range: 'junior',
    description: 'A light junior badminton racket built for a beginner starting the sport.',
    image_url: 'https://placehold.co/600x600/png?text=Badminton+Racket',
  },
  {
    title: `${SEED_PREFIX}Yonex Badminton Shoes Adult Advanced`,
    brand: 'yonex',
    sport: 'badminton',
    skill_level: 'advanced',
    age_range: 'adult',
    description: 'Advanced badminton court shoes for adults with superior grip and stability.',
    image_url: null,
  },
  {
    title: `${SEED_PREFIX}Wilson Pro Staff Tennis Racket`,
    brand: 'wilson',
    sport: 'tennis',
    skill_level: 'advanced',
    age_range: 'adult',
    description: 'A tour level tennis racket for advanced adult players.',
    image_url: 'https://placehold.co/600x600/png?text=Tennis+Racket+Pro',
  },
  {
    title: `${SEED_PREFIX}Babolat Pure Drive Tennis Racket`,
    brand: 'babolat',
    sport: 'tennis',
    skill_level: 'intermediate',
    age_range: 'adult',
    description: 'A powerful intermediate tennis racket for adults.',
    image_url: null,
  },
  {
    title: `${SEED_PREFIX}Babolat Junior Tennis Racket`,
    brand: 'babolat',
    sport: 'tennis',
    skill_level: 'beginner',
    age_range: 'junior',
    description: 'A junior tennis racket for a beginner starting tennis.',
    image_url: 'https://placehold.co/600x600/png?text=Tennis+Racket+Junior',
  },
  {
    title: `${SEED_PREFIX}Head Radical Tennis Racket Adult`,
    brand: 'head',
    sport: 'tennis',
    skill_level: 'intermediate',
    age_range: 'adult',
    description: 'An intermediate tennis racket for adults with good balance and control.',
    image_url: null,
  },
  {
    title: `${SEED_PREFIX}Cosco Cricket Bat Starter`,
    brand: 'cosco',
    sport: 'cricket',
    skill_level: 'beginner',
    age_range: 'junior',
    description: 'A junior cricket bat for a beginner.',
    image_url: 'https://placehold.co/600x600/png?text=Cricket+Bat+Junior',
  },
  {
    title: `${SEED_PREFIX}SG Cricket Bat Pro Adult`,
    brand: 'sg',
    sport: 'cricket',
    skill_level: 'advanced',
    age_range: 'adult',
    description: 'A professional grade cricket bat for advanced adult players.',
    image_url: null,
  },
  {
    title: `${SEED_PREFIX}Kookaburra Cricket Ball Set`,
    brand: 'kookaburra',
    sport: 'cricket',
    skill_level: 'intermediate',
    age_range: 'adult',
    description: 'A set of intermediate grade cricket balls for adults.',
    image_url: 'https://placehold.co/600x600/png?text=Cricket+Balls',
  },
  {
    title: `${SEED_PREFIX}Adidas Football Junior`,
    brand: 'adidas',
    sport: 'football',
    skill_level: 'beginner',
    age_range: 'junior',
    description: 'A junior football for a beginner.',
    image_url: null,
  },
  {
    title: `${SEED_PREFIX}Nivia Football Pro Adult`,
    brand: 'nivia',
    sport: 'football',
    skill_level: 'intermediate',
    age_range: 'adult',
    description: 'An intermediate match football for adults.',
    image_url: 'https://placehold.co/600x600/png?text=Football',
  },
  {
    title: `${SEED_PREFIX}Puma Football Boots Junior`,
    brand: 'puma',
    sport: 'football',
    skill_level: 'beginner',
    age_range: 'junior',
    description: 'Junior football boots for a beginner.',
    image_url: null,
  },
];

// Retailers and typical INR price ranges for offers.
const RETAILERS = [
  { key: 'amazon_in', name: 'Amazon.in', url: 'https://amazon.in' },
  { key: 'flipkart', name: 'Flipkart', url: 'https://flipkart.com' },
  { key: 'decathlon_in', name: 'Decathlon', url: 'https://decathlon.in' },
];

// Generate 30 product offers across the 12 products and 3 retailers.
// Some will be out of stock, some will have stale pricing info (1-9 days old).
function generateOffers(productIds) {
  const offers = [];
  const now = new Date();

  for (let i = 0; i < productIds.length; i++) {
    const productId = productIds[i];
    const product = FIXTURES[i];

    // Each product gets 2-3 offers spread across retailers.
    const numOffers = i < 6 ? 3 : 2;
    const selectedRetailers = RETAILERS.slice(0, numOffers);

    for (const retailer of selectedRetailers) {
      // Vary prices realistically (15-25% variance).
      const basePrice = 500 + Math.random() * 12000;
      const price = Math.round(basePrice * (0.85 + Math.random() * 0.4));

      // Spread last_checked_at from 1 hour to 9 days ago.
      const hoursAgo = Math.floor(Math.random() * (9 * 24 - 1)) + 1;
      const lastCheckedAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();

      // A couple of out-of-stock offers for testing.
      const inStock = Math.random() > 0.08;

      offers.push({
        affiliate_product_id: productId,
        retailer: retailer.name,
        price,
        currency: 'INR',
        affiliate_url: `${retailer.url}/search?q=${encodeURIComponent(product.title)}`,
        in_stock: inStock,
        last_checked_at: lastCheckedAt,
      });
    }
  }

  return offers;
}

async function deleteExistingSeeds() {
  const { data, error } = await supabase
    .from('affiliate_products')
    .select('id')
    .ilike('title', `${SEED_PREFIX}%`);

  if (error) {
    throw new Error(`[seed-shop-search] failed to fetch existing seed products: ${error.message}`);
  }

  if (data.length === 0) return 0;

  const ids = data.map((r) => r.id);
  const { error: delError } = await supabase.from('affiliate_products').delete().in('id', ids);

  if (delError) {
    throw new Error(`[seed-shop-search] failed to delete existing seed products: ${delError.message}`);
  }

  console.log(`[seed-shop-search] deleted ${ids.length} existing seed products`);
  return ids.length;
}

async function seedProducts() {
  const ids = [];

  for (const fixture of FIXTURES) {
    const id = randomUUID();
    const { error } = await supabase.from('affiliate_products').insert({
      id,
      title: fixture.title,
      brand: fixture.brand,
      sport: fixture.sport,
      skill_level: fixture.skill_level,
      age_range: fixture.age_range,
      description: fixture.description,
      image_url: fixture.image_url,
      active: true,
    });

    if (error) {
      throw new Error(`[seed-shop-search] failed to seed product ${fixture.title}: ${error.message}`);
    }

    ids.push(id);
  }

  console.log(`[seed-shop-search] seeded ${ids.length} affiliate products`);
  return ids;
}

async function seedOffers(productIds) {
  const offers = generateOffers(productIds);
  let created = 0;

  for (const offer of offers) {
    const { error } = await supabase.from('product_offers').insert({
      affiliate_product_id: offer.affiliate_product_id,
      retailer: offer.retailer,
      price: offer.price,
      currency: offer.currency,
      affiliate_url: offer.affiliate_url,
      in_stock: offer.in_stock,
      last_checked_at: offer.last_checked_at,
    });

    if (error) {
      throw new Error(
        `[seed-shop-search] failed to seed offer for product ${offer.affiliate_product_id}: ${error.message}`
      );
    }

    created++;
  }

  console.log(`[seed-shop-search] seeded ${created} product offers`);
  return created;
}

async function embedAllProducts(productIds) {
  // Call the local gear-embed function with sweep mode to embed all products.
  let embedded = 0;

  for (const productId of productIds) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-embed`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId, sweep: false }),
      });

      const json = await res.json();

      if (!json.embedded || json.embedded === 0) {
        console.warn(
          `[seed-shop-search] gear-embed returned ${json.embedded} for product ${productId}: ${JSON.stringify(json)}`
        );
      } else {
        embedded += json.embedded;
      }
    } catch (err) {
      console.warn(`[seed-shop-search] gear-embed fetch failed for ${productId}: ${err.message}`);
    }
  }

  console.log(`[seed-shop-search] embedded ${embedded} products via gear-embed`);
}

async function callGearEmbedSweep() {
  // Call gear-embed with sweep: true, limit: 50 to batch embed everything under service role.
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gear-embed`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sweep: true, limit: 50 }),
    });

    const json = await res.json();
    console.log(`[seed-shop-search] gear-embed sweep: embedded ${json.embedded ?? 0} products`);
  } catch (err) {
    console.warn(`[seed-shop-search] gear-embed sweep failed: ${err.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--clean')) {
    try {
      const deleted = await deleteExistingSeeds();
      console.log(`[seed-shop-search] cleaned up ${deleted} seed product(s)`);
    } catch (err) {
      console.error(`[seed-shop-search] CLEAN FAILED: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  try {
    // Delete any existing seeded data first.
    await deleteExistingSeeds();

    // Seed products.
    const productIds = await seedProducts();

    // Seed offers.
    const offerCount = await seedOffers(productIds);

    // Embed all products via the sweep call.
    await callGearEmbedSweep();

    console.log(
      `[seed-shop-search] done: ${productIds.length} products, ${offerCount} offers seeded and embedded for local testing.`
    );
  } catch (err) {
    console.error(`[seed-shop-search] FAILED: ${err.message ?? err}`);
    process.exit(1);
  }
}

main();
