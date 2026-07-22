import Link from "next/link";
import { ArrowRight, Gift, Heart, Plus, Sparkles } from "lucide-react";

import { requireVerifiedApplication } from "@/lib/empower";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function DashboardPage() {
  const { application } = await requireVerifiedApplication();
  const supabase = await createClient();

  // Total raised is LEDGER DERIVED (PRD-06 FR-3, FR-4): the credit minus debit
  // balance of this UPA's fund account_ref, never a client sum of donations and
  // never funded_amount. funded_amount below is used only for per item counts.
  const [{ data: rawRaised }, itemsResult, gratitudeResult] = await Promise.all([
    supabase.rpc("upa_fund_balance", { p_account_ref: application.id }),
    // Own items only, scoped by the owner's application id (upa_wishlist_items
    // is permissive-OR, 0049; this explicit filter is the scope, not RLS).
    supabase.from("upa_wishlist_items").select("*").eq("upa_id", application.id),
    supabase.from("gratitude_posts").select("wishlist_item_id").eq("upa_id", application.id),
  ]);

  const items = itemsResult.data ?? [];
  const totalRaised = typeof rawRaised === "number" ? rawRaised : Number(rawRaised ?? 0);
  const openCount = items.filter((i) => i.status === "open").length;
  const fundedCount = items.filter((i) => i.status === "funded" || i.status === "delivered").length;

  const thankedItemIds = new Set((gratitudeResult.data ?? []).map((g) => g.wishlist_item_id));
  const awaitingThanks = items.filter(
    (i) => i.status === "funded" && !thankedItemIds.has(i.id),
  );

  const header = (
    <PageHeader
      eyebrow="Dashboard"
      title={application.story_headline}
      description="Your funding at a glance."
      action={
        <Button render={<Link href="/wishlist" />}>
          <Plus className="size-4" strokeWidth={1.75} />
          Manage wishlist
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Sparkles className="size-4" strokeWidth={1.75} />
              Total raised
            </span>
            <Money amount={totalRaised} className="text-2xl font-semibold text-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Gift className="size-4" strokeWidth={1.75} />
              Items funded
            </span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {fundedCount}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Gift className="size-4" strokeWidth={1.75} />
              Items open
            </span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {openCount}
            </span>
          </CardContent>
        </Card>
      </div>

      {awaitingThanks.length > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-primary">
                <Heart className="size-5" strokeWidth={1.75} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {awaitingThanks.length === 1
                    ? "One funded item is waiting for a thank you"
                    : `${awaitingThanks.length} funded items are waiting for a thank you`}
                </span>
                <span className="text-sm text-muted-foreground">
                  A gratitude post lets your sponsor see the impact they made.
                </span>
              </div>
            </div>
            <Button variant="outline" render={<Link href="/gratitude" />}>
              Write a thank you
              <ArrowRight className="size-4" strokeWidth={1.75} />
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Gift}
          title="Add your first wishlist item"
          description="List the gear or support you need with a real cost, and sponsors can start funding it."
        />
      ) : null}
    </div>
  );
}
