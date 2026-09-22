import { useEffect, useState } from "react";

// Swatches are READ at runtime via getComputedStyle, never copied from the
// token file, per the kitchen sink template rule: a hardcoded hex keeps
// saying orange after somebody changes the token, which is exactly the bug
// this page exists to catch.

const COLOR_VARS = [
  "--color-bg",
  "--color-surface",
  "--color-surface-muted",
  "--color-card",
  "--color-text",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-border",
  "--color-border-strong",
  "--color-accent",
  "--color-accent-tint",
  "--color-success",
  "--color-warning",
  "--color-info",
  "--color-danger",
];

const RADIUS_VARS = ["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-pill"];
const SHADOW_VARS = ["--shadow-sm", "--shadow-md", "--shadow-lg"];
const TYPE_VARS = ["display", "title", "h1", "h2", "h3", "body", "callout", "label", "caption", "overline"];
const NUMERIC_VARS = ["numericDisplay", "numericLg", "numericBase", "numericSm"];

function readVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function TokenReadout() {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const name of COLOR_VARS) next[name] = readVar(name);
    for (const name of RADIUS_VARS) next[name] = readVar(name);
    for (const name of SHADOW_VARS) next[name] = readVar(name);
    setValues(next);
    // Re-read whenever the theme flips (data-theme mutation on <html>).
    const observer = new MutationObserver(() => {
      const updated: Record<string, string> = {};
      for (const name of COLOR_VARS) updated[name] = readVar(name);
      setValues(updated);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="ak-kitchen-tokens">
      <div className="ak-kitchen-swatch-grid">
        {COLOR_VARS.map((name) => (
          <div key={name} className="ak-kitchen-swatch">
            <span className="ak-kitchen-swatch-chip" style={{ backgroundColor: `var(${name})` }} />
            <code>{name}</code>
            <code className="ak-kitchen-swatch-value">{values[name]}</code>
          </div>
        ))}
      </div>

      <h3 className="ak-kitchen-subhead">Type scale</h3>
      <div className="ak-kitchen-type-scale">
        {TYPE_VARS.map((name) => (
          <div
            key={name}
            className="ak-kitchen-type-row"
            style={{
              fontFamily: name === "overline" ? "var(--font-mono)" : "var(--font-sans)",
              fontSize: `var(--type-${name}-size)`,
              lineHeight: `var(--type-${name}-line)`,
              letterSpacing: `var(--type-${name}-tracking)`,
              textTransform: name === "overline" ? "uppercase" : "none",
            }}
          >
            The quick brown fox <code>{name}</code>
          </div>
        ))}
        {NUMERIC_VARS.map((name) => (
          <div
            key={name}
            className="ak-kitchen-type-row"
            style={{
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: `var(--type-${name}-size)`,
              lineHeight: `var(--type-${name}-line)`,
            }}
          >
            0123456789 <code>{name}</code>
          </div>
        ))}
      </div>

      <h3 className="ak-kitchen-subhead">Radii</h3>
      <div className="ak-kitchen-radii">
        {RADIUS_VARS.map((name) => (
          <div key={name} className="ak-kitchen-radius-item">
            <div className="ak-kitchen-radius-box" style={{ borderRadius: `var(${name})` }} />
            <code>{name}</code>
          </div>
        ))}
      </div>

      <h3 className="ak-kitchen-subhead">Shadows</h3>
      <div className="ak-kitchen-shadows">
        {SHADOW_VARS.map((name) => (
          <div key={name} className="ak-kitchen-shadow-item">
            <div className="ak-kitchen-shadow-box" style={{ boxShadow: `var(${name})` }} />
            <code>{name}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
