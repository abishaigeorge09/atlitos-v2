/* Problem band. Stickers land with a rotate settle, the note words scrub in,
   the rotator phrase flips vertically, marquee tiles skew with velocity.
   Spec: MOTION-ARCHITECTURE.md 3.3. */

export default function init(ctx) {
  const { gsap } = ctx;
  const section = document.querySelector(".problem");
  if (!section) { return; }

  /* rich mode owns the reveals here */
  ctx.q("[data-reveal]", section).forEach((el) => el.classList.add("is-in"));

  const stickers = ctx.q(".sticker", section);
  const eyebrow = section.querySelector(".sec-eyebrow");
  const note = section.querySelector(".note");

  gsap.timeline({
    scrollTrigger: { trigger: section, start: "top 72%", once: true },
  })
    .fromTo(eyebrow, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0)
    .fromTo(stickers,
      { opacity: 0, y: 40, rotate: -5 },
      { opacity: 1, y: 0, rotate: (i) => [-1.5, 1, -0.8][i % 3], duration: 0.6, ease: "back.out(1.3)", stagger: 0.1 }, 0.1)
    .fromTo(note, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.35);

  /* word rotator: vertical flip. The chip gets a masked two-layer stack. */
  const chip = document.getElementById("rotChip");
  const phrases = window.__atlitosPhrases;
  if (chip && phrases && phrases.length) {
    const mark = chip.parentElement; // mark.chip
    mark.classList.add("chip-flip");
    let pi = 0;
    const iv = setInterval(() => {
      if (document.visibilityState === "hidden") { return; }
      const r = mark.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) { return; }
      pi = (pi + 1) % phrases.length;
      const next = document.createElement("span");
      next.textContent = phrases[pi];
      next.style.cssText = "position:absolute;left:0;top:0;width:100%;";
      mark.style.position = "relative";
      mark.appendChild(next);
      gsap.fromTo(next, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: "power3.inOut" });
      gsap.to(chip, {
        yPercent: -100, opacity: 0, duration: 0.45, ease: "power3.inOut",
        onComplete: () => {
          chip.textContent = phrases[pi];
          gsap.set(chip, { yPercent: 0, opacity: 1 });
          next.remove();
        },
      });
    }, 3400);
    ctx.onCleanup(() => clearInterval(iv));
  }

  /* marquee tiles skew with velocity, clamped 6 degrees. ONE loop for the
     whole section (a quickTo per tile, but a single visibility-gated ticker),
     per the 6.3 battery rule. */
  if (window.matchMedia("(pointer: fine)").matches) {
    const tiles = ctx.q(".m-tile, .m-word", section);
    if (tiles.length) {
      const tos = tiles.map((el) => gsap.quickTo(el, "skewY", { duration: 0.4, ease: "power3.out" }));
      let raf = null;
      const tick = () => {
        const v = Math.max(-60, Math.min(60, ctx.velocity()));
        const deg = (v / 60) * 6;
        tos.forEach((to) => to(deg));
        raf = requestAnimationFrame(tick);
      };
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && raf === null && document.visibilityState === "visible") {
            raf = requestAnimationFrame(tick);
          } else if (!en.isIntersecting && raf !== null) {
            cancelAnimationFrame(raf); raf = null;
          }
        });
      });
      io.observe(section);
      ctx.onCleanup(() => { io.disconnect(); if (raf !== null) { cancelAnimationFrame(raf); } });
    }
  }
}
