# Atlitos Design Language v2

Status: draft for P0 gate. The one open decision is marked **PENDING P0 GATE** below (orange vs ember). Everything else is locked and implemented in `packages/theme`.

This is a NEW language, synthesized from four reference projects per `docs/design/TASTE.md`, not copied from any one of them. Source of truth for values is `packages/theme`, this document explains the values and the reasoning; the package is what code imports. If the two ever disagree, fix the package and then fix this doc in the same change.

## Principles

1. **Tokens only.** No component, screen, or portal page ever writes a raw hex, px, or duration. Everything routes through `@atlitos/theme`. This is the single hardest rule in the whole design system and the biased approver checks it at every gate.
2. **Warm, not clinical.** Off white and near black both carry a warm undertone (paper and espresso, not hospital white and OLED black). Sport gear, not SaaS dashboard.
3. **Orange earns its keep.** One hero accent, used sparingly, always with an ink pairing that keeps it legible. Everything else is neutral so the accent reads as a decision, not wallpaper.
4. **Numbers are a feature.** Prices, timers, scores, stats: always JetBrains Mono, always tabular figures, so digits never jitter as they update.
5. **Light and dark are both first class.** Dark mode is not an inverted afterthought; it has its own tuned surfaces, borders, and tints.
6. **Quiet motion.** Interface transitions are fast and settle cleanly. Motion earns attention only for reveals and press feedback, never for decoration.

## Color

### Brand accent: PENDING P0 GATE

Two candidates ship side by side in the token gallery for the founder's Phase 0 pick:

| Token | Hex | Source |
|---|---|---|
| `brand.orange` | `#FF4200` | Brand brief |
| `brand.ember` | `#E46136` | v1 Figma prototype |

Both are permanent tokens (kept forever for reference and for any surface that intentionally wants the other tone, e.g. a secondary badge ramp). The single **active** accent is `color.accent`, which today aliases `brand.orange` as a placeholder default. This is a one line swap in `packages/theme/src/colors.ts` (search `TODO(P0-GATE)`), nothing else in the codebase references `brand.orange` or `brand.ember` directly, everything reads `color.accent`, so the founder's pick at the gate changes one file.

Both candidates sit at nearly identical luminance (relative luminance ≈ 0.25), which is why they share one ink pairing below, the gate pick is about hue character (fire red vs terracotta), not contrast math.

### Ink on accent

Orange at this saturation is darker than it looks. Measured against both candidates, dark ink beats white ink on contrast (white on `#FF4200` ≈ 3.5:1, fails AA text; near black ink on `#FF4200` ≈ 6:1, passes). So the ink-on-accent pairing is the inverse of synth's dark-ink-on-mint trick applied to a darker hue family:

- `ink.onAccent` = `#2A0E02` ("Ember Ink"), deep warm brown-black, used for text and icons sitting on top of any accent fill (primary CTA label, active tab indicator, selected chip text, badge glyphs).
- This single ink value works unchanged across both accent candidates and both light/dark app themes, because it is contrast-paired to the accent fill itself, not to the surrounding surface.

### Ink on media

`inkOnMedia` (`#FFFFFF`, `packages/theme/src/colors.ts`) is the text colour for copy laid over a photo or video behind the dark `overlay` scrim (promo banners, media cards). The scrim is dark in both themes, so this ink is theme independent. Never use `textInverse` over media: it flips to near black in dark mode, which rendered the Home promo banner as dark text on a grey slab (fixed 2026-09-23).

`mediaBackdrop` (`#0D0D0D`) is the letterbox behind video and clip thumbnails (Clutch feed, post view, clip cards, coach review video), dark in both themes. Never use `colors.text` / `bg-text` as a video backdrop: it turns cream in dark mode. Media surfaces therefore look the same in light and dark mode: `mediaBackdrop` underneath, `overlay` scrims, `inkOnMedia` on top.

