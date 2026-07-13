/**
 * Corner radius tokens. Soft synth-style rounding, not SRM's hard 1.5px
 * brutalist corners, not full iOS-capsule everything.
 *
 * The button radius decision (docs/design/DESIGN-LANGUAGE.md): cards/sheets
 * are soft (`lg`/`xl`), chips/tags are full `pill`, and primary CTA buttons
 * are deliberately `sm` (8px) rather than a pill, decisive and athletic
 * without reading as brutalist. This is locked, not a per-screen choice.
 */
export const radii = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 28,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radii;

/** The one radius primary CTA buttons and inputs should use. See radii doc. */
export const ctaRadius: RadiusToken = "sm";
