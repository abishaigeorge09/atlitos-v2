import { UserRound } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function MyProfilePage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          My profile
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Your story, sport and region
        </h1>
      </div>
      <EmptyState
        icon={UserRound}
        title="Your profile appears once verified"
        description="Story headline, sport, region and the same preview sponsors see will live here."
      />
    </div>
  );
}
