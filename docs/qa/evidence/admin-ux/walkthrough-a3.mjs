// Phase A3 gate, browser half, on the INTEGRATED tree. Local stack only.
//
// Proves the founder's complaint is answered on the real screen: "the link
// does not really add in". Drives /gear/create through the three outcomes and
// screenshots each, then saves the Decathlon-shaped one and checks the row
// landed with its offer.
//
// Needs:
//   - the admin dev server on :5199 against the local stack
//   - `supabase functions serve --env-file <f>` where f has
//     GEAR_INGEST_PUBLIC_URL=http://127.0.0.1:54321 and
//     FETCH_ALLOW_HOSTS=host.docker.internal
//   - SUPABASE_SERVICE_ROLE_KEY in the environment
//
// Run:  OUT_DIR=docs/qa/evidence/admin-ux/phase-A2/a3 NODE_PATH=apps/e2e/node_modules \
//         node docs/qa/evidence/admin-ux/walkthrough-a3.mjs
import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");

const OUT = process.env.OUT_DIR ?? "docs/qa/evidence/admin-ux/phase-A2/a3";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.ADMIN_BASE ?? "http://localhost:5199";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const FIX = path.resolve("scripts/fixtures/gear");
const KEY = "walkthrough_a3";

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(label);
}

const BOT_WALL = `<!doctype html><html><head><title>Service Unavailable</title>
<meta property="og:image" content="__ORIGIN__/images/racket.jpg"></head><body>503</body></html>`;
const NO_PRODUCT = `<!doctype html><html><head><title>Category</title>
<meta property="og:description" content="Browse rackets."></head><body>listing</body></html>`;

const server = http.createServer((req, res) => {
  const u = (req.url ?? "/").split("?")[0];
  const origin = `http://host.docker.internal:${server.address().port}`;
  if (u === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("User-agent: *\nAllow: /\n"); }
  if (u === "/product/json-ld") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(readFileSync(path.join(FIX, "product-json-ld.html"), "utf8").replaceAll("__ORIGIN__", origin));
  }
  if (u === "/product/503") { res.writeHead(503, { "Content-Type": "text/html" }); return res.end(BOT_WALL.replaceAll("__ORIGIN__", origin)); }
  if (u === "/product/empty") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(NO_PRODUCT); }
  if (u === "/images/racket.jpg") { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(readFileSync(path.join(FIX, "racket.jpg"))); }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(0, "0.0.0.0", r));
const port = server.address().port;
const origin = `http://host.docker.internal:${port}`;
console.log("fixture on", port);

await svc.from("retailer_programmes").delete().eq("key", KEY);
const { error: pe } = await svc.from("retailer_programmes").insert({
  key: KEY, display_name: "Walkthrough Store", url_patterns: ["host.docker.internal"],
  affiliate_tag_template: null, extractor: null, fetch_policy: { maxPerMinute: 60 }, active: true, fetchable: true,
});
if (pe) throw pe;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log(`  shot ${OUT}/${n}.png`); };

const urlField = () => page.getByLabel("Product page URL");
const readButton = () => page.getByRole("button", { name: "Read the page" });
const titleField = () => page.getByLabel("Title").first();

