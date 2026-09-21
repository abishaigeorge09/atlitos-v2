/**
 * Generates src/styles/tokens.css from @atlitos/theme. Source of truth for
 * every value here is packages/theme/src/*.ts (see docs/design/DESIGN-LANGUAGE.md).
 * Never hand edit the token blocks below, edit packages/theme and rerun this
 * script instead: `pnpm --filter @atlitos/admin gen-tokens`.
 *
 * apps/admin is a plain Vite app (no Tailwind/shadcn pipeline like
 * portal-court/portal-life), so this script writes a small hand-rolled CSS
 * custom property sheet instead of a shadcn slot map: `--color-*` vars in
 * `hsl(H S% L%)` form, generated with @atlitos/theme's hexToHsl/toCssVars
 * helpers, so the admin shell never carries a hardcoded color value outside
 * packages/theme (CLAUDE.md "Tokens only").
 *
 * A1-T1: also emits typography (`--font-sans`/`--font-mono`, sizes, weights,
 * per variant size/line/tracking incl. numeric variants), elevation
 * (`--shadow-sm/md/lg`, warm tinted box-shadow strings), motion
 * (`--duration-*`, `--ease-*`), fixes `--color-overlay` (was emitting the
 * invalid `hsl(rgba(...))`), and emits `[data-theme="dark"]` beside `.dark`
 * so the shell's `data-theme` toggle (ThemeToggle.tsx) and any legacy
 * `.dark` class consumer both resolve the same values.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  colors,
  cssEasing,
  duration,
  elevation,
  fontFamily,
  fontSize,
  fontWeight,
  numericVariants,
  radii,
  spacing,
  textVariants,
  toCssVars,
  type ColorPalette,
} from "@atlitos/theme";

function colorVarBlock(palette: ColorPalette): string {
  const vars = toCssVars(palette, "color");
  return Object.entries(vars)
    .map(([name, value]) => {
      // `overlay` is the one non-hex palette entry (a translucent rgba
      // scrim, see @atlitos/theme colors.ts); toCssVars already returns it
      // as a full `rgba(...)` string, unlike every other entry which comes
      // back as a bare "H S% L%" triplet meant to be wrapped in `hsl(...)`.
      // The old script wrapped everything unconditionally, producing the
      // invalid `hsl(rgba(0,0,0,0.45))`. Fixed here: pass rgba() through.
      const isRgba = value.startsWith("rgba(");
      return `  ${name}: ${isRgba ? value : `hsl(${value})`};`;
    })
    .join("\n");
}

function shadowValue(token: keyof typeof elevation): string {
  const e = elevation[token];
  if (e.blur === 0 && e.opacity === 0) return "none";
  // elevation.ts stores a warm-tinted hex + opacity, platform neutral. Web
  // composes the CSS box-shadow string here; RN derives its own shadow
  // props from the same source (see packages/ui-native).
  const { r, g, b } = hexToRgb(e.color);
  return `${e.x}px ${e.y}px ${e.blur}px ${e.spread}px rgba(${r}, ${g}, ${b}, ${e.opacity})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function typographyBlock(): string {
  const lines: string[] = [];
  lines.push(`  --font-sans: "${fontFamily.sans} Variable", "${fontFamily.sans}", -apple-system, sans-serif;`);
  lines.push(`  --font-mono: "${fontFamily.mono} Variable", "${fontFamily.mono}", ui-monospace, monospace;`);

  for (const [name, value] of Object.entries(fontSize)) {
    lines.push(`  --text-${name}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(fontWeight)) {
    lines.push(`  --weight-${name}: ${value};`);
  }

  for (const [name, style] of Object.entries(textVariants)) {
    const tracking = style.letterSpacingEm != null ? `${style.letterSpacingEm}em` : `${style.letterSpacing ?? 0}px`;
    lines.push(`  --type-${name}-size: ${style.fontSize}px;`);
    lines.push(`  --type-${name}-line: ${style.lineHeight}px;`);
    lines.push(`  --type-${name}-tracking: ${tracking};`);
  }
  for (const [name, style] of Object.entries(numericVariants)) {
    lines.push(`  --type-${name}-size: ${style.fontSize}px;`);
    lines.push(`  --type-${name}-line: ${style.lineHeight}px;`);
    lines.push(`  --type-${name}-tracking: 0px;`);
  }

  return lines.join("\n");
}

function elevationBlock(): string {
  return (["sm", "md", "lg"] as const).map((token) => `  --shadow-${token}: ${shadowValue(token)};`).join("\n");
}

function motionBlock(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(duration)) {
    lines.push(`  --duration-${name}: ${value}ms;`);
  }
  for (const token of ["standard", "decelerate", "accelerate", "srm"] as const) {
    lines.push(`  --ease-${token}: ${cssEasing(token)};`);
  }
  return lines.join("\n");
}

function radiiBlock(): string {
  return `  --radius-sm: ${radii.sm}px;
  --radius-md: ${radii.md}px;
  --radius-lg: ${radii.lg}px;
  --radius-xl: ${radii.xl}px;
  --radius-pill: ${radii.pill}px;`;
}

function spaceBlock(): string {
  return `  --space-xs: ${spacing.xs}px;
  --space-sm: ${spacing.sm}px;
  --space-md: ${spacing.md}px;
  --space-lg: ${spacing.lg}px;
  --space-xl: ${spacing.xl}px;
  --space-2xl: ${spacing["2xl"]}px;
  --space-3xl: ${spacing["3xl"]}px;
  --space-4xl: ${spacing["4xl"]}px;`;
}

const css = `/* GENERATED FILE. Source of truth: packages/theme/src/*.ts.
 * Regenerate with: pnpm --filter @atlitos/admin gen-tokens
 * Do not hand edit the token values below, see docs/design/DESIGN-LANGUAGE.md. */

:root {
  color-scheme: light dark;

  /* Atlitos tokens, from @atlitos/theme colors.light ("Paper") */
${colorVarBlock(colors.light)}

${radiiBlock()}

${spaceBlock()}

  /* Typography, from @atlitos/theme typography.ts. Urbanist for UI text,
   * JetBrains Mono for every numeric readout (CLAUDE.md "Tokens only"). */
${typographyBlock()}

  /* Elevation, from @atlitos/theme elevation.ts. Warm tinted, never flat black. */
${elevationBlock()}

  /* Motion, from @atlitos/theme motion.ts. */
${motionBlock()}
}

/* Dark ("Espresso") tokens. Toggled by ThemeToggle.tsx via
 * data-theme="dark" on <html>, persisted to localStorage with a
 * prefers-color-scheme default; .dark kept alongside for any legacy
 * class-based consumer. */
.dark,
[data-theme="dark"] {
${colorVarBlock(colors.dark)}
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}

* {
  box-sizing: border-box;
}
`;

const outPath = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
writeFileSync(outPath, css);
console.log(`Wrote ${outPath}`);
