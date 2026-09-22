// Re exports from the admin kit (apps/admin/src/components/kit/). Kept so
// existing commerce pages (venues/show.tsx's reject textarea etc.) keep
// compiling; new pages should import Field/Input/Select/Textarea from ./kit
// directly. inputStyle stays here as a plain object for the one or two call
// sites that read it directly rather than through <Input>.
import type { CSSProperties, ReactNode } from "react";

export { Input } from "./kit/Input";
export { Select } from "./kit/Select";
export { Textarea } from "./kit/Textarea";

import { Field as KitField } from "./kit/Field";

export const inputStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-surface-muted)",
  color: "var(--color-text)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

/** Pre-kit call sites pass `style`; the kit Field has no style prop, so it
 * is accepted here and ignored (none of the existing call sites relied on
 * anything besides layout spacing, which the kit Field already provides). */
export function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  void style;
  return <KitField label={label}>{children}</KitField>;
}
