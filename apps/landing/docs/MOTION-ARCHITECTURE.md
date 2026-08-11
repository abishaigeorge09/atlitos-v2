# Atlitos landing, motion architecture

Status: proposed, ready to build. Author: architect agent, 2026-08-11.
Scope: full animation rebuild of `apps/landing/`. Content stays, presentation is rebuilt.
Inputs: `docs/RESEARCH-MOTION.md`, `LANDING-NOTES.md`, founder directive (hero video is dead,
"crazy animations and 3D stuff", heyparker smoothness is the floor).

Read this before writing a line of motion code. Every decision below is settled unless it
appears under `## Open questions`.

---

## 0. Decision records

Four decisions carry the build. Each lists the option space, the winner, and a mechanical
check that proves the winner is actually in place. Checks are collected in section 9.

### D1. Library stack

| Option | Weight | Verdict |
|---|---|---|
| A. Do nothing. Keep CSS transitions plus IntersectionObserver, no library. | 0 KB | Rejected. It is the current page. The founder has already called the result short of the bar, and scrub, split type, and velocity coupling are not reachable from CSS alone. |
| B. GSAP 3.13 core plus ScrollTrigger plus SplitText plus Lenis, self hosted. | approx 58 KB gz | **Chosen.** All four files are already vendored in `vendor/`. No build step, UMD globals, no CDN dependency, no runtime cost we cannot measure. |
| C. B plus ScrollSmoother instead of Lenis. | approx 62 KB gz | Rejected. ScrollSmoother wraps the page in a transformed container, which is the single most common cause of the pin plus overflow bug class we are structurally trying to kill. Lenis leaves the native scroller alone. |
| D. B plus matter.js physics. | approx 82 KB gz | Deferred. One more dependency for one toy. Revisit only if the founder asks for the ball pit by name. |

Consequences, good: one engine for every section, matchMedia gives the reduced motion and
mobile splits for free, SplitText 3.13 auto resplits on resize so we stop hand rolling
typewriters. Consequences, bad: 58 KB gz of JS on a page that shipped with 12 KB, a hard
dependency on GreenSock staying free, and every section now has two code paths (rich and
basic) that both have to be verified.

### D2. Hero concept

| Option | Verdict |
|---|---|
| A. **COLD OPEN.** Giant SplitText headline, duotone athlete panel parallax, ember speed lines, four CSS 3D kit tiles that drop and tilt to the pointer. Zero WebGL above the fold. | **Chosen.** Text LCP, first motion inside 200 ms, sporty, and it cannot fail closed because the headline is real markup. |
| B. three.js hero. A WebGL court or particle field behind the type. | Rejected for the hero. 165 KB gz plus shader compile in front of first paint, and it violates the standing rule that above the fold never depends on animation completing. The WebGL budget is spent once, at Empower, where it is below the fold and lazy. |
| C. matter.js ball drop in the hero. | Rejected. Fun for four seconds, then it is a pile of balls sitting on the LCP element, and it needs a canvas sized before layout settles. |
| D. Do nothing, keep the scrubbed film. | Rejected by the founder directive. Also removes two MP4s from the critical path, which is the largest single performance win available. |

### D3. Pinning policy

| Option | Verdict |
|---|---|
| A. No JS pinning, CSS sticky only (the current standing order). | Rejected, superseded. The founder lifted it. |
| B. Pin freely wherever it helps. | Rejected. This is exactly how the original bug shipped: pricing scrolled over a stuck features stage. |
| C. **Pin budget of one, at Empower only, under a written recipe.** Everything else stays CSS sticky. | **Chosen.** One pin is auditable. The recipe in section 8.1 makes the bug class structurally impossible, and a scripted overlap sweep proves it on every deploy. |

The steps file stack stays CSS sticky. It is pixel matched to the reference, the founder
audits it at DOM level, and converting it to a pin would put three pinned stages inside the
negative margin band. GSAP drives what happens *inside* each file, not the sticking.

### D4. File architecture

| Option | Verdict |
|---|---|
| A. Keep everything in `main.js`. | Rejected. 13 sections of choreography in one IIFE is 1500 lines, and two builder agents editing it in parallel worktrees will collide on every commit. |
| B. One new `motion.js` IIFE alongside `main.js`. | Rejected for the same collision reason, and it gives no fallback story. |
| C. **`main.js` stays as the floor, `motion/` ES modules are the ceiling.** `main.js` (classic script, `defer`) owns nav, count ups, way toggle, typewriters and the reveal IntersectionObserver. `motion/index.js` (`type="module"`) owns Lenis, GSAP and per section choreography, and switches the basic behaviours off when it boots. | **Chosen.** If the module graph fails to load for any reason, the page degrades to today's behaviour instead of to nothing. Each section is one file, so phases and parallel builders do not collide. |

Consequences, bad: two code paths to keep honest, and a handful of extra module requests
(mitigated with `modulepreload`). Consequences, good: a genuine hard fallback, and a builder
agent can own `motion/sections/empower.js` without reading any other file.

---

## 1. Stack: exact files, versions, load order

### 1.1 Vendor inventory

Already present in `vendor/`. Nothing needs fetching.

| File | Version | Role |
|---|---|---|
| `vendor/gsap-3.13.min.js` | 3.13.0 | Engine |
| `vendor/ScrollTrigger-3.13.min.js` | 3.13 | Scroll choreography |
| `vendor/SplitText-3.13.min.js` | 3.13 | Kinetic type, free since April 2025 |
| `vendor/lenis-1.3.min.js` | 1.3.26 | Smooth scroll, exposes `globalThis.Lenis` |
| `vendor/three.min.js` | r150 UMD | Empower WebGL only, lazy |

**Delete in Phase 0:** `vendor/gsap.min.js` (3.12.5) and `vendor/ScrollTrigger.min.js`
(3.12.5). Two versions of the same global in one repo is a footgun; SplitText 3.13 will not
run against a 3.12.5 core.

**three.js stays at r150.** Do not upgrade. r150 to r18x changes colour management and light
units, which means re-tuning the Empower materials for zero user visible benefit. Record the
pin in `docs/DEBT.md` with an owner.

### 1.2 Load order in `index.html`

```html
<head>
  ...
  <link rel="preload" as="image" href="img/hero-cut.webp" fetchpriority="high" />
  <link rel="modulepreload" href="motion/index.js" />
</head>
<body>
  ...
  <script src="main.js" defer></script>                          <!-- the floor -->
  <script src="vendor/gsap-3.13.min.js" defer></script>
  <script src="vendor/ScrollTrigger-3.13.min.js" defer></script>
  <script src="vendor/SplitText-3.13.min.js" defer></script>
  <script src="vendor/lenis-1.3.min.js" defer></script>
  <script type="module" src="motion/index.js"></script>           <!-- the ceiling -->
</body>
```

