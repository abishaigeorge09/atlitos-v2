// Re exports from the admin kit (apps/admin/src/components/kit/), the token
// backed component set introduced in Part B / ADR-012. Kept so existing
// pages keep compiling without a mass rewrite (that rewrite is A2, not this
// task); new pages should import from ./kit directly. Two thin adapters
// below translate the pre-kit prop shapes (EmptyState's `description`,
// Button's `destructive` variant) onto the kit components so no existing
// page needs to change.
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export { Badge } from "./kit/Badge";

import { Card as KitCard } from "./kit/Card";
import { Button as KitButton, type ButtonVariant as KitButtonVariant } from "./kit/Button";
import { EmptyState as KitEmptyState } from "./kit/EmptyState";

/** Pre-kit call sites pass an inline `style` override; the kit Card takes
 * only `className`, so this adapter keeps that working without touching
 * every page that already renders `<Card style={{...}}>`. */
export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  if (!style) return <KitCard>{children}</KitCard>;
  return (
    <div style={style}>
      <KitCard>{children}</KitCard>
    </div>
  );
}

export type ButtonVariant = KitButtonVariant | "destructive";

export function Button({
  variant = "primary",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  loading?: boolean;
  children?: ReactNode;
}) {
  return <KitButton variant={variant === "destructive" ? "danger" : variant} {...rest} />;
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return <KitEmptyState icon={icon} title={title} body={description} />;
}
