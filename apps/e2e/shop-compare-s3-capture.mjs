// Phase S3, Track G: one-off Playwright capture of the compare screen for the
// QA evidence pack (docs/qa/evidence/shop-search/s3-web-compare-*.png). Not a
// checked-in spec (the suite's own specs live under specs/); run manually:
//
//   node apps/e2e/shop-compare-s3-capture.mjs
//
// against `npx expo start --web --port 8097 --clear` already running with
// EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY pointed at the local
// stack, and the affiliate catalog seeded (scripts/seed-affiliate-catalog.mjs
// against http://127.0.0.1:54321). 393x852 viewport (iPhone 16 Pro Max web
// proxy per this track's dispatch).
//
// SHOP_S3_PRODUCT_ID should point at a product with at least three offers,
// one of them out of stock, so the screenshot proves the dimmed row and the
// "Cheapest" marker in the same frame (Phase S3, PHASE-S3-STATUS.md scope
// row 4, PRD-07 FR-35/FR-36).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'docs', 'qa', 'evidence', 'shop-search');
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.SHOP_S3_BASE_URL ?? 'http://127.0.0.1:8097';
const PRODUCT_ID = process.env.SHOP_S3_PRODUCT_ID ?? 'a0000000-0000-0000-0000-000000000001';

async function capture(colorScheme, suffix) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, colorScheme });

  // Cold start goes through splash first, which silently mints an anonymous
  // guest session before routing into the app; a direct deep link to the
  // compare screen without visiting "/" first would race that mint.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  await page.goto(`${BASE_URL}/shop/affiliate/${PRODUCT_ID}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="compare-offer-0"]', { timeout: 20000 });
  await page.waitForTimeout(500);

  const cheapestCount = await page.locator('[data-testid="compare-cheapest"]').count();
  console.log(`[${colorScheme}] compare-cheapest count:`, cheapestCount, '(expected 1)');

  const offerRows = await page.locator('[data-testid^="compare-offer-"]').count();
  console.log(`[${colorScheme}] offer rows:`, offerRows, '(expected >= 3)');

  // Every offer row with no buy pressable is the out-of-stock one; confirm at
  // least one exists and that it carries no compare-buy-* element (FR-36).
  for (let i = 0; i < offerRows; i++) {
    const buyCount = await page.locator(`[data-testid="compare-buy-${i}"]`).count();
    console.log(`[${colorScheme}] compare-offer-${i} has compare-buy-${i}:`, buyCount === 1);
  }

  const disclosureVisible = await page.getByText('commission', { exact: false }).first().isVisible();
  console.log(`[${colorScheme}] disclosure visible:`, disclosureVisible);

  await page.screenshot({ path: join(OUT_DIR, `s3-web-compare-${suffix}.png`) });
  console.log(`captured s3-web-compare-${suffix}.png`);

  await browser.close();
}

async function main() {
  await capture('light', 'light');
  await capture('dark', 'dark');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