`defer` scripts execute in document order before `DOMContentLoaded`; a `type="module"`
script is deferred by default and runs after them. So the four globals are guaranteed to
exist when `motion/index.js` runs. `motion/index.js` still asserts them and bails to basic
mode if any is missing.

### 1.3 Weight budget

| Bucket | Budget (gzip) | Note |
|---|---|---|
| GSAP core | 27 KB | fixed |
| ScrollTrigger | 14 KB | fixed |
| SplitText | 7 KB | fixed |
| Lenis | 10 KB | measure, research quoted 3 KB which looks optimistic for the UMD build |
| `main.js` | 4 KB | shrinks, hero film controller is deleted |
| `motion/**` | 10 KB | hard cap across all modules |
| **First load JS total** | **80 KB gz hard cap** | fails the build check above this |
| `styles.css` | 12 KB gz | currently around 8 KB, cap the growth |
| three.js (lazy, Empower, desktop only) | 165 KB gz | never counted in first load |
| Hero image | 90 KB | WebP, `fetchpriority="high"` |
| **Removed** | `img/hero-clean.mp4`, `img/hero-scoreboard.mp4` leave the page entirely | the single biggest win |

### 1.4 Lenis plus GSAP wiring (the exact snippet)

`motion/scroll.js`:

```js
export function initSmoothScroll({ gsap, ScrollTrigger, reduced }) {
  if (reduced || !window.Lenis || !window.matchMedia("(pointer: fine)").matches) return null;

  const lenis = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: false,              // iOS momentum stays native, see risk R2
    autoRaf: false,                // GSAP owns the tick
    anchors: { offset: -72 },      // matches --nav-h
    prevent: (node) => node.hasAttribute("data-lenis-prevent"),
  });

  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  ScrollTrigger.config({ ignoreMobileResize: true });

  return lenis;
}
```

Required CSS, add to `styles.css` verbatim:

```css
html.lenis, html.lenis body { height: auto; }
.lenis.lenis-smooth { scroll-behavior: auto !important; }
.lenis.lenis-smooth [data-lenis-prevent] { overscroll-behavior: contain; }
.lenis.lenis-stopped { overflow: hidden; }
```

Lenis is desktop and pointer-fine only. On touch the native scroller is better than any
JS approximation, and `syncTouch: true` is the source of most iOS complaints.

---

## 2. The hero: COLD OPEN

The video is deleted. `.vhero`, `#heroVideo`, `#heroVeil`, `#heroLed`, `#heroHint` and the
entire hero film controller in `main.js` go with it.

### 2.1 Composition

Espresso ground (`--espresso`), so the hand off into the existing `.led-entry` band is a
continuous dark field rather than a colour cut. Layers, back to front:

1. **Grain** (global overlay, section 5.5).
2. **Duotone athlete panel.** `img/hero-badminton.jpg` inside a hard edged angled
   `clip-path` polygon, `filter: grayscale(1) contrast(1.15)` with an ember multiply layer
   over it. Sits right of centre, breaking the type. Parallaxes at `yPercent: -12` over the
   hero scroll. Upgrade slot: a real transparent cutout at `img/hero-cut.webp` replaces the
   clipped panel with no JS change once the asset exists (open question Q1).
3. **Speed lines.** Five ember and marigold skewed bars at `-18deg`, full bleed, sweeping
   `xPercent: -140 -> 140` on load with `power4.inOut`, `stagger: 0.05`, then four of them
   dissolve and one thin marigold rule stays as a composition element.
4. **The headline.** The existing copy, unchanged:
   `The way you play sports is about to change forever.`
   Fraunces 900, `clamp(3rem, 10.5vw, 9rem)`, `line-height: 0.92`, `letter-spacing: -0.03em`,
   three manual line spans so the break is art directed rather than accidental.
   `change forever` is italic ember.
5. **Kit tiles.** Four small CSS 3D tiles carrying the persona tags already on the page,
   `PLAY MORE`, `COACH MORE`, `EARN MORE`, `GIVE MORE`, in JetBrains Mono. They drop in with
   `back.out(1.7)`, hold a slow `rotate3d` idle, and tilt toward the pointer within a 220 px
   radius. `aria-hidden`, decorative, no numbers, no invented claims.
6. **Scroll rail.** `SCROLL` in mono at the bottom left with a 1 px marigold line that
   grows and shrinks on a 1.6 s loop.

No CTA row in the hero. The nav CTA is on screen and `.led-entry` directly below carries
both existing CTAs. Duplicating them three times on one page is worse than not having one
above the fold. This call is reversible in one commit if the founder disagrees.

### 2.2 Load choreography (total 1.5 s, nothing blocking)

| t (s) | Beat | Ease |
|---|---|---|
| 0.00 | Curtain lifts (if enabled, section 5.6), speed lines start sweeping | `power4.inOut`, 0.7 |
| 0.15 | Headline chars rise from line masks, `yPercent: 100 -> 0`, `stagger: 0.018` per char, staggered by line at 0.09 | `expo.out`, 0.9 |
| 0.45 | Duotone panel wipes in via `clip-path` inset, `scale: 1.08 -> 1` | `power3.out`, 1.0 |
| 0.70 | Kit tiles drop, `y: -60`, `rotateX: -50 -> 0`, `stagger: 0.07` | `back.out(1.7)`, 0.8 |
| 1.05 | Scroll rail fades up, nav card unfolds | `power2.out`, 0.5 |

**Hard fallback.** A 1800 ms `setTimeout` in `main.js` forces `html.hero-ready`, which sets
every hero element to its final state through CSS. If GSAP never boots, if SplitText throws,
if fonts never resolve, the hero is complete and readable at 1.8 s. This is the same
guarantee the film hero had, kept.

### 2.3 Hero scroll behaviour

`.hero` is `100svh`, static, not pinned, not a 300vh track. On scroll:

- Headline `yPercent: -18`, opacity to 0.15 by 70 percent of viewport travel, scrubbed.
- Duotone panel `yPercent: -30`, scrubbed. Classic three layer parallax, pattern 10.
- Kit tiles `y: -120` with a per tile `stagger`-like offset, so they scatter upward.
- The marigold rule stretches across and hands into `.led-entry`.

CSS sticky is not needed and is not used. This keeps the LCP element in normal flow.

### 2.4 Mobile and reduced motion

- **Mobile (<= 900px):** headline drops to `clamp(2.5rem, 12vw, 4rem)`, kit tiles reduce to
  two and lose the pointer tilt, speed lines reduce to two, panel parallax reduced to
  `yPercent: -8`. Load choreography identical, it is cheap.
- **Reduced motion:** every element at its final state on first paint. No split, no sweep,
  no parallax, no idle. SplitText is never called.

---

## 3. Section by section choreography

Legend for triggers: **L** load, **E** enter viewport (ScrollTrigger `once: true` unless
noted), **S** scrub, **P** pin, **H** hover, **C** continuous.

