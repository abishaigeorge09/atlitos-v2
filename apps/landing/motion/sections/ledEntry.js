/* Meet Atlitos title card. SplitText word masks on the headline, word scrub
   on the sub line, CTA rise. The data-reveal attributes stay in the markup so
   basic mode still reveals everything; rich mode pre-adds is-in and runs its
   own choreography instead. */

export default function init(ctx) {
  const { gsap, SplitText } = ctx;
  const section = document.querySelector(".led-entry");
  if (!section) { return; }

  const title = section.querySelector("#led-entry-title");
  const sub = section.querySelector(".led-entry-sub");
  const ctas = ctx.q(".cta-row > *", section);
  const eyebrow = section.querySelector(".sec-eyebrow");

  /* rich mode owns these elements; freeze the basic reveal to its shown state
     so the two systems never double-animate the same nodes */
  ctx.q("[data-reveal]", section).forEach((el) => el.classList.add("is-in"));

  ctx.splitReady.then(() => {
    if (!title) { return; }
    const split = SplitText.create(title, { type: "words", mask: "words" });

    gsap.timeline({
      scrollTrigger: { trigger: section, start: "top 70%", once: true },
      defaults: { ease: "expo.out" },
    })
      .fromTo(eyebrow, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0)
      .fromTo(split.words,
        { yPercent: 115 },
        { yPercent: 0, duration: 0.9, stagger: 0.08 }, 0.1)
      .fromTo(ctas,
        { opacity: 0, y: 26 },
        { opacity: 1, y: 0, duration: 0.55, ease: "power3.out", stagger: 0.08 }, 0.5);
  });

  /* sub line: word scrub, opacity 0.2 -> 1 as the block crosses the centre */
  ctx.mm.add("(min-width: 901px)", () => {
    if (!sub) { return; }
    ctx.splitReady.then(() => {
      const words = SplitText.create(sub, { type: "words" }).words;
      gsap.fromTo(words,
        { opacity: 0.2 },
        {
          opacity: 1,
          stagger: 0.06,
          ease: "none",
          scrollTrigger: {
            trigger: sub,
            start: "top 85%",
            end: "top 45%",
            scrub: 0.6,
          },
        });
    });
  });
}