let createdId = null;
try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', "admin@atlitos.dev");
  await page.fill('input[type="password"]', "AtlitosDemo!2026");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });

  // ---- 1. a readable retailer page prefills the one form -----------------
  console.log("\n1. readable page prefills the form");
  await page.goto(`${BASE}/gear/create`);
  await urlField().fill(`${origin}/product/json-ld`);
  const rowsBefore = (await svc.from("affiliate_products").select("id", { count: "exact", head: true })).count;
  await readButton().click();
  await page.getByText("Filled in below").waitFor({ timeout: 30000 });
  const prefilledTitle = await titleField().inputValue();
  check("title prefilled from the page", prefilledTitle.length > 0, prefilledTitle);
  const offerUrl = await page.getByLabel("Affiliate link").first().inputValue();
  check("pasted URL became the offer link", offerUrl === `${origin}/product/json-ld`, offerUrl);
  const offerPrice = await page.getByLabel("Price, INR").first().inputValue();
  check("price prefilled into the offer row", offerPrice.length > 0, offerPrice);
  const rowsAfterFetch = (await svc.from("affiliate_products").select("id", { count: "exact", head: true })).count;
  check("reading the page wrote nothing (FR-44)", rowsAfterFetch === rowsBefore, `${rowsBefore} -> ${rowsAfterFetch}`);
  await shot("a3-1-decathlon-prefill");

  // Save it and prove one product with one offer landed.
  await page.getByLabel("Retailer").first().fill("Walkthrough Store");
  await page.getByRole("button", { name: "Create gear item" }).first().click();
  await page.waitForURL(/\/gear\/show\//, { timeout: 30000 });
  createdId = page.url().split("/gear/show/")[1].split("?")[0];
  const { data: saved } = await svc.from("affiliate_products").select("id,title").eq("id", createdId).single();
  check("one product row saved", Boolean(saved?.id), saved?.title);
  const { count: offerCount } = await svc.from("product_offers").select("id", { count: "exact", head: true }).eq("product_id", createdId);
  check("exactly one offer saved", offerCount === 1, String(offerCount));
  await shot("a3-2-saved-product");

  // ---- 2. Amazon: honest message, URL kept, form ready -------------------
  console.log("\n2. amazon.in, not fetchable");
  await page.goto(`${BASE}/gear/create`);
  await urlField().fill("https://www.amazon.in/dp/B0EXAMPLE");
  await readButton().click();
  await page.getByText("RETAILER_UNAVAILABLE").waitFor({ timeout: 30000 });
  const amazonText = await page.locator(".ak-gear-ingest-refusal").innerText();
  check("names the retailer and what to do", amazonText.includes("Amazon India pages cannot be fetched automatically."), amazonText.split("\n")[1]);
  check("guidance says the link is kept", amazonText.includes("kept as the offer"), "");
  const amazonOffer = await page.getByLabel("Affiliate link").first().inputValue();
  check("URL locked in as the offer link", amazonOffer === "https://www.amazon.in/dp/B0EXAMPLE", amazonOffer);
  check("form is ready to fill", await titleField().isEditable(), "");
  await shot("a3-3-amazon-honest");

  // ---- 3. a supported retailer that answers 503 --------------------------
  console.log("\n3. supported retailer answers 503");
  await page.goto(`${BASE}/gear/create`);
  await urlField().fill(`${origin}/product/503`);
  await readButton().click();
  await page.getByText("RETAILER_UNAVAILABLE").waitFor({ timeout: 30000 });
  const wallText = await page.locator(".ak-gear-ingest-refusal").innerText();
  check("shows the upstream status", wallText.includes("HTTP 503"), wallText.split("\n")[0]);
  const wallOffer = await page.getByLabel("Affiliate link").first().inputValue();
  check("URL kept as the offer link", wallOffer === `${origin}/product/503`, wallOffer);
  await shot("a3-4-retailer-503");

  // ---- 4. a page with no product ----------------------------------------
  console.log("\n4. page with no product data");
  await page.goto(`${BASE}/gear/create`);
  await urlField().fill(`${origin}/product/empty`);
  await readButton().click();
  await page.getByText("NO_PRODUCT_FOUND").waitFor({ timeout: 30000 });
  const emptyText = await page.locator(".ak-gear-ingest-refusal").innerText();
  check("names what is missing and what to do", emptyText.includes("carried no product details"), emptyText.split("\n").slice(-1)[0]);
  await shot("a3-5-no-product");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  if (createdId) {
    await svc.from("product_offers").delete().eq("product_id", createdId);
    await svc.from("affiliate_products").delete().eq("id", createdId);
  }
  await svc.from("retailer_programmes").delete().eq("key", KEY);
}

console.log("");
if (failures.length) {
  console.log(`walkthrough-a3 FAILED: ${failures.length}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("walkthrough-a3: all checks passed");