Global default ease for entrances: `power3.out`, duration 0.7, stagger 0.06. Deviations are
called out. Every entrance has a `data-reveal` equivalent in markup so the `main.js`
IntersectionObserver produces a correct, plainer version when `motion/` is absent.

### 3.0 Header (`.site-header`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Folder tab unfolds from the top edge, `scaleY: 0.6 -> 1` plus `y: -20 -> 0` | 1 | L, at 1.05 s | `back.out(1.4)`, 0.5 | same | final state |
| Tuck to wordmark plus CTA on scroll down, reopen on any scroll up | existing | S via ScrollTrigger `onUpdate` direction | 0.35 `power2.out` | same | instant class toggle, no transition |
| Nav links get a stacked label swap on hover | 20 | H | 0.25 `power2.out` | disabled | disabled |
| CTA is magnetic | 16 | H | `quickTo` 0.28 `expo.out` | disabled | disabled |

The scroll direction logic moves from the raw `scroll` listener in `main.js` to a single
ScrollTrigger with `onUpdate: (self) => self.direction`. `main.js` keeps its listener as the
basic mode path and `motion/` kills it by setting `html.motion-rich` (section 7.2).

Standing order from `LANDING-NOTES.md`: bidirectional, always open near the top. Unchanged.

### 3.1 Hero (`.hero`)

See section 2.

### 3.2 Meet Atlitos (`.led-entry`)

The second beat of the opening, no longer "inside the board" since there is no board.
Reframed as the title card.

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Eyebrow `YOU ARE INSIDE THE BOARD` needs new copy, see Q2. Interim: keep the string, it reads as an LED reference and costs nothing | | | | | |
| `Meet Atlitos.` split by word, mask reveal, `Atlitos` in marigold italic scales from 1.15 with a slight `rotate: -2deg` settle | 1 | E | `expo.out` 0.9, word stagger 0.08 | same | final |
| Sub line word scrub, opacity 0.2 to 1 as the block crosses viewport centre | 2 | S, `scrub: 0.6` | linear over 40 percent viewport | disabled, plain fade | final |
| Two CTAs rise, magnetic, fill sweep on hover | 16, 20 | E then H | 0.55 `power3.out`, stagger 0.08 | rise only | final |
| Ember speed line wipe into the section | 12 | E | 0.9 `power4.inOut` | 2 bars instead of 3 | none |

### 3.3 Problem (`.problem`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Ember band rises with its curved seam, `clip-path` inset from the bottom | 9 | S, `scrub: true`, over the last 40vh of the previous section | linear | reduced to a plain fade in | static band |
| Three stickers land one by one with a rotate settle, keeping the existing `tilt` character | 1 | E | `back.out(1.3)` 0.6, stagger 0.1 | same | final |
| Word rotator chip: the phrase flips vertically instead of fading. Old phrase `yPercent: -100`, new phrase in from `100` | 3 | C, 3.4 s interval | 0.45 `power3.inOut` | same | no rotation, first phrase only |
| Two icon marquees become velocity reactive: base 40 px/s, `+/- lenis.velocity * 0.35`, direction flips on scroll up | 13 | C | continuous | base speed only, no velocity coupling | static, no animation |
| Marquee tiles skew with velocity, clamped to 6 degrees | 4 | C | `quickTo` 0.4 | disabled | disabled |

The rotator interval must pause on `document.visibilityState === "hidden"`. That guard is
already in `main.js`, keep it.

### 3.4 Interlude (`.interlude`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| `Here is how it works` typed. Replace the `setTimeout` typewriter with SplitText chars revealed on a `stagger` so it reads as typing but is frame accurate and interruptible | 1 | E | 0.035 per char, `none` ease | same | full text, caret static |
| Three arrows draw. Keep the existing `stroke-dashoffset` mechanic, drive it from GSAP for correct stagger | scroll draw | E | 0.9 `power2.inOut`, stagger 0.18 | same | drawn, no animation |
| Arrows get a small `y` bob tied to scroll velocity | 4 | C | `quickTo` 0.5 | disabled | disabled |

### 3.5 Steps (`.steps-wrap`, `#how`)

**Decision: keep the sticky file tab stack exactly as it is.** CSS `position: sticky` at
`top: var(--nav-h)`, same offset, same z index, DOM order stacking. Do not convert to a
ScrollTrigger pin. This is the founder's pixel matched mechanic and the historical bug lives
in the alternative.

What GSAP adds *inside* each file:

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Tab slides in from its own edge as the file docks, `x: -40 / 0 / 40` by tab index | 6 | E per `.step-file` | 0.5 `power3.out` | tabs are static full width, current behaviour | final |
| Step copy lines mask reveal per line, not per char, so it stays readable | 1 | E | 0.6 `expo.out`, stagger 0.07 | same | final |
| Demo card rows stamp in with the existing `pop` character, then the `d-cta` row pulses once instead of forever | 6 | E | `back.out(1.5)` 0.45, stagger 0.09 | same | all rows visible, no pulse |
| XP bar fills 0 to 65 percent | odometer | E | 1.1 `power2.out` | same | final width |
| Outgoing panel dims and scales to 0.985 as the next file covers it | 6 | S, `scrub: 0.5`, per file | linear | disabled, files are static blocks | none |
| Marigold speed line wipe at the section entrance | 12 | E | 0.9 `power4.inOut` | 2 bars | none |

Mobile below 900px already unsticks the files (`.step-file { position: relative }`). Keep
that. The scrub on the outgoing panel must be inside a `matchMedia("(min-width: 901px)")`
block so it never registers on mobile.

### 3.6 Features (`.features`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Marigold band arch rises over the steps, `border-radius` band already exists, add `yPercent: 8 -> 0` scrub | 10 | S, `scrub: 0.8` | linear | reduced to 4 percent | static |
| Looping headline typewriter stays a loop, moves to a GSAP timeline with `repeat: -1, repeatDelay: 2.6` | 1 | E | 0.038 per char | same | full text, no loop |
| Four notification cards slide in from the right in sequence, each with a small overshoot | 8 | E | `back.out(1.2)` 0.5, stagger 0.12 | same, stagger 0.09 | final |
| Notification stack then cycles: the top card lifts out and reinserts at the bottom every 3.2 s | 8 | C, IO gated | 0.6 `power3.inOut` | disabled | disabled |
| Mini stickers idle float, keep the existing CSS keyframe | 15 | C | 3 s | same | none |

The notification cycle is the cheapest way to make the "always on" claim feel alive without
a video. It is DOM only, four elements, and it stops the moment the section leaves the
viewport.

