/* Header: rich mode replaces the raw scroll listener with a single
   ScrollTrigger direction watcher. Standing order from LANDING-NOTES.md:
   bidirectional, tucks on scroll down, reopens on ANY scroll up, always open
   near the top. Unchanged behaviour, better frame pacing. */

export default function init(ctx) {
  const { ScrollTrigger } = ctx;
  const header = document.getElementById("siteHeader");
  if (!header) { return; }

  /* take over from main.js */
  if (window.__atlitosBasic && window.__atlitosBasic.disableNavScroll) {
    window.__atlitosBasic.disableNavScroll();
  }

  const docEl = document.documentElement;
  /* nav glass flips paper once scroll leaves the dark opening; .problem is
     the first light band (same boundary as the basic path in main.js) */
  const darkEnd = () => {
    const problem = document.querySelector(".problem");
    return problem ? problem.offsetTop - 120 : 90;
  };
  const st = ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate(self) {
      const y = self.scroll();
      docEl.classList.toggle("scrolled", y > darkEnd());
      if (y < 80) {
        header.classList.remove("compact");
      } else if (self.direction === 1) {
        header.classList.add("compact");
      } else if (self.direction === -1) {
        header.classList.remove("compact");
      }
    },
  });
  ctx.onCleanup(() => st.kill());
}
