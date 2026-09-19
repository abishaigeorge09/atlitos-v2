/*
 * Evidence capture for Phase S2 Track E (admin gear ingest UI + catalog
 * health). Not a CI script; run once by hand against the local Supabase
 * stack with an admin vite dev server up, per PHASE-S2-STATUS.md's gate.
 *
 * Usage (from the repo root of this worktree):
 *   NODE_PATH=apps/e2e/node_modules node docs/qa/evidence/shop-search/capture-track-e.cjs
 *
 * Requires: `pnpm exec vite --port 5199` running in apps/admin against the
 * local stack, and admin@atlitos.dev / AtlitosDemo!2026 seeded (local only).
 */
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5199";
const OUT = __dirname;

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').fill("admin@atlitos.dev");
  await page.locator('input[type="password"]').fill("AtlitosDemo!2026");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  await login(page);

  // 1. Add from a link, empty state (gear-ingest not deployed locally at
  // capture time; see the report for what this proves and what it does not).
  await page.goto(`${BASE}/gear/create`);
  await page.waitForSelector("text=Add from a link");
  await page.screenshot({ path: `${OUT}/01-create-add-from-link-empty.png`, fullPage: true });

  // 2. Fetch attempted against a function that is not deployed on this
  // branch yet: proves the 422/error path is real, wired, and surfaced
  // inline, not a fabricated draft.
  await page.getByPlaceholder("https://www.amazon.in/dp/...").fill("https://example.com/product/evidence");
  await page.getByRole("button", { name: /fetch/i }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Fetching"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-create-fetch-error-state.png`, fullPage: true });

  // 3. Catalog health, mixed states (attention filter).
  await page.goto(`${BASE}/gear/health`);
  await page.waitForSelector("text=Catalog health");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/03-health-attention.png`, fullPage: true });

  // 4. Catalog health, All filter (shows ok / delisted rows too).
  await page.getByRole("button", { name: "All" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-health-all.png`, fullPage: true });

  // 5. Catalog health, Delisted filter.
  await page.getByRole("button", { name: "Delisted" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-health-delisted.png`, fullPage: true });

  // 6. Gear list, health + last checked columns.
  await page.goto(`${BASE}/gear`);
  await page.waitForSelector("text=Gear");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/06-list-health-columns.png`, fullPage: true });

  // 7. Show page for the product seeded with an AI suggestion.
  await page.goto(`${BASE}/gear/show/a0000000-0000-0000-0000-000000000003`);
  await page.waitForSelector("text=AI suggestion", { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/07-show-ai-suggestion.png`, fullPage: true });

  // 8. Re-check now against gear-recheck, not deployed on this branch yet:
  // proves the call is real and the failure surfaces, not a fabricated ok.
  await page.getByRole("button", { name: /re-check now/i }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Checking"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/08-show-recheck-error-state.png`, fullPage: true });

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
