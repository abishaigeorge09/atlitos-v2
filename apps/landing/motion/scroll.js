/* Lenis lifecycle. Desktop pointer-fine only; touch keeps the native scroller
   (syncTouch is the source of most iOS complaints). GSAP owns the tick.
   Exact wiring per MOTION-ARCHITECTURE.md section 1.4. */

export function initSmoothScroll({ gsap, ScrollTrigger, reduced }) {
  if (reduced) { return null; }
  if (!window.Lenis) { return null; }
  if (!window.matchMedia("(pointer: fine)").matches) { return null; }

  const lenis = new Lenis({
    lerp: 0.1, // matches the heyparker feel. Do not raise above 0.12.
    smoothWheel: true,
    syncTouch: false,
    autoRaf: false,
    anchors: { offset: -72 }, // matches --nav-h
    prevent: (node) => node.hasAttribute && node.hasAttribute("data-lenis-prevent"),
  });

  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  ScrollTrigger.config({ ignoreMobileResize: true });

  return lenis;
}
