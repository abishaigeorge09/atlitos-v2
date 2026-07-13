/**
 * Motion tokens. Pure data, no reanimated/framer-motion import, so this
 * package stays zero-react. packages/ui-native wraps these in reanimated
 * helpers (springs, entering presets); packages/ui-web wraps these in CSS
 * transitions / framer-motion variants. Both read the same numbers.
 */

export const duration = {
  fast: 120,
  base: 200,
  slow: 320,
  slower: 480,
} as const;

export type DurationToken = keyof typeof duration;

/** Cubic-bezier control points, portable to both CSS and RN Easing.bezier(). */
export const easing = {
  standard: [0.2, 0, 0, 1],
  decelerate: [0, 0, 0.2, 1],
  accelerate: [0.4, 0, 1, 1],
  /** Signature snap borrowed from SRM: hover/press states, stat counters, scroll reveals. */
  srm: [0.3, 1, 0.3, 1],
} as const;

export type EasingToken = keyof typeof easing;

/** CSS-ready `cubic-bezier(...)` string for a given easing token. */
export function cssEasing(token: EasingToken): string {
  const [x1, y1, x2, y2] = easing[token];
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

export const spring = {
  standard: { damping: 18, stiffness: 220 },
} as const;

export type SpringToken = keyof typeof spring;

/** Per-item delay step for list/grid stagger reveals. */
export const staggerStep = 40;

/** Scale factor on press-in for tactile press feedback. */
export const pressScale = 0.96;