### Light theme: "Paper"

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FBF7F1` | App background, warm paper |
| `surface` | `#FFFFFF` | Elevated surfaces, sheets |
| `surfaceMuted` | `#F2EBE0` | Inputs, unselected option cards, skeletons |
| `card` | `#FFFFFF` | Cards |
| `border` | `#E7DECF` | Hairlines |
| `borderStrong` | `#D6C9B4` | Dividers that need to read as structure |
| `overlay` | `rgba(28,20,13,0.45)` | Scrim behind sheets/modals |
| `text` | `#1C1712` | Primary ink |
| `textSecondary` | `#5B5248` | Secondary copy |
| `textTertiary` | `#8C8072` | Meta, placeholders, timestamps |
| `textInverse` | `#FBF7F1` | Text on dark/near-black fills |

### Dark theme: "Espresso"

| Token | Hex | Use |
|---|---|---|
| `bg` | `#14100B` | App background, warm near black |
| `surface` | `#1E1810` | Elevated surfaces, sheets |
| `surfaceMuted` | `#281F16` | Inputs, unselected option cards, skeletons |
| `card` | `#1E1810` | Cards |
| `border` | `#332A1E` | Hairlines |
| `borderStrong` | `#453A2A` | Dividers that need to read as structure |
| `overlay` | `rgba(0,0,0,0.6)` | Scrim behind sheets/modals |
| `text` | `#F5EEE3` | Primary ink |
| `textSecondary` | `#B6A996` | Secondary copy |
| `textTertiary` | `#8A7C68` | Meta, placeholders, timestamps |
| `textInverse` | `#14100B` | Text on light fills inside dark mode |

Accent fill (`color.accent`, both candidates), accent pressed state, and accent tint chip are theme aware:

| Token | Light | Dark |
|---|---|---|
| `accentPressed` (orange) | `#D93800` | `#D93800` |
| `accentPressed` (ember) | `#C24E27` | `#C24E27` |
| `accentTint` | `#FEE7DA` | `#3A1B0C` |

### Semantic (success / warning / info / danger)

Each has a base and a subtle tint (tint = roughly 8–10% of the base blended toward the surface, matching the reference projects' `-subtle` convention). Danger is deliberately a colder, more crimson red than the accent (hue ~350 vs the accent's ~17) so error states never get mistaken for brand orange.

| Token | Light base | Light tint | Dark base | Dark tint |
|---|---|---|---|---|
| `success` | `#1B8A5A` | `#E1F3E8` | `#34C787` | `#163326` |
| `warning` | `#B9770E` | `#FBEBD2` | `#E3A83B` | `#3A2A11` |
| `info` | `#1D6FC4` | `#DFEBFB` | `#5B9FE8` | `#16273A` |
| `danger` | `#D7263D` | `#FBE1E4` | `#F0616F` | `#3A1418` |

### Aurora (auth backdrop)

The auth and onboarding surface (`AuthScene`) renders a slow, warm animated aurora, a mesh of drifting react-native-svg radial glows over a cream (light) or espresso (dark) wash. Its gradient stops are the one place the palette needs warm intermediate points between the two brand accents and the paper background, so they live as a dedicated token set `auroraStops` in `packages/theme` (`ember`, `orange` reuse the brand accents; `gold` `#F4A15D` and `cream` `#FFE3CE` are the two hand picked warm mids). Screens import `auroraStops`, never hardcode these. Motion is reanimated driven and freezes to a static composition under reduced motion. Glass form cards over the aurora are translucent token derived rgba fills of `surface`, not a native blur.

## Typography

**CHANGED(2026-09-10):** the UI face moved **Inter -> Urbanist** per the founder's brand
direction; see `packages/theme/src/typography.ts` for the source of truth and the "CHANGED"
note there. Every table below reflects Urbanist, not Inter. **JetBrains Mono** for every
numeric readout (prices, scores, timers, stat counters, XP, distances), always with tabular
figures (`font-variant-numeric: tabular-nums` on web, tabular lining figures on mobile) so
digits don't reflow as values tick. The admin kit (`apps/admin/src/components/kit/`, Part B
of `snappy-foraging-meadow.md`) is where this pairing is enforced by shared components rather
than left to each screen: `<Mono>` for readouts, `--font-sans`/`--font-mono` (self hosted via
`@fontsource-variable/urbanist` and `@fontsource-variable/jetbrains-mono`) for everything else.

