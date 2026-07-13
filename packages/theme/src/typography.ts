/**
 * Typography tokens. See docs/design/DESIGN-LANGUAGE.md for the full scale
 * rationale. Pure data, no react/react-native import, so both
 * packages/ui-native (RN Text) and packages/ui-web (CSS) resolve these tokens
 * to their own platform primitives.
 *
 * Inter for UI text. JetBrains Mono for every numeric readout (prices,
 * scores, timers, XP, distances), always with tabular figures, and for the
 * uppercase mono "eyebrow" overline label.
 */

/** CSS/RN-agnostic base family names. Web reads these directly as font-family. */
export const fontFamily = {
  sans: "Inter",
  mono: "JetBrainsMono",
} as const;

export type FontFamilyToken = keyof typeof fontFamily;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
} as const;

export type FontWeightToken = keyof typeof fontWeight;

/**
 * RN convention (expo-google-fonts): `Family_WeightStyle`. Mobile consumers
 * map a (fontFamily, fontWeight) token pair through this table to get the
 * loaded font family name RN needs; web consumers ignore this and use
 * `fontFamily` + `fontWeight` (CSS) directly instead.
 */
export const rnFontFamily = {
  sans: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
    extrabold: "Inter_800ExtraBold",
  },
  mono: {
    regular: "JetBrainsMono_400Regular",
    medium: "JetBrainsMono_500Medium",
    semibold: "JetBrainsMono_600SemiBold",
    bold: "JetBrainsMono_700Bold",
  },
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 15,
  callout: 15,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  "4xl": 32,
  "5xl": 40,
} as const;

export type FontSizeToken = keyof typeof fontSize;

export interface TextVariantStyle {
  fontFamily: FontFamilyToken;
  fontWeight: FontWeightToken;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  /** 0.22 means 0.22em, multiply by fontSize to get an absolute px value. */
  letterSpacingEm?: number;
  uppercase?: boolean;
  /** Numeric readouts render with tabular lining figures so digits don't jitter. */
  tabularNums?: boolean;
}

/**
 * Semantic UI text variants. display/title/h1/h2/h3 carry negative letter
 * spacing (tighter as size increases) for a denser, more athletic feel than
 * default Inter tracking. `overline` is the SRM-influenced uppercase mono
 * eyebrow label, the one place mono appears outside a numeric readout.
 */
export const textVariants = {
  display: { fontFamily: "sans", fontWeight: "bold", fontSize: fontSize["5xl"], lineHeight: 46, letterSpacing: -1.0 },
  title: { fontFamily: "sans", fontWeight: "bold", fontSize: fontSize["4xl"], lineHeight: 40, letterSpacing: -0.8 },
  h1: { fontFamily: "sans", fontWeight: "bold", fontSize: fontSize["3xl"], lineHeight: 34, letterSpacing: -0.6 },
  h2: { fontFamily: "sans", fontWeight: "semibold", fontSize: fontSize["2xl"], lineHeight: 30, letterSpacing: -0.4 },
  h3: { fontFamily: "sans", fontWeight: "semibold", fontSize: fontSize.xl, lineHeight: 26, letterSpacing: -0.2 },
  body: { fontFamily: "sans", fontWeight: "regular", fontSize: fontSize.lg, lineHeight: 24 },
  callout: { fontFamily: "sans", fontWeight: "regular", fontSize: fontSize.callout, lineHeight: 22 },
  label: { fontFamily: "sans", fontWeight: "semibold", fontSize: fontSize.base, lineHeight: 18, letterSpacing: 0.1 },
  caption: { fontFamily: "sans", fontWeight: "regular", fontSize: fontSize.sm, lineHeight: 16 },
  overline: {
    fontFamily: "mono",
    fontWeight: "semibold",
    fontSize: fontSize.xs,
    lineHeight: 14,
    letterSpacingEm: 0.22,
    uppercase: true,
  },
} as const satisfies Record<string, TextVariantStyle>;

export type TextVariant = keyof typeof textVariants;

/** Numeric readout variants, always JetBrains Mono, always tabular figures. */
export const numericVariants = {
  numericDisplay: { fontFamily: "mono", fontWeight: "bold", fontSize: fontSize["5xl"], lineHeight: 46, tabularNums: true },
  numericLg: { fontFamily: "mono", fontWeight: "semibold", fontSize: fontSize["2xl"], lineHeight: 30, tabularNums: true },
  numericBase: { fontFamily: "mono", fontWeight: "medium", fontSize: fontSize.lg, lineHeight: 22, tabularNums: true },
  numericSm: { fontFamily: "mono", fontWeight: "medium", fontSize: fontSize.base, lineHeight: 18, tabularNums: true },
} as const satisfies Record<string, TextVariantStyle>;

export type NumericVariant = keyof typeof numericVariants;
