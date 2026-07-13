import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-secondary text-foreground",
        accent: "bg-accent text-accent-foreground",
        success:
          "bg-[color-mix(in_oklch,hsl(var(--color-success)),transparent_88%)] text-[hsl(var(--color-success))]",
        warning:
          "bg-[color-mix(in_oklch,hsl(var(--color-warning)),transparent_88%)] text-[hsl(var(--color-warning))]",
        danger: "bg-destructive/10 text-destructive",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export { Badge, badgeVariants };
