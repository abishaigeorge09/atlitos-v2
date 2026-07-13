import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function VenuesPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Venues
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Venues and courts
        </h1>
      </div>
      <EmptyState
        icon={Building2}
        title="No venues yet"
        description="Add your first venue, upload photos and submit for verification to start taking bookings."
      />
    </div>
  );
}
