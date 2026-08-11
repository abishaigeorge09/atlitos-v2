/* Chapter rail: six dots on the right edge, desktop only. Six chapters, not
   thirteen; a thirteen dot rail is a scrollbar with extra steps. Driven by
   one ScrollTrigger per chapter via onToggle. Click scrolls via Lenis with
   the nav offset, scrollIntoView when Lenis is absent. Spec: 5.7. */

const CHAPTERS = [
  ["OPEN", ".hero"],
  ["PROBLEM", ".problem"],
  ["HOW", ".steps-wrap"],
  ["WHY", ".different"],
  ["PRICING", ".pricing"],
  ["EMPOWER", ".empower"],
];

export default function init(ctx) {
  const { ScrollTrigger } = ctx;
  if (!window.matchMedia("(min-width: 901px)").matches) { return; }

  const rail = document.createElement("nav");
  rail.className = "chapter-rail";
  rail.setAttribute("aria-label", "Page chapters");

  const dots = CHAPTERS.map(([label, sel]) => {
    const target = document.querySelector(sel);
    if (!target) { return null; }
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "rail-dot";
    dot.innerHTML = `<i></i><span class="rail-label mono">${label}</span>`;
    dot.addEventListener("click", () => {
      if (ctx.lenis) { ctx.lenis.scrollTo(target, { offset: -72 }); }
      else { target.scrollIntoView({ block: "start" }); }
    });
    rail.appendChild(dot);
    return { dot, target };
  }).filter(Boolean);

  document.body.appendChild(rail);

  dots.forEach(({ dot, target }, i) => {
    const next = dots[i + 1];
    ScrollTrigger.create({
      trigger: target,
      start: "top 50%",
      endTrigger: next ? next.target : document.body,
      end: next ? "top 50%" : "bottom bottom",
      onToggle: (self) => dot.classList.toggle("is-active", self.isActive),
    });
  });

  ctx.onCleanup(() => rail.remove());
}
