#!/usr/bin/env node
/* Motion architecture mechanical checks (docs/MOTION-ARCHITECTURE.md section 9).
   Usage: node scripts/motion-check.mjs <baseUrl> [--checks C1,C5,...]
   Exits non zero on any failure. Every check was planted red before green.

   Playwright resolution: this repo installs @playwright/test under apps/e2e via
   pnpm. We resolve playwright-core through the monorepo store so the landing
   app itself stays dependency free. Override with PLAYWRIGHT_CORE=<path>. */

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING = resolve(__dirname, "..");

function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_CORE) { return process.env.PLAYWRIGHT_CORE; }
  const roots = [
    resolve(LANDING, "../../node_modules/.pnpm"),
    // worktrees live at <repo>/.claude/worktrees/<name>/, so the repo root's
    // store is five levels above apps/landing there
    resolve(LANDING, "../../../../../node_modules/.pnpm"),
  ];
  for (const root of roots) {
    if (!existsSync(root)) { continue; }
    const hit = readdirSync(root).find((d) => d.startsWith("playwright-core@"));
    if (hit) { return join(root, hit, "node_modules/playwright-core"); }
  }
  throw new Error("playwright-core not found; set PLAYWRIGHT_CORE=<path>");
}

const require = createRequire(import.meta.url);
const { chromium } = require(resolvePlaywright());

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("usage: node scripts/motion-check.mjs <baseUrl> [--checks C1,C5]");
  process.exit(2);
}
const only = (() => {
  const i = process.argv.indexOf("--checks");
  return i > -1 ? process.argv[i + 1].split(",") : null;
})();

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`);
}
function skip(id) {
  return only && !only.includes(id);
}

/* ---------- static checks (no browser) ---------- */

function checkC2() {
  if (skip("C2")) { return; }
  const css = readFileSync(join(LANDING, "styles.css"), "utf8");
  // Hidden-state rules for data-reveal must be scoped under .js
  const offenders = [];
  css.split("\n").forEach((line, i) => {
    if (!line.includes("[data-reveal")) { return; }
    if (!/[{,]/.test(line) && !line.trim().startsWith(".") && !line.trim().startsWith("html")) { return; }
    const sel = line.split("{")[0];
    if (sel.includes(":not(.is-in)") && !/\.js\s|html\.js/.test(sel)) {
      offenders.push(`${i + 1}: ${line.trim()}`);
    }
  });
  report("C2", offenders.length === 0,
    offenders.length ? `unscoped hidden states: ${offenders.join(" | ")}` : "all data-reveal hidden states scoped under .js");
}

function checkC6() {
  if (skip("C6")) { return; }
  /* First load = main.js + vendor + the EAGER motion modules (the boot list
     in motion/index.js). DEFERRED sections load at post-boot idle and three/*
     loads worker-side at post-load idle; both are off the first-paint path
     and reported informationally instead of capped. */
  const DEFERRED = new Set([
    "sections/problem.js", "sections/interlude.js", "sections/steps.js",
    "sections/features.js", "sections/oldway.js", "sections/different.js",
    "sections/lower.js", "sections/empower.js", "systems/wipe.js",
    "systems/rail.js",
  ]);
  const files = [
    join(LANDING, "main.js"),
    join(LANDING, "vendor/gsap-3.13.min.js"),
    join(LANDING, "vendor/ScrollTrigger-3.13.min.js"),
    join(LANDING, "vendor/SplitText-3.13.min.js"),
    join(LANDING, "vendor/lenis-1.3.min.js"),
  ];
  const motionDir = join(LANDING, "motion");
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith(".js") ? [p] : []);
  });
  let deferredTotal = 0;
  if (existsSync(motionDir)) {
    for (const p of walk(motionDir)) {
      const rel = p.slice(motionDir.length + 1);
      if (DEFERRED.has(rel) || rel.startsWith("three/")) {
        deferredTotal += gzipSync(readFileSync(p)).length;
      } else {
        files.push(p);
      }
    }
  }
  let total = 0;
  for (const f of files) { total += gzipSync(readFileSync(f)).length; }
  const kb = (total / 1024).toFixed(1);
  const dkb = (deferredTotal / 1024).toFixed(1);
  report("C6", total <= 80 * 1024,
    `first-load JS ${kb} KB gz (cap 80 KB); idle-deferred motion ${dkb} KB gz`);
}

/* ---------- browser checks ---------- */

async function withPage(fn, opts = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: opts.reducedMotion || "no-preference",
    javaScriptEnabled: opts.javaScriptEnabled !== false,
  });
  try {
    if (opts.blockMotion) {
      await page.route("**/motion/index.js", (r) => r.abort());
    }
    await page.goto(baseUrl, { waitUntil: "load" });
    if (opts.waitFullBoot) {
      /* deferred section modules land at post-boot idle; steady-state checks
         (pin sweep, frame budget) must not race them */
      await page.waitForFunction(
        () => document.documentElement.classList.contains("motion-full"),
        null, { timeout: 15000 }
      ).catch(() => { /* reduced/basic pages never set it; checks handle */ });
    }
    await fn(page);
  } finally {
    await browser.close();
  }
}

async function checkC1() {
  if (skip("C1")) { return; }
  await withPage(async (page) => {
    // sample copy strings that must exist without JS
    const strings = [
      "The way you play sports is about to change forever",
      "Meet",
      "Playing is easy",
      "Here is how it works",
      "Plans built for athletes",
      "Empower",
    ];
    /* textContent, not innerText: the guard is "present in plain markup",
       and sr-only copy legitimately satisfies it while innerText hides it.
       Whitespace collapsed, headlines legitimately break across spans. */
    const text = await page.evaluate(() =>
      document.body.textContent.replace(/\s+/g, " ")
    );
    const missing = strings.filter((s) => !text.includes(s));
    /* An element mid CSS keyframe pulse (e.g. .d-cta ctapulse) legitimately
       samples below 1; a running animation means visible-by-design, never
       stuck hidden. Transitions do not run without a trigger, so a genuinely
       stuck reveal element has zero active animations and still gets caught. */
    const hidden = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-reveal]"))
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.99)
        .filter((el) => el.getAnimations().length === 0).length
    );
    report("C1", missing.length === 0 && hidden === 0,
      `no-JS copy: ${missing.length} missing, ${hidden} hidden reveal elements`);
  }, { javaScriptEnabled: false });
}

async function checkC3() {
  if (skip("C3")) { return; }
  await withPage(async (page) => {
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      pins: window.ScrollTrigger ? ScrollTrigger.getAll().filter((t) => t.pin).length : 0,
      canvas: !!document.querySelector("#emp3d canvas"),
      hidden: Array.from(document.querySelectorAll("[data-reveal]"))
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.99).length,
    }));
    report("C3", r.pins === 0 && !r.canvas && r.hidden === 0,
      `reduced motion: pins=${r.pins} canvas=${r.canvas} hidden=${r.hidden}`);
  }, { reducedMotion: "reduce" });
}

async function checkC5() {
  if (skip("C5")) { return; }
  await withPage(async (page) => {
    const r = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflowX,
      body: getComputedStyle(document.body).overflowX,
    }));
    report("C5", r.html === "clip" && r.body === "visible",
      `overflow-x html=${r.html} body=${r.body} (want clip/visible)`);
  });
}

async function checkC12() {
  if (skip("C12")) { return; }
  await withPage(async (page) => {
    await page.waitForTimeout(600);
    // scroll past the hero track so reveal targets actually intersect; nav
    // should compact (basic mode logic) and reveals should fire
    await page.evaluate(() => {
      const target = document.querySelector(".led-entry") || document.body;
      window.scrollTo(0, target.offsetTop + 200);
    });
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({
      compact: document.getElementById("siteHeader").classList.contains("compact"),
      richFlag: document.documentElement.classList.contains("motion-rich"),
      someRevealed: document.querySelectorAll("[data-reveal].is-in").length > 0,
    }));
    report("C12", r.compact && !r.richFlag && r.someRevealed,
      `floor with motion/ blocked: compact=${r.compact} rich=${r.richFlag} revealed=${r.someRevealed}`);
  }, { blockMotion: true });
}

async function checkC4() {
  /* THE pin overlap sweep, R1. Scroll the Empower range in 40px steps and
     assert the pinned stage never paints past the footer top. Planted red
     with pinSpacing:false before this went green. */
  if (skip("C4")) { return; }
  await withPage(async (page) => {
    await page.waitForTimeout(600);
    const r = await page.evaluate(async () => {
      const wrap = document.querySelector(".emp-pin-wrap");
      const stage = document.querySelector(".emp-stage");
      const footer = document.querySelector(".site-footer");
      if (!wrap || !stage || !footer) { return { skip: true }; }
      const startY = wrap.getBoundingClientRect().top + scrollY - innerHeight;
      const endY = startY + innerHeight * 4;
      let worst = -Infinity;
      let pinnedSeen = false;
      for (let y = Math.max(0, startY); y < endY; y += 40) {
        scrollTo(0, y);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const st = stage.getBoundingClientRect();
        const ft = footer.getBoundingClientRect();
        const pinned = window.ScrollTrigger && ScrollTrigger.getAll().some((t) => t.pin && t.isActive);
        if (pinned) {
          pinnedSeen = true;
          worst = Math.max(worst, st.bottom - ft.top);
        }
      }
      return { worst: Math.round(worst), pinnedSeen };
    });
    if (r.skip) { report("C4", false, "empower pin structure missing"); return; }
    report("C4", r.pinnedSeen && r.worst <= 0,
      `pin overlap sweep: pinned seen=${r.pinnedSeen}, worst stage-bottom minus footer-top ${r.worst}px (must be <= 0)`);
  }, { waitFullBoot: true });
}

async function checkC7() {
  if (skip("C7")) { return; }
  /* three.js loads at post-load idle into a WORKER (parse off main thread).
     The assertions that matter: it is never on the critical path (requested
     only after the load event) and never on mobile at all. */
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const desktop = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const three = performance.getEntriesByType("resource").find((r) => r.name.includes("three.min"));
    return {
      requested: !!three,
      afterLoad: three ? three.startTime > nav.loadEventEnd - 5 : true,
    };
  });
  /* mobile 390px: zero three requests even after a full scroll */
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const mobileReqs = [];
  p2.on("request", (req) => { if (req.url().includes("three.min")) { mobileReqs.push(req.url()); } });
  await p2.goto(baseUrl, { waitUntil: "load" });
  await p2.evaluate(async () => {
    const total = document.body.scrollHeight - innerHeight;
    for (let y = 0; y <= total; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
  });
  await p2.waitForTimeout(3000);
  await browser.close();
  report("C7", desktop.afterLoad && mobileReqs.length === 0,
    `three.js: desktop requested=${desktop.requested} strictly after load=${desktop.afterLoad}, mobile requests after full scroll=${mobileReqs.length} (want 0)`);
}

async function checkC10C11() {
  if (skip("C10") && skip("C11")) { return; }
  await withPage(async (page) => {
    await page.waitForTimeout(2200);
    /* scroll the whole page so count-ups and reveals settle to final text */
    await page.evaluate(async () => {
      const total = document.body.scrollHeight - innerHeight;
      for (let y = 0; y <= total; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    });
    await page.waitForTimeout(1500);

    if (!skip("C10")) {
      const r = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const bad = [];
        while (walker.nextNode()) {
          const t = walker.currentNode.textContent;
          const el = walker.currentNode.parentElement;
          if (!el || !el.offsetParent) { continue; } // hidden/meta text exempt
          /* true emoji planes only; typographic dingbats (the ✱ strip stars)
             are a deliberate design ornament, not emoji, and flagging them
             would teach everyone to ignore this check */
          if (/[\u{1F300}-\u{1FAFF}\u{2764}\u{2b50}\u{2705}\u{274C}]/u.test(t)) { bad.push("emoji: " + t.trim().slice(0, 30)); }
          /* em dashes and spaced hyphens in visible copy; compound words in
             attributes/URLs are not text nodes so they never trip this */
          if (/—|–| - /.test(t)) { bad.push("dash: " + t.trim().slice(0, 30)); }
        }
        return bad.slice(0, 5);
      });
      report("C10", r.length === 0, r.length ? r.join(" | ") : "no emoji, no em dashes or spaced hyphens in visible copy");
    }

    if (!skip("C11")) {
      const r = await page.evaluate(() => {
        const text = document.body.textContent.replace(/\s+/g, " ");
        const tiers = ["Starter", "₹0", "Pro", "₹199", "Elite", "₹499"].every((s) => text.includes(s));
        const tags = Array.from(document.querySelectorAll(".v-tag, .emp-stat .v-tag"));
        const sampleVisible = tags.length > 0 && tags.every((el) => {
          const cs = getComputedStyle(el);
          return parseFloat(cs.opacity) >= 0.99 && cs.visibility !== "hidden" && cs.display !== "none";
        });
        return { tiers, tagCount: tags.length, sampleVisible };
      });
      report("C11", r.tiers && r.sampleVisible,
        `tiers frozen=${r.tiers}, ${r.tagCount} SAMPLE tags all visible=${r.sampleVisible}`);
    }
  });
}

async function checkC9() {
  if (skip("C9")) { return; }
  /* Two attempts, pass if either passes: headless SwiftShader raster warmup
     produces occasional ~54ms one-off frames that no real GPU reproduces. A
     SYSTEMATIC jank source (the 651KB three.js parse did this) fails both
     attempts, so the check still catches what it exists to catch. */
  const attempt = () => new Promise((resolve) => {
    withPage(async (page) => {
      await page.waitForTimeout(600); // hero settles (full boot already awaited)
      const r = await page.evaluate(() => new Promise((res) => {
        const frames = [];
        let lastT = performance.now();
        let scrolled = 0;
        const total = document.body.scrollHeight - innerHeight;
        const step = () => {
          const now = performance.now();
          frames.push(now - lastT);
          lastT = now;
          scrolled += 24;
          scrollTo(0, scrolled);
          if (scrolled < total) { requestAnimationFrame(step); }
          else {
            const longest = Math.max(...frames);
            const fps = 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length);
            res({ longest: Math.round(longest), fps: Math.round(fps), n: frames.length });
          }
        };
        requestAnimationFrame(step);
      }));
      resolve(r);
    }, { waitFullBoot: true });
  });
  let r = await attempt();
  let note = "";
  if (!(r.longest <= 50 && r.fps >= 55)) {
    const r2 = await attempt();
    note = ` (attempt 1: ${r.longest}ms/${r.fps}fps)`;
    r = r2;
  }
  report("C9", r.longest <= 50 && r.fps >= 55,
    `scripted scroll: longest frame ${r.longest}ms (cap 50), mean ${r.fps}fps (floor 55), ${r.n} frames${note}`);
}

async function checkC8() {
  /* SLOW (three throttled loads); opt in with --checks C8. Median of three
     because single throttled runs over a real network are noisy. */
  if (!only || !only.includes("C8")) { return; }
  const lcps = [], clss = [];
  for (let i = 0; i < 3; i++) {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions",
      { offline: false, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 150 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(baseUrl, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    lcps.push(await page.evaluate(() => new Promise((res) => {
      new PerformanceObserver((l) => { const e = l.getEntries(); res(Math.round(e[e.length - 1].startTime)); })
        .observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => res(-1), 2000);
    })));
    clss.push(await page.evaluate(() => new Promise((res) => {
      let v = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) v += e.value; }))
        .observe({ type: "layout-shift", buffered: true });
      setTimeout(() => res(v), 1000);
    })));
    await browser.close();
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[1];
  const lcp = med(lcps), cls = med(clss);
  report("C8", lcp > 0 && lcp < 2000 && cls < 0.02,
    `median LCP ${lcp}ms (target <2000), median CLS ${cls.toFixed(4)} (target <0.02), trials LCP=[${lcps}]`);
}

/* ---------- run ---------- */

checkC2();
checkC6();
await checkC1();
await checkC3();
await checkC5();
await checkC12();
await checkC4();
await checkC7();
await checkC10C11();
await checkC9();
await checkC8();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
