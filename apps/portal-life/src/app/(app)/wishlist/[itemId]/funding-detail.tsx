"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleUser, Heart, Loader2, PackageCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { WishlistItem, GratitudePost } from "@/lib/empower";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { FundingBar } from "@/components/funding-bar";
import { Money } from "@/components/money";
import { StatusPill, itemStatusPill } from "@/components/status-pill";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface DonationRow {
  id: string;
  amount: number;
  created_at: string;
  method: string;
  // AT-149: the finalize-time visibility snapshot. Non null only when the donor
  // had show_donor_name on at the moment they gave; null renders "A Sponsor".
  // Read from the row, never joined live against users (address-snapshot rule).
  donor_display_name: string | null;
}

export function FundingDetail({ itemId, upaId }: { itemId: string; upaId: string }) {
  const [item, setItem] = useState<WishlistItem | null>(null);
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [gratitude, setGratitude] = useState<GratitudePost | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready" | "missing">("loading");
  const [marking, setMarking] = useState(false);

  const reload = useCallback(async () => {
    const supabase = createClient();
    // Scope by BOTH id and the owner's upa_id (permissive-OR table, 0049).
    const { data: itemData, error } = await supabase
      .from("upa_wishlist_items")
      .select("*")
      .eq("id", itemId)
      .eq("upa_id", upaId)
      .maybeSingle();

    if (error) {
      setState("error");
      return;
    }
    if (!itemData) {
      setState("missing");
      return;
    }
    setItem(itemData);

    // Donations attributed to this item. The UPA's own-UPA select policy
    // (donations_select_own_upa) returns only rows for its own application, and
    // this item filter narrows to this item.
    const [{ data: donationData }, { data: gratitudeData }] = await Promise.all([
      supabase
        .from("donations")
        .select("id, amount, created_at, method, donor_display_name")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false }),
      supabase
        .from("gratitude_posts")
        .select("*")
        .eq("wishlist_item_id", itemId)
        .eq("upa_id", upaId)
        .maybeSingle(),
    ]);

    setDonations((donationData ?? []) as DonationRow[]);
    setGratitude(gratitudeData ?? null);
    setState("ready");
  }, [itemId, upaId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Realtime: a new donation flips funded_amount/status under the service role.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`funding-${itemId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upa_wishlist_items", filter: `id=eq.${itemId}` },
        () => reload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "donations", filter: `item_id=eq.${itemId}` },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, reload]);

  async function markDelivered() {
    if (!item) return;
    setMarking(true);
    const supabase = createClient();
    // funded -> delivered via the owner gated RPC (0050), never a client status
    // write.
    const { error } = await supabase.rpc("mark_wishlist_item_delivered", { p_item_id: item.id });
    setMarking(false);
    if (!error) reload();
  }

  const back = (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link href="/wishlist" />}>
      <ArrowLeft className="size-4" strokeWidth={1.75} />
      Back to wishlist
    </Button>
  );

  if (state === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {back}
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {back}
        <ErrorState description="We could not load this item." onRetry={reload} />
      </div>
    );
  }

  if (state === "missing" || !item) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {back}
        <EmptyState
          icon={PackageCheck}
          title="Item not found"
          description="This item may have been removed. Head back to your wishlist."
        />
      </div>
    );
  }

  const pill = itemStatusPill(item.status, Number(item.funded_amount));

  return (
    <div className="flex flex-1 flex-col gap-6">
      {back}

      <PageHeader eyebrow="Funding progress" title={item.title} />

      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <StatusPill label={pill.label} tone={pill.tone} />
            {item.status === "funded" ? (
              <Button size="sm" variant="outline" onClick={markDelivered} disabled={marking}>
                {marking ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" strokeWidth={1.75} />}
                Mark as delivered
              </Button>
            ) : null}
          </div>
          <FundingBar funded={Number(item.funded_amount)} cost={Number(item.cost)} />
        </CardContent>
      </Card>

      {gratitude ? (
        <Card>
          <CardContent className="flex flex-col gap-2 p-6">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Heart className="size-4 text-primary" strokeWidth={1.75} />
              Your thank you
            </span>
            <p className="text-sm text-muted-foreground">{gratitude.body}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Sponsors
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {donations.length} {donations.length === 1 ? "donation" : "donations"}
          </span>
        </div>

        {donations.length === 0 ? (
          <EmptyState
            icon={CircleUser}
            title="No sponsors yet"
            description="When a sponsor funds this item, their contribution appears here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {donations.map((donation) => (
              <Card key={donation.id}>
                <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <CircleUser className="size-4" strokeWidth={1.75} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {donation.donor_display_name ?? "A Sponsor"}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatDate(donation.created_at)}
                      </span>
                    </div>
                  </div>
                  <Money amount={donation.amount} className="text-sm text-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
