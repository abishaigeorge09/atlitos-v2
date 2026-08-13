# Landing Page Build Log and Learnings

Session closeout, 2026-08-11 (the animation rebuild). This is the memory for whoever
touches `apps/landing/` next.
Live: https://www.atlitos.com · Vercel project `atlitos-landing` · The architecture
contract is `docs/MOTION-ARCHITECTURE.md`; read it before writing motion code.
Research digest behind it: `docs/RESEARCH-MOTION.md`.

## What the page is now

Static HTML + CSS + vanilla JS + GSAP 3.13 stack, no framework, no build step. Deploy
with `npx vercel deploy --prod --yes --archive=tgz --scope abishaigeorge09s-projects`
from this directory. Commit from the REPO ROOT.

Two-layer motion architecture (D4 in the architecture doc):
- **`main.js` is the floor**: nav logic, way toggle, count ups, reveal IO, rotator,
  typewriters, the 1800ms `hero-ready` fallback, `window.__atlitosBasic` handover.
  If `motion/` never boots the page degrades to this, proven by check C12.
- **`motion/` is the ceiling**: `index.js` boots GSAP + ScrollTrigger + SplitText +
  Lenis (desktop pointer-fine only), then EAGER inits (fold: header, hero, ledEntry,
  cursor, magnetic, skew, marquee) and idle-DEFERRED inits (everything below the fold
  plus the rail). `html.motion-rich` marks rich mode; `html.motion-full` marks the
  whole choreography registered (checks wait on it). Basic text behaviours check
  `motion-rich` at fire time so the two layers never double-drive one element.

Page story, top to bottom:
1. **COLD OPEN hero** (no video): Fraunces 900 headline rises from line masks,
   "change forever." italic ember; duotone athlete panel (angled clip-path over
   `img/hero-panel.webp` + srcset 640w) wipes in; five speed lines sweep, one
   survives as a thin marigold rule (transform-only settle, see learnings); four
   kit tiles drop and tilt to the pointer; scroll parallax on the whole stack;
   nav unfolds last. `hero-ready` (timeline end or 1800ms fallback) forces final
   states via CSS.
2. **GAME ON / Meet Atlitos**: SplitText word masks, word-scrub sub line, CTA rise.
3. **Problem band**: stickers land with rotate settle, phrase rotator flips
   vertically, velocity-reactive icon marquees, tiles skew with scroll velocity.
4. **Interlude**: SplitText char typing, arrows draw in sequence.
5. **Step files**: sticking is CSS STICKY, never a pin (D3, the founder's pixel
   matched mechanic). GSAP drives internals: tab slide, copy rise, demo card rows
   stamping, XP fill, outgoing panel recession. The demo cards are real HTML
   (`.demo-card`/`.d-row`/`.d-xp`), never generated video.
6. **Features band**: arch rise scrub, GSAP loop typewriter, notification stack
   cycles top-to-bottom every 3.2s while visible.
7. **Old way vs Atlitos way**: court draws piece by piece, chaos path snakes via the
   shared `drawPath`, chips pop, auto-advance to the clean line (3200ms, respects
   wayTouched, rich-aware so the path never draws twice).
8. **Differentiators**: alternating row entrances, oversized numerals drift against
   scroll, row-1 photo expands card-to-bleed via clip-path scrub.
9. **Strip**: shutter open + shared velocity marquee.
10. **Pricing**: green wipe, checks draw, plans rise (Pro overshoots), prices count
    up in mono. Tiers NEVER change without the founder (C11 enforces).
11. **Voices**: opposite velocity marquees, hover pause + lift, velocity skew.
    SAMPLE tags must stay visible at every scroll position (C11).
12. **Personas**: cards deal in like a hand, alternate drift.
13. **EMPOWER, THE ORBIT**: the page's ONE pin (R1 recipe: `overflow-x: clip` on
    html, `emp-pin-wrap` isolation z-30, footer z-31, pinSpacing true, `+=180%`,
    invalidateOnRefresh) and ONE WebGL scene. The scrubbed story: headline, ₹293
    card, +₹7 into orbit, 24 coins tighten while the key light lerps ember→green
    and stats count, the athlete photo blooms, roundup line, release into outro
    CTAs. three.js runs in a WORKER with OffscreenCanvas (651KB parses off-main);
    the main thread posts progress/visibility. Gates: reduced motion, <=620px,
    saveData, no-WebGL, no-OffscreenCanvas all fall back to the CSS circle.
    Mobile <=900px: no pin, the beats fire as reveals.
14. **Footer**: giant mark scrub, link columns rise, tagline accents cycle tokens.

Global systems: custom cursor (dot + lagging ring, BOOK/VIEW/PLAY/OPEN labels),
magnetic buttons, velocity skew (`data-skew`), one marquee engine, speed-line wipes
at exactly three boundaries (steps, pricing, empower — three is the budget), static
film grain (desktop), 6-dot chapter rail. The CURTAIN was built, measured at ~500ms
LCP against the architecture's 250ms budget, and DROPPED per that same rule.

