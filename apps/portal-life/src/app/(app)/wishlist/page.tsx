import { getMoneySummary, requireVerifiedApplication, type WishlistItem } from "@/lib/empower";
import { createClient } from "@/lib/supabase/server";
import { WishlistManager } from "./wishlist-manager";

// Wishlist Manager (PRD-05 FR-11 to FR-16). Verified only. Server seeds the
// initial items scoped by owner; the client subscribes to Realtime so a
// sponsor donation reflects here without a manual refresh (FR-15). Per item
// funding is DERIVED from donations (0084 upa_money_summary), never the
// funded_amount cache column that the QA audit found drifted.
export default async function WishlistPage() {
  const { application } = await requireVerifiedApplication();
  const supabase = await createClient();

  const [{ data }, summary] = await Promise.all([
    supabase
      .from("upa_wishlist_items")
      .select("*")
      .eq("upa_id", application.id)
      .order("created_at", { ascending: false }),
    getMoneySummary(application.id),
  ]);

  return (
    <WishlistManager
      upaId={application.id}
      initialItems={(data ?? []) as WishlistItem[]}
      initialFunded={summary?.items ?? {}}
    />
  );
}
