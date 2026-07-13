/**
 * Elevation tokens, the only shadows in the app. Platform-neutral shape
 * (`x`/`y`/`blur`/`spread`/`color`/`opacity`) so packages/ui-native derives
 * RN shadow props (+ Android `elevation`) and packages/ui-web derives
 * `box-shadow` from the same source. Shadows are warm-tinted, never a flat
 * `#000` at high opacity.
 */
export interface ElevationStyle {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
  /** Android `elevation` prop equivalent (ignored on iOS/web). */
  androidElevation: number;
}

export const elevation = {
  none: { x: 0, y: 0, blur: 0, spread: 0, color: "#1C1712", opacity: 0, androidElevation: 0 },
  sm: { x: 0, y: 2, blur: 8, spread: 0, color: "#1C1712", opacity: 0.06, androidElevation: 2 },
  md: { x: 0, y: 6, blur: 16, spread: 0, color: "#1C1712", opacity: 0.08, androidElevation: 4 },
  lg: { x: 0, y: 12, blur: 28, spread: 0, color: "#1C1712", opacity: 0.14, androidElevation: 10 },
  xl: { x: 0, y: 20, blur: 40, spread: 0, color: "#1C1712", opacity: 0.22, androidElevation: 16 },
} as const satisfies Record<string, ElevationStyle>;

export type ElevationToken = keyof typeof elevation;
