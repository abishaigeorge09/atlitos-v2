/** Spacing scale (4pt base). Screens/components use named tokens, never raw numbers. */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 56,
} as const;

export type SpacingToken = keyof typeof spacing;

/** Mobile screen horizontal padding. Portal gutters use `2xl`/`3xl` at wider breakpoints. */
export const screenPadding: SpacingToken = "lg";
