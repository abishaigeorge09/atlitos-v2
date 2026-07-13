/**
 * Generates src/app/globals.css from @atlitos/theme. Source of truth for
 * every value here is packages/theme/src/*.ts (see docs/design/DESIGN-LANGUAGE.md).
 * Never hand edit the token blocks in globals.css, edit packages/theme and
 * rerun this script instead: `pnpm --filter @atlitos/portal-court gen-tokens`.
 *
 * shadcn's Nova preset (Tailwind v4, oklch defaults) ships slot variables
 * (--background, --primary, --card, ...) that this script rewrites to
 * hsl(var(--color-...)) references pointing at Atlitos's own token vars,
 * generated with @atlitos/theme's hexToHsl/toCssVars helpers, so the portal
 * never carries a hardcoded color value outside packages/theme.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colors, radii, toCssVars, type ColorPalette } from "@atlitos/theme";

function colorVarBlock(palette: ColorPalette): string {
  const vars = toCssVars(palette, "color");
  return Object.entries(vars)
    .map(([name, triplet]) => `  ${name}: ${triplet};`)
    .join("\n");
}

/** Shadcn slot name -> Atlitos color token name (kebab case, matches toCssVars output). */
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
  accent: "color-accent-tint",
  "accent-foreground": "color-text",
  destructive: "color-danger",
  "destructive-foreground": "color-ink-on-accent",
  border: "color-border",
  input: "color-border",
  ring: "color-accent",
  "chart-1": "color-accent",
  "chart-2": "color-success",
  "chart-3": "color-info",
  "chart-4": "color-warning",
  "chart-5": "color-danger",
  sidebar: "color-surface",
  "sidebar-foreground": "color-text",
  "sidebar-primary": "color-accent",
  "sidebar-primary-foreground": "color-ink-on-accent",
  "sidebar-accent": "color-surface-muted",
  "sidebar-accent-foreground": "color-text",
  "sidebar-border": "color-border",
  "sidebar-ring": "color-accent",
};

function slotVarBlock(): string {
  return Object.entries(slotToColorToken)
    .map(([slot, token]) => `  --${slot}: hsl(var(--${token}));`)
    .join("\n");
}

// radii.lg (16px) is the shadcn --radius base this preset scales radius-sm/md/xl
// off of, matching DESIGN-LANGUAGE.md's card radius (lg/xl family, not the sm
// button radius, buttons apply radius.sm explicitly via className/utility).
const radiusRem = `${(radii.lg / 16).toFixed(3).replace(/\.?0+$/, "") || "0"}rem`;

const css = `/* GENERATED FILE. Source of truth: packages/theme/src/*.ts.
 * Regenerate with: pnpm --filter @atlitos/portal-court gen-tokens
 * Do not hand edit the token values below, see docs/design/DESIGN-LANGUAGE.md. */

@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-heading: var(--font-sans);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  /* Atlitos tokens, from @atlitos/theme colors.light */
${colorVarBlock(colors.light)}

  /* shadcn slots, mapped to the Atlitos tokens above */
${slotVarBlock()}
  --radius: ${radiusRem};
}

.dark {
  /* Atlitos tokens, from @atlitos/theme colors.dark */
${colorVarBlock(colors.dark)}

  /* shadcn slots, mapped to the Atlitos tokens above */
${slotVarBlock()}
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
`;

const outPath = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));
writeFileSync(outPath, css);
console.log(`Wrote ${outPath}`);
