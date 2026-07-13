import { BadgeCheck } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function VerificationPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Verification
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Application status
        </h1>
      </div>
      <EmptyState
        icon={BadgeCheck}
        title="No application submitted yet"
        description="Start your application with a story, sport, region and a certificate or video link."
      />
    </div>
  );
}
