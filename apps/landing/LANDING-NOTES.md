# Landing Page Build Log and Learnings

Session closeout, July 2026. This is the memory for whoever touches `apps/landing/` next.
Live: https://atlitos-landing.vercel.app · Vercel project `atlitos-landing` · Reference: heyparker.ai

## What the page is now

Static HTML + CSS + vanilla JS, no framework, no build step. Deploy with
`npx vercel deploy --prod --yes` from this directory. Commit from the REPO ROOT
(`git add apps/landing` fails if your shell is still cd'd into apps/landing).

Page story, top to bottom:
1. **Cinematic film hero** (`.vhero`): the founder's generated LED scoreboard video
   (watermark removed via ffmpeg delogo, re encoded with dense keyframes for scrubbing,
   `img/hero-scoreboard.mp4`, poster at the 7.9s resting frame). Phase 1 autoplays
   0 to 7.9s then pauses; folder tab nav and scroll hint fade in. Phase 2: 300vh track,
   scroll scrubs 7.9 to 9.88s with rAF inertia, fully reversible, intro never replays.
   Past 80 percent an LED dot veil rises and Section 2 emerges from it.
2. **led-entry**: "Meet Atlitos." + CTAs on the LED matrix darkness.
3. **Problem band** (ember, curved seams, word rotator chip, two icon marquees).
4. **Interlude** typed line + drawn arrows.
5. **Step files**: each step is ONE sticky unit, a third width colored tab attached to its
   own full width white panel, all at the same offset; DOM order slides the next file over
   the previous while docked tabs stay visible. Video slots wired by filename with photo
   posters (`step1-courts.mp4`, `step2-coach.mp4`, `step3-roundup.mp4`).
6. **Features band** (marigold, looping typewriter, notification screen in the card language).
7. **Old way vs Atlitos way**: espresso court diagram, starts on the old way, paths draw
   themselves, auto advances once to the clean line.
8. **Differentiators**: three intent rows (verified courts, ledger money, Empower link card).
9. **Subscription strip**: the plans themselves scroll in a marigold marquee.
10. **Pricing**: sticky What's included card while tiers scroll. Starter 0, Pro 199,
    Elite 499, mono numerals, academy dashed box. NEVER change tiers without the founder.
11. **Voices wall**: two opposite marquees of SAMPLE labeled placeholder quote cards.
    Do not invent real sounding testimonials; swap in real quotes one for one.
12. **Personas** four door cards, espresso dome into:
13. **Empower highlight** (THE HEART OF ATLITOS): flow cards 293 to plus 7 to an athlete,
    dashed PHOTO SLOT wired to `img/empower-story.jpg`, SAMPLE stat tiles with Indian digit
    count ups, lazy loaded three.js seamed ball (`vendor/three.min.js`, WebGL gated,
    CSS fallback circle, hidden under reduced motion).
14. **Footer**: newsletter mailto, link columns, giant parallax logotype.

## Binding guards (checked every deploy)

- Zero JS: every copy string present in plain markup, curl provable. All reveal hidden
  states live ONLY under `html.js` selectors.
- Reduced motion: final states, no sticky tracks, film holds the resting frame without
  autoplay, no idle float, 3D hidden.
- Above the fold never depends on animation: hero has a 12s hard fallback that forces the
  rested state (nav can never stay hidden), a 2.2s reveal fallback, and the poster IS the
  resting frame.
- House copy: no emojis, no hyphens or em dashes in user visible strings (commas and
  periods), mono numerals via JetBrains Mono everywhere.

## Founder taste, learned the hard way

- **Rejects flat "AI slop" compositions**: the first rebuild was called boring and not
  sporty. What worked: real photography (CC0 via Openverse), the cinematic film hero,
  hard ink borders, folder tab and file metaphors carried through nav, steps, and frames.
- **Hates cartoon illustrations**: scoreboard machine drawing, cartoon balls, the big
  semicircle photo circle scene were all killed on request. Photography and real product
  UI mocks only.
- **The reference (heyparker.ai) is the bar for FEEL, not for copying**: the founder
  keeps a DOM level audit of it and expects mechanics matched exactly when they cite them
  (tab widths, sticky offsets, panel colors, stacking order). When they say "like the
  reference", recapture the reference and diff side by side rather than working from memory.
- **Iterates by pointing at deltas**: expect several rounds on any section; ship each
  round to prod so they can react to the live page, not screenshots.
- **Navbar journey**: solid card -> glass (rejected, "do not like the placement") ->
  options gallery at `/nav-options.html` (kept for reference) -> picked OPTION 5, the
  marigold folder tab. Behavior: tucks to wordmark plus CTA on scroll down, reopens on
  any scroll up, always open near the top. They flip flopped between "expand once like
  Parker" and bidirectional; bidirectional is the standing order.
- Empower is the emotional center of the product. Keep it the most highlighted section.

## Engineering learnings and gotchas

- **No JS pinning, ever.** The original founder reported bug (pricing scrolling over a
  stuck features stage) came from GSAP pinning plus overflow. Everything is CSS sticky
  inside fixed height tracks now; the bug class is structurally impossible. GSAP and
  ScrollTrigger still sit unused in `vendor/` and are not loaded.
- **Hidden tab verification trap** (cost hours, twice): backgrounded or automation hidden
  tabs suspend scroll events, IntersectionObserver, CSS transitions, and video loading.
  Symptoms look exactly like broken code (frozen mid opacity values, is-in applied but
  invisible, video readyState 0). Wake the tab with a screenshot, wait, then capture.
  Never conclude a handler is dead from a hidden tab test.
- **Browser CSS cache trap**: cache busting query params on the page URL do NOT bust
  styles.css. Hard reload (cmd shift r) or fetch with cache reload when verifying a
  deployed CSS change. One "bug" was just a stale sheet; the real cause of that layout
  issue was a leftover `shell` class capping width.
- **Video scrubbing encode**: `-g 8 -bf 0 -movflags +faststart` makes currentTime seeks
  land instantly; scrub with a rAF chase (`cur += (target-cur)*0.16`), clamp to the
  window, and only write currentTime when readyState > 1 and the delta is meaningful.
- **ffmpeg delogo** cleanly removes a static generator watermark on dark footage
  (`delogo=x=1118:y=563:w=88:h=80` for the sparkle at 1280x720).
- **Sticky stacking recipe** (the step files): each unit `position: sticky` at the SAME
  top with the SAME z index, one viewport tall, no margins; DOM order paints later units
  over earlier ones; a transparent tab row keeps earlier tabs visible. Deck variants use
  staggered offsets instead.
- **Openverse API** (`api.openverse.org/v1/images/?q=...&license=cc0,pdm`) is the free
  image pipeline; results are hit or miss, ALWAYS eyeball downloads before shipping
  (a "cricket batsman" query returned a gravestone). Resize with sips to 1600w q62.
- **Higgsfield MCP is connected but out of credits**; top up to unlock generation and
  upscale_video from here.

## Open threads (waiting on the founder)

1. `hero-clean.mp4` clean plate (1080p, blank LED panel) to unlock the live HTML LED
   text overlay. Plan, prompt, and cost ladder in ASSET-PROMPTS.md section 7. $0 path
   agreed in principle; parked with "we can get back to this later".
2. Step demo videos, Empower story photo, ambient loop: prompts and exact filenames in
   ASSET-PROMPTS.md; everything drops in with zero code changes.
3. Real quotes for the Voices wall and real or approved Empower numbers to replace the
   SAMPLE tags.
4. Newsletter is a mailto stopgap; real capture needs an endpoint decision.
5. Options gallery `/nav-options.html` and stale hero photos (hero-stadium, basketball,
   badminton, used by the gallery and as film era leftovers) are kept deliberately.

## Deploy and headers (2026-09-12 audit follow up)

### The production site is NOT built from this branch

`www.atlitos.com` is served from `origin/worktree-atlitos-landing-pixel-match`, not from
`main`. Proof: the live `styles.css` is md5 identical (`47c7cc36fd4808024999ecb8a22ad381`)
to that branch's copy, and differs from `main`'s. That branch forked at `1199955`, carries
16 landing commits `main` does not have (the COLD OPEN kinetic hero, GSAP 3.13 plus Lenis,
self hosted variable fonts under `fonts/`, the `motion/` ES module system), and is missing
the one landing commit `main` does have, `bd0ba6c` (privacy, terms, content policy).

That single fact explains both headline audit findings:

- `/content-policy` returns 404 because the deployed branch has no legal pages at all.
- The homepage has no legal links for the same reason.

Neither is a defect in `main`. `main` has `content-policy.html` tracked and committed, and
`index.html` links `/privacy`, `/terms`, `/content-policy` in the footer. Both remotes have
`main` at the same sha as the local checkout, so nothing is unpushed. The gap is a branch
that was never reconciled.

The deployed branch's `vercel.json` is also only `{"outputDirectory": "."}`, with no
`cleanUrls`. Even if the legal pages were merged in, the extensionless URLs would 404 until
`cleanUrls` lands there too.

**Whoever reconciles these branches owns the fix.** Everything below lives on `main` and
reaches production only after that merge, or after the Vercel project is repointed.

### What changed on main

- `vercel.json` gained a `headers` block on `/(.*)`: HSTS with `includeSubDomains` and
  `preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  strict-origin-when-cross-origin`, and a `Permissions-Policy` that denies camera,
  microphone, geolocation and payment (none are used).
- CSP ships in two parts on purpose. The enforcing `Content-Security-Policy` carries only
  the structural directives that cannot break a resource load: `base-uri`, `object-src`,
  `frame-ancestors`, `form-action`, `upgrade-insecure-requests`. The full resource policy
  ships as `Content-Security-Policy-Report-Only` so it can be watched in DevTools before it
  is promoted. To promote it, rename the report only key to `Content-Security-Policy`,
  fold the structural directives in, and drop the old entry.
- The report only policy is a deliberate superset of both builds: `style-src` and
  `font-src` allow the Google Fonts origins `main` still uses, while `img-src 'self' data:`
  covers the deployed branch's inline SVG grain texture. Everything else on both builds is
  same origin.
- `script-src` pins the one inline bootstrap script by hash. Both builds use the identical
  line, `document.documentElement.classList.add("js");`, so the hash
  `sha256-WZRJfWvsnNCPcxzZwvyhovnZGqhZaC+8gPGPRbx6wTk=` covers both. If that line is ever
  edited the hash must be recomputed, otherwise the page silently falls back to the no JS
  path.
- `robots.txt` and `sitemap.xml` are new. The sitemap lists only the four public pages on
  the canonical `www.atlitos.com` origin in `cleanUrls` form. No app, portal or admin URL
  appears in either file, and none should ever be added.
- `robots.txt` disallows `/nav-options`, `/LANDING-NOTES.md` and `/ASSET-PROMPTS.md`.
  These are internal build notes and a scratch gallery that ship inside the static output
  directory and are publicly fetchable. `LANDING-NOTES.md` in particular names the Vercel
  project. Robots is advisory only. If they should be genuinely unreachable they need to be
  moved out of the output directory.
- `vercel.json` rewrites `/favicon.ico` to `/img/favicon.png`, so the bare favicon request
  stops 404ing without adding a binary. This only works once `img/favicon.png` is git
  added. It is currently untracked, which is why the icon has never deployed.

### Horizontal overflow: measured, not a defect

The audit reported roughly 55px of sideways scroll at a 390px viewport. Measured on `main`
with headless Chromium at 320, 360, 375, 390, 414, 430, 480, 540, 640, 768, 834 and 1024px
across all four pages, scrolling the full page height at each width: `scrollWidth` equals
the viewport width every time, and no element escapes a clipping ancestor.

On the live site the 445px reading reproduces, but it is transient. The offender is
`.diff-row` mid tween, at `matrix(0.99961, -0.0279216, 0.0279216, 0.99961, -70, 0)`: the
GSAP entry animation slides each row in from 70px off axis with a slight rotate, and 342px
of row plus 70px of offset plus rotation slop lands at 445. Once the tween settles,
`scrollWidth` returns to 390. `window.scrollTo(9999, 0)` leaves `scrollX` at 0, and both
`documentElement.scrollLeft` and `body.scrollLeft` stay 0, so the page cannot actually be
scrolled sideways. The deployed branch's `html { overflow-x: clip }` is holding, and its
author already left a comment explaining why `clip` and never `hidden`.

No CSS change was made. There is nothing to paper over.

One alignment worth folding in at merge time: `main` still uses `body { overflow-x: hidden }`,
the weaker pattern. The deployed branch's `html { overflow-x: clip }` is the better rule and
should win.

### Contact addresses, unresolved

The site uses `founder@synthsports.co` in 15 places (`index.html` at lines 68, 422, 559,
573, 586, 601; `privacy.html` at 62, 222, 273; `terms.html` at 47, 158, 165;
`content-policy.html` at 103, 111, 119). This exposes the parent entity rather than an
Atlitos address, and App Store guideline 1.2 wants a monitored support contact.

`support@elsheph.com` is NOT on the site. It appears once in the repo, in
`docs/qa/APP-STORE-SUBMISSION-PACK.md` line 130, describing the App Store Connect record.

Nothing was changed. No `@atlitos.com` address exists anywhere in this repo, and inventing
one would ship a dead mailto. A real mailbox has to be provisioned first, then swapped into
all 15 sites plus the App Store Connect record.
