/* onVisibleFrame: the ONLY sanctioned way to run a continuous animation.
   The callback runs on the shared GSAP ticker, but only while the element's
   section intersects the viewport AND the tab is visible. This is the battery
   guard from MOTION-ARCHITECTURE.md section 6.3; nobody hand rolls their own
   requestAnimationFrame loop. Returns a dispose function. */

const watched = new Map(); // el -> { visible, fns:Set }

let io = null;

function ensureObserver() {
  if (io) { return io; }
  io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const rec = watched.get(entry.target);
      if (rec) { rec.visible = entry.isIntersecting; }
    });
  }, { rootMargin: "80px 0px 80px 0px" });
  return io;
}

export function onVisibleFrame(el, fn, { gsap }) {
  const observer = ensureObserver();
  let rec = watched.get(el);
  if (!rec) {
    rec = { visible: false, fns: new Set() };
    watched.set(el, rec);
    observer.observe(el);
  }

  const wrapped = (time, deltaTime) => {
    if (!rec.visible) { return; }
    if (document.visibilityState === "hidden") { return; }
    fn(time, deltaTime);
  };

  rec.fns.add(wrapped);
  gsap.ticker.add(wrapped);

  return function dispose() {
    gsap.ticker.remove(wrapped);
    rec.fns.delete(wrapped);
    if (rec.fns.size === 0) {
      observer.unobserve(el);
      watched.delete(el);
    }
  };
}
