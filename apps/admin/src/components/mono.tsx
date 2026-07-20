import type { CSSProperties, ReactNode } from "react";

// CLAUDE.md, "Tokens only": "Numeric readouts (prices, stats, timers, counts,
// percentages) render in JetBrains Mono with tabular figures, everywhere, no
// exceptions."
//
// The existing admin screens set `fontFamily: "JetBrains Mono, monospace"`
// inline at each call site and none of them set `font-variant-numeric`, so
// their digits are monospaced but not actually TABULAR: a column of counts can
// still shift by a fraction as values change. This component is the one place
// that pairing lives, so the commerce surfaces get both halves of the rule and
// the older screens have something to migrate onto rather than a rule restated
// in a comment.
//
// `fontVariantNumeric: "tabular-nums"` is the load-bearing line. Everything
// else is passthrough.
export function Mono({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: "JetBrains Mono, monospace",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
