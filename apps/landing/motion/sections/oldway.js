/* Old way vs Atlitos way. Court draws itself piece by piece, chaos path
   snakes in, chips pop along it, then the auto advance to the clean line
   (kept exactly, incl. the wayTouched guard). Reuses main.js's setWay and
   drawPath through the handover surface rather than reimplementing. 3.7. */

export default function init(ctx) {
  const { gsap } = ctx;
  const section = document.querySelector(".oldway");
  if (!section) { return; }

  ctx.q("[data-reveal]", section).forEach((el) => el.classList.add("is-in"));

  const basic = window.__atlitosBasic || {};
  const court = section.querySelector("svg.court");
  const courtLines = court ? ctx.q(".court-line", court) : [];
  const tags = ctx.q(".way-labels-old .way-tag", section);
  const goal = court ? court.querySelector(".way-goal") : null;

  /* seed court strokes for drawing */
  courtLines.forEach((p) => {
    const len = p.getTotalLength ? p.getTotalLength() : 0;
    if (!len) { return; }
    p.style.strokeDasharray = String(len);
    p.style.strokeDashoffset = String(len);
  });

  const tl = gsap.timeline({
    scrollTrigger: { trigger: section, start: "top 62%", once: true },
  });
  courtLines.forEach((p, i) => {
    tl.to(p, { strokeDashoffset: 0, duration: 0.7, ease: "power2.inOut" }, i * 0.15);
  });
  tl.add(() => { if (basic.drawPath) { basic.drawPath(document.getElementById("pathOld")); } }, 0.9);
  tl.fromTo(tags,
    { opacity: 0, scale: 0.4 },
    { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.6)", stagger: 0.12 }, 1.4);
  if (goal) {
    tl.fromTo(goal, { scale: 0.2, transformOrigin: "center" },
      { scale: 1, duration: 0.35, ease: "back.out(2)" }, 2.0);
  }
  /* the auto advance to the clean way lives in main.js and is not rich-gated
     (same behaviour both modes); nothing to do here */
}
