/**
 * Corner radius tokens. Soft synth-style rounding, not SRM's hard 1.5px
 * brutalist corners, not full iOS-capsule everything.
 *
 * The button radius decision (docs/design/DESIGN-LANGUAGE.md): cards/sheets
 * are soft (`lg`/`xl`), chips/tags are full `pill`.
 *
 * CHANGED(2026-09-10): CTA buttons moved from `sm` (8px) to `pill`. The
 * original call was deliberately `sm`, "decisive and athletic without
 * reading as brutalist", and it was locked. The founder's approved login
 * reference draws every CTA as a full capsule, so the lock is lifted and
 * `buttonRadius` is now the swap point. Inputs did NOT move: the same
 * reference keeps them at `sm`, so buttons and fields no longer share one
 * radius and `ctaRadius` below is scoped to fields only.
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

/** The radius text fields, selects and OTP boxes use. See radii doc. */
export const ctaRadius: RadiusToken = "sm";

/** The radius primary CTA buttons use. See radii doc. */
export const buttonRadius: RadiusToken = "pill";
