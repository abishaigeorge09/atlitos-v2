import { LayoutDashboard } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function OverviewPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Overview
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Your venues at a glance
        </h1>
      </div>
      <EmptyState
        icon={LayoutDashboard}
        title="Overview arrives once your first venue is verified"
        description="Bookings, occupancy and payouts across every venue will show up here."
      />
    </div>
  );
}
