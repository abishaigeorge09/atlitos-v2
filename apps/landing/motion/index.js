/* Motion boot. The ceiling over main.js's floor.
   Order: assert globals -> detect mode -> register plugins -> smooth scroll ->
   hand over from basic mode -> dispatch section inits.
   If ANYTHING here fails, the page keeps main.js behaviour: reveals via
   IntersectionObserver, native scroll, full content. That floor is a real,
   shippable page and check C12 proves it stays alive. */

import { createContext } from "./context.js";
import { initSmoothScroll } from "./scroll.js";

/* EAGER: everything the fold needs, loaded at boot and counted in the C6
   first-load budget. */
/* No curtain: measured ~500ms of LCP on throttled mobile against the 250ms
   budget in MOTION-ARCHITECTURE.md 5.6, so per that section's own rule it was
   dropped. The hero load choreography is the opening. */
const EAGER_INITS = [
  ["header", () => import("./sections/header.js")],
  ["hero", () => import("./sections/hero.js")],
  ["ledEntry", () => import("./sections/ledEntry.js")],
  ["cursor", () => import("./systems/cursor.js")],
  ["magnetic", () => import("./systems/magnetic.js")],
  ["skew", () => import("./systems/skew.js")],
  ["marquee", () => import("./systems/marquee.js")],
];

/* DEFERRED: below-fold section choreography, loaded at post-boot idle so it
   never blocks first paint. The main.js reveal IO stays live in the gap, so a
   sprint scroller who outruns the idle load still sees content revealed by
   the basic system rather than nothing. */
const DEFERRED_INITS = [
  ["problem", () => import("./sections/problem.js")],
  ["interlude", () => import("./sections/interlude.js")],
  ["steps", () => import("./sections/steps.js")],
  ["features", () => import("./sections/features.js")],
  ["oldway", () => import("./sections/oldway.js")],
  ["different", () => import("./sections/different.js")],
  ["lower", () => import("./sections/lower.js")],
  ["empower", () => import("./sections/empower.js")],
  ["rail", () => import("./systems/rail.js")],
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

  const runInits = async (inits) => {
    for (const [name, load] of inits) {
      try {
        const mod = await load();
        await mod.default(ctx); /* inits may return a readiness promise */
      } catch (e) {
        /* One broken section must not take down the rest of the page. */
        console.error("[motion] section failed:", name, e);
      }
    }
  };

  await runInits(EAGER_INITS);

  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 800));
  idle(() => {
    runInits(DEFERRED_INITS).then(() => {
      ScrollTrigger.refresh();
      /* the whole choreography is registered; checks wait on this marker */
      document.documentElement.classList.add("motion-full");
    });
  }, { timeout: 2500 });

  /* One refresh after fonts settle so SplitText line boxes and pin distances
     are computed against real metrics. */
  ctx.splitReady.then(() => ScrollTrigger.refresh());
}

boot();
