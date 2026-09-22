import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

/** Kit primitive. Variant/size prop API per Part B plan B1. */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ["ak-button", `ak-button-${variant}`, `ak-button-${size}`, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? <Loader2 className="ak-button-spinner" size={size === "sm" ? 14 : 16} strokeWidth={2} /> : null}
      {children}
    </button>
  );
}
