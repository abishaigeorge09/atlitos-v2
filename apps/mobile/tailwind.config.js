/* GENERATED FILE. Source of truth: packages/theme/src/*.ts.
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
        "bg": "hsl(var(--color-bg))",
        "surface": "hsl(var(--color-surface))",
        "surface-muted": "hsl(var(--color-surface-muted))",
        "overlay": "var(--color-overlay)",
        "text": "hsl(var(--color-text))",
        "text-secondary": "hsl(var(--color-text-secondary))",
        "text-tertiary": "hsl(var(--color-text-tertiary))",
        "text-inverse": "hsl(var(--color-text-inverse))",
        "border-strong": "hsl(var(--color-border-strong))",
        "accent": "hsl(var(--color-accent))",
        "accent-pressed": "hsl(var(--color-accent-pressed))",
        "accent-tint": "hsl(var(--color-accent-tint))",
        "ink-on-accent": "hsl(var(--color-ink-on-accent))",
        "brand-orange": "hsl(var(--color-brand-orange))",
        "brand-ember": "hsl(var(--color-brand-ember))",
        "success": "hsl(var(--color-success))",
        "success-tint": "hsl(var(--color-success-tint))",
        "warning": "hsl(var(--color-warning))",
        "warning-tint": "hsl(var(--color-warning-tint))",
        "info": "hsl(var(--color-info))",
        "info-tint": "hsl(var(--color-info-tint))",
        "danger": "hsl(var(--color-danger))",
        "danger-tint": "hsl(var(--color-danger-tint))",
      },
      spacing: {
        "none": "0px",
        "xs": "4px",
        "sm": "8px",
        "md": "12px",
        "lg": "16px",
        "xl": "20px",
        "2xl": "24px",
        "3xl": "32px",
        "4xl": "40px",
        "5xl": "56px",
        "6xl": "72px",
      },
      borderRadius: {
        "none": "0px",
        "xs": "4px",
        "sm": "8px",
        "md": "12px",
        "lg": "16px",
        "xl": "20px",
        "2xl": "28px",
        "pill": "999px",
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
