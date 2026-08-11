/* Features band: arch rise scrub, GSAP loop typewriter, notification cards
   slide in then CYCLE (top card lifts out and reinserts at the bottom) while
   the section is visible. Spec: 3.6. */

export default function init(ctx) {
  const { gsap, SplitText } = ctx;
  const section = document.querySelector(".features");
  if (!section) { return; }

  ctx.q("[data-reveal]", section).forEach((el) => el.classList.add("is-in"));

  /* band arch rises slightly as it enters */
  ctx.mm.add("(min-width: 901px)", () => {
    gsap.fromTo(section,
      { yPercent: 8 },
      {
        yPercent: 0,
        ease: "none",
        scrollTrigger: { trigger: section, start: "top bottom", end: "top 40%", scrub: 0.8 },
      });
  });

  /* looping headline typewriter on the GSAP clock */
  const typed = section.querySelector("[data-type-loop]");
  if (typed) {
    ctx.splitReady.then(() => {
      const split = SplitText.create(typed, { type: "chars" });
      gsap.set(split.chars, { opacity: 0 });
      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 2.6,
        scrollTrigger: { trigger: section, start: "top 75%", toggleActions: "play pause resume pause" },
      });
      tl.to(split.chars, { opacity: 1, duration: 0.01, ease: "none", stagger: 0.038 });
      tl.to({}, { duration: 0.05 }); // hold the full line one beat before repeat
      ctx.onCleanup(() => tl.kill());
    });
  }

  /* notification stack: slide in, then cycle every 3.2s while visible */
  const col = section.querySelector(".notif-col");
  const notifs = ctx.q(".notif", section);
  if (col && notifs.length > 1) {
    gsap.fromTo(notifs,
      { opacity: 0, x: 60 },
      {
        opacity: 1, x: 0, duration: 0.5, ease: "back.out(1.2)", stagger: 0.12,
        scrollTrigger: { trigger: col, start: "top 78%", once: true },
      });

    let cycling = false;
    const cycle = () => {
      if (cycling) { return; }
      cycling = true;
      const first = col.firstElementChild;
      const h = first.offsetHeight + 16; // gap
      gsap.to(first, {
        opacity: 0, y: -24, duration: 0.3, ease: "power3.in",
        onComplete: () => {
          col.appendChild(first);
          gsap.fromTo(first, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" });
          /* the remaining cards ride up via FLIP-lite: from their old offset */
          ctx.q(".notif", col).slice(0, -1).forEach((el) => {
            gsap.fromTo(el, { y: h }, { y: 0, duration: 0.45, ease: "power3.inOut" });
          });
          cycling = false;
        },
      });
    };
    const iv = setInterval(() => {
      if (document.visibilityState === "hidden") { return; }
      const r = col.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) { return; }
      cycle();
    }, 3200);
    ctx.onCleanup(() => clearInterval(iv));
  }
}