## Binding guards (checked every deploy, `scripts/motion-check.mjs`)

Playwright-driven, resolves playwright-core from the monorepo pnpm store, wired into
the repo pre-push hook (gated on apps/landing changes). Checks C1-C12 per the
architecture: zero-JS copy, scoped hidden states, reduced motion, pin overlap sweep
(planted red with pinSpacing:false, +653px overlap, then green), overflow-x clip,
80KB first-load JS cap (eager modules; deferred reported separately), three.js
never-before-load + never-on-mobile, C8 median LCP<2s / CLS<0.02 (opt-in, slow),
frame budget (two-attempt, SwiftShader warmup noise), copy rules, frozen pricing +
SAMPLE tags, the C12 fallback floor. Current prod numbers: LCP ~1.6s median,
CLS ~0.012, first-load 69KB gz, longest frame 50ms.

## Learnings this rebuild (each cost a debugging round)

- **GSAP vs CSS percent translates**: CSS hidden states like `translateY(110%)`
  parse into GSAP as PIXEL x/y; a tween on `yPercent` leaves the pixel residue as a
  second transform component. Every fromTo zeroes the parsed axis (`y: 0`).
- **Never let CSS transitions touch GSAP-driven elements**: a live transition
  interpolates every inline write per frame (froze the step rows mid rotation).
  `.motion-rich [data-reveal] { transition: none }` kills the conflict class.
- **Transforms only inside animations**: tweening `height`/`top` on the hero speed
  line settle measured 0.055 CLS by itself. scaleY instead.
- **Font metric fallbacks beat font preloads**: size-adjust matched local fallbacks
  took CLS 0.062→0.012; preloading the woff2s then starved the LCP image on
  throttled mobile and was removed.
- **The rupee sign lives in latin-ext**: the JetBrains Mono latin subset alone
  renders ₹ in the fallback font; ship `JetBrainsMono-var-latinext.woff2` too.
- **Big JS parse is a scroll stall wherever it happens on main**: 651KB three.js
  UMD = 1.4s cold frame. Worker + OffscreenCanvas moved parse, context, and render
  off-main entirely; even worker SPAWN costs ~160ms, so it happens inside the
  deferred boot chain, never on scroll approach.
- **Marquee wrap math**: sign-preserving modulo (`x % half`, fold positives down);
  the `((x%h)+h)%h*-1` form ping-pongs a full copy width per frame. And GSAP
  ticker delta units vary; derive dt from the time param.
- **overflow-x: clip on html, never hidden on body** — hidden creates a scroll
  container, which was the root cause of the historical pin overlap bug.
- **Vercel CDN propagation**: a check run right after deploy can read the previous
  styles.css; wait ~15s or re-run before diagnosing.

## Founder taste, learned the hard way (carried forward + new)

- Rejects flat AI-slop compositions and cartoon illustrations. Photography, real
  product UI in HTML, hard ink borders, kinetic type.
- **"Match the reference" means pixel-level mechanics**, and "crazy animations,
  everything smooth" set the bar for this rebuild: heyparker.ai smoothness as the
  floor (it is a Framer export + Lenis; this page is hand-tuned GSAP).
- Iterates by pointing at deltas on the LIVE page; ship every round to prod.
- Navbar standing order: bidirectional tuck/reopen, always open near the top. Dark
  glass over the espresso opening, paper glass from the problem band down (the
  boundary is `.problem`'s offset, not a fixed y).
- Empower is the emotional heart; it holds the page's only pin and only WebGL.
- Pricing tiers and SAMPLE tags are untouchable without the founder.

## Asset generation learnings (Higgsfield)

- Generative models hallucinate text onto everything; enumerate plain surfaces in
  prompts ("completely plain solid shirt, no print, no logo, no lettering").
- **UI demo videos are a dead end** (illegible gibberish text, model limitation).
  Product UI is HTML, always.
- `nano_banana_pro` beat `soul_2` for clean no-lettering photos.
- Starter plan: 2 concurrent jobs max. `cinematic_studio_video_v2`: 1:1/16:9/9:16.

## Open threads (waiting on the founder)

1. **Hero athlete cutout**: candidate generated and awaiting approval
   (`img/hero-athlete-candidate.png`, plain kit, no lettering). On approval: cut
   out, duotone, ship as `img/hero-cut.webp` panel upgrade.
2. Real quotes for the Voices wall and real/approved Empower numbers (SAMPLE tags
   stay until then).
3. Newsletter is a mailto stopgap; real capture needs an endpoint decision.
4. Retired film-era assets (`hero-clean.mp4`, `hero-scoreboard.mp4`,
   `hero-poster.jpg`) kept in `img/` per founder precedent, off the page.
5. `/nav-options.html` kept deliberately (references `styles.css` classes that
   evolved; it is a museum piece, not a live surface).
