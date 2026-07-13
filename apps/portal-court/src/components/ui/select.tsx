"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A native <select>, styled to match Input/Button rather than wrapping
 * @base-ui/react/select's full positioner/popup/list part set. Court/day/sport
 * pickers in this portal are simple single-value dropdowns with no need for
 * custom option rendering, so a styled native element gives the same visual
 * result with far less surface area, while staying fully keyboard/screen
 * reader accessible for free (native <select> semantics).
 */
function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "flex h-9 w-full appearance-none rounded-lg border border-border bg-secondary px-3 py-1 pr-8 text-sm text-foreground outline-none transition-[color,box-shadow] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
      />
    </div>
  );
}

/** Multi-select checklist rendered as a set of toggle rows, for sport tags
 * and day-of-week ranges where a native <select multiple> would be
 * unusable on a touch screen at the front desk. */
function CheckboxGroupItem({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm transition-colors",
        checked ? "border-primary bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-sm border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-[hsl(var(--color-border-strong))]",
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
      </span>
      {label}
    </button>
  );
}

export { Select, CheckboxGroupItem };
