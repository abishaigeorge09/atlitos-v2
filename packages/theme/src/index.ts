/**
 * @atlitos/theme, the single source of design tokens for every Atlitos app.
 * Pure TypeScript, zero react/react-native dependency, so apps/mobile
 * (Expo/RN), apps/portal-court, apps/portal-life, and apps/admin (Next.js +
 * shadcn) all consume the same values. Mobile reads the JS objects directly;
 * web portals convert palettes to CSS variables with `toCssVars`/`hslVar`
 * below and let Tailwind/shadcn point at `hsl(var(--...))`.
 *
 * See docs/design/DESIGN-LANGUAGE.md for the values and the reasoning.
 */

export * from "./colors";
export * from "./typography";
export * from "./radii";
export * from "./spacing";
export * from "./elevation";
export * from "./motion";

import { type ColorPalette, type ThemeMode, colors } from "./colors";

/** Everything needed to render one theme mode: colors + a `mode` discriminant. */
export interface Theme {
  mode: ThemeMode;
  colors: ColorPalette;
}

export const lightTheme: Theme = { mode: "light", colors: colors.light };
export const darkTheme: Theme = { mode: "dark", colors: colors.dark };

export function getTheme(mode: ThemeMode): Theme {
  return mode === "dark" ? darkTheme : lightTheme;
}

// Currency

/**
 * ₹ with Indian digit grouping: 231000 -> "₹2,31,000". Ported from v1
 * (atlitos-app/src/theme/tokens.ts). Always pair with a mono numeric text
 * variant when rendering, money is never rendered in Inter.
 */
export function formatINR(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const n = Math.abs(Math.round(amount));
  const s = n.toString();
  if (s.length <= 3) return `${sign}₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}₹${rest},${last3}`;
}

// CSS variable helpers (web portals)
//
// shadcn/ui + Tailwind convention: CSS custom properties hold a bare
// "H S% L%" triplet (space separated, no commas, no `hsl()` wrapper) so
// Tailwind can compose `hsl(var(--x) / <alpha-value>)`. These helpers convert
// this package's hex tokens into that format so portal `globals.css` can be
// generated/checked from the same source instead of hand-copied.

/** Convert a `#rrggbb` (or `#rgb`) hex color to an "H S% L%" triplet string. */
export function hexToHsl(hex: string): string {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }

  const hDeg = Math.round(h * 360);
  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);
  return `${hDeg} ${sPct}% ${lPct}%`;
}

/** `hsl(var(--{name}))`, the CSS accessor shadcn components expect. */
export function hslVar(name: string): string {
  return `hsl(var(--${name}))`;
}

/**
 * Build a `{ "--color-bg": "32 30% 97%", ... }` map from a ColorPalette,
 * ready to spread into a `:root { ... }` / `.dark { ... }` block in a portal's
 * globals.css. `prefix` defaults to `color` to match `--color-*` var names;
 * pass "" for shadcn's bare `--background`-style names if a portal wants that
 * instead.
 */
export function toCssVars(palette: ColorPalette, prefix = "color"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(palette)) {
    if (typeof value !== "string") continue;
    const kebab = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const varName = prefix ? `${prefix}-${kebab}` : kebab;
    if (value.startsWith("rgba(")) {
      // `overlay` is the one non-hex palette entry (a translucent scrim, see
      // DESIGN-LANGUAGE.md's Light/Dark theme tables). Every other entry
      // here is consumed as a bare "H S% L%" triplet so callers can compose
      // `hsl(var(--color-x) / <alpha>)`; that composition does not apply to
      // an already-translucent rgba() value, so this one var is emitted as
      // the full `rgba(...)` string and consumed directly (e.g.
      // `bg-[var(--color-overlay)]`), never wrapped in `hsl(...)`.
      out[`--${varName}`] = value;
    } else {
      out[`--${varName}`] = hexToHsl(value);
    }
  }
  return out;
}
