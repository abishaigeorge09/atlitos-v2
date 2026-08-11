/* Motion boot. The ceiling over main.js's floor.
   Order: assert globals -> detect mode -> register plugins -> smooth scroll ->
   hand over from basic mode -> dispatch section inits.
   If ANYTHING here fails, the page keeps main.js behaviour: reveals via
   IntersectionObserver, native scroll, full content. That floor is a real,
   shippable page and check C12 proves it stays alive. */

import { createContext } from "./context.js";
import { initSmoothScroll } from "./scroll.js";

const SECTION_INITS = [
  /* Populated per phase. Each entry: [name, loader]. Loaders are dynamic so a
     syntax error in one section skips that section instead of killing boot. */
  ["header", () => import("./sections/header.js")],
  ["hero", () => import("./sections/hero.js")],
  ["ledEntry", () => import("./sections/ledEntry.js")],
  /* global systems (P2) */
  ["cursor", () => import("./systems/cursor.js")],
  ["magnetic", () => import("./systems/magnetic.js")],
  ["skew", () => import("./systems/skew.js")],
  ["marquee", () => import("./systems/marquee.js")],
  /* upper page (P3) */
  ["problem", () => import("./sections/problem.js")],
  ["interlude", () => import("./sections/interlude.js")],
  ["steps", () => import("./sections/steps.js")],
  ["features", () => import("./sections/features.js")],
];

function detectMode() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { return "reduced"; }
  if (!window.gsap || !window.ScrollTrigger || !window.SplitText) { return "basic"; }
  return "rich";
}

async function boot() {
  const mode = detectMode();
  if (mode !== "rich") { return; } // basic and reduced stay on the main.js floor

  const { gsap, ScrollTrigger, SplitText } = window;
  gsap.registerPlugin(ScrollTrigger, SplitText);

  const reduced = false; // rich mode implies not reduced
  const lenis = initSmoothScroll({ gsap, ScrollTrigger, reduced });

  const ctx = createContext({ gsap, ScrollTrigger, SplitText, lenis, mode });

  /* Hand over: switch the basic-mode listeners off now that rich mode owns
     them. Guarded, main.js may legitimately not have finished registering. */
  document.documentElement.classList.add("motion-rich");
  const basic = window.__atlitosBasic;
  if (basic) {
    if (lenis && basic.disableMarkParallax) { basic.disableMarkParallax(); }
    /* reveal IO and nav scroll stay live until their rich replacements exist
       (P3/P0 respectively); each phase flips its own switch. */
  }

  for (const [name, load] of SECTION_INITS) {
    try {
      const mod = await load();
      mod.default(ctx);
    } catch (e) {
      /* One broken section must not take down the rest of the page. */
      console.error("[motion] section failed:", name, e);
    }
  }

  /* One refresh after fonts settle so SplitText line boxes and pin distances
     are computed against real metrics. */
  ctx.splitReady.then(() => ScrollTrigger.refresh());
}

boot();