### 3.7 Old way vs Atlitos way (`.oldway`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Court lines draw themselves, outer rect then centre line then circle then keys | scroll draw | E | 0.7 each, stagger 0.15 | same | drawn |
| Chaos path draws with its dashed stroke, then the four `way-tag` chips pop along it | scroll draw, 6 | E, sequenced after the court | path 1.4 `power2.inOut`, chips `back.out(1.6)` 0.4 stagger 0.12 | same | final |
| Auto advance to the clean line after 2.6 s, unless the visitor touched the toggle. Keep this behaviour exactly | | timer | crossfade 0.4, new path draw 1.0 | same | shows the clean line only, no advance |
| Clean line draw is followed by a marigold goal dot scale pop | 6 | sequenced | `back.out(2)` 0.35 | same | final |
| Toggle buttons get a sliding ink pill behind the active label using `Flip`-free `quickTo` on `x` and `width` | 20 | H, click | 0.3 `power3.out` | same | instant |

The existing `setWay` and `drawPath` logic in `main.js` is correct and stays. `motion/` only
replaces the timing source so the sequence is one timeline instead of nested timeouts.

### 3.8 Differentiators (`.different`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Oversized `01 / 02 / 03` numerals travel `yPercent: 30 -> -30` across their row, JetBrains Mono, opacity 0.35 | 3 | S, `scrub: 1` per row | linear | disabled, static | static |
| Rows enter alternating from left and right with a 2 degree rotation settle | 1 | E | `power3.out` 0.7 | from bottom only | final |
| Row 1 photo expands from a 14 px radius card to full row bleed via `clip-path: inset()` | 9 | S, `scrub: 0.8` | linear | disabled | final |
| Tag chips keep the idle float, but the float amplitude scales with scroll velocity | 4, 15 | C | `quickTo` 0.4 | fixed amplitude | none |
| Empower link card is magnetic and lifts on hover, keeping the existing hard shadow offset | 16 | H | 0.25 `power2.out` | disabled | none |

### 3.9 Subscription strip (`.strip`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Marigold marquee moves to the shared velocity marquee system | 13 | C | base 60 px/s | base speed, no velocity | static, first four items visible |
| The band scales `scaleY: 0.4 -> 1` as it enters, like a shutter | 12 | E | 0.5 `power4.out` | same | static |

### 3.10 Pricing (`.pricing`)

Pricing tiers are untouchable. Numbers, labels, order, all frozen. Motion only.

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Green speed line wipe on entrance | 12 | E | 0.9 `power4.inOut` | 2 bars | none |
| `What's included` card stays CSS `position: sticky`. Do not pin it | | | | already static below 900px | static |
| Checklist items tick in, each `svg.check` draws its stroke then the label slides right | scroll draw, 1 | E | draw 0.3, label 0.35, stagger 0.08 | same | final |
| Three plan cards rise with a 0.12 stagger, Pro overshoots slightly further so it reads as the pick | 1 | E | `back.out(1.2)` 0.65 | same | final |
| Price numerals count up from zero, Indian grouping, mono. Reuse the existing `formatIN` | 23 | E, once | 1.0 `power3.out` | same | final numbers, no count |
| Plan CTAs are magnetic with a diagonal fill sweep | 16, 20 | H | 0.25 | disabled | none |

Note on the count up: `Starter` counts to 0, which is a no op. Skip the count on that card
rather than animating a zero.

### 3.11 Voices (`.voices`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Two opposite marquees move to the velocity marquee system | 13 | C | base 45 and 52 px/s | base speed | static rows |
| Cards skew with velocity, clamped to 5 degrees | 4 | C | `quickTo` 0.45 | disabled | disabled |
| Hover pauses the row and lifts the hovered card | 19 | H | 0.25 | disabled | none |
| `SAMPLE` tags stay on every card, no animation that could hide them | | | | | |

Hard rule from `LANDING-NOTES.md`: the `SAMPLE` tag must be visible whenever the card is
visible. No motion may fade, cover or offset it.

### 3.12 Personas (`.personas`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Four door cards deal in like a hand of cards: from a stacked centre position, `rotate` from `-8deg`, into the grid | 6 | E | `power4.out` 0.8, stagger 0.1 | 2 up grid, same deal | final grid |
| Cards drift horizontally with scroll, `x: -20 -> 20` alternating by index. No pin, no horizontal scroll strip | 10 | S, `scrub: 1` | linear | disabled | none |
| Card hover: lifts, hard shadow deepens, `p-icon` draws its stroke again | 16, scroll draw | H | 0.25 | disabled | none |
| Espresso dome rises into Empower, `scaleX` from 1.15 to 1 as it enters | 12 | S, `scrub: 0.6` | linear | same | static |

The horizontal pinned strip (pattern 7) was considered here and rejected. It needs a pin,
and the pin budget is spent at Empower.

### 3.13 Empower (`.empower`), the second biggest moment

This is the emotional heart and it gets the only pin on the page, plus the only WebGL.

**Concept: THE ORBIT.** The roundup story becomes one continuous scrubbed sequence. The
existing three flow cards and three stat tiles are the source material, nothing new is
invented.

Structure:

```
<section class="empower" id="empower">
  <div class="emp-pin-wrap">        <!-- position: relative; isolation: isolate; z-index: 30 -->
    <div class="emp-stage">         <!-- 100svh, the pinned element -->
      ... flow cards, stats, canvas host ...
    </div>
  </div>
  <div class="emp-outro"> ... CTA row, note ... </div>
</section>
```

Scrubbed timeline, `end: "+=180%"`, `scrub: 0.8`:

| Progress | Beat |
|---|---|
| 0.00 to 0.18 | Headline stickers land, note text word scrubs in |
| 0.18 to 0.35 | Card 01 (`₹293` order) slides to centre and compresses into a coin form |
| 0.35 to 0.52 | Card 02 splits off as `+ ₹7`, green, and enters orbit around the ball |
| 0.52 to 0.72 | Orbit tightens, the ball shifts from ember key light to green, three stat tiles count up in sequence |
| 0.72 to 0.88 | Card 03 (the photo) scales up out of the ball, `clip-path` inset from centre |
| 0.88 to 1.00 | `roundup-line` types, ball settles to idle, pin releases |

Then, unpinned, `.emp-outro` rises with the CTA row and note.

**The WebGL upgrade.** Keep the existing three.js scene (seamed paper ball, three torus
seams, green ring) and add:

- 24 small coin meshes on an orbit whose radius, tilt and phase are driven by the same
  scroll progress value, not by wall clock.
- The key light lerps `--ember` to `--green` over progress 0.52 to 0.72.
- `renderer.setPixelRatio(Math.min(1.5, devicePixelRatio))`, canvas capped at 720 px on the
  long edge.
- Render only when the section is intersecting and the tab is visible. The current
  `render()` loop already checks both, keep that guard and add `IntersectionObserver`
  gating so `requestAnimationFrame` is not even scheduled offscreen.
- Loaded lazily on IO, WebGL context probed first, CSS fallback circle stays as the
  failure state.

**Gating.** WebGL is off when any of these is true: `prefers-reduced-motion: reduce`,
viewport width <= 620 px, `navigator.connection?.saveData === true`, `WebGLRenderingContext`
missing, or the context creation throws. In every off case the CSS fallback circle shows and
the orbit is drawn as a static SVG ring.

