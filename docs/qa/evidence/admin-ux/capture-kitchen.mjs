/*
 * Gate 1 evidence capture for the admin kitchen sink (Part B / plan
 * snappy-foraging-meadow, B2). Not a CI script; run once by hand against
 * the local Supabase stack with the admin Vite dev server up.
 *
 * Run these two commands first, from the repo root of this worktree:
 *
 *   pnpm --filter @atlitos/admin exec vite --port 5199
 *   NODE_PATH=apps/e2e/node_modules node docs/qa/evidence/admin-ux/capture-kitchen.mjs
 *
 * Requires the local Supabase stack up and admin@atlitos.dev /
 * AtlitosDemo!2026 seeded (local only), same as
 * docs/qa/evidence/shop-search/capture-track-e.cjs.
 *
 * Captures /_kitchen full page at 1440x960 and 1024x768, light and dark
 * (localStorage theme flip + reload), reduced motion forced, plus the
 * shell wrapping the existing /gear list at 1440 in both themes.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5199";
const OUT = dirname(fileURLToPath(import.meta.url));
const REFERENCES = join(OUT, "..", "..", "..", "design", "references");

const VIEWPORTS = [
  { width: 1440, height: 960, tag: "1440" },
  { width: 1024, height: 768, tag: "1024" },
];

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').fill("admin@atlitos.dev");
  await page.locator('input[type="password"]').fill("AtlitosDemo!2026");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("atlitos-admin-theme", t);
  }, theme);
}

async function main() {
  const browser = await chromium.launch();

  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await login(page);
    await setTheme(page, theme);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE}/_kitchen`);
      await page.waitForSelector("text=Kitchen sink");
      // Let the mutation observer / font swap settle.
      await page.waitForTimeout(600);
      const path = join(REFERENCES, `kitchen-admin-${theme}-${viewport.tag}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(`Wrote ${path}`);
    }

    // Shell wrapping an existing page, 1440 only, per theme.
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${BASE}/gear`);
    await page.waitForSelector("text=Gear");
    await page.waitForTimeout(600);
    const shellPath = join(REFERENCES, `kitchen-admin-shell-gear-${theme}.png`);
    await page.screenshot({ path: shellPath, fullPage: true });
    console.log(`Wrote ${shellPath}`);

    await page.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
