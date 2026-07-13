/**
 * Generates global.css and tailwind.config.js from @atlitos/theme, the same
 * pattern as apps/portal-court/scripts/gen-tokens.ts. Source of truth for
 * every value here is packages/theme/src/*.ts (see docs/design/DESIGN-LANGUAGE.md).
 * Never hand edit the generated blocks, edit packages/theme and rerun:
 * `pnpm --filter @atlitos/mobile gen-tokens`.
 *
 * Colors go through CSS variables (hsl(var(--x))) so light/dark can flip via
 * the `dark` class Nativewind toggles, exactly like the web portals. Radii
 * and the named spacing scale are baked as literal px values straight into
 * tailwind.config.js theme.extend since they do not vary by color scheme.
 *
 * Both blocks EXTEND Tailwind's defaults rather than replace them: Tailwind's
 * native numeric spacing/radius scale is left alone for component internals
 * (this mirrors apps/portal-court's shadcn components, which also lean on
 * Tailwind's native --spacing()/rounded-* scale for micro layout inside
 * vendored component source). Only the named `@atlitos/theme` keys are
 * generated here, so anything reachable by name (`p-lg`, `rounded-xl`,
 * `bg-accent`, `text-danger`) traces to packages/theme.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { colors, radii, spacing, toCssVars, type ColorPalette } from "@atlitos/theme";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function colorVarBlock(palette: ColorPalette): string {
  const vars = toCssVars(palette, "color");
  const lines = Object.entries(vars).map(([name, triplet]) => `    ${name}: ${triplet};`);
  // toCssVars skips `overlay` (it's rgba(), not hex), emit it verbatim so
  // rawColorBlock can still reference it as a real, if untranslated, token.
  lines.push(`    --color-overlay: ${palette.overlay};`);
  return lines.join("\n");
}

/**
 * Shadcn/react-native-reusables slot name -> Atlitos color token name (kebab
 * case). NOTE: upstream shadcn's "accent" slot is a TINT (hover/pressed
 * background for ghost/muted surfaces), not a brand color. It is emitted
 * here as `--accent-soft` / `--accent-soft-foreground`, deliberately NOT
 * `--accent`/`--accent-foreground`, so it can never collide with (and
 * silently shadow) the real Atlitos brand accent Tailwind utility that
 * rawColorBlock below generates from packages/theme's `accent` token. Fixed
 * in the Phase 1 fix cycle: this collision previously made `bg-accent` /
 * `text-accent` / `border-accent` resolve to the pale accent TINT instead of
 * the true ember brand accent everywhere (primary CTA, active tab, selected
 * chips, progress fills), see docs/design/DESIGN-LANGUAGE.md "Brand accent".
 * Nothing in this codebase currently reads the shadcn tint slot (no vendored
 * RNR internal here uses `bg-accent`/`text-accent-foreground` for a hover
 * tint), it is kept only for shadcn-pattern compatibility, reachable
 * explicitly via `bg-accent-soft`/`text-accent-soft-foreground` if a future
 * vendored component needs it.
 */
const slotToColorToken: Record<string, string> = {
  background: "color-bg",
  foreground: "color-text",
  card: "color-card",
  "card-foreground": "color-text",
  popover: "color-surface",
  "popover-foreground": "color-text",
  primary: "color-accent",
  "primary-foreground": "color-ink-on-accent",
  secondary: "color-surface-muted",
  "secondary-foreground": "color-text",
  muted: "color-surface-muted",
  "muted-foreground": "color-text-secondary",
  "accent-soft": "color-accent-tint",
  "accent-soft-foreground": "color-text",
  destructive: "color-danger",
  "destructive-foreground": "color-ink-on-accent",
  border: "color-border",
  input: "color-border",
  ring: "color-accent",
};

function slotVarBlock(): string {
  return Object.entries(slotToColorToken)
    .map(([slot, token]) => `    --${slot}: hsl(var(--${token}));`)
    .join("\n");
}

const css = `/* GENERATED FILE. Source of truth: packages/theme/src/*.ts.
 * Regenerate with: pnpm --filter @atlitos/mobile gen-tokens
 * Do not hand edit the token values below, see docs/design/DESIGN-LANGUAGE.md. */

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Atlitos tokens, from @atlitos/theme colors.light */
${colorVarBlock(colors.light)}

    /* react-native-reusables slots, mapped to the Atlitos tokens above */
${slotVarBlock()}
  }

  .dark:root {
    /* Atlitos tokens, from @atlitos/theme colors.dark */
${colorVarBlock(colors.dark)}

    /* react-native-reusables slots, mapped to the Atlitos tokens above */
${slotVarBlock()}
  }
}
`;

