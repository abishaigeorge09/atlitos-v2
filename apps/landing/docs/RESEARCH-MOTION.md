# Motion research report (agent output, 2026-08-11)

## 1. Recommended library stack (static HTML, vanilla JS, all CDN-loadable)

| Library | Version | Size (min+gz) | Why |
|---|---|---|---|
| GSAP core | 3.13.x | ~27KB | The engine. Since Webflow acquired GreenSock, GSAP is 100% free including ALL formerly-paid Club plugins as of April 2025 (SplitText, MorphSVG, DrawSVG, ScrollSmoother, etc). |
| ScrollTrigger | bundled 3.13 | ~14KB | Pinning, scrubbing, section choreography. The single most load-bearing plugin for award-style sites. |
| SplitText | bundled 3.13 | ~7KB | Rewritten in 3.13, 50% smaller, auto-resplit on resize, masking. Kinetic typography: per-char/word/line reveals. |
| Lenis | 1.3.26 | ~3KB | Buttery smooth scroll; the de facto standard. Canonical GSAP wiring: `lenis.on('scroll', ScrollTrigger.update)`, `gsap.ticker.add(t => lenis.raf(t*1000))`, `gsap.ticker.lagSmoothing(0)`. heyparker uses 1.3.17. |
| three.js (OPTIONAL) | r17x | ~150KB | Only if we commit to one hero WebGL moment. Biggest perf/complexity cost. |
| matter.js (OPTIONAL) | 0.20 | ~24KB | Physics toy (bouncing balls/badges). Cheap fun, very sporty. |

Skip: Framer Motion (React-oriented), barba.js (single page), theatre.js (authoring overhead), Locomotive Scroll (superseded by Lenis), Rive/Lottie (no authored assets), ScrollSmoother (redundant with Lenis).

Total core payload: ~51KB gz (GSAP+ST+SplitText+Lenis).

## 2. Pattern catalog (name -> how -> library)

Typography:
1. Char-stagger hero reveal — SplitText chars, yPercent:100 inside overflow:hidden line masks, stagger 0.02, expo.out.
2. Scrub-in paragraph — split into words, opacity 0.15->1 scrubbed by ST as block passes viewport center.
3. Kinetic oversized numerals — 20-40vw stat numbers that count up via gsap.to(obj,{val, snap:1}) and slide with slight skew on scroll.
4. Skew-on-velocity — text/images skew proportional to lenis.velocity, snapping back on stop.
5. Variable-font stretch — animate font-weight/wdth axis on scroll or hover.

Scroll choreography:
6. Pinned section with internal timeline — ST.create({pin:true, scrub:1, end:'+=300%'}) while content swaps in stages.
7. Horizontal scroll strip — pin a container, translate inner flex row x scrubbed; for the 4-pillar tour.
8. Sticky device with typed screen — device frame sticks while scroll drives what plays on screen (heyparker: loop <video preload="none"> per stage + typewriter).
9. Clip-path/scale image expansion — image grows from card to full-bleed (clip-path: inset() scrub).
10. Layered parallax depth — 3-4 layers at different yPercent speeds; fakes 3D with zero WebGL.
11. Section snap — ST.snap between full-height chapters.
12. Speed-line wipes between sections — full-width diagonal stripes sweep across on section entry (3 staggered divs, xPercent:-100->100, power4.inOut). Cheapest sporty transition.

Ambient/continuous:
13. Velocity-reactive marquee — infinite ticker whose speed/direction respond to scroll velocity (heyparker has 68 ticker items).
14. Progress bar / chapter nav — thin fixed bar or dot rail tied to ST.progress; scoreboard mono styling.
15. Grain overlay — fixed SVG feTurbulence noise div at 4-6% opacity, mix-blend-mode:overlay. CSS only.

