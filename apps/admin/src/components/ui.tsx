import type { ButtonHTMLAttributes, ReactNode } from "react";

// Small shared style primitives, all reading CSS vars from
// src/styles/tokens.css (generated from @atlitos/theme). apps/admin has no
// shadcn/Tailwind pipeline (plain Vite shell), so these stand in for the
// button/card/chip component tone described in DESIGN-LANGUAGE.md's
// "Component tone" section until packages/ui-web covers this app.

export function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-xl)",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "destructive";

const variantStyle: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-ink-on-accent)",
    border: "1px solid transparent",
  },
  secondary: {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border-strong)",
  },
  destructive: {
    backgroundColor: "var(--color-danger)",
    color: "var(--color-surface)",
    border: "1px solid transparent",
  },
};

export function Button({
  variant = "primary",
  style,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-lg)",
        borderRadius: "var(--radius-sm)",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...variantStyle[variant],
        ...style,
      }}
      {...rest}
    />
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger";

const badgeTone: Record<BadgeTone, React.CSSProperties> = {
  neutral: { backgroundColor: "var(--color-surface-muted)", color: "var(--color-text-secondary)" },
  success: { backgroundColor: "var(--color-success-tint)", color: "var(--color-success)" },
  warning: { backgroundColor: "var(--color-warning-tint)", color: "var(--color-warning)" },
  danger: { backgroundColor: "var(--color-danger-tint)", color: "var(--color-danger)" },
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px var(--space-sm)",
        borderRadius: "var(--radius-pill)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        ...badgeTone[tone],
      }}
    >
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-2xl)",
        textAlign: "center",
        color: "var(--color-text-secondary)",
      }}
    >
      <span style={{ color: "var(--color-text-tertiary)" }}>{icon}</span>
      <p style={{ fontWeight: 600, color: "var(--color-text)", margin: 0 }}>{title}</p>
      <p style={{ fontSize: 14, margin: 0 }}>{description}</p>
    </div>
  );
}
