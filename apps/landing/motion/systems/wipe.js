/* Speed-line section wipes. Three skewed bars sweep the viewport once when a
   boundary section enters. Budgeted to exactly three boundaries (Steps,
   Pricing, Empower); using it everywhere turns it into wallpaper. Spec: 5.9. */

export function speedLineWipe(trigger, ctx, opts = {}) {
  const { gsap, ScrollTrigger } = ctx;
  const colors = opts.colors || ["--ember", "--marigold", "--green"];
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  const barCount = isMobile ? 2 : (opts.bars || 3);
  const angle = opts.angle == null ? -18 : opts.angle;

  const wrap = document.createElement("div");
  wrap.className = "wipe-wrap";
  wrap.setAttribute("aria-hidden", "true");
  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement("i");
    bar.className = "wipe-bar";
    bar.style.background = `var(${colors[i % colors.length]})`;
    bar.style.top = `${(100 / (barCount + 1)) * (i + 1)}%`;
    bar.style.transform = `skewY(${angle}deg) translateX(-140%)`;
    wrap.appendChild(bar);
  }
  document.body.appendChild(wrap);

  ScrollTrigger.create({
    trigger,
    start: "top 80%",
    once: true,
    onEnter: () => {
      gsap.to(wrap.children, {
        x: () => window.innerWidth * 2.8,
        duration: 0.9,
        ease: "power4.inOut",
        stagger: 0.06,
        onComplete: () => wrap.remove(),
      });
    },
  });

  ctx.onCleanup(() => wrap.remove());
}
