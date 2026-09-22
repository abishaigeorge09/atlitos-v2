/*
 * Admin UX screenshot matrix and axe pass (docs/PLAN-ADMIN-UX.md, Verification).
 * Not a CI script; run by hand against the local Supabase stack with the admin
 * Vite dev server up on the integrated tree.
 *
 *   cd apps/admin && VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<local anon> pnpm exec vite --port 5199
 *   NODE_PATH=apps/e2e/node_modules node docs/qa/evidence/admin-ux/capture-matrix.mjs [phase-A2] [--axe-only] [--base http://localhost:5199]
 *
 * Every route in docs/design/IA-ADMIN.md plus login and /_kitchen, at 1440x960
 * and 1024x768, light and dark (localStorage flip + reload), reduced motion
 * forced, into docs/qa/evidence/admin-ux/<phase>/matrix/. Then axe (wcag2a,
 * wcag2aa) on every route in both themes at 1440, written to
 * <phase>/axe.json and summarised on stdout. Exit 1 if any route failed to
 * render (error boundary text, redbox, or a navigation error) or if axe finds
 * a critical or serious violation.
 *
 * Seeded ids are the local fixture ids from supabase/seed/local_seed_admin_ux.sql
 * and the other local seeds; gear and drills ids are looked up from the list
 * pages at run time so a reseed does not break the matrix.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const { AxeBuilder } = require("@axe-core/playwright");

const args = process.argv.slice(2);
const PHASE = args.find((a) => !a.startsWith("--")) ?? "phase-A2";
const AXE_ONLY = args.includes("--axe-only");
const BASE = (args.find((a) => a.startsWith("--base=")) ?? "--base=http://localhost:5199").slice("--base=".length);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, PHASE);
const MATRIX = join(OUT, "matrix");
mkdirSync(MATRIX, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 960, tag: "1440" },
  { width: 1024, height: 768, tag: "1024" },
];

// Static routes. Detail routes with a fixed local fixture id are listed
// directly; gear and drills resolve their first row at run time.
const STATIC_ROUTES = [
  "/dashboard",
  "/verification",
  "/verification/show/d0000000-0000-0000-0000-000000000001",
  "/verification/show/d0000000-0000-0000-0000-000000000004",
  "/venues",
  "/venues/create",
  "/venues/show/a0000000-0000-0000-0000-000000000001",
  "/bookings",
  "/orders",
  "/orders/show/a1b00000-0000-0000-0000-000000000001",
  "/gear",
  "/gear/create",
  "/gear/health",
  "/products",
  "/moderation",
  "/reports",
  "/drills",
  "/drills/create",
  "/users",
  "/fee-config",
  "/_kitchen",
];

const FAILURE_TEXTS = [
  "Something went wrong. The team has been notified.",
  "Loading...",
];

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').fill("admin@atlitos.dev");
  await page.locator('input[type="password"]').fill("AtlitosDemo!2026");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 });
}

async function setTheme(page, theme) {
  await page.evaluate((t) => localStorage.setItem("atlitos-admin-theme", t), theme);
}

async function firstRowHref(page, listPath) {
  await page.goto(`${BASE}${listPath}`);
  const link = page.locator("table a[href], tbody tr[data-href], tbody tr a").first();
  await link.waitFor({ timeout: 20000 }).catch(() => {});
  const href = await link.getAttribute("href").catch(() => null);
  if (href) return href;
  const dataHref = await page.locator("tbody tr[data-href]").first().getAttribute("data-href").catch(() => null);
  return dataHref;
}

async function settle(page) {
  // Wait for skeletons to leave and fonts to land. Cap the wait so a hung
  // page is reported instead of blocking the whole matrix.
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll(".ak-skeleton").length === 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function main() {
  const browser = await chromium.launch();
  // AxeBuilder refuses a page from browser.newPage(); it needs an explicit
  // context. One context, reduced motion forced, for every page here.
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const failures = [];
  const axeReport = {};

  // Resolve dynamic ids once, in a light session.
  const probe = await ctx.newPage();
  await login(probe);
  const routes = [...STATIC_ROUTES];
  for (const [list, label] of [["/gear", "gear show"], ["/drills", "drills show"], ["/moderation", "moderation show"], ["/reports", "reports show"], ["/users", "users show"], ["/products", "products show"]]) {
    const href = await firstRowHref(probe, list);
    if (href) routes.push(href.startsWith("http") ? new URL(href).pathname : href);
    else failures.push(`${label}: no row link found on ${list}`);
  }
  await probe.close();

  for (const theme of ["light", "dark"]) {
    const page = await ctx.newPage();
    await login(page);
    await setTheme(page, theme);

    for (const viewport of VIEWPORTS) {
      if (AXE_ONLY && viewport.tag !== "1440") continue;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        const slug = route.replace(/^\//, "").replace(/[\/:]/g, "_") || "root";
        try {
          await page.goto(`${BASE}${route}`, { timeout: 30000 });
          await settle(page);
          const text = await page.locator("body").innerText();
          for (const bad of FAILURE_TEXTS) {
            if (text.includes(bad)) failures.push(`${theme} ${viewport.tag} ${route}: page shows "${bad}"`);
          }
          if (!AXE_ONLY) {
            const path = join(MATRIX, `${slug}-${theme}-${viewport.tag}.png`);
            await page.screenshot({ path, fullPage: true });
            console.log(`wrote ${path}`);
          }
          if (viewport.tag === "1440") {
            const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
            const key = `${theme} ${route}`;
            axeReport[key] = results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
            for (const v of results.violations) {
              if (v.impact === "critical" || v.impact === "serious") failures.push(`axe ${key}: ${v.impact} ${v.id} (${v.nodes.length} nodes)`);
            }
          }
        } catch (err) {
          failures.push(`${theme} ${viewport.tag} ${route}: ${err.message.split("\n")[0]}`);
        }
      }
    }
    await page.close();
  }

  // Login page, both themes, no session.
  if (!AXE_ONLY) {
    for (const theme of ["light", "dark"]) {
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      await setTheme(page, theme);
      await page.reload();
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(MATRIX, `login-${theme}-1440.png`), fullPage: true });
      await page.close();
    }
  }

  await ctx.close();
  await browser.close();
  writeFileSync(join(OUT, "axe.json"), JSON.stringify(axeReport, null, 2));

  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const list of Object.values(axeReport)) for (const v of list) counts[v.impact ?? "minor"] += 1;
  console.log(`\naxe violations across ${Object.keys(axeReport).length} route/theme pairs: ${JSON.stringify(counts)}`);
  const moderateIds = new Set();
  for (const list of Object.values(axeReport)) for (const v of list) if (v.impact === "moderate") moderateIds.add(v.id);
  if (moderateIds.size) console.log(`moderate rule ids: ${[...moderateIds].join(", ")}`);

  if (failures.length) {
    console.log(`\nFAILED: ${failures.length}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nmatrix green: ${routes.length} routes, both themes${AXE_ONLY ? "" : ", both viewports"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
