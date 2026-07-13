import { Wallet } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function EarningsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Earnings
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Earnings and payouts
        </h1>
      </div>
      <EmptyState
        icon={Wallet}
        title="Earnings show up after your first payout account is linked"
        description="Gross bookings, platform fee and net payable, plus your transfer history, land here."
      />
    </div>
  );
}
