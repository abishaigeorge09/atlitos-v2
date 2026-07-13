import { Radio } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function LiveTodayPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Live today
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Today, court by court
        </h1>
      </div>
      <EmptyState
        icon={Radio}
        title="Nothing booked for today yet"
        description="Check ins, walk ins and cancellations across every court will update here in real time."
      />
    </div>
  );
}
