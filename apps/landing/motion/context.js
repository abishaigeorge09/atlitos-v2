/* MotionCtx factory. One shared context object threads through every section
   init so no module reaches for globals on its own. See MOTION-ARCHITECTURE.md
   section 4.1 for the interface contract. */

export function createContext({ gsap, ScrollTrigger, SplitText, lenis, mode }) {
  const cleanups = [];

  const ctx = {
    gsap,
    ScrollTrigger,
    SplitText,
    lenis,
    mode, // "rich" | "basic" | "reduced"
    mm: gsap.matchMedia(),

    /* signed velocity in px per frame, 0 when Lenis is absent (touch, reduced) */
    velocity() {
      return lenis ? lenis.velocity : 0;
    },

    /* SplitText must never run against fallback font metrics. Race fonts.ready
       against a 1500 ms cap so a failed font load degrades instead of blocking. */
    splitReady: Promise.race([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]),

    onCleanup(fn) {
      cleanups.push(fn);
    },

    q(sel, root) {
      return Array.from((root || document).querySelectorAll(sel));
    },

    dispose() {
      cleanups.forEach((fn) => {
        try { fn(); } catch (e) { /* one bad teardown must not stop the rest */ }
      });
      cleanups.length = 0;
    },
  };

  return ctx;
}
