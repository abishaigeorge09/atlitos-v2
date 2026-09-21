# Founder Taste Reference (research digest, July 2026)

Synthesized from Abishai's four reference projects. The v2 design language must be NEW but learn from all of these. This digest is the source for DESIGN-LANGUAGE.md and packages/theme.

## Recurring through-lines (non-negotiable)
- TypeScript + Supabase + Vercel everywhere. Zod validation, Zustand state, Framer Motion, PWA-minded.
- **JetBrains Mono for numeric readouts** appears in nearly every project.
- An emerald/mint accent recurs, but Atlitos owns ORANGE (brand brief #FF4200, figma prototype #E46136 — token gallery renders both, founder picks at P0 gate).
- Token discipline: components never hardcode hex; single theme source; light + dark first-class.
- Copy rules (strict, from his CLAUDE.md files): NO emojis ever (SVG/lucide icons instead), no em-dashes and no hyphens in visible copy, concise benefit-led microcopy, lowercase-leaning brand voice, toast feedback.

## Reference 1: synth-app (~/synth-app) — the gold standard token architecture
- packages/shared-ui/src/theme/: colors.ts, typography.ts, radii.ts, spacing.ts, motion.ts, elevation.ts; useTheme()/useThemeSafe() hooks; semantic sub-palettes mapped to brand ramp.
- Palette: Off White #F8F6F3 bg, Near Black #111111, Primary Green #10B981 w/ Soft Mint #DDF7EE tint (dark tint #10301F), Golden #EFCB77 secondary, danger #E5484D, muted #8B8B8B, hairline #EAEAEA. Dark-green ink #04140C on green CTAs (ink-on-accent trick).
- Type scale: display 40 / title 32 / h1-h3 / body / callout / caption / overline; negative letter-spacing on headings (-1 to -0.2). SF Pro Display headings, Inter body, JetBrains Mono numerics.
- Radii sm8 md12 lg16 xl20 2xl28 pill999 ("Cal AI soft rounding"). Spacing 4pt base to 5xl:56.
- Component conventions: variant/size prop APIs, haptics on press, SynthText variant system, strict TS.

## Reference 2: GMV.LIVE (~/dev/gmv/GMV.LIVE_codebase) — shadcn dashboards
- Full shadcn/ui + Radix + CVA + tailwind-merge. Dark-first HSL tokens: bg 0 0% 3%, card 0 0% 7%, primary 349 98% 56% (hot pink), accent 174 91% 55% (cyan), --radius 0.75rem, full --sidebar-* token set.
- Patterns to lift: role-based onboarding funnels (OnboardingRole → per-role), sidebar dashboards per role (Admin/Creator/Brand), route guards, deal-room messaging, TikTok-style VideoCard (9:16, rounded-2xl, poster preload + blur swap, muted-autoplay fallback), react-query data layer, waitlist + social proof.

## Reference 3: SRM Student Store (~/dev/store/srmstudentstore) — the signature landing energy
- Dark terminal/brutalist: black bg, neon mint #5fe08c accent, JetBrains Mono body, VT323 display, Georgia serif for the survey surface.
- Signature moves: uppercase mono eyebrow labels with .22em letter-spacing, giant clamp() stat numerals (.bignum up to 230px), square 1.5px-border buttons that invert on hover, custom easings cubic-bezier(0.3,1,0.3,1), scroll reveal, mix-blend-mode difference header, splash intro video.
- Three surfaces deliberately distinct: light homepage, warm paper survey, dark admin.

## Reference 4: synth-platform-legacy — CSS-variable theming
- Tailwind v4 CSS-var driven theming with .dark class, semantic accent ramps each with -subtle rgba(~8%) tints, theme-aware utility classes, safe-area vars, Lenis smooth scroll.

## Synthesis directive for Atlitos v2
- Consumer app: warm premium base (off-white family, warm near-black dark mode), Atlitos orange as the single hero accent with an ink-on-accent pairing (deep warm brown/black ink on orange CTAs, like synth's #04140C-on-green), soft synth radii, Inter + JetBrains Mono numerics, SRM uppercase-mono eyebrows as section labels, subtle tint chips (orange at ~8-10% alpha).
- Portals (court, life, admin): shadcn with the same token values expressed as HSL CSS vars, GMV sidebar dashboard bones but warm-light default + dark toggle (NOT GMV's pink/cyan).
- Motion: SRM easings + framer/reanimated micro-interactions; haptics on mobile presses.
- Brand assets: logo SVGs + Benji/Wendy mascot avatars at ~/Desktop/ATLITOS/04 Design & Brand/.
- Numbers are a design feature: stats, prices, timers always mono with tabular figures.

## Reference 5: Google Shopping (2026-09-17, for the shop search rebuild)

Images in the repo: `references/google-shopping-grid.jpg`, `references/google-shopping-compare.jpg`.
The founder's named precedent: "Google Shopping, but for Atlitos".

What specifically is good, and what we take:

- **The search field is the page.** Everything else (filter chips, grid) sits under one query
  box. No category tree to walk first. We take this: the Shop tab opens on the search field,
  with categories and sports as chips beneath it, never as a separate page.
- **The card is four lines, in a fixed order.** Image, title, price, then "Retailer & more".
  Price is the second most prominent thing after the image; the retailer line tells you it is
  comparable before you tap. We take the order and the "& more" idea as "3 stores".
- **Compare panel lists retailers as rows, cheapest first, each with its own buy action.** The
  price is right aligned and heavy; stock and delivery are a quiet second line. Our compare
  screen (FR-35 to FR-37) already has this shape; the reference confirms it and adds the
  freshness line ("checked 6 h ago") we need because our prices are fetched, not live.
- **Strikethrough old price beside the new one** when a price dropped. We take this only once
  the nightly recheck stores `last_price_change_at`; never fabricated.
- **Images are cut out on a flat light tile.** Product on white with generous padding. Our
  images come from retailers and will not be uniform; the tile background does the
  unifying, so the tile is a token surface, not the image.

What we do not take: the pure white ground and Google's blue, the rating stars (we have no
ratings and will not invent them), the "Free delivery" lines (we do not know delivery), and
the dense chip row of retailer names as filters (our retailer set is small; sport and price
ceiling are the useful chips).

## Reference 6: Stripe dashboard (Mobbin captures, docs/design/references/admin/)

2026-09-21, for the admin portal rebuild (`docs/design/DIRECTION-ADMIN.md`). Six captures of
the live Stripe dashboard: `stripe-home.png`, `stripe-overview-dashboard.png`,
`stripe-transactions-list.png`, `stripe-payment-link-detail.png`, `stripe-billing-tabs.png`,
`stripe-data-table.png`.

- **The grouped sidebar with section labels, a search-first header.** Plain top level items
  (Home, Balances) above labelled groups (Products, then each product's own sub items), a
  search field left of the chrome controls rather than a page level search. We take the
  grouping and the header placement; Atlitos has no "Test mode" toggle or app marketplace icon
  to carry alongside it.
- **Status count tabs above a filter chip row, above a dense table with right aligned mono
  amounts.** The transactions list counts each status in the tab itself ("Failed, 3") rather
  than a separate summary row, and every numeric column right aligns. We take both: `Tabs`
  carries a count per item, and `DataTable`'s `numeric` column flag right aligns through
  `<Mono>` (CLAUDE.md's numeric readout rule, not new for Atlitos, just newly enforced by one
  shared component).
- **The 2fr/1fr detail layout, sectioned cards left, a sticky preview and metadata card
  right.** The payment link detail's `Products` / `Payment methods` / `Details` cards read top
  to bottom on the left while a `Preview` card stays pinned on the right as the page scrolls.
  We take the shape as `DetailLayout`; we do not take Stripe's live device preview, since gear
  detail has no equivalent artifact to preview.
