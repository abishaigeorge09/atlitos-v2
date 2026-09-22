/*
 * Phase A2-T2 evidence capture (operations pages: dashboard, verification,
 * bookings, orders). Not a CI script; run by hand against the local
 * Supabase stack with this track's own Vite dev server up on port 5202.
 *
 *   cd apps/admin && VITE_SUPABASE_URL=http://127.0.0.1:54321 \
 *     VITE_SUPABASE_ANON_KEY=... pnpm exec vite --port 5202
 *   NODE_PATH=apps/e2e/node_modules node docs/qa/evidence/admin-ux/capture-track-a2-t2.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5202";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "phase-A2", "t2");

const ROUTES = [
  { path: "/dashboard", waitText: "Dashboard", name: "dashboard" },
  { path: "/verification", waitText: "Verification queue", name: "verification-list" },
  { path: "/verification/show/d0000000-0000-0000-0000-000000000001", waitText: "application", name: "verification-show-pending" },
  { path: "/bookings", waitText: "Bookings", name: "bookings-list" },
  { path: "/orders", waitText: "Orders", name: "orders-list" },
  { path: "/orders/show/a1b00000-0000-0000-0000-000000000001", waitText: "Total paid", name: "orders-show" },
];

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').fill("admin@atlitos.dev");
  await page.locator('input[type="password"]').fill("AtlitosDemo!2026");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 });
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
    await page.setViewportSize({ width: 1440, height: 960 });

    for (const route of ROUTES) {
      await page.goto(`${BASE}${route.path}`);
      try {
        await page.waitForSelector(`text=${route.waitText}`, { timeout: 15000 });
      } catch (err) {
        console.error(`Selector wait failed for ${route.path}: ${err.message}`);
      }
      await page.waitForTimeout(700);
      await page
        .waitForSelector(".ak-skeleton", { state: "detached", timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(300);
      const path = join(OUT, `${route.name}-${theme}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(`Wrote ${path}`);
    }

    await page.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