Headings carry negative letter spacing (tighter as size increases) for a denser, more athletic feel than default Urbanist tracking.

| Variant | Family | Weight | Size | Line height | Letter spacing | Notes |
|---|---|---|---|---|---|---|
| `display` | Urbanist | Bold (700) | 40 | 46 | -1.0 | Hero numerals/headlines, sparingly |
| `title` | Urbanist | Bold (700) | 32 | 40 | -0.8 | Screen/page titles |
| `h1` | Urbanist | Bold (700) | 28 | 34 | -0.6 | Section headers |
| `h2` | Urbanist | Semibold (600) | 24 | 30 | -0.4 | Card/group titles |
| `h3` | Urbanist | Semibold (600) | 20 | 26 | -0.2 | Subsection titles |
| `body` | Urbanist | Regular (400) | 16 | 24 | 0 | Default copy |
| `callout` | Urbanist | Regular (400) | 15 | 22 | 0 | Secondary copy, list rows |
| `label` | Urbanist | Semibold (600) | 13 | 18 | 0.1 | Form labels, chip text, buttons |
| `caption` | Urbanist | Regular (400) | 12 | 16 | 0 | Meta, timestamps, helper text |
| `overline` | JetBrains Mono | Semibold (600) | 11 | 14 | 0.22em, UPPERCASE | Eyebrow section labels (SRM signature move) |

Numeric variants (all JetBrains Mono, tabular figures):

| Variant | Weight | Size | Line height | Use |
|---|---|---|---|---|
| `numericDisplay` | Bold (700) | 40 | 46 | Hero stat numerals |
| `numericLg` | Semibold (600) | 24 | 30 | Prices in checkout/booking summaries |
| `numericBase` | Medium (500) | 16 | 22 | Inline prices, scores, durations |
| `numericSm` | Medium (500) | 13 | 18 | Compact stat chips, table cells |

The overline is the one place the design language borrows SRM's brutalist mono energy directly: uppercase, wide-tracked, monospace, used as a small eyebrow label above a section title (e.g. `COURT DETAILS`, `PAYMENT SUMMARY`, `XP EARNED`). It is a label, never a paragraph.

## Radii

Soft synth-style rounding, not SRM's hard 1.5px brutalist corners and not full iOS-capsule everything.

| Token | Value | Use |
|---|---|---|
| `none` | 0 | Full-bleed media |
| `xs` | 4 | Tag/badge micro-corners |
| `sm` | 8 | **Primary CTA buttons**, inputs |
| `md` | 12 | Small cards, list rows |
| `lg` | 16 | Cards, sheets |
| `xl` | 20 | Large cards, feature tiles |
| `2xl` | 28 | Hero cards, bottom sheet tops |
| `pill` | 999 | Chips, tags, filter pills, avatars |