Micro-interactions:
16. Magnetic buttons — translate toward cursor within radius via gsap.quickTo, spring back.
17. Custom cursor/follower — dot + lagging ring; grows to "VIEW"/"BOOK" over cards; hide on touch. Subtle, not circus.
18. Image trail on hero mousemove — spawn/fade small athlete photos along cursor path.
19. Hover video cards — muted 1-2s loop on hover, greyscale->color, slight zoom.
20. Button fill sweep — diagonal color fill on hover with stacked-label text swap-up.
21. Physics drop — matter.js canvas, sport balls rain and pile, draggable; footer.
22. Preloader with count — 0->100 mono counter + curtain wipe revealing hero mid-animation.
23. Odometer scoreboard stats — digits flip like a stadium scoreboard.
24. Sound design (optional) — opt-in only, tiny ticks behind explicit mute toggle, off by default.
25. Reduced-motion + mobile degrade — ScrollTrigger.matchMedia handles desktop/mobile/reduced splits natively; disable Lenis + cursor on touch.

## 3. Sporty design devices

- Velocity as a material: skew-on-scroll, motion blur keyed to velocity, speed-line wipes, hard 0.2s cuts.
- Bold condensed/italic display type, ALL-CAPS, tight tracking, oversized jersey/scoreboard numerals as layout elements.
- Athlete photography: high-contrast B&W or duotone cutouts breaking the grid, layered behind/in front of giant type, grain; color arrives on hover/scroll.
- Scoreboard/broadcast UI language: mono digits, live ticker strips, stat chips, timestamp labels (19:00 IST, COURT 3).
- Hard geometry: diagonal section cuts, court-line motifs (center circle, sidelines) as SVG strokes that draw in via DrawSVG (now free).
- Modular split: Lando Norris "On Track / Off Track" maps to Atlitos Play / Learn / Watch / Give pillars as color-coded chapters.

## 4. heyparker.ai teardown (verified from delivered HTML)

- Framer export shipping Lenis 1.3.17, Framer motion runtime as ES modules, appear-effect precomputation (data-framer-appear-id) so first paint animates without JS jank.
- Sections: two-beat headline hero -> Step 1/2/3 (each a looping muted video inside a device frame — the "typed text" is baked into the videos, not live JS) -> comparison table -> team -> pricing -> 68-item testimonial ticker -> CTA.
- Type system: Source Serif Pro editorial headings + Radio Canada UI + Fragment Mono retro-terminal accents ("Loading..." labels). The mono + loading affordances create the retro-computer atmosphere more than the device illustration.
- Palette: white ground, hard black blocks, two soft pastels (peach, cream). Restraint + one sticky choreographed centerpiece + tickers = premium.
- Lesson: one sticky device showing the real app per scroll stage, screen content as cheap pre-rendered loops, mono accent for system labels, heavy marquees. All reproducible in vanilla with sticky + ScrollTrigger — and beatable, since ours can be live DOM instead of baked video.

## 5. Reference sites worth stealing from

1. lando.gg (Awwwards SOTY 2025) — speed-as-transition language, lime-on-dark single accent, cinematic scrub between chapters, modular split.
2. heyparker.ai — sticky device + staged screens, mono system labels, ticker, two-beat serif headline rhythm, appear-on-load choreography.
3. Nike ecosystem / sports commerce — story-before-spec blocks, full-bleed athlete imagery with type overlap, hover-video cards.
4. Codrops demos (tympanus.net May 2025 free-GSAP-plugins set) — directly liftable vanilla code for SplitText masks, DrawSVG motifs, image-trail cursor.
5. Awwwards sports collection — bold numerals, grain, duotone athletes, scoreboard UI.

## 6. Architecture implications

- One motion.js module: init Lenis -> wire GSAP ticker -> register plugins -> per-section init functions guarded by ScrollTrigger.matchMedia.
- Self-host the 4 core files (~51KB gz); UMD globals from plain script tags, no build step.
- WebGL is the one costly decision; defer or restrict to one moment. Everything else is DOM/canvas.
- Pre-render any complex screen content as short muted loops rather than animating heavy DOM inside pins — EXCEPT product UI, which must be HTML per repo rule (no generated UI video).
