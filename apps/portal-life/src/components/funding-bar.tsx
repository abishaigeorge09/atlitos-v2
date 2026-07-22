import { cn } from "@/lib/utils";
import { fundedPercent } from "@/lib/format";
import { Money } from "@/components/money";

/**
 * Per item funding progress. funded_amount over cost is the legitimate item
 * level use of funded_amount (SCHEMA.md); a fund total is never derived here,
 * it comes from the ledger RPC upstream.
 */
export function FundingBar({
  funded,
  cost,
  showLabels = true,
}: {
  funded: number | string;
  cost: number | string;
  showLabels?: boolean;
}) {
  const pct = fundedPercent(funded, cost);
  const complete = pct >= 100;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            complete ? "bg-[hsl(var(--color-success))]" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabels ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            <Money amount={funded} className="text-foreground" /> of <Money amount={cost} />
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">{pct}%</span>
        </div>
      ) : null}
    </div>
  );
}
