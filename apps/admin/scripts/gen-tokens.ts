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
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { colors, radii, spacing, toCssVars, type ColorPalette } from "@atlitos/theme";

function colorVarBlock(palette: ColorPalette): string {
  const vars = toCssVars(palette, "color");
  return Object.entries(vars)
    .map(([name, triplet]) => `  ${name}: hsl(${triplet});`)
    .join("\n");
}

const css = `/* GENERATED FILE. Source of truth: packages/theme/src/*.ts.
 * Regenerate with: pnpm --filter @atlitos/admin gen-tokens
 * Do not hand edit the token values below, see docs/design/DESIGN-LANGUAGE.md. */

:root {
  /* Atlitos tokens, from @atlitos/theme colors.light ("Paper") */
${colorVarBlock(colors.light)}

  --radius-sm: ${radii.sm}px;
  --radius-md: ${radii.md}px;
  --radius-lg: ${radii.lg}px;
  --radius-xl: ${radii.xl}px;
  --radius-pill: ${radii.pill}px;

  --space-xs: ${spacing.xs}px;
  --space-sm: ${spacing.sm}px;
  --space-md: ${spacing.md}px;
  --space-lg: ${spacing.lg}px;
  --space-xl: ${spacing.xl}px;
  --space-2xl: ${spacing["2xl"]}px;
}

/* Dark ("Espresso") tokens, ready for a future admin theme toggle; the
 * shell itself defaults to the warm light sidebar per PRD-04/DESIGN-LANGUAGE
 * and does not switch this class today. */
.dark {
${colorVarBlock(colors.dark)}
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: Inter, sans-serif;
}

* {
  box-sizing: border-box;
}
`;

const outPath = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
writeFileSync(outPath, css);
console.log(`Wrote ${outPath}`);
