/**
 * Color tokens, the Atlitos brand kit. See docs/design/DESIGN-LANGUAGE.md for
 * the full rationale. Consumers NEVER hardcode hex: read `colors.light.*` /
 * `colors.dark.*` (or the resolved palette from your app's theme provider).
 *
 * Brand accent is a two candidate decision pending the founder's Phase 0 gate
 * (docs/PLAN.md). Both candidates are permanent tokens; `accent` is the single
 * active pick and the one place the rest of the codebase should ever read from.
 */

/** Brand accent candidates, both permanent, both shown in the P0 token gallery. */
export const brand = {
  /** Brand brief candidate. */
  orange: "#FF4200",
  /** v1 Figma prototype candidate. */
  ember: "#E46136",
} as const;

/**
 * Active accent swap point. TODO(P0-GATE): set to `brand.ember` if the founder
 * picks ember at the Phase 0 gate. This is the ONLY line that needs to change,
 * nothing else in the codebase should reference `brand.orange` / `brand.ember`
 * directly, only `color.accent`.
 */
const ACTIVE_ACCENT: string = brand.orange;

/** Pressed state per accent candidate, so the gallery can preview both live. */
const accentPressed: Record<"orange" | "ember", string> = {
  orange: "#D93800",
  ember: "#C24E27",
};

/**
 * Deep warm brown-black ink used for text/icons ON TOP of an accent fill
 * (primary CTA labels, active tab indicators, selected chip text, badge
 * glyphs). Both accent candidates sit at ~0.25 relative luminance, so dark
 * ink beats white ink on contrast for either pick (~6:1 vs ~3.5:1), one ink
 * value serves both candidates and both app themes unchanged.
 */
export const inkOnAccent = "#2A0E02";

export interface ColorPalette {
  // Surfaces
  bg: string;
  surface: string;
  surfaceMuted: string;
  card: string;
  overlay: string;

  // Text
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  // Lines
  border: string;
  borderStrong: string;

  // Brand accent (resolved to the active pick)
  accent: string;
  accentPressed: string;
  accentTint: string;
  /** Ink for text/icons drawn on top of `accent` / `accentPressed` fills. */
  inkOnAccent: string;

  // Both accent candidates, always available for the token gallery / gate.
  brandOrange: string;
  brandEmber: string;

  // Semantic
  success: string;
  successTint: string;
  warning: string;
  warningTint: string;
  info: string;
  infoTint: string;
  danger: string;
  dangerTint: string;
}

// Light, "Paper": warm off-white surfaces, warm near-black ink.
export const lightColors: ColorPalette = {
  bg: "#FBF7F1",
  surface: "#FFFFFF",
  surfaceMuted: "#F2EBE0",
  card: "#FFFFFF",
  overlay: "rgba(28,20,13,0.45)",

  text: "#1C1712",
  textSecondary: "#5B5248",
  textTertiary: "#8C8072",
  textInverse: "#FBF7F1",

  border: "#E7DECF",
  borderStrong: "#D6C9B4",

  accent: ACTIVE_ACCENT,
  accentPressed: ACTIVE_ACCENT === brand.orange ? accentPressed.orange : accentPressed.ember,
  accentTint: "#FEE7DA",
  inkOnAccent,

  brandOrange: brand.orange,
  brandEmber: brand.ember,

  success: "#1B8A5A",
  successTint: "#E1F3E8",
  warning: "#B9770E",
  warningTint: "#FBEBD2",
  info: "#1D6FC4",
  infoTint: "#DFEBFB",
  danger: "#D7263D",
  dangerTint: "#FBE1E4",
};

// Dark, "Espresso": warm near-black surfaces, warm off-white ink.
export const darkColors: ColorPalette = {
  bg: "#14100B",
  surface: "#1E1810",
  surfaceMuted: "#281F16",
  card: "#1E1810",
  overlay: "rgba(0,0,0,0.6)",

  text: "#F5EEE3",
  textSecondary: "#B6A996",
  textTertiary: "#8A7C68",
  textInverse: "#14100B",

  border: "#332A1E",
  borderStrong: "#453A2A",

  accent: ACTIVE_ACCENT,
  accentPressed: ACTIVE_ACCENT === brand.orange ? accentPressed.orange : accentPressed.ember,
  accentTint: "#3A1B0C",
  inkOnAccent,

  brandOrange: brand.orange,
  brandEmber: brand.ember,

  success: "#34C787",
  successTint: "#163326",
  warning: "#E3A83B",
  warningTint: "#3A2A11",
  info: "#5B9FE8",
  infoTint: "#16273A",
  danger: "#F0616F",
  dangerTint: "#3A1418",
};

export const colors = { light: lightColors, dark: darkColors } as const;

export type ThemeMode = keyof typeof colors;
export type ColorToken = keyof ColorPalette;
