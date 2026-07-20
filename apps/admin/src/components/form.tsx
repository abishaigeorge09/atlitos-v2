import type { CSSProperties, ReactNode } from "react";

// Shared form primitives for the commerce admin surfaces. Same posture as
// components/ui.tsx: apps/admin has no shadcn/Tailwind pipeline, so these are
// plain elements reading CSS vars from src/styles/tokens.css (generated from
// @atlitos/theme). No hardcoded colors, radii or spacing.
//
// Before this file, every admin form control was styled inline at its call
// site (see venues/show.tsx's reject textarea). Commerce adds roughly a dozen
// controls across two screens, which is the point at which repeating that
// block stops being cheaper than naming it.

export const inputStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-surface-muted)",
  color: "var(--color-text)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

/** Numeric inputs get JetBrains Mono with tabular figures, per CLAUDE.md. */
const monoInputStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: "JetBrains Mono, monospace",
  fontVariantNumeric: "tabular-nums",
};

export function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", ...style }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>{label}</span>
      {children}
    </label>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Set for prices, counts and SKUs. */
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={mono ? monoInputStyle : inputStyle}
    />
  );
}
