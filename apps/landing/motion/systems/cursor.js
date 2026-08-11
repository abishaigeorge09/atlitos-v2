/* TARGET LOCK. The dot+ring cursor was rejected by the founder as a stock
   award-site trope. This is the replacement: the NATIVE cursor stays, and
   hovering any interactive element snaps four broadcast-style corner
   brackets around it, like a replay camera locking on. The brackets spring
   between targets (they travel, not blink), pulse once on lock, and fade
   when the pointer is over open ground. Pointer-fine only. */

export default function init(ctx) {
  const { gsap } = ctx;
  if (!window.matchMedia("(pointer: fine)").matches) { return; }

  const lock = document.createElement("div");
  lock.className = "target-lock";
  lock.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i++) {
    const c = document.createElement("i");
    c.className = "tl-corner tl-" + i;
    lock.appendChild(c);
  }
  document.body.appendChild(lock);

  const pos = { x: gsap.quickTo(lock, "x", { duration: 0.32, ease: "expo.out" }),
                y: gsap.quickTo(lock, "y", { duration: 0.32, ease: "expo.out" }),
                w: gsap.quickTo(lock, "width", { duration: 0.32, ease: "expo.out" }),
                h: gsap.quickTo(lock, "height", { duration: 0.32, ease: "expo.out" }) };

  const SELECTOR = "a, button, .vcard, .plan, .persona, .kit-tile, .notif, [data-magnetic]";
  let current = null;
  let raf = null;

  const track = () => {
    raf = null;
    if (!current || !current.isConnected) { return; }
    const r = current.getBoundingClientRect();
    const pad = Math.min(10, Math.max(5, r.width * 0.03));
    pos.x(r.left - pad);
    pos.y(r.top - pad);
    pos.w(r.width + pad * 2);
    pos.h(r.height + pad * 2);
    raf = requestAnimationFrame(track);
  };

  const onOver = (e) => {
    const t = e.target.closest(SELECTOR);
    if (t === current) { return; }
    current = t;
    if (t) {
      const first = !lock.classList.contains("is-locked");
      lock.classList.add("is-locked");
      if (first) {
        /* first acquisition: appear AT the target, no cross-screen flight */
        const r = t.getBoundingClientRect();
        gsap.set(lock, { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 });
      }
      /* lock pulse: corners overshoot in then settle */
      gsap.fromTo(lock.children,
        { scale: 1.6, opacity: 0.4 },
        { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(2.2)", overwrite: true });
      if (raf === null) { raf = requestAnimationFrame(track); }
    } else {
      lock.classList.remove("is-locked");
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    }
  };

  window.addEventListener("pointerover", onOver, { passive: true });
  document.addEventListener("scroll", () => {
    /* brackets chase the target through scroll via the same rAF track */
  }, { passive: true });

  ctx.onCleanup(() => {
    window.removeEventListener("pointerover", onOver);
    if (raf !== null) { cancelAnimationFrame(raf); }
    lock.remove();
  });
}
