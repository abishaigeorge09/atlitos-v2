/* COLD OPEN hero. Load choreography per MOTION-ARCHITECTURE.md section 2.2,
   scroll parallax per 2.3. The CSS owns the hidden states under
   html.js:not(.hero-ready); this module animates FROM those states and then
   adds hero-ready so CSS and JS agree on the final state forever after. */

export default function init(ctx) {
  const { gsap, ScrollTrigger } = ctx;
  const hero = document.querySelector(".hero");
  if (!hero) { return; }

  const docEl = document.documentElement;
  const lines = ctx.q(".hl", hero);
  const panel = hero.querySelector(".hero-panel");
  const inners = ctx.q(".hh-inner", hero);
  const tiles = ctx.q(".kit-tile", hero);
  const rail = hero.querySelector(".hero-rail");

  /* ----- load choreography -----
     GOTCHA: the CSS hidden states use percentage translates (translateY(110%),
     translateX(-140%)). GSAP parses those into PIXEL x/y, so every fromTo must
     explicitly zero the parsed px axis (x: 0 / y: 0) or a stale pixel offset
     survives the tween as a second transform component. Found the hard way. */
  const allAnimated = () => [...lines, ...inners, ...tiles, panel, rail].filter(Boolean);
  const tl = gsap.timeline({
    defaults: { ease: "power3.out" },
    onComplete: () => {
      docEl.classList.add("hero-ready");
      /* CSS owns the final state; drop every inline style GSAP wrote so the
         two systems cannot disagree (the scrub below re-writes what it needs) */
      gsap.set(allAnimated(), { clearProps: "all" });
    },
  });

  /* speed lines sweep through, then all but hl-2 dissolve */
  tl.fromTo(lines,
    { x: 0, xPercent: -140, opacity: 1 },
    { xPercent: 0, duration: 0.7, ease: "power4.inOut", stagger: 0.05 }, 0);
  tl.to(lines.filter((l) => !l.classList.contains("hl-2")),
    { opacity: 0, duration: 0.45, ease: "power2.out" }, 0.85);
  tl.to(lines.filter((l) => l.classList.contains("hl-2")),
    { height: 2, top: "78%", duration: 0.6, ease: "power3.inOut" }, 0.85);

  /* headline rises from its line masks */
  tl.fromTo(inners,
    { y: 0, yPercent: 110 },
    { yPercent: 0, duration: 0.9, ease: "expo.out", stagger: 0.09 }, 0.15);

  /* duotone panel wipes in */
  if (panel) {
    tl.fromTo(panel,
      { clipPath: "polygon(18% 0, 18% 0, 0 94%, 0 94%)", opacity: 1, scale: 1.08 },
      { clipPath: "polygon(18% 0, 100% 6%, 92% 100%, 0 94%)", scale: 1, duration: 1.0 }, 0.45);
  }

  /* kit tiles drop */
  tl.fromTo(tiles,
    { opacity: 0, y: -60, rotateX: -50 },
    { opacity: 1, y: 0, rotateX: 0, duration: 0.8, ease: "back.out(1.7)", stagger: 0.07 }, 0.7);

  /* rail and nav */
  if (rail) { tl.fromTo(rail, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 1.05); }

  /* If the 1800ms main.js fallback fires first, kill the timeline mid flight;
     CSS final states have already taken over and fighting them causes a
     double-jump. */
  const guard = setInterval(() => {
    if (docEl.classList.contains("hero-ready") && tl.progress() < 1) {
      tl.kill();
      clearInterval(guard);
      /* clear inline styles so the CSS final states win outright */
      gsap.set(allAnimated(), { clearProps: "all" });
    }
    if (tl.progress() >= 1) { clearInterval(guard); }
  }, 200);
  ctx.onCleanup(() => clearInterval(guard));

  /* ----- scroll parallax (desktop; cheap enough for mobile at reduced range) ----- */
  ctx.mm.add("(min-width: 901px)", () => {
    const headline = hero.querySelector(".hero-headline");
    const scrub = gsap.timeline({
      scrollTrigger: {
        trigger: hero,
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    });
    if (headline) { scrub.to(headline, { yPercent: -18, opacity: 0.15, ease: "none" }, 0); }
    if (panel) { scrub.to(panel, { yPercent: -30, ease: "none" }, 0); }
    if (tiles.length) { scrub.to(tiles, { y: -120, stagger: 0.03, ease: "none" }, 0); }
  });
  ctx.mm.add("(max-width: 900px)", () => {
    if (!panel) { return; }
    gsap.to(panel, {
      yPercent: -8,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true },
    });
  });

  /* ----- pointer tilt on the kit tiles ----- */
  if (window.matchMedia("(pointer: fine)").matches) {
    const setters = tiles.map((t) => ({
      rx: gsap.quickTo(t, "rotateX", { duration: 0.5, ease: "power3.out" }),
      ry: gsap.quickTo(t, "rotateY", { duration: 0.5, ease: "power3.out" }),
      el: t,
    }));
    const onMove = (e) => {
      setters.forEach((s) => {
        const r = s.el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < 220) {
          const f = 1 - dist / 220;
          s.ry(dx * 0.06 * f);
          s.rx(-dy * 0.06 * f);
        } else {
          s.ry(0); s.rx(0);
        }
      });
    };
    hero.addEventListener("pointermove", onMove);
    ctx.onCleanup(() => hero.removeEventListener("pointermove", onMove));
  }
}