**Mobile (<= 900px).** No pin at all. The same six beats fire as six independent
IntersectionObserver reveals in DOM order. The story reads identically, it just does not
scrub.

**Reduced motion.** No pin, no scrub, no canvas. All three flow cards, all three stat tiles
with final numbers, the photo, the roundup line and the CTA row are visible on first paint.
The `SAMPLE` tags stay.

### 3.14 Footer (`.site-footer`)

| What | Pattern | Trigger | Timing | Mobile | Reduced |
|---|---|---|---|---|---|
| Giant `Atlitos` logotype parallax, keep the mechanic, move to a ScrollTrigger scrub for correct frame pacing | 10 | S, `scrub: 0.5` | `yPercent: 34 -> 0` | reduce to 18 percent | static at final position |
| Logotype skews with scroll velocity, clamped to 4 degrees | 4 | C | `quickTo` 0.5 | disabled | disabled |
| Tagline accent words (`Athletes`, `Tech`, `Purpose`) cycle a colour highlight, ember to marigold to green, one at a time | 1 | C, IO gated, 2.4 s | 0.4 `power2.inOut` | same | static ember |
| Link columns rise with stagger | 1 | E | 0.5, stagger 0.07 | same | final |

---

## 4. Component boundaries and ownership

| Module | Owns | Must not touch |
|---|---|---|
| `index.html` | All copy, all structural markup, `data-reveal` attributes, `data-magnetic`, `data-cursor`, `data-skew`, `data-split` hooks | Nothing scripted |
| `styles.css` | Tokens, layout, the `html.js` hidden states, reduced motion final states, Lenis CSS, grain, cursor, curtain | No inline styles from motion code except transform and opacity |
| `main.js` (classic, `defer`) | Nav scroll logic, way toggle, count ups, reveal IO, rotator, hero hard fallback timer | Never imports GSAP, never pins, never assumes `motion/` exists |
| `motion/index.js` | Boot, plugin registration, mode detection, matchMedia contexts, calling every section init | Section internals |
| `motion/scroll.js` | Lenis lifecycle, `velocity()` accessor | Anything visual |
| `motion/systems/*.js` | cursor, magnetic, marquee, skew, wipes, progress rail, curtain | Section specific timing |
| `motion/sections/*.js` | One file per section, one default export | Global state, other sections |
| `motion/three/empower-orbit.js` | The entire WebGL scene, lazy loaded | The DOM outside `#emp3d` |

### 4.1 Interface signatures

```js
// motion/index.js
export function initMotion(): void;

// motion/context.js
export type MotionMode = "rich" | "basic" | "reduced";
export interface MotionCtx {
  gsap: typeof gsap;
  ScrollTrigger: typeof ScrollTrigger;
  SplitText: typeof SplitText;
  lenis: Lenis | null;
  mode: MotionMode;
  mm: gsap.MatchMedia;              // shared, use mm.add(), never ScrollTrigger.matchMedia
  velocity: () => number;           // signed px per frame, 0 when lenis is null
  splitReady: Promise<void>;        // resolves on fonts.ready or after 1500 ms, whichever first
  onCleanup: (fn: () => void) => void;
  q: (sel: string, root?: ParentNode) => HTMLElement[];
}

// every motion/sections/<name>.js
export default function init(ctx: MotionCtx): void;

// motion/systems/marquee.js
export function registerMarquee(el: HTMLElement, opts: {
  speed: number;                    // px per second, base
  reverse?: boolean;                // default false
  velocityFactor?: number;          // default 0.35
  pauseOnHover?: boolean;           // default false
}): () => void;                     // returns dispose

// motion/systems/magnetic.js
export function makeMagnetic(el: HTMLElement, opts?: {
  radius?: number;                  // default 90
  strength?: number;                // default 0.32
}): () => void;

// motion/systems/wipe.js
export function speedLineWipe(trigger: HTMLElement, opts?: {
  colors?: string[];                // default ["--ember", "--marigold", "--green"]
  bars?: number;                    // default 3, 2 on mobile
  angle?: number;                   // default -18
}): void;

// motion/three/empower-orbit.js  (dynamic import target)
export function mountOrbit(host: HTMLElement): {
  setProgress: (p: number) => void; // 0..1, called from the scrub
  dispose: () => void;
} | null;                           // null when WebGL is unavailable or gated off
```

`mountOrbit` returning `null` is the contract for every WebGL failure. The caller must
handle it by leaving the CSS fallback circle in place. It never throws.

---

## 5. Global systems

### 5.1 Smooth scroll

Section 1.4. Desktop pointer-fine only. `lerp: 0.1` matches the heyparker feel closely; do
not raise it above 0.12, the page starts feeling detached from the wheel.

### 5.2 Custom cursor

- Two elements, `.cur-dot` (8 px, ember) and `.cur-ring` (34 px, 1.5 px ink outline).
- Dot follows at `quickTo` 0.12, ring at 0.35. That lag is the whole effect.
- On `[data-cursor="view"]` etc, the ring grows to 64 px, fills with `--marigold` at 0.9
  opacity, and shows the label in JetBrains Mono at 10 px, 0.14em tracking.
- Hidden entirely when `(pointer: coarse)`, when `prefers-reduced-motion: reduce`, and
  during any text selection.
- Never replaces the native cursor on form controls or links. `cursor: none` is applied to
  `body` only, and restored on `input, textarea, select`.
- Labels allowed: `VIEW`, `BOOK`, `PLAY`, `OPEN`. No numbers, no claims.

### 5.3 Velocity skew

One shared reader. `velocity()` returns `lenis.velocity` clamped to `[-60, 60]`, mapped to a
skew in `[-6deg, 6deg]`, applied with `gsap.quickTo(el, "skewY", { duration: 0.4, ease:
"power3.out" })`. Elements opt in with `data-skew` plus an optional `data-skew-max`.
Disabled on touch and under reduced motion. Never applied to text that must stay legible
while stationary, which means headlines opt out.

### 5.4 Marquee system

Replace all five CSS keyframe marquees with one JS system.

- Track content is duplicated in markup already, keep that so no-JS still scrolls via the
  CSS animation.
- JS sets `animation: none` on the track and drives `x` with a modulo wrap on
  `gsap.ticker`, reading `velocity()` for speed and sign.
- One `IntersectionObserver` stops the ticker callback for offscreen marquees. With five
  marquees on the page this matters.
- `prefers-reduced-motion`: JS never boots, and `styles.css` already sets
  `.marquee-track, .strip-track { animation: none }` under the reduced query. That leaves a
  static row, which is the correct final state.

### 5.5 Grain overlay

```html
<div class="grain" aria-hidden="true"></div>
```

