import type { ElementType, HTMLAttributes, ReactNode } from "react";
import "./Eyebrow.css";

/**
 * Placeholder proving the ui-web pattern for later phases: a shared web
 * primitive built from vanilla CSS classNames reading the @atlitos/theme
 * CSS variable set (never a raw hex or px value inline). This is the
 * uppercase mono "eyebrow" section label from
 * docs/design/DESIGN-LANGUAGE.md, the one place mono type appears outside a
 * numeric readout. Later phases add the rest of the shared web primitive
 * set here alongside each portal's own shadcn/ui component bones.
 */

export interface EyebrowProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Renders in the accent color instead of the default tertiary text tone. */
  accent?: boolean;
  /** Element to render as, defaults to a span so it composes inline above a heading. */
  as?: ElementType;
}

export function Eyebrow({ children, accent = false, as: Component = "span", className, ...rest }: EyebrowProps) {
  const classNames = ["atlitos-eyebrow", accent ? "atlitos-eyebrow--accent" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <Component className={classNames} {...rest}>
      {children}
    </Component>
  );
}
