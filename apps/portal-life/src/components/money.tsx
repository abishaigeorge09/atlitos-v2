import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/format";

/**
 * Every rupee readout in the portal renders through here: JetBrains Mono with
 * tabular figures, per CLAUDE.md "numeric readouts render in JetBrains Mono
 * with tabular figures, everywhere". The value is always a ledger derived or
 * per item figure passed by the caller, never summed in this component.
 */
export function Money({
  amount,
  className,
  "data-testid": testId,
}: {
  amount: number | string | null | undefined;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <span className={cn("font-mono tabular-nums", className)} data-testid={testId}>
      {formatRupees(amount)}
    </span>
  );
}