`position: fixed; inset: 0; pointer-events: none; z-index: 90; opacity: 0.055;
mix-blend-mode: overlay;` backed by an inline SVG `feTurbulence` data URI at
`baseFrequency="0.85"`, tiled at 180 px. CSS only, no animation, no JS. Costs one composited
layer. Keep `z-index: 90` so it sits under the header (100) and above everything else.

Do not animate the grain. Animated noise is a GPU cost with no payoff on a page that already
has a lot moving.

### 5.6 Curtain (the preloader question)

**Decision: yes, but a curtain, not a preloader, and it is Phase 6, not Phase 1.**

- No `0 to 100` counter. A progress counter on a static site is a fabricated number and it
  forces a minimum hold, which directly costs LCP. Ruled out on both grounds.
- Three full bleed bands, ember, marigold, green, covering the viewport. They exit
  `yPercent: 0 -> -100` with `stagger: 0.08`, `power4.inOut`, 0.7 s.
- Dismiss trigger: the earlier of `document.fonts.ready` and a **900 ms hard cap**. Never
  waits on images, never waits on the module graph.
- Exists only under `html.js` and only when `motion/` boots. Absent for zero JS and under
  reduced motion.
- The hero load timeline starts at the same instant the curtain starts lifting, so the
  headline is already animating when the bands clear.
- LCP guard: the hero image is preloaded with `fetchpriority="high"` and is the intended
  LCP element. Measure LCP with and without the curtain in Phase 6 and drop the curtain if
  it costs more than 250 ms.

### 5.7 Progress and chapter rail

- Fixed right edge, 6 dots, desktop only, hidden below 900 px.
- Chapters: `OPEN`, `PROBLEM`, `HOW`, `WHY`, `PRICING`, `EMPOWER`. Six, not thirteen. A
  thirteen dot rail is a scrollbar with extra steps.
- Active dot fills marigold, label appears on hover in mono.
- Driven by one ScrollTrigger per chapter using `onToggle`, not by a scroll listener.
- Clicking a dot calls `lenis.scrollTo(target, { offset: -72 })`, falling back to
  `element.scrollIntoView()` when Lenis is null.
- Under reduced motion the rail still shows position, it just jumps rather than eases.

### 5.8 Magnetic buttons

`[data-magnetic]` on `.btn-pill`, `.btn-ghost`, `.plan-cta`, `.btn-nav`,
`.diff-empower-link`. Radius 90 px, strength 0.32, `quickTo` 0.28 `expo.out`, spring back to
zero on `pointerleave` with `elastic.out(1, 0.5)`. Pointer-fine only. The inner label
translates at 0.5 the parent offset, which is what makes it read as depth.

### 5.9 Speed line wipes

Used at exactly three boundaries: into Steps, into Pricing, into Empower. Three bars,
`-18deg`, sequential colours, `xPercent: -140 -> 140`, `stagger: 0.06`, `power4.inOut`,
0.9 s, `once: true`. Two bars on mobile. None under reduced motion.

Using this at every boundary turns it into wallpaper. Three is the budget.

---

## 6. Performance budget and loading strategy

### 6.1 Targets

| Metric | Target | Where measured |
|---|---|---|
| LCP | < 2.0 s | Moto G class, 4G throttle, Lighthouse mobile |
| CLS | < 0.02 | same |
| INP | < 200 ms | same |
| First load JS | <= 80 KB gz | `scripts/motion-check.mjs` weight assertion |
| Sustained fps during a full page scroll | >= 55 avg, no frame > 50 ms | scripted scroll in the check script |
| three.js | never in first load, never on <= 620 px | check script asserts no `three` request before the Empower IO fires |

### 6.2 Loading

- `main.js` and all four vendor files are `defer`. `motion/index.js` is a module, so also
  deferred, with `modulepreload`.
- Hero image: `fetchpriority="high"`, preloaded, WebP, <= 90 KB, explicit `width` and
  `height` so it reserves layout. This is the CLS guard.
- Every other image keeps `loading="lazy"` and gains explicit dimensions. Missing intrinsic
  dimensions on `.diff-media img` is a live CLS risk today.
- `img/night-match.jpg` (the Empower background) moves behind a `media` query so it is not
  fetched below 620 px.
- three.js is `import()`ed from inside the Empower IO callback, after gating.
- Fonts: the existing Google Fonts link stays, but add `&display=swap` (already present) and
  a `preconnect` (already present). Fraunces 900 italic is the hero face, confirm it is in
  the axis list before shipping.

### 6.3 Runtime gating

Every continuous animation, marquee, notification cycle, word rotator, footer tagline cycle,
WebGL render, must be behind both:

1. an `IntersectionObserver` on its own section, and
2. a `document.visibilityState === "visible"` check.

One shared `motion/systems/ticker.js` provides `onVisibleFrame(el, fn)` so nobody hand rolls
this. A single always-running `requestAnimationFrame` loop that touches five marquees is the
difference between a warm phone and a hot one.

### 6.4 DPR and canvas

`Math.min(1.5, window.devicePixelRatio || 1)` for the WebGL renderer, canvas long edge
capped at 720 px, `antialias: true` only when DPR is 1, `powerPreference: "low-power"`.

---

## 7. File architecture

### 7.1 Layout

```
apps/landing/
  index.html
  styles.css                    -> split, see 7.3
  main.js                       -> the floor, trimmed
  motion/
    index.js                    -> boot, mode detection, section dispatch
    context.js                  -> MotionCtx factory
    scroll.js                   -> Lenis
    systems/
      ticker.js                 -> onVisibleFrame
      cursor.js
      magnetic.js
      marquee.js
      skew.js
      wipe.js
      rail.js
      curtain.js
    sections/
      hero.js
      ledEntry.js
      problem.js
      interlude.js
      steps.js
      features.js
      oldway.js
      different.js
      strip.js
      pricing.js
      voices.js
      personas.js
      empower.js
      footer.js
      header.js
    three/
      empower-orbit.js          -> dynamic import target
  vendor/
  docs/
  scripts/
    motion-check.mjs            -> Phase 0 deliverable
```

### 7.2 What survives from `main.js`

Kept, unchanged in behaviour:

- Nav collapse and reopen logic (basic mode path).
- `setWay` and `drawPath` for the old way toggle. `motion/` reuses these functions, it does
  not reimplement them.
- Count ups with `formatIN` Indian digit grouping.
- The `data-reveal` IntersectionObserver. This is the reduced motion and basic mode
  fallback, and it must keep working.
- The word rotator.
- The `observeOnce` helper.

Deleted:

- The entire hero film controller, `HERO_LED_MESSAGE`, `typeLed`, `heroLoop`, the veil, hint
  and LED handling. Roughly 80 lines.
- `typeOnce` and the `[data-type]` / `[data-type-loop]` loops move to `motion/`. `main.js`
  keeps a one line fallback that simply leaves the full text in place, which is what the
  markup already contains.
- The footer giant mark scroll listener, replaced by a ScrollTrigger scrub.

