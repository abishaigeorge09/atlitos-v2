/* Magnetic elements. The element translates toward the pointer inside a
   radius and springs back on leave; the inner label moves at half the parent
   offset, which is what makes it read as depth. Pointer-fine only, callers
   gate. Spec: MOTION-ARCHITECTURE.md 5.8. */

export function makeMagnetic(el, { gsap }, opts = {}) {
  const radius = opts.radius || 90;
  const strength = opts.strength || 0.32;

  const x = gsap.quickTo(el, "x", { duration: 0.28, ease: "expo.out" });
  const y = gsap.quickTo(el, "y", { duration: 0.28, ease: "expo.out" });
  const label = el.firstElementChild;
  const lx = label ? gsap.quickTo(label, "x", { duration: 0.28, ease: "expo.out" }) : null;
  const ly = label ? gsap.quickTo(label, "y", { duration: 0.28, ease: "expo.out" }) : null;

  const onMove = (e) => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < radius + Math.max(r.width, r.height) / 2) {
      x(dx * strength); y(dy * strength);
      if (lx) { lx(dx * strength * 0.5); ly(dy * strength * 0.5); }
    }
  };
  const onLeave = () => {
    gsap.to(el, { x: 0, y: 0, duration: 0.55, ease: "elastic.out(1, 0.5)" });
    if (label) { gsap.to(label, { x: 0, y: 0, duration: 0.55, ease: "elastic.out(1, 0.5)" }); }
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
  return () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
  };
}

export default function init(ctx) {
  if (!window.matchMedia("(pointer: fine)").matches) { return; }
  const targets = ctx.q(".btn-pill, .btn-ghost, .plan-cta, .diff-empower-link, [data-magnetic]");
  targets.forEach((el) => ctx.onCleanup(makeMagnetic(el, ctx)));
}
