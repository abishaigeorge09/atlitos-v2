/* Custom cursor: 8px ember dot + 34px lagging ink ring. Ring grows and fills
   marigold with a mono label over [data-cursor] targets. The lag between the
   two followers IS the effect. Hidden on touch, reduced motion, and during
   text selection; native cursor preserved on form controls (cursor: none is
   scoped in CSS). Labels allowed: VIEW, BOOK, PLAY, OPEN. Spec: 5.2. */

export default function init(ctx) {
  const { gsap } = ctx;
  if (!window.matchMedia("(pointer: fine)").matches) { return; }

  const dot = document.createElement("div");
  dot.className = "cur-dot";
  const ring = document.createElement("div");
  ring.className = "cur-ring";
  const ringLabel = document.createElement("span");
  ringLabel.className = "cur-label mono";
  ring.appendChild(ringLabel);
  document.body.append(dot, ring);
  document.documentElement.classList.add("has-cursor");

  const dx = gsap.quickTo(dot, "x", { duration: 0.12, ease: "power3.out" });
  const dy = gsap.quickTo(dot, "y", { duration: 0.12, ease: "power3.out" });
  const rx = gsap.quickTo(ring, "x", { duration: 0.35, ease: "power3.out" });
  const ry = gsap.quickTo(ring, "y", { duration: 0.35, ease: "power3.out" });

  const onMove = (e) => {
    dx(e.clientX); dy(e.clientY);
    rx(e.clientX); ry(e.clientY);
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  /* label targets via event delegation so late-added nodes work */
  const ALLOWED = ["VIEW", "BOOK", "PLAY", "OPEN"];
  const onOver = (e) => {
    const t = e.target.closest("[data-cursor]");
    if (t) {
      const label = (t.getAttribute("data-cursor") || "").toUpperCase();
      if (ALLOWED.includes(label)) {
        ringLabel.textContent = label;
        ring.classList.add("is-big");
      }
    } else {
      ring.classList.remove("is-big");
    }
  };
  window.addEventListener("pointerover", onOver, { passive: true });

  /* hide during selection, restore after */
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    const hidden = sel && !sel.isCollapsed;
    dot.classList.toggle("is-hidden", hidden);
    ring.classList.toggle("is-hidden", hidden);
  });

  ctx.onCleanup(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerover", onOver);
    dot.remove(); ring.remove();
    document.documentElement.classList.remove("has-cursor");
  });
}
