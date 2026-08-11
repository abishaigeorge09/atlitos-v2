/* Lower page small sections in one module: strip shutter, pricing, voices
   hover, personas deal, footer. Split out if any grows past a screen. 3.9,
   3.10, 3.11, 3.12, 3.14. */

import { speedLineWipe } from "../systems/wipe.js";

export default function init(ctx) {
  const { gsap, SplitText } = ctx;

  /* ---------- strip: shutter open on entry (marquee itself is P2) ---------- */
  const strip = document.querySelector(".strip");
  if (strip) {
    gsap.fromTo(strip,
      { scaleY: 0.4, transformOrigin: "50% 100%" },
      {
        scaleY: 1, duration: 0.5, ease: "power4.out",
        scrollTrigger: { trigger: strip, start: "top 88%", once: true },
      });
  }

  /* ---------- pricing ---------- */
  const pricing = document.querySelector(".pricing");
  if (pricing) {
    ctx.q("[data-reveal]", pricing).forEach((el) => el.classList.add("is-in"));
    speedLineWipe(pricing, ctx, { colors: ["--green", "--marigold", "--ember"] });

    /* checklist: checks draw, labels slide */
    const items = ctx.q(".incl-card li", pricing);
    items.forEach((li) => {
      const check = li.querySelector(".check path");
      if (check) {
        const len = check.getTotalLength();
        check.style.strokeDasharray = String(len);
        check.style.strokeDashoffset = String(len);
      }
    });
    gsap.timeline({
      scrollTrigger: { trigger: pricing.querySelector(".incl-card"), start: "top 74%", once: true },
    })
      .fromTo(items, { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.35, ease: "power3.out", stagger: 0.08 }, 0)
      .to(items.map((li) => li.querySelector(".check path")).filter(Boolean),
        { strokeDashoffset: 0, duration: 0.3, ease: "power2.out", stagger: 0.08 }, 0.1);

    /* plan cards rise; Pro overshoots further so it reads as the pick */
    const plans = ctx.q(".plan, .plan-enterprise", pricing);
    plans.forEach((plan) => {
      const isPro = plan.classList.contains("plan-pro");
      gsap.fromTo(plan,
        { opacity: 0, y: isPro ? 64 : 44 },
        {
          opacity: 1, y: 0, duration: 0.65,
          ease: isPro ? "back.out(1.6)" : "back.out(1.2)",
          scrollTrigger: { trigger: plan, start: "top 82%", once: true },
        });
    });

    /* price count ups, Indian grouping, skip Starter's zero */
    const formatIN = (window.__atlitosBasic || {}).formatIN || String;
    ctx.q(".plan .price .mono", pricing).forEach((el) => {
      const target = parseInt(el.textContent.replace(/[^\d]/g, ""), 10);
      if (!target) { return; } // Starter counts to 0, a no op, skip
      const obj = { v: 0 };
      gsap.to(obj, {
        v: target, duration: 1.0, ease: "power3.out",
        snap: { v: 1 },
        scrollTrigger: { trigger: el, start: "top 85%", once: true },
        onUpdate: () => { el.textContent = "₹" + formatIN(Math.round(obj.v)); },
      });
    });
  }

  /* ---------- voices: hover lift (rows/skew are P2 systems) ---------- */
  ctx.q(".vcard").forEach((card) => {
    card.addEventListener("pointerenter", () => {
      gsap.to(card, { y: -6, duration: 0.25, ease: "power2.out" });
    });
    card.addEventListener("pointerleave", () => {
      gsap.to(card, { y: 0, duration: 0.3, ease: "power2.out" });
    });
  });

  /* ---------- personas: cards deal in like a hand ---------- */
  const personas = document.querySelector(".personas");
  if (personas) {
    ctx.q("[data-reveal]", personas).forEach((el) => el.classList.add("is-in"));
    const cards = ctx.q(".persona", personas);
    gsap.fromTo(cards,
      { opacity: 0, y: 60, rotate: (i) => -8 + i * 4, transformOrigin: "50% 100%" },
      {
        opacity: 1, y: 0, rotate: 0, duration: 0.8, ease: "power4.out", stagger: 0.1,
        scrollTrigger: { trigger: personas.querySelector(".persona-grid"), start: "top 78%", once: true },
      });
    /* horizontal drift with scroll, alternating */
    ctx.mm.add("(min-width: 901px)", () => {
      cards.forEach((card, i) => {
        gsap.fromTo(card,
          { x: i % 2 ? 20 : -20 },
          {
            x: i % 2 ? -20 : 20,
            ease: "none",
            scrollTrigger: { trigger: personas, start: "top bottom", end: "bottom top", scrub: 1 },
          });
      });
    });
  }

  /* ---------- footer ---------- */
  const footer = document.querySelector(".site-footer");
  const mark = document.getElementById("giantMark");
  if (footer && mark) {
    if (window.__atlitosBasic && window.__atlitosBasic.disableMarkParallax) {
      window.__atlitosBasic.disableMarkParallax();
    }
    ctx.q("[data-reveal]", footer).forEach((el) => el.classList.add("is-in"));

    gsap.fromTo(mark,
      { yPercent: 34 },
      {
        yPercent: 0,
        ease: "none",
        scrollTrigger: { trigger: footer, start: "top bottom", end: "bottom bottom", scrub: 0.5 },
      });

    /* footer link columns rise */
    gsap.fromTo(ctx.q(".site-footer nav, .newsletter", footer),
      { opacity: 0, y: 26 },
      {
        opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.07,
        scrollTrigger: { trigger: footer, start: "top 85%", once: true },
      });

    /* tagline accent cycle: ember -> marigold -> green, one highlighted at a
       time. Colors resolved from the token set, never raw hex (house rule). */
    const accents = ctx.q(".tagline .accent", footer);
    if (accents.length) {
      const css = getComputedStyle(document.documentElement);
      const tokens = ["--ember", "--marigold", "--green"].map((t) => css.getPropertyValue(t).trim());
      const base = tokens[0];
      let idx = 0;
      const iv = setInterval(() => {
        if (document.visibilityState === "hidden") { return; }
        const r = footer.getBoundingClientRect();
        if (r.top > innerHeight || r.bottom < 0) { return; }
        idx = (idx + 1) % accents.length;
        accents.forEach((el, i) => {
          gsap.to(el, { color: i === idx ? tokens[i % tokens.length] : base, duration: 0.4, ease: "power2.inOut" });
        });
      }, 2400);
      ctx.onCleanup(() => clearInterval(iv));
    }
  }
}
