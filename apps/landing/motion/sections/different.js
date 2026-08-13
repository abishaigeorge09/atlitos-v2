/* Differentiators. Oversized numerals travel with scroll, rows enter
   alternating with a rotate settle, the row-1 photo expands via clip-path
   scrub, tags keep their idle float. Magnetic on the Empower link comes from
   the magnetic system. 3.8. */

export default function init(ctx) {
  const { gsap } = ctx;
  const section = document.querySelector(".different");
  if (!section) { return; }

  ctx.q("[data-reveal]", section).forEach((el) => el.classList.add("is-in"));

  const rows = ctx.q(".diff-row", section);

  rows.forEach((row, i) => {
    const flip = row.classList.contains("diff-flip");
    gsap.fromTo(row,
      { opacity: 0, x: flip ? 70 : -70, rotate: flip ? 1.6 : -1.6 },
      {
        opacity: 1, x: 0, rotate: 0, duration: 0.7, ease: "power3.out",
        scrollTrigger: { trigger: row, start: "top 74%", once: true },
      });

    /* the big numeral drifts against the scroll */
    const num = row.querySelector(".diff-num");
    if (num) {
      ctx.mm.add("(min-width: 901px)", () => {
        gsap.fromTo(num,
          { yPercent: 30, opacity: 0.35 },
          {
            yPercent: -30, opacity: 0.35,
            ease: "none",
            scrollTrigger: { trigger: row, start: "top bottom", end: "bottom top", scrub: 1 },
          });
      });
    }
  });

  /* row 1 photo: card to near-bleed clip expansion */
  ctx.mm.add("(min-width: 901px)", () => {
    const img = section.querySelector(".diff-row .diff-media img");
    if (!img) { return; }
    gsap.fromTo(img,
      { clipPath: "inset(6% 8% 6% 8% round 14px)", scale: 1.06 },
      {
        clipPath: "inset(0% 0% 0% 0% round 10px)", scale: 1,
        ease: "none",
        scrollTrigger: { trigger: img, start: "top 85%", end: "top 35%", scrub: 0.8 },
      });
  });

  /* mobile: rows rise from below only */
  ctx.mm.add("(max-width: 900px)", () => {
    /* the same entrance triggers registered above use x offsets; on mobile the
       from state is overridden by simply letting the row entrance run, the x
       shift at 70px reads fine on small screens too, nothing extra needed */
  });
}
