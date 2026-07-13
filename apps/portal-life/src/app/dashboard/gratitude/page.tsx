import { Heart } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function GratitudePage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Gratitude
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Gratitude posts
        </h1>
      </div>
      <EmptyState
        icon={Heart}
        title="No gratitude posts yet"
        description="Once a wishlist item is funded or delivered, share a note and an optional photo with your sponsor."
      />
    </div>
  );
}
