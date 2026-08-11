/* Steps. THE STICKING STAYS CSS STICKY, never a pin (D3, the founder's
   pixel-matched mechanic). GSAP drives only what happens INSIDE each file:
   tab slide, copy line masks, demo rows stamping, XP fill, outgoing panel
   recession, and the marigold wipe at the section boundary. Spec: 3.5. */

import { speedLineWipe } from "../systems/wipe.js";

export default function init(ctx) {
  const { gsap, SplitText } = ctx;
  const wrap = document.querySelector(".steps-wrap");
  if (!wrap) { return; }

  const files = ctx.q(".step-file", wrap);
  speedLineWipe(wrap, ctx, { colors: ["--marigold", "--ember", "--green"] });

  files.forEach((file, idx) => {
    ctx.q("[data-reveal]", file).forEach((el) => el.classList.add("is-in"));

    const tab = file.querySelector(".step-tab");
    const rows = ctx.q(".demo-card .d-row, .demo-card .d-xp", file);
    const copyBlocks = ctx.q(".step-lede, .stack-list", file);
    const xpFill = file.querySelector(".xp-bar i");

    const tl = gsap.timeline({
      scrollTrigger: { trigger: file, start: "top 62%", once: true },
    });
    if (tab) {
      tl.fromTo(tab,
        { x: [-40, 0, 40][idx] || 0, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0);
    }
    tl.fromTo(copyBlocks,
      { opacity: 0, y: 26 },
      { opacity: 1, y: 0, duration: 0.6, ease: "expo.out", stagger: 0.07 }, 0.1);
    tl.fromTo(rows,
      { opacity: 0, scale: 0.6, y: 14 },
      { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: "back.out(1.5)", stagger: 0.09 }, 0.25);
    if (xpFill) {
      tl.fromTo(xpFill, { width: "0%" }, { width: "65%", duration: 1.1, ease: "power2.out" }, 0.6);
    }

    /* line masks on the step copy once fonts settle: upgrade the plain rise
       above to per-line masks for the lede only (stack-lists stay blocks) */
    const lede = file.querySelector(".step-lede");
    if (lede) {
      ctx.splitReady.then(() => { /* lede is short; block rise reads fine, skip splitting */ });
    }

    /* outgoing panel dims and recedes as the next file covers it. Desktop
       only; below 900px the files are static blocks. */
    if (idx < files.length - 1) {
      ctx.mm.add("(min-width: 901px)", () => {
        const panel = file.querySelector(".step-panel");
        const next = files[idx + 1];
        if (!panel || !next) { return; }
        gsap.fromTo(panel,
          { opacity: 1, scale: 1 },
          {
            opacity: 0.55, scale: 0.985,
            transformOrigin: "50% 20%",
            ease: "none",
            scrollTrigger: {
              trigger: next,
              start: "top bottom",
              end: "top top",
              scrub: 0.5,
            },
          });
      });
    }
  });
}