Handover contract: `motion/index.js` sets `document.documentElement.classList.add("motion-rich")`
and calls exported teardown hooks that `main.js` places on `window.__atlitosBasic`:

```js
// main.js, at the end
window.__atlitosBasic = {
  disableReveal: () => { revealIO.disconnect(); },
  disableNavScroll: () => { window.removeEventListener("scroll", onScrollNav); },
  disableMarkParallax: () => { window.removeEventListener("scroll", onScrollMark); },
  setWay, drawPath, formatIN, observeOnce,
};
```

If `motion/` never boots, nothing calls these and the page behaves exactly as it does today
minus the film. That is the floor, and it is a real, shippable page.

### 7.3 CSS organisation

Keep one `styles.css`. Do not split into imports, extra round trips are not worth it at
12 KB gz. Reorganise into labelled bands in this order, each with a banner comment:

1. Tokens
2. Base and reset, including the `overflow-x` fix in section 8.1
3. Lenis required CSS
4. Global overlays: grain, cursor, curtain, rail
5. Reveal framework (`html.js` hidden states) and `html.motion-rich` overrides
6. Header
7. Sections, in page order
8. Reduced motion block, which must be last and must set final states for everything added
   above
9. Responsive

Rule: any element that `motion/` animates must have its final state expressed in CSS under
both `html:not(.js)` and the reduced motion query. If you cannot write that final state, the
animation is not shippable.

---

## 8. Risk register

### R1. The pin bug class (pricing scrolling over a stuck stage)

Cause, from `LANDING-NOTES.md`: GSAP pinning interacting with `overflow`. The current page
has `body { overflow-x: hidden }` at `styles.css:63`, and a band of sections using negative
margins with explicit z indexes (`.features` `margin-top: -80px; z-index: 22`, `.oldway`
`z-index: 21`, `.strip` and `.pricing` and `.personas` at `z-index: 24`). Pinning anything
inside that band would reproduce the bug exactly.

Structural prevention, all five are mandatory:

1. **Kill the overflow ancestor.** Replace `body { overflow-x: hidden }` with
   `html { overflow-x: clip }`. `clip` does not create a scroll container, `hidden` does.
   This is the single most important line in the rebuild.
2. **Pin budget of one**, at Empower, which sits outside the negative margin band and has no
   negative margin of its own.
3. **Own stacking context.** `.emp-pin-wrap { position: relative; isolation: isolate;
   z-index: 30; }`, higher than the `24` band, and `.site-footer` gets `z-index: 31` so it
   paints over the released pin.
4. **`pinSpacing: true` always.** Never `pinSpacing: false` on a section with content after
   it. Never a negative `margin-top` on the section following a pin.
5. **Explicit unpin boundary.** `end: "+=180%"` in percent, never element relative, plus
   `invalidateOnRefresh: true`, plus `ScrollTrigger.refresh()` after `document.fonts.ready`
   and after the Empower photo decodes.

The pin recipe, verbatim:

```js
const st = ScrollTrigger.create({
  trigger: ".emp-pin-wrap",
  start: "top top",
  end: "+=180%",
  pin: ".emp-stage",
  pinSpacing: true,
  anticipatePin: 1,
  invalidateOnRefresh: true,
  scrub: 0.8,
  animation: tl,
  onLeave: () => tl.progress(1),        // never leave the stage mid state
  onLeaveBack: () => tl.progress(0),
});
```

Mechanical proof, not review: `scripts/motion-check.mjs` scrolls the page in 40 px steps
through the Empower range and asserts that `.emp-stage.getBoundingClientRect().bottom` is
never greater than `.site-footer.getBoundingClientRect().top` while `.emp-stage` is pinned.
The check must be planted red first: temporarily set `pinSpacing: false`, watch it fail,
then restore.

### R2. Lenis and iOS

- `syncTouch: false`. Touch scrolling stays native. Lenis only handles wheel.
- The address bar resize on iOS Safari fires `resize` constantly and triggers ScrollTrigger
  refresh storms. `ScrollTrigger.config({ ignoreMobileResize: true })` is mandatory.
- Use `svh` not `vh` for any full height stage. `.step-file` already does this, follow it.
- Do not use `position: fixed` for the cursor or rail on touch. Both are already disabled
  there.
- `data-lenis-prevent` on any future scrollable inner panel.

### R3. Font loading vs SplitText

Splitting before webfonts land produces character positions computed against the fallback
metrics, which then jump. Fraunces at 9 rem makes that jump enormous.

Contract: `ctx.splitReady` is

```js
Promise.race([
  document.fonts.ready,
  new Promise((r) => setTimeout(r, 1500)),
])
```

Every `SplitText` call awaits it. Use `SplitText.create(el, { type: "chars,lines",
mask: "lines", autoSplit: true })`; 3.13 resplits on resize by itself. After every split,
call `ScrollTrigger.refresh()` once, batched, not per element.

If fonts fail entirely, the 1500 ms race fires, the split runs against fallback metrics, and
the text is still fully readable. That is an acceptable degraded state.

### R4. LCP with a heavy hero

- The LCP element is the hero image, not the headline, because the headline animates from
  `opacity: 0`.
- Preload it, give it explicit dimensions, keep it under 90 KB.
- The curtain caps at 900 ms and is the last phase, precisely so it can be dropped if the
  measurement says it costs too much.
- The 1800 ms hero hard fallback is independent of GSAP and of the curtain.

### R5. Battery and thermal on mobile

Five marquees, a notification cycle, a word rotator, a footer cycle and a WebGL scene, all
running at once, will cook a mid range phone. Mitigations are in section 6.3 and are not
optional. Additionally: no WebGL below 620 px, no velocity skew on touch, no cursor on
touch, marquee velocity coupling desktop only.

### R6. The hidden tab verification trap

From `LANDING-NOTES.md`, cost hours twice. Backgrounded or automation-hidden tabs suspend
scroll events, IntersectionObserver, CSS transitions and video loading. Symptoms look exactly
like broken code. Every verification in section 9 must run with the tab actually visible.
Take a screenshot first to wake it, wait, then capture.

### R7. Browser CSS cache trap

Cache busting query params on the page URL do not bust `styles.css`. Verify deployed CSS
changes with a hard reload or a `cache: "reload"` fetch.

### R8. Two GSAP versions in the tree

Deleting `vendor/gsap.min.js` and `vendor/ScrollTrigger.min.js` in Phase 0 is not tidying,
it is a correctness fix. SplitText 3.13 against a 3.12.5 core fails at registration.

---

## 9. Verification, the mechanical checks

`scripts/motion-check.mjs` is a Phase 0 deliverable. It is Playwright driven, takes a base
URL, and exits non zero on any failure. Every check below must be planted red before it is
made green.

```
node scripts/motion-check.mjs http://localhost:3000
node scripts/motion-check.mjs https://www.atlitos.com
```