**The button radius debate, resolved:** cards and sheets are soft (`lg`/`xl`, the synth influence). Chips and tags are full pill (SRM eyebrow energy channeled into a soft shape). Primary CTA buttons are `sm` (8px), deliberately not a pill. A full-pill CTA reads as a wellness/meditation app; a hard square (SRM's literal 1.5px corner) reads too brutalist for a consumer superapp with payments and booking flows. `radius.sm` keeps buttons looking decisive and athletic while staying inside the same soft-rounding family as everything else. This is a locked decision, not a per-screen judgment call.

## Spacing

4pt base scale, consistent across mobile and web.

| Token | Value |
|---|---|
| `none` | 0 |
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 20 |
| `2xl` | 24 |
| `3xl` | 32 |
| `4xl` | 40 |
| `5xl` | 56 |

Screen horizontal padding on mobile is `spacing.lg` (16). Portal page gutters use `spacing.2xl`/`3xl` at wider breakpoints.

## Elevation

Shadows are warm-tinted (never pure `#000` at high opacity) and expressed as platform-neutral tokens (`x`, `y`, `blur`, `spread`, `color`, `opacity`) so mobile (RN shadow props) and web (`box-shadow`) both derive from the same source.

| Token | Use |
|---|---|
| `none` | Flush surfaces |
| `sm` | Resting card lift, list rows |
| `md` | Prominent cards, floating controls, default elevated Card |
| `lg` | Sheets, popovers, dropdowns |
| `xl` | Modals, full-screen overlays |

## Motion

| Token | Value | Use |
|---|---|---|
| `duration.fast` | 120ms | Press feedback, toggles |
| `duration.base` | 200ms | Default transitions, fades |
| `duration.slow` | 320ms | Sheet/modal enter |
| `duration.slower` | 480ms | Full-screen transitions, splash |
| `easing.standard` | cubic-bezier(0.2, 0, 0, 1) | Default transitions |
| `easing.decelerate` | cubic-bezier(0, 0, 0.2, 1) | Entering content |
| `easing.accelerate` | cubic-bezier(0.4, 0, 1, 1) | Exiting content |
| `easing.srm` | cubic-bezier(0.3, 1, 0.3, 1) | Signature snap: hover/press states, stat counters, scroll reveals, the one deliberately energetic easing in the system, borrowed from SRM |
| `spring.standard` | damping 18, stiffness 220 | Press scale, list stagger reveal |
| `stagger.step` | 40ms | Per-item delay in list/grid reveals |
| `pressScale` | 0.96 | Scale factor on press-in for tactile feedback |

Haptics accompany press feedback on mobile (light impact on primary actions, selection change on toggles/segmented controls). Web has no haptic equivalent; rely on the press scale + `easing.srm` snap instead.

## Icons

Lucide only, everywhere, always. No emoji, ever, as an icon substitute (this is also a hard copy rule below). Standard sizes: `16` inline with `label`/`caption` text, `20` inline with `body`, `24` default UI icon (nav, buttons, list rows), `32` feature/empty-state icons, `48` empty-state/onboarding hero icons. Stroke width `1.75` default, `2` for the 16px size only (thin strokes disappear at small sizes). Icons always take a color token, never a raw hex; on accent fills they use `ink.onAccent`.

## Component tone

- **Cards**: soft rounded (`radius.lg`/`xl`), `elevation.sm` at rest, `elevation.md` when interactive/pressed-hover. White/surface fill, hairline border in light mode, no border in dark mode (elevation alone reads there).
- **Chips/tags/pills**: `radius.pill`, `label` typography, tint background + base-color text for status chips (`successTint` bg + `success` text, etc.), `accentTint` bg + `accent` text for brand-flavored chips.
- **Buttons**: primary uses `color.accent` fill + `ink.onAccent` label at `radius.sm`; secondary uses `surface` fill + `borderStrong` outline + `text` label at `radius.sm`; destructive uses `danger` fill + white label at `radius.sm`. Button height 48 (mobile primary tap target), 40 (web/compact/secondary).
- **Inputs**: `surfaceMuted` fill, `radius.sm`, `border` outline, `accent` outline on focus (2px), `danger` outline on error.
- **Money surfaces**: every screen touching money renders a `BillSummary` component (line items in `body`/`callout`, totals in `numericLg` mono), never a bare number. This mirrors the biased-approver's hard rule and is a design requirement, not just a build one. On mobile this is `apps/mobile/src/components/molecules/BillSummary.tsx`; on the web portals it is `@atlitos/ui-web`'s `BillSummary` (added in the Courts vertical slice pass), same rows-plus-total shape, expressed as vanilla CSS reading the same token set instead of nativewind classNames.
- **Portals (court, life, admin)**: shadcn/ui component bones, same token values expressed as HSL CSS variables (see `packages/theme/src/index.ts` `hslVar`/`toCssVars` helpers), warm-light default with a dark toggle. GMV's sidebar-dashboard structure, not GMV's pink/cyan palette. **ADR-012 drift, admin only:** `apps/admin` has no Tailwind/shadcn pipeline, so it does not use shadcn primitives; its component bones live at `apps/admin/src/components/kit/` instead, same token values, plain CSS classes prefixed `ak-`. Revisit when `packages/ui-web` grows a shared shadcn set.

## Shop tiles and compare rows (direction C)

Amazon's card, on Atlitos ground (`docs/design/DIRECTION-SHOP.md`, direction C, approved). Applies
to `GearResultTile` (the browse grid) and `OfferRow dense` (the affiliate compare screen,
`/shop/affiliate/[id]`).

- **Image tile**: flat square, `radius.none`, no border, filled with `color.surface` so a
  retailer photo shot on white blends into the tile. The product image sits centred at 80
  percent of the tile; the `Package` glyph is the placeholder for a product with no image yet.
- **Grid tile sizes**: three only, `13` (brand semibold, title regular), `12` (retailer line,
  freshness), `18` mono semibold (the price, the one accent).
- **Compare row sizes**: `13` semibold (retailer name), `13` semibold mono in `color.text` (the
  price, never the accent except on the cheapest row), `12` (in stock/out of stock plus
  freshness). The screen title above the rows is the fourth and last size on the surface.
- **One accent per surface**: the grid tile's price is the accent; the compare screen's one
  accent is the word "Cheapest" on the cheapest in stock row, never a border or a price color on
  every row. No strikethrough price on the compare rows (S3 hard decision 2: `previous_price`
  does not exist yet).
- **Freshness is always present, never loud**: `checked N h ago` / `checked N days ago` in
  `color.textTertiary`, or `not checked yet` for an offer the nightly job has never reached.
- **Out of stock**: the whole row at 60 percent opacity, no buy action, so a price the shopper
  cannot actually buy is never presented as buyable.

## Interactive cards: the pressable overlay pattern

**Never nest a `Pressable` (or any `Touchable*`) inside another one.** Under react-native-web a pressable carrying `role`/`accessibilityRole="button"` renders a real `<button>`, so a card that wraps its own secondary actions emits `Console Error: <button> cannot contain a nested <button>`, which is invalid HTML and a hydration error. On native there is no warning at all, so the same mistake fails silently: the tap target semantics are ambiguous and screen readers announce one control containing another. This shape was found in five components at once (ClutchPostCard, ProductCard, WishlistGrid, SessionCard, CourtCard), so it is a rule now, not advice.

A card that is itself tappable AND carries its own action controls (a wishlist heart, Accept and Decline, Add to cart, a like or share rail) is built like this:

1. The card container is a plain `View`. It never takes `onPress` and never carries a button role.
2. The card level press is a `Pressable` with `style={StyleSheet.absoluteFill}`, `accessibilityRole="button"` and a meaningful `accessibilityLabel`, rendered as the **first** child so every later sibling paints and hit tests above it. Render it conditionally, so a card with no `onPress` gets no overlay and no spurious button.
3. Purely presentational subtrees (images, titles, price blocks, info rows) are wrapped in a `View` with `pointerEvents="none"`, so taps anywhere over them fall through to the overlay and the whole card stays tappable.
4. Layout wrappers that contain action controls get `pointerEvents="box-none"` plus `style={{ zIndex: 1 }}`. `box-none` makes the wrapper itself transparent to touches while its children stay interactive; the `zIndex` guarantees the controls sit above the absolutely positioned overlay rather than under it.
5. Action controls are therefore **siblings** of the overlay, never descendants. Each keeps its own `accessibilityRole="button"`, its own label, and the 44pt minimum tap target (`min-h-11 min-w-11`, or `hitSlop` where the visual affordance is deliberately smaller).

Consequence to accept: the container can no longer carry `active:opacity-90`, because the pressed state now lives on a transparent overlay. Losing card level press feedback is the correct trade for valid HTML and unambiguous hit resolution. If a card needs press feedback, put it on the overlay, not on the container.

The one sanctioned exception is the modal backdrop idiom (`ConfirmSheet`, `LoginGateModal`, and the variant pickers): a roleless backdrop `Pressable` wrapping a roleless `Pressable` that calls `event.stopPropagation()` to swallow sheet taps. Neither carries a button role, so neither renders a `<button>`, and the nesting is what makes dismiss-on-backdrop work. Do not add `accessibilityRole="button"` to either of those.

Reference implementation: `apps/mobile/src/components/molecules/ClutchPostCard.tsx` (feed variant). The invariant to check in review: no `Pressable` is an ancestor of another `Pressable` in the same card.

## The floating nav: nothing pinned sits under it

The bottom nav (`apps/mobile/src/components/ui/bottom-nav.tsx`) is a glass pill that is **absolutely positioned** over every screen in the `(tabs)` group. It takes no layout height on purpose, so pages run full bleed and scroll under the glass instead of stopping at a dead strip of background. The cost is that the bar covers whatever is beneath it, and a control that cannot scroll away (a sticky CTA, a chat composer, the caption and action rail on a full bleed clip, the last row of a list) ends up under the pill. That happened on the coach profile, the court detail, both pay screens, the group join and renew footers, the Post viewer, the feed and every tab list at once, so it is a rule now.

Every screen rendered inside `(tabs)`, and every organism that can be rendered there, reads `useNavBarInset()` from `bottom-nav.tsx` and applies it in one of two ways:

1. **Scrollables** pad their content: `contentContainerStyle={{ ..., paddingBottom: navInset + spacing.xl }}`. The page still runs under the glass; the final row can be scrolled clear of it.
2. **Pinned controls** pad or offset by it so the bar stays at the bottom and the control sits above it: a footer gets `paddingBottom: navInset + spacing.lg` on top of its own padding, an absolutely positioned overlay gets `bottom: navInset`, a composer pads by it only while the keyboard is down (`useKeyboardShown()` in `src/lib/use-keyboard-shown.ts`), because with the keyboard up the bar is behind the keys and the padding would only open a gap.

The value is `NAV_BAR_INSET` (72, the pill's full layout height plus its top gutter, documented in the component) plus the same bottom safe area the bar pads with. It is provided by `(tabs)/_layout.tsx` and reads **0 outside the tabs**, so a shared component (the profile screen, `ClutchProfileView`, `ChatThreadList`) adds it unconditionally and is correct on both a tab and a pushed route. Never hand a screen `insets.bottom` on top of it; the inset already carries the safe area. A `SafeAreaView` that used `edges={['bottom']}` for a pinned control drops that edge when it adopts the inset.

Reference implementations: `(tabs)/coaching/coach/[id].tsx` (pinned footer), `(tabs)/chat/[id].tsx` (keyboard aware composer), `(tabs)/clutch/post/[id].tsx` (absolute overlays), `components/molecules/ClutchPostCard.tsx` (`bottomInset` prop, passed only by the full screen feed).

## Voice and copy rules

- No emojis, anywhere, ever, including in placeholder copy, commit-adjacent user-facing strings, and empty states. Use a lucide icon instead.
- No em-dashes and no hyphens in user-visible copy strings. Use commas or periods, or rephrase. Ordinary compound words are fine in prose docs like this one. This rule targets UI copy strings specifically. Write "book a court, get instant confirmation, no back and forth" rather than "book a court, get instant confirmation, no back-and-forth."
- Concise, benefit-led microcopy. Lead with what the user gets, not the mechanism. "Get paid the day you coach" not "Payouts are processed via Razorpay Route on session completion."
- Lowercase-leaning brand voice in marketing surfaces (splash, empty states, onboarding); sentence case in functional UI (buttons, labels, form fields) for legibility and scanability.
- Toasts for feedback, not modals, for anything reversible or non-blocking (added to cart, saved, copied). Modals are reserved for confirmation of destructive or money-moving actions.
- Currency is always INR with Indian digit grouping, rendered mono: `formatINR(231000)` → `₹2,31,000`. Never render a bare `₹` number without grouping, and never render money in Inter.
- Numbers (prices, scores, XP, timers, counts) are always JetBrains Mono with tabular figures, in prose and in UI alike where a live/comparable value is shown.

## Token gallery (P0 deliverable)

A small gallery screen/page renders both accent candidates side by side against every semantic color, both themes, all typography variants, and the full button/card/chip set, so the founder can make the accent call by looking at real components rather than a swatch grid. This gallery consumes `@atlitos/theme` directly and is the P0 gate artifact referenced in `docs/PLAN.md`.
