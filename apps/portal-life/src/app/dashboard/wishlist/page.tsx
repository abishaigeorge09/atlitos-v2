import { Gift } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

export default function WishlistPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Wishlist
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Wishlist manager
        </h1>
      </div>
      <EmptyState
        icon={Gift}
        title="Wishlist opens once you are verified"
        description="Add items with a title and cost, then track funding from sponsors in real time."
      />
    </div>
  );
}
