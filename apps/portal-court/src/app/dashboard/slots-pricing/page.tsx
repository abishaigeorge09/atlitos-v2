import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function SlotsPricingPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Slots and pricing
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Availability and pricing rules
        </h1>
      </div>
      <EmptyState
        icon={CalendarClock}
        title="Set availability once a venue is verified"
        description="Define weekly windows, blackout dates, base pricing and peak pricing rules per court."
      />
    </div>
  );
}
