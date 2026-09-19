/* Velocity skew. Elements opt in with data-skew (optional data-skew-max, in
   degrees, default 6). One shared reader maps lenis velocity to skewY through
   a quickTo per element. Desktop only; never on headlines (legibility rule).
   Spec: 5.3. */

import { onVisibleFrame } from "./ticker.js";

export default function init(ctx) {
  const { gsap } = ctx;
  if (!window.matchMedia("(pointer: fine)").matches) { return; }
  const els = ctx.q("[data-skew]");
  if (!els.length) { return; }

  els.forEach((el) => {
    const max = parseFloat(el.getAttribute("data-skew-max") || "6");
    const to = gsap.quickTo(el, "skewY", { duration: 0.4, ease: "power3.out" });
    const dispose = onVisibleFrame(el, () => {
      const v = Math.max(-60, Math.min(60, ctx.velocity()));
      to((v / 60) * max);
    }, ctx);
    ctx.onCleanup(dispose);
  });
}