| # | Check | Assertion |
|---|---|---|
| C1 | Zero JS copy | With JavaScript disabled, every visible string in `index.html` is present in the rendered text. No `[data-reveal]` element has computed `opacity < 0.99`. |
| C2 | Hidden states are scoped | `grep -n "data-reveal" styles.css` shows no hidden state rule outside a selector beginning `.js ` or `html.js`. Note: do not use `\b` in guard greps, `git grep -E` ignores it. |
| C3 | Reduced motion | With `reducedMotion: "reduce"`, `ScrollTrigger.getAll().filter(t => t.pin).length === 0`, no canvas exists in `#emp3d`, and every `[data-reveal]` has `opacity >= 0.99` at load. |
| C4 | Pin overlap sweep | Scroll in 40 px steps across the Empower range. `.emp-stage` bottom never exceeds `.site-footer` top while pinned. Plant red with `pinSpacing: false`. |
| C5 | No overflow ancestor | Computed `overflow-x` on `html` is `clip` and on `body` is `visible`. |
| C6 | First load weight | Sum of transferred bytes for `main.js`, the four vendor files and every `motion/**` module is <= 80 KB gz. |
| C7 | three.js is lazy | No request whose URL contains `three` before `#empower` first intersects. Zero such requests at a 390 px viewport. |
| C8 | LCP and CLS | `PerformanceObserver` reports LCP < 2000 ms and CLS < 0.02 under 4x CPU throttle and Fast 3G. |
| C9 | Frame budget | During a scripted full page scroll, no frame exceeds 50 ms and mean fps >= 55. |
| C10 | Copy rules | No emoji, no `-` or `--` inside any visible text node. Numerals inside `.mono` resolve to JetBrains Mono. |
| C11 | Frozen content | `Starter ₹0`, `Pro ₹199`, `Elite ₹499` present and unchanged. Every `.vcard` and `.emp-stat` still contains a visible `SAMPLE` tag with `opacity >= 0.99`. |
| C12 | Fallback floor | With `motion/index.js` blocked by route interception, the page still reveals content, the nav still collapses and reopens, and count ups still run. |
| C13 | Real render | Screenshots at 390, 768 and 1440 px, light and dark system appearance, hero and Empower. Eyeballed against the previous deploy. |

Wire `scripts/motion-check.mjs` into `.git/hooks/pre-push`. Private repos on the free GitHub
plan cannot require a status check, so the hook is the gate and the gap goes in
`docs/DEBT.md` with an owner. CI that cannot block is not a gate.

---

## 10. Build plan

Each phase is independently shippable to production. Ship each one so the founder reacts to
the live page, not to screenshots.

| Phase | Scope | Ships when |
|---|---|---|
| **P0. Foundation** | Delete the 3.12.5 vendor pair. Fix `overflow-x`. Add Lenis CSS. Create `motion/index.js`, `context.js`, `scroll.js`, `systems/ticker.js`. Boot GSAP, register plugins, wire Lenis, add `html.motion-rich` and the `__atlitosBasic` handover. No visual change beyond smooth scroll. Write `scripts/motion-check.mjs` with C1, C2, C3, C5, C6, C12, and install the pre-push hook. | Checks pass, page looks identical, scroll feels smooth, and C12 proves the floor still works with `motion/` blocked. |
| **P1. Hero** | Delete the film hero entirely. Build COLD OPEN: markup, CSS, `motion/sections/hero.js`, `header.js`, `ledEntry.js`. Add the 1800 ms hard fallback. Add C8, C13 to the check script. | LCP < 2.0 s measured, hero complete at 1.8 s with JS blocked mid load, screenshots at three widths approved. |
| **P2. Global systems** | `cursor.js`, `magnetic.js`, `skew.js`, `marquee.js`, `wipe.js`, grain overlay. Convert all five marquees. Add C9. | Frame budget holds with all marquees on screen, cursor absent on touch, grain does not tint the ember band incorrectly. |
| **P3. Upper page** | `problem.js`, `interlude.js`, `steps.js`, `features.js`. Steps stays CSS sticky, GSAP drives internals only. | The step file stack still docks at `--nav-h` with tabs visible, diffed against the current deploy at DOM level. |
| **P4. Lower page** | `oldway.js`, `different.js`, `strip.js`, `pricing.js`, `voices.js`, `personas.js`, `footer.js`. Add C10, C11. | Pricing tiers byte identical, `SAMPLE` tags visible on every card at every scroll position. |
| **P5. Empower** | `empower.js`, the one pin, `three/empower-orbit.js`, the orbit upgrade. Add C4, C7. | C4 planted red then green. WebGL absent at 390 px and under reduced motion, CSS fallback circle visible in both. |
| **P6. Curtain and rail** | `curtain.js`, `rail.js`. Measure LCP with and without the curtain. | Curtain costs < 250 ms of LCP, or it is dropped. |
| **P7. Polish pass** | Timing audit against heyparker side by side, ease unification, mobile thermal soak test, final `LANDING-NOTES.md` update. | Full check script green on production, founder walkthrough. |

Per phase, non negotiable: run the full check script, not just the new checks. A check that
should apply but cannot run is a failure, not a skip.

---

## 11. Non-goals

- **No section content changes.** Copy, pricing, `SAMPLE` tags, personas, footer links are
  frozen. Presentation only.
- **No AI generated product UI video.** Two attempts produced gibberish lettering. Product UI
  is HTML, using the existing `.demo-card` / `.d-row` / `.d-xp` classes.
- **No horizontal scroll strip**, no section snap, no page transitions, no barba.
- **No sound design.** Not even opt in. It is a maintenance surface with no evidence anybody
  wants it.
- **No `0 to 100` preloader counter.** Fabricated progress, and it costs LCP.
- **No second pin.** The budget is one. Any proposal for a second pin re-opens D3 in writing
  first.
- **No three.js upgrade**, no WebGL above the fold, no WebGL below 620 px.
- **No build step.** Static HTML, CSS, vanilla JS and ES modules, deployed with
  `npx vercel deploy --prod --yes`.
- **No new invented numbers, logos, testimonials or counts.** The scoreboard aesthetic is
  achieved with labels and typography, never with fake stats.

---

## Open questions: RESOLVED at the founder gate, 2026-08-11

**Q1. Hero athlete asset.** GENERATE one under the plain-surfaces prompt discipline from
`LANDING-NOTES.md` (plain kit, no lettering anywhere, duotone-friendly). Founder approves the
image before it ships. P1 ships the angled `clip-path` panel of `img/hero-badminton.jpg`
until the cutout is approved.

**Q2. Eyebrow.** Replaced with `GAME ON`.

**Q3. Retired video files.** Keep in `img/` as previous-era assets, following the
`hero-scoreboard.mp4` precedent. They leave the page, not the repo.

**Q4. Hero CTA.** Confirmed removed. Nav CTA plus the Meet Atlitos CTAs carry conversion.

**Overall plan: APPROVED, build it.** Ship each phase to prod as it lands.
