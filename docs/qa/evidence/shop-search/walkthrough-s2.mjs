// Phase S2 gate, browser half, on the INTEGRATED tree. Local stack only.
// Needs: admin dev server on :5199, and `supabase functions serve --env-file <f>` where f has
// VOYAGE_STUB=1, GEAR_INGEST_PUBLIC_URL=http://127.0.0.1:54321, FETCH_ALLOW_HOSTS=host.docker.internal
// (the fetch guard refuses .internal hosts otherwise; production never sets FETCH_ALLOW_HOSTS).
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const OUT = process.env.OUT_DIR;
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const FIX = path.resolve(process.env.REPO_ROOT ?? "../..", "scripts/fixtures/gear");
const KEY = "walkthrough_fixture";
let gone = false;

const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  const origin = `http://host.docker.internal:${server.address().port}`;
  if (u === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("User-agent: *\nAllow: /\n"); }
  if (u === "/product/json-ld") {
    if (gone) { res.writeHead(404); return res.end("gone"); }
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(readFileSync(path.join(FIX, "product-json-ld.html"), "utf8").replaceAll("__ORIGIN__", origin));
  }
  if (u === "/images/racket.jpg") { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(readFileSync(path.join(FIX, "racket.jpg"))); }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(0, "0.0.0.0", r));
const port = server.address().port;
const productUrl = `http://host.docker.internal:${port}/product/json-ld`;
console.log("fixture on", port);

await svc.from("retailer_programmes").delete().eq("key", KEY);
const { error: pe } = await svc.from("retailer_programmes").insert({ key: KEY, display_name: "Walkthrough Store", url_patterns: ["host.docker.internal"], affiliate_tag_template: null, extractor: null, fetch_policy: { maxPerMinute: 60 }, active: true });
if (pe) throw pe;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const shots = [];
const shot = async (n) => { const p = `${OUT}/${n}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };
let productId = null;
try {
  await page.goto("http://localhost:5199/login");
  await page.fill('input[type="email"]', "admin@atlitos.dev");
  await page.fill('input[type="password"]', "AtlitosDemo!2026");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });

  await page.goto("http://localhost:5199/gear/create");
  await page.getByText("Add from a link").waitFor();
  await page.fill('input[placeholder="https://www.amazon.in/dp/..."]', productUrl);
  await page.getByRole("button", { name: "Fetch" }).click();
  await page.getByText("Walkthrough Store", { exact: false }).or(page.getByText(KEY)).first().waitFor({ timeout: 30000 });
  const { count: before } = await svc.from("affiliate_products").select("id", { count: "exact", head: true });
  console.log("rows after Fetch (must be unchanged):", before);
  await shot("s2-01-draft-after-fetch");

  await page.getByRole("button", { name: /^Save/ }).first().click();
  await page.waitForURL(/\/gear\/show\//, { timeout: 30000 });
  productId = page.url().split("/gear/show/")[1].split("?")[0];
  await page.waitForTimeout(4000);
  console.log("show page has retailers heading:", await page.getByText("Retailers, cheapest first").count(), "url", page.url());
  await shot("s2-02-show-after-save");
  const { data: prod } = await svc.from("affiliate_products").select("id,title,image_url,image_path,health_status").eq("id", productId).single();
  console.log("saved product:", JSON.stringify(prod));
  const imgRes = await fetch(prod.image_url);
  console.log("image_url on our bucket:", prod.image_url.startsWith(SUPABASE_URL + "/storage/v1/object/public/product-images/"), "status", imgRes.status, imgRes.headers.get("content-type"));

  await page.goto("http://localhost:5199/gear/health");
  await page.getByRole("heading", { name: "Catalog health" }).waitFor();
  await page.getByText("All").first().click();
  await page.waitForTimeout(800);
  await shot("s2-03-health-ok");

  gone = true;
  await svc.from("product_offers").update({ consecutive_failures: 6 }).eq("affiliate_product_id", productId);
  await page.getByRole("button", { name: "Re-check now" }).first().click();
  await page.waitForTimeout(6000);
  await shot("s2-04-health-after-recheck");
  const { data: after } = await svc.from("affiliate_products").select("active,auto_delisted_at,health_status").eq("id", productId).single();
  const { data: audit } = await svc.from("audit_log").select("action,actor_id").eq("entity_id", productId).eq("action", "affiliate_product.auto_delist");
  console.log("after recheck:", JSON.stringify(after), "audit:", JSON.stringify(audit));
  await page.getByText("Delisted").first().click();
  await page.waitForTimeout(800);
  await shot("s2-05-health-delisted");
} finally {
  await browser.close();
  if (productId) {
    const { data: prod } = await svc.from("affiliate_products").select("image_path").eq("id", productId).maybeSingle();
    if (prod?.image_path) await svc.storage.from("product-images").remove([prod.image_path]);
    await svc.from("affiliate_products").delete().eq("id", productId);
  }
  await svc.from("retailer_programmes").delete().eq("key", KEY);
  server.close();
  console.log(shots.join("\n"));
}
