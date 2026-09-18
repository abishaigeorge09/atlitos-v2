// Phase S3, Track F: one-off Playwright capture of the web build for the QA
// evidence pack (docs/qa/evidence/shop-search/s3-web-*.png). Not a checked-in
// spec (the suite's own specs live under specs/); run manually per the
// PHASE-S3-STATUS.md dispatch:
//
//   node apps/e2e/shop-search-s3-capture.mjs
//
// against `npx expo start --web --port 8096 --clear` already running with
// EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY pointed at the local
// stack, and the affiliate catalog seeded (scripts/seed-affiliate-catalog.mjs
// against http://127.0.0.1:54321). 393x852 viewport (iPhone 16 Pro Max web
// proxy per this track's dispatch; the Release-build device screenshots are
// the integrator's, not this track's).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'docs', 'qa', 'evidence', 'shop-search');
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.SHOP_S3_BASE_URL ?? 'http://127.0.0.1:8096';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });

  // Cold start goes through splash first, which silently mints an anonymous
  // guest session (session-store.ts) before routing into the app. A direct
  // deep link to /shop skips that, leaving no session at all, and ai-search
  // (unlike the public PostgREST reads) requires one; so this always visits
  // "/" first and gives the anon mint a moment to land.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // 1. /shop with results (empty query, the seeded catalogue newest first).
  await page.goto(`${BASE_URL}/shop`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="shop-search-input"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="gear-tile-0"]', { timeout: 20000 });
  await page.screenshot({ path: join(OUT_DIR, 's3-web-shop-results.png') });
  console.log('captured s3-web-shop-results.png');

  // Confirm the cart button is ABSENT (shop.owned_enabled = false).
  const cartButton = await page.$('[data-testid="shop-cart-button"]');
  console.log('shop-cart-button present:', cartButton !== null, '(expected false)');

  // 2. /shop with a query that returns nothing: the empty state + broaden line.
  await page.fill('[data-testid="shop-search-input"]', 'wilson racket under 500');
  await page.waitForTimeout(2000); // 400 ms debounce + the aiSearch round trip
  await page.waitForSelector('[data-testid="shop-empty"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="shop-broaden"]', { timeout: 20000 });
  const broadenText = await page.textContent('[data-testid="shop-broaden"]');
  console.log('broaden line:', broadenText);
  await page.screenshot({ path: join(OUT_DIR, 's3-web-shop-empty-broaden.png') });
  console.log('captured s3-web-shop-empty-broaden.png');

  // 3. /shop/cart redirects to /shop with the flag false.
  await page.goto(`${BASE_URL}/shop/cart`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="shop-search-input"]', { timeout: 20000 });
  const url = page.url();
  console.log('after visiting /shop/cart, url is:', url, '(expected to end in /shop)');
  await page.screenshot({ path: join(OUT_DIR, 's3-web-shop-cart-redirect.png') });
  console.log('captured s3-web-shop-cart-redirect.png');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
