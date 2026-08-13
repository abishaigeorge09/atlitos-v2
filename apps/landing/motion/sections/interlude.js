/* Interlude: the typed line becomes a SplitText char stagger (reads as typing
   but frame accurate), the three arrows draw with a GSAP-sequenced stagger.
   Spec: 3.4. */

export default function init(ctx) {
  const { gsap, SplitText } = ctx;
  const section = document.querySelector(".interlude");
  if (!section) { return; }

  ctx.q("[data-reveal]", section).forEach((el) => el.classList.add("is-in"));

  const typed = section.querySelector("[data-type]");
  const caret = section.querySelector(".caret");
  const arrows = ctx.q("svg.arrow", section);

  /* pre-seed the arrow strokes for drawing */
  arrows.forEach((svg) => {
    ctx.q(".a-path", svg).forEach((p) => {
      const len = p.getTotalLength();
      p.style.transition = "none";
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });
  });

  ctx.splitReady.then(() => {
    let chars = null;
    if (typed) {
      const split = SplitText.create(typed, { type: "chars" });
      chars = split.chars;
      gsap.set(chars, { opacity: 0 });
    }

    const tl = gsap.timeline({
      scrollTrigger: { trigger: section, start: "top 70%", once: true },
    });
    if (chars) {
      tl.to(chars, { opacity: 1, duration: 0.01, ease: "none", stagger: 0.035 }, 0);
      if (caret) {
        tl.fromTo(caret, { opacity: 1 }, { opacity: 1, duration: 0.01 }, 0);
      }
    }
    arrows.forEach((svg, i) => {
      ctx.q(".a-path", svg).forEach((p) => {
        tl.to(p, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" }, 0.4 + i * 0.18);
      });
    });
  });
}
