import Link from "next/link";
import {
  ArrowRight,
  Clock,
  Gift,
  Heart,
  Landmark,
  Plus,
  Quote,
  Sparkles,
  Users,
} from "lucide-react";

import { getMoneySummary, requireVerifiedApplication } from "@/lib/empower";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function DashboardPage() {
  const { application } = await requireVerifiedApplication();
  const supabase = await createClient();

  // Money-in is READ ONLY and server derived (0084 upa_money_summary): total is
  // ledger derived, per item funding and supporters come from donations, never
  // from the funded_amount cache. Scoped to this owner inside the RPC.
  const [summary, itemsResult] = await Promise.all([
    getMoneySummary(application.id),
    supabase.from("upa_wishlist_items").select("*").eq("upa_id", application.id),
  ]);

  const items = itemsResult.data ?? [];
  const totalRaised = summary?.total_raised ?? 0;
  const donorCount = summary?.donor_count ?? 0;
  const supporters = summary?.supporters ?? [];
  const gratitude = summary?.gratitude ?? [];
  const openCount = items.filter((i) => i.status === "open").length;
  const fundedCount = items.filter((i) => i.status === "funded" || i.status === "delivered").length;

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
    <div className="flex flex-1 flex-col gap-6" data-testid="upa-dashboard">
      {header}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Sparkles className="size-4" strokeWidth={1.75} />
              Total raised
            </span>
            <Money
              amount={totalRaised}
              className="text-2xl font-semibold text-foreground"
              data-testid="dashboard-total-raised"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-5">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="size-4" strokeWidth={1.75} />
              Supporters
            </span>
            <span
              className="font-mono text-2xl font-semibold tabular-nums text-foreground"
              data-testid="dashboard-donor-count"
            >
              {donorCount}
            </span>
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

      {/* Money in and where it goes: an honest visibility seam. Bank payouts are
          Razorpay Route gated and not enabled (PAYMENTS.md), so no disbursed
          figure is shown and no transfer is offered. */}
      <Card data-testid="disbursement-panel">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <Landmark className="size-4 text-primary" strokeWidth={1.75} />
            <span className="text-sm font-medium text-foreground">Money in and where it goes</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-4 py-3">
              <span className="text-sm text-muted-foreground">Raised for you</span>
              <Money amount={totalRaised} className="text-sm font-semibold text-foreground" />
            </div>
            <div
              className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-4 py-3"
              data-testid="payout-status"
            >
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="size-3.5" strokeWidth={1.75} />
                Payouts to your account
              </span>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Arriving soon
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Every rupee raised is held safely for you. Direct payouts to your bank account open
            once account setup is enabled. We will let you know the moment it is ready.
          </p>
        </CardContent>
      </Card>

      {gratitude.length === 0 && items.some((i) => i.status === "funded") ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-primary">
                <Heart className="size-5" strokeWidth={1.75} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  A funded item is waiting for a thank you
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

      {/* Supporters (PRD-05 FR-17): grouped by donor, name shown only when the
          donor opted in, otherwise "A Sponsor". */}
      <section className="flex flex-col gap-3" data-testid="supporters-section">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Your supporters
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {donorCount} {donorCount === 1 ? "supporter" : "supporters"}
          </span>
        </div>
        {supporters.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No supporters yet"
            description="When a sponsor funds your wishlist, they show up here."
          />
        ) : (
          <div className="flex flex-col gap-2" data-testid="supporters-list">
            {supporters.map((supporter, index) => (
              <Card key={`${supporter.last_at}-${index}`}>
                <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <Heart className="size-4" strokeWidth={1.75} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {supporter.display_name ?? "A Sponsor"}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatDate(supporter.last_at)}
                      </span>
                    </div>
                  </div>
                  <Money amount={supporter.amount} className="text-sm text-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Reviews: the UPA's own published gratitude posts, shown back to them. */}
      <section className="flex flex-col gap-3" data-testid="reviews-section">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Your thank you notes
        </span>
        {gratitude.length === 0 ? (
          <EmptyState
            icon={Quote}
            title="No thank you notes yet"
            description="After an item is funded, write a thank you here and your sponsor will see it."
          />
        ) : (
          <div className="flex flex-col gap-2" data-testid="reviews-list">
            {gratitude.map((post) => (
              <Card key={post.id}>
                <CardContent className="flex flex-col gap-2 p-5">
                  <Quote className="size-4 text-primary" strokeWidth={1.75} />
                  <p className="text-sm text-muted-foreground">{post.body}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {post.item_title ? (
                      <span className="text-foreground">{post.item_title}</span>
                    ) : null}
                    <span className="font-mono tabular-nums">{formatDate(post.created_at)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

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