/** `{ xs: "4px", sm: "8px", ... }` from packages/theme/src/spacing.ts, named keys only. */
function spacingBlock(): string {
  return Object.entries(spacing)
    .map(([key, value]) => `        "${key}": "${value}px",`)
    .join("\n");
}

/** `{ xs: "4px", sm: "8px", ..., pill: "9999px" }` from packages/theme/src/radii.ts. */
function radiiBlock(): string {
  return Object.entries(radii)
    .map(([key, value]) => `        "${key}": "${value}px",`)
    .join("\n");
}

/**
 * Full raw @atlitos/theme color palette as Tailwind color utilities
 * (bg-danger, text-success, bg-accent-tint, bg-accent, ...). Skips keys that
 * collide with a shadcn/react-native-reusables slot name already defined
 * above ("border", "card"), those two are safe no-op collisions (the slot
 * and the raw palette both resolve to the exact same CSS var, so whichever
 * wins is identical). "accent" is intentionally NOT in this collision set:
 * the raw Atlitos `accent` (true brand ember) must win the `bg-accent` /
 * `text-accent` / `border-accent` utilities, see the slotToColorToken
 * comment above for why the shadcn tint slot was renamed to `accent-soft`
 * instead of being left here to collide.
 */
function rawColorBlock(): string {
  const slotCollisions = new Set(["border", "card"]);
  const keys = Object.keys(colors.light) as Array<keyof ColorPalette>;
  return keys
    .map((key) => {
      const kebab = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      if (slotCollisions.has(kebab)) return null;
      // overlay is rgba(), stored verbatim (not hsl-converted) in colorVarBlock.
      const value = kebab === "overlay" ? "var(--color-overlay)" : `hsl(var(--color-${kebab}))`;
      return `        "${kebab}": "${value}",`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
}

const tailwindConfig = `/* GENERATED FILE. Source of truth: packages/theme/src/*.ts.
 * Regenerate with: pnpm --filter @atlitos/mobile gen-tokens
 * Do not hand edit the theme block below, see docs/design/DESIGN-LANGUAGE.md.
 *
 * Extends (never replaces) Tailwind's native scales. Named @atlitos/theme
 * keys (p-lg, rounded-xl, bg-accent, text-danger, ...) trace to
 * packages/theme; Tailwind's own numeric scale (p-4, rounded-md, gap-1.5)
 * stays available for component-internal micro layout, same as
 * apps/portal-court's vendored shadcn components. */
const { hairlineWidth } = require("nativewind/theme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // react-native-reusables / shadcn compatibility slots. These CSS vars
        // (defined in global.css) already resolve to a full hsl(...) value,
        // so reference them with var(), not hsl(var()) (that would double wrap).
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        // Shadcn/RNR compat tint slot only, NOT the brand accent, see
        // gen-tokens.ts's slotToColorToken comment. The brand accent utility
        // ("accent") comes from the raw palette block below instead.
        "accent-soft": {
          DEFAULT: "var(--accent-soft)",
          foreground: "var(--accent-soft-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        // Full @atlitos/theme palette, kebab case, every value traces to
        // packages/theme/src/colors.ts (bg-accent, text-danger, bg-success-tint, ...)
${rawColorBlock()}
      },
      spacing: {
${spacingBlock()}
      },
      borderRadius: {
${radiiBlock()}
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      fontFamily: {
        sans: ["Inter_400Regular"],
        "sans-medium": ["Inter_500Medium"],
        "sans-semibold": ["Inter_600SemiBold"],
        "sans-bold": ["Inter_700Bold"],
        mono: ["JetBrainsMono_500Medium"],
        "mono-semibold": ["JetBrainsMono_600SemiBold"],
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require("tailwindcss-animate")],
};
`;

const cssOutPath = join(scriptDir, "..", "global.css");
const configOutPath = join(scriptDir, "..", "tailwind.config.js");
writeFileSync(cssOutPath, css);
writeFileSync(configOutPath, tailwindConfig);
console.log(`Wrote ${cssOutPath}`);
console.log(`Wrote ${configOutPath}`);
