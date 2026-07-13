import type { ReactNode } from "react";
import { Eyebrow } from "@atlitos/ui-web";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Shared page header for every /dashboard/* screen: Eyebrow (the SRM
 * influenced uppercase mono label from @atlitos/ui-web) above an h1, an
 * optional description line, and an optional right-aligned action slot (a
 * primary button, a venue switcher). Replaces the hand-rolled
 * font-mono/uppercase span each stub page used to duplicate.
 */
export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
