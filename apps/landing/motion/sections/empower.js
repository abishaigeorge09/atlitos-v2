/* EMPOWER: THE ORBIT. The page's ONE pin, under the R1 recipe verbatim, and
   the one WebGL scene (worker-side, lazy). Scrubbed story: headline lands,
   the ₹293 card compresses toward the ball, +₹7 splits off into orbit, the
   orbit tightens while stats count, the photo blooms, the roundup line types.
   Mobile <=900px: NO pin, the beats fire as plain staggered reveals.
   Reduced motion never reaches this module (mode gate in motion/index.js). */

export default function init(ctx) {
  const { gsap, ScrollTrigger } = ctx;
  const section = document.querySelector(".empower");
  if (!section) { return; }

  const pinWrap = section.querySelector(".emp-pin-wrap");
  const stage = section.querySelector(".emp-stage");
  const outro = section.querySelector(".emp-outro");
  if (!pinWrap || !stage) { return; }

  ctx.q("[data-reveal]", section).forEach((el) => el.classList.add("is-in"));

  const stickers = ctx.q(".empower-head .sticker", stage);
  const note = stage.querySelector(".empower-note");
  const cards = ctx.q(".emp-card", stage);
  const arrows = ctx.q(".emp-arrow", stage);
  const stats = ctx.q(".emp-stat", stage);
  const emp3d = stage.querySelector("#emp3d");
  const roundup = stage.querySelector(".roundup-line");

  /* seed arrow strokes */
  arrows.forEach((svg) => {
    ctx.q(".a-path", svg).forEach((p) => {
      const len = p.getTotalLength();
      p.style.transition = "none";
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });
  });

  /* stat count ups driven by the timeline (not the main.js IO) */
  const formatIN = (window.__atlitosBasic || {}).formatIN || String;
  const statTweens = ctx.q(".emp-stat .ru", stage).map((el) => {
    const target = parseInt(el.getAttribute("data-count"), 10) || 0;
    const prefix = el.getAttribute("data-prefix") || "";
    const obj = { v: 0 };
    return gsap.to(obj, {
      v: target, duration: 1, ease: "power3.out", paused: true, snap: { v: 1 },
      onUpdate: () => { el.textContent = prefix + formatIN(Math.round(obj.v)); },
    });
  });

  /* The orbit mounts HERE, inside the deferred boot chain (this module is
     already idle-loaded), and the returned promise is awaited by the boot so
     html.motion-full only appears once the worker is spawned. Mounting on a
     separate timer measured 85-160ms frames whenever it raced a scroll. All
     gating (mobile, saveData, WebGL) lives inside mountOrbit. */
  let orbit = null;
  let mountReady = Promise.resolve();
  if (emp3d) {
    mountReady = import("../three/empower-orbit.js").then((mod) => {
      orbit = mod.mountOrbit(emp3d);
      if (orbit) { orbit.setVisible(false); } /* render only when seen */
    }).catch(() => { /* fallback circle stays */ });
  }
  ctx.onCleanup(() => { if (orbit) { orbit.dispose(); } });

  /* visibility gate for the worker's render loop */
  const visIO = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (orbit) { orbit.setVisible(entry.isIntersecting && document.visibilityState === "visible"); } });
  });
  visIO.observe(section);
  ctx.onCleanup(() => visIO.disconnect());

  /* ---------- desktop: the one pin, R1 recipe verbatim ---------- */
  ctx.mm.add("(min-width: 901px)", () => {
    const tl = gsap.timeline({ paused: true });

    /* 0.00-0.18 headline + note */
    tl.fromTo(stickers, { opacity: 0, y: 40, rotate: -4 },
      { opacity: 1, y: 0, rotate: 0, duration: 0.1, stagger: 0.03, ease: "power2.out" }, 0);
    tl.fromTo(note, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.08 }, 0.06);
    /* 0.18-0.35 card 01 lands, first arrow draws */
    tl.fromTo(cards[0], { opacity: 0, y: 40, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.1 }, 0.18);
    if (arrows[0]) { tl.to(ctx.q(".a-path", arrows[0]), { strokeDashoffset: 0, duration: 0.09 }, 0.26); }
    /* 0.35-0.52 card 02 (+₹7) splits off, coins enter orbit (worker reads p) */
    tl.fromTo(cards[1], { opacity: 0, x: -30, scale: 0.9 }, { opacity: 1, x: 0, scale: 1, duration: 0.1 }, 0.35);
    if (arrows[1]) { tl.to(ctx.q(".a-path", arrows[1]), { strokeDashoffset: 0, duration: 0.09 }, 0.44); }
    /* 0.52-0.72 orbit tightens (worker), stats count in sequence */
    tl.fromTo(stats, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.08, stagger: 0.05 }, 0.52);
    tl.add(() => statTweens.forEach((t, i) => setTimeout(() => t.play(), i * 220)), 0.56);
    /* 0.72-0.88 the photo card blooms */
    tl.fromTo(cards[2], { opacity: 0, scale: 0.7, clipPath: "inset(30% 30% 30% 30% round 18px)" },
      { opacity: 1, scale: 1, clipPath: "inset(0% 0% 0% 0% round 18px)", duration: 0.12 }, 0.72);
    /* 0.88-1.00 roundup line rises, ball settles */
    tl.fromTo(roundup, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.1 }, 0.88);

    const st = ScrollTrigger.create({
      trigger: pinWrap,
      start: "top top",
      end: "+=180%",
      pin: stage,
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      scrub: 0.8,
      animation: tl,
      onUpdate: (self) => { if (orbit) { orbit.setProgress(self.progress); } },
      onLeave: () => tl.progress(1),
      onLeaveBack: () => tl.progress(0),
    });

    /* outro rises after the pin releases */
    if (outro) {
      gsap.fromTo(outro.children, { opacity: 0, y: 30 },
        {
          opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.08,
          scrollTrigger: { trigger: outro, start: "top 90%", once: true },
        });
    }

    return () => { st.kill(); };
  });

  /* ---------- mobile: no pin, same beats as staggered reveals ---------- */
  ctx.mm.add("(max-width: 900px)", () => {
    const groups = [
      [...stickers, note],
      [cards[0], arrows[0]].filter(Boolean),
      [cards[1], arrows[1]].filter(Boolean),
      stats,
      [cards[2]].filter(Boolean),
      [roundup].filter(Boolean),
    ];
    groups.forEach((els) => {
      if (!els.length) { return; }
      gsap.fromTo(els, { opacity: 0, y: 30 }, {
        opacity: 1, y: 0, duration: 0.55, ease: "power3.out", stagger: 0.08,
        scrollTrigger: { trigger: els[0], start: "top 82%", once: true },
        onComplete: () => {
          els.forEach((el) => {
            if (el.classList && el.classList.contains("emp-arrow")) {
              ctx.q(".a-path", el).forEach((p) => { p.style.strokeDashoffset = "0"; });
            }
          });
        },
      });
    });
    /* stats count when they arrive */
    ScrollTrigger.create({
      trigger: stats[0] || stage, start: "top 85%", once: true,
      onEnter: () => statTweens.forEach((t, i) => setTimeout(() => t.play(), i * 220)),
    });
  });

  /* boot awaits this so motion-full means the worker is spawned too */
  return mountReady;
}
