/* Velocity-reactive marquee system. Replaces the CSS keyframe marquees when
   rich mode boots: JS zeroes the CSS animation and drives x with a modulo
   wrap on the shared ticker, reading scroll velocity for speed and direction.
   Offscreen marquees cost nothing (onVisibleFrame). No-JS and reduced motion
   keep the CSS animation / static row respectively. Spec: 5.4. */

import { onVisibleFrame } from "./ticker.js";

export function registerMarquee(el, ctx, opts) {
  const { gsap } = ctx;
  const speed = opts.speed || 45;              // px/s base
  const dir = opts.reverse ? -1 : 1;
  const velocityFactor = opts.velocityFactor == null ? 0.35 : opts.velocityFactor;

  el.style.animation = "none";
  el.style.willChange = "transform";

  /* content is duplicated in markup; one copy's width is the wrap length */
  let half = el.scrollWidth / 2;
  const refresh = () => { half = el.scrollWidth / 2; };
  window.addEventListener("resize", refresh);

  let x = 0;
  let paused = false;
  if (opts.pauseOnHover) {
    el.addEventListener("pointerenter", () => { paused = true; });
    el.addEventListener("pointerleave", () => { paused = false; });
  }

  /* dt derived from the ticker's time param (seconds); the deltaTime arg's
     units proved unreliable across GSAP builds, measured the hard way */
  let last = null;
  const dispose = onVisibleFrame(el, (time) => {
    if (last === null) { last = time; return; }
    const dt = Math.min(time - last, 0.064);
    last = time;
    if (paused || half <= 0) { return; }
    const v = ctx.velocity(); // signed px/frame from lenis, 0 on touch
    const px = (speed + Math.abs(v) * velocityFactor * 60) * dt;
    x -= px * dir * (v < 0 ? -1 : 1);
    /* wrap into (-half, 0]: sign-preserving modulo, then fold positives (from
       direction flips) down one copy. The naive ((x%h)+h)%h*-1 form ping
       ponged a full copy-width every frame. */
    x = x % half;
    if (x > 0) { x -= half; }
    el.style.transform = `translateX(${x}px)`;
  }, ctx);

  return () => {
    dispose();
    window.removeEventListener("resize", refresh);
    el.style.animation = "";
    el.style.transform = "";
  };
}

export default function init(ctx) {
  /* the five page marquees, base speeds per the architecture */
  const rows = [
    ...ctx.q(".problem .marquee-track").map((el, i) => ({ el, speed: 40, reverse: el.classList.contains("marquee-reverse") })),
    ...ctx.q(".strip-track").map((el) => ({ el, speed: 60 })),
    ...ctx.q(".vwall .marquee-track").map((el, i) => ({ el, speed: i === 0 ? 45 : 52, reverse: el.classList.contains("marquee-reverse"), pauseOnHover: true })),
  ];
  rows.forEach(({ el, ...opts }) => ctx.onCleanup(registerMarquee(el, ctx, opts)));
}
