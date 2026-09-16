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
  /** The logo's orange, sampled from the artwork itself. */
  orange: "#FF4D00",
  /** v1 Figma prototype candidate. */
  ember: "#E46136",
} as const;

/**
 * Active accent swap point. DECIDED(P0-GATE, 2026-07-13): founder picked
 * ember at the Phase 0 token gallery gate.
 *
 * REVERSED(2026-09-10): founder moved to orange so the product matches the
 * logo, which is #FF4D00 throughout. `brand.orange` was also corrected from
 * the brief's approximate #FF4200 to the value actually used in the artwork.
 * This remains the ONLY line that changes if the pick is revisited; nothing
 * else in the codebase should reference `brand.orange` / `brand.ember`
 * directly, only `color.accent`.
 */
const ACTIVE_ACCENT: string = brand.orange;

/** Pressed state per accent candidate, so the gallery can preview both live. */
const accentPressed: Record<"orange" | "ember", string> = {
  orange: "#D94000",
  ember: "#C24E27",
};

/**
 * Ink used for text/icons ON TOP of an accent fill (primary CTA labels,
 * active tab indicators, selected chip text, badge glyphs).
 *
 * White, per the approved login reference, which sets white labels on the
 * orange CTAs. Note the tradeoff: #FF4D00 sits at ~0.26 relative luminance,
 * so white lands at ~3.3:1 against it. That clears WCAG AA for large text
 * (>=18.66px bold or >=24px), which is what every accent fill in the design
 * carries. Do NOT put small text on an accent fill: it would fail AA. Use
 * `accentTint` with normal `text` for anything at body size.
 */
export const inkOnAccent = "#FFFFFF";

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

// Light: neutral greys on white, the ChatGPT light palette the founder asked
// for. Separation comes from hairline borders rather than tinted fills, which
// is why `card` and `bg` are both pure white.
export const lightColors: ColorPalette = {
  bg: "#FFFFFF",
  surface: "#F9F9F9",
  surfaceMuted: "#ECECEC",
  card: "#FFFFFF",
  overlay: "rgba(0,0,0,0.45)",

  text: "#0D0D0D",
  textSecondary: "#5D5D5D",
  textTertiary: "#8F8F8F",
  textInverse: "#FFFFFF",

  border: "#E5E5E5",
  borderStrong: "#D1D1D1",

  accent: ACTIVE_ACCENT,
  accentPressed: ACTIVE_ACCENT === brand.orange ? accentPressed.orange : accentPressed.ember,
  accentTint: "#FFEDE5",
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

// Dark: neutral near-black, anchored on the founder's #141414. Deliberately
// untinted so the orange accent and the white logo are the only chroma on
// screen, matching the login reference.
export const darkColors: ColorPalette = {
  bg: "#141414",
  surface: "#1C1C1C",
  surfaceMuted: "#262626",
  card: "#1C1C1C",
  overlay: "rgba(0,0,0,0.6)",

  text: "#FFFFFF",
  textSecondary: "#A8A8A8",
  textTertiary: "#7A7A7A",
  textInverse: "#141414",

  border: "#2E2E2E",
  borderStrong: "#3D3D3D",

  accent: ACTIVE_ACCENT,
  accentPressed: ACTIVE_ACCENT === brand.orange ? accentPressed.orange : accentPressed.ember,
  accentTint: "#3A1405",
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

/**
 * Third party brand colors, fixed by each provider's brand guidelines.
 *
 * These are deliberately NOT part of `ColorPalette`: they do not participate
 * in the light/dark flip, they are not ours to restyle, and nothing but a
 * provider's own surface may use them. They live here because the tokens-only
 * rule admits no hex literal outside this package, and a sign in button
 * legally has to render the vendor's exact values.
 *
 * Apple is absent on purpose. Its button is rendered by Apple's own native
 * component (`AppleAuthenticationButton`), which owns its colors.
 */
export const vendorBrand = {
  /** The four segments of Google's "G", per their identity guidelines. */
  googleBlue: "#4285F4",
  googleGreen: "#34A853",
  googleYellow: "#FBBC05",
  googleRed: "#EA4335",
  /** Google's light sign in button: white plate, near-black label. */
  googleButtonSurface: "#FFFFFF",
  googleButtonInk: "#1F1F1F",
} as const;

/**
 * Bottom navigation chrome, NAV-03. The floating tab pill.
 *
 * A glass control that floats OVER page content rather than a surface the page
 * flows into, so its values are translucent and it carries its own hairline
 * edge. It is kept out of `ColorPalette` because none of these are page
 * surfaces: putting `rgba()` fills in the palette would let any screen paint a
 * half transparent background, and the palette feeds `toCssVars`, which
 * converts to HSL triplets and would silently drop the alpha.
 *
 * Light mode is a near white chrome, dark mode a near black one, both at the
 * same alpha so the material reads identically in either scheme.
 *
 * These live here because the tokens-only rule admits no hex literal outside
 * this package.
 */
export interface NavChrome {
  /**
   * The pill fill. Translucent, so content passing underneath tints it.
   * These alphas are tuned for NO backdrop blur; if `expo-blur` is ever
   * restored, drop them so the blur is what reads.
   */
  surface: string;
  /** The capsule behind the active tab. An accent wash, per the reference bar. */
  surfaceActive: string;
  /** Hairline edge. The specular lip that makes the glass read as an object. */
  border: string;
  /** Icon and label color for a resting tab. */
  ink: string;
  /** Icon and label color for the ACTIVE tab. Brand accent, matching the
   *  reference bar, which tints the selected glyph and its label. */
  inkActive: string;
  /** Unread dot. */
  badge: string;
  /** `expo-blur` tint for this scheme. */
  blurTint: "light" | "dark";
  /** `expo-blur` intensity, 0 to 100. */
  blurIntensity: number;
}

export const navChrome = {
  light: {
    surface: "rgba(255,255,255,0.55)",
    surfaceActive: "rgba(255,77,0,0.12)",
    border: "rgba(0,0,0,0.10)",
    ink: "#1C1C1E",
    inkActive: ACTIVE_ACCENT,
    badge: "#FF3B30",
    blurTint: "light",
    blurIntensity: 60,
  },
  dark: {
    surface: "rgba(28,28,30,0.45)",
    surfaceActive: "rgba(255,77,0,0.22)",
    border: "rgba(255,255,255,0.16)",
    ink: "#FFFFFF",
    inkActive: ACTIVE_ACCENT,
    badge: "#FF453A",
    blurTint: "dark",
    blurIntensity: 55,
  },
} as const satisfies Record<ThemeMode, NavChrome>;

export type ThemeMode = keyof typeof colors;
export type ColorToken = keyof ColorPalette;
