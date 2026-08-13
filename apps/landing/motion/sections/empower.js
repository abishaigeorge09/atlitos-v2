/* EMPOWER: THE COIN JOURNEY. The page's ONE pin, under the R1 recipe
   verbatim. As the pin scrubs, a rupee coin travels a dashed route that
   threads the three flow cards, the trail inking in green behind it: the
   ₹293 order, the +₹7 roundup, the athlete it reaches. Hand-drawn language,
   same family as the emp arrows. No WebGL (the founder killed the 3D ball).
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

  /* ---------- the coin journey (desktop, rides the pin scrub) ---------- */
  const flow = stage.querySelector(".emp-flow");
  let journey = null; // { setProgress(p 0..1) }
  const buildJourney = () => {
    if (!flow || cards.length < 3) { return null; }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("emp-journey");
    svg.setAttribute("aria-hidden", "true");
    const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
    track.classList.add("journey-track");
    const trail = document.createElementNS("http://www.w3.org/2000/svg", "path");
    trail.classList.add("journey-trail");
    svg.append(track, trail);
    flow.appendChild(svg);
    const coin = document.createElement("div");
    coin.className = "emp-coin mono";
    coin.textContent = "₹7";
    flow.appendChild(coin);

    let len = 0;
    const layout = () => {
      const fr = flow.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${Math.round(fr.width)} ${Math.round(fr.height) + 80}`);
      /* anchors: out of card 1, over the top of card 2, into the heart of
         card 3; playful arcs below then above then below the row */
      const pts = cards.map((c) => {
        const r = c.getBoundingClientRect();
        return {
          x: r.left - fr.left + r.width / 2,
          y: r.top - fr.top + r.height / 2,
          top: r.top - fr.top,
          bottom: r.bottom - fr.top,
        };
      });
      /* the mid anchor clears card 02's top edge so the coin never crosses
         its title; the arc dips below the row, crests above card 02, dips
         again, then lands in card 03 */
      const d = [
        `M ${pts[0].x - 30} ${pts[0].bottom - 20}`,
        `C ${pts[0].x + 90} ${pts[0].bottom + 56}, ${((pts[0].x + pts[1].x) / 2) - 40} ${pts[1].top - 90}, ${pts[1].x} ${pts[1].top - 34}`,
        `C ${pts[1].x + 120} ${pts[1].top + 10}, ${((pts[1].x + pts[2].x) / 2) + 20} ${pts[2].bottom + 52}, ${pts[2].x} ${pts[2].bottom - 30}`,
      ].join(" ");
      track.setAttribute("d", d);
      trail.setAttribute("d", d);
      len = trail.getTotalLength();
      trail.style.strokeDasharray = String(len);
      trail.style.strokeDashoffset = String(len);
    };
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    ctx.onCleanup(() => { window.removeEventListener("resize", onResize); svg.remove(); coin.remove(); });

    let lastP = -1;
    return {
      setProgress(p) {
        if (!len) { return; }
        const clamped = Math.max(0, Math.min(1, p));
        /* skip sub-pixel updates; every write repaints the SVG stroke */
        if (Math.abs(clamped - lastP) < 0.0015) { return; }
        lastP = clamped;
        coin.classList.toggle("is-live", clamped > 0.001 && clamped < 0.999);
        const pt = trail.getPointAtLength(clamped * len);
        coin.style.transform = `translate(${pt.x}px, ${pt.y}px) rotate(${clamped * 540}deg)`;
        trail.style.strokeDashoffset = String(len * (1 - clamped));
      },
    };
  };

  /* ---------- desktop: the one pin, R1 recipe verbatim ---------- */
  ctx.mm.add("(min-width: 901px)", () => {
    journey = buildJourney();
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
      onUpdate: (self) => {
        if (journey) {
          /* the coin rides between card 01 landing and the photo bloom */
          journey.setProgress((self.progress - 0.2) / (0.88 - 0.2));
        }
      },
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

}
