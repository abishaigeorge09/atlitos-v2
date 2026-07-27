"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Gift, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { WishlistItem } from "@/lib/empower";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FundingBar } from "@/components/funding-bar";
import { Money } from "@/components/money";
import { StatusPill, derivedItemPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function WishlistManager({
  upaId,
  initialItems,
  initialFunded,
}: {
  upaId: string;
  initialItems: WishlistItem[];
  initialFunded: Record<string, number>;
}) {
  const [items, setItems] = useState<WishlistItem[]>(initialItems);
  // Per item DERIVED funding, keyed by item id (0084 upa_money_summary), never
  // the funded_amount cache. Refreshed alongside the item list.
  const [funded, setFunded] = useState<Record<string, number>>(initialFunded);
  const [state, setState] = useState<"ready" | "error">("ready");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WishlistItem | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WishlistItem | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    // Explicit owner scope by upa_id (permissive-OR table, 0049). Funding comes
    // from the derived money summary RPC, scoped to this owner inside the RPC.
    const [{ data, error }, { data: summary }] = await Promise.all([
      supabase
        .from("upa_wishlist_items")
        .select("*")
        .eq("upa_id", upaId)
        .order("created_at", { ascending: false }),
      supabase.rpc("upa_money_summary", { p_upa_id: upaId }),
    ]);
    if (error) {
      setState("error");
      return;
    }
    setItems(data ?? []);
    const summaryItems = (summary as { items?: Record<string, number> } | null)?.items;
    setFunded(summaryItems ?? {});
    setState("ready");
  }, [upaId]);

  // Realtime (FR-15): a donation flips funding under the service role; subscribe
  // to this UPA's own items and its donations, refetch derived funding on any
  // change.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`wishlist-${upaId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "upa_wishlist_items",
          filter: `upa_id=eq.${upaId}`,
        },
        () => reload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "donations", filter: `upa_id=eq.${upaId}` },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [upaId, reload]);

  const header = (
    <PageHeader
      eyebrow="Wishlist"
      title="What you need"
      description="Add gear and support with a real cost. Sponsors fund it from your public profile."
      action={
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" strokeWidth={1.75} />
          Add item
        </Button>
      }
    />
  );

  if (state === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description="We could not load your wishlist." onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      {items.length === 0 ? (
        <EmptyState
          icon={Gift}
          title="No items yet"
          description="Add your first item so sponsors know exactly what to fund."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="wishlist-grid">
          {items.map((item) => {
            const fundedAmount = funded[item.id] ?? 0;
            const pill = derivedItemPill(item.status, fundedAmount, Number(item.cost));
            const editable = item.status === "open" && fundedAmount === 0;
            return (
              <Card key={item.id} data-testid="wishlist-item-card">
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        Cost <Money amount={item.cost} className="text-foreground" />
                      </span>
                    </div>
                    <StatusPill label={pill.label} tone={pill.tone} />
                  </div>

                  <FundingBar funded={fundedAmount} cost={Number(item.cost)} />

                  <div className="flex items-center justify-between">
                    <Button variant="link" size="sm" className="h-auto p-0" render={<Link href={`/wishlist/${item.id}`} />}>
                      View funding
                      <ArrowRight className="size-3.5" strokeWidth={1.75} />
                    </Button>
                    {editable ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit item"
                          onClick={() => setEditTarget(item)}
                        >
                          <Pencil className="size-4" strokeWidth={1.75} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove item"
                          onClick={() => setRemoveTarget(item)}
                        >
                          <Trash2 className="size-4" strokeWidth={1.75} />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Locked once funding starts
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        upaId={upaId}
        onSaved={reload}
      />
      <ItemDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        upaId={upaId}
        item={editTarget}
        onSaved={reload}
      />
      <RemoveDialog target={removeTarget} onClose={() => setRemoveTarget(null)} onDone={reload} />
    </div>
  );
}

function ItemDialog({
  open,
  onOpenChange,
  upaId,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upaId: string;
  item?: WishlistItem | null;
  onSaved: () => void;
}) {
  const editing = !!item;
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(item?.title ?? "");
      setCost(item ? String(item.cost) : "");
      setError(null);
    }
  }, [open, item]);

  async function save() {
    const costValue = Number(cost);
    if (!title.trim()) {
      setError("Give the item a name.");
      return;
    }
    if (!Number.isFinite(costValue) || costValue <= 0) {
      setError("Enter a cost greater than zero.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    // Clients never write funded_amount or status (0049 column grant excludes
    // them). Insert relies on the open/funded 0 defaults; edit touches only
    // title and cost.
    const { error: writeError } = editing
      ? await supabase.from("upa_wishlist_items").update({ title: title.trim(), cost: costValue }).eq("id", item!.id)
      : await supabase.from("upa_wishlist_items").insert({ upa_id: upaId, title: title.trim(), cost: costValue });
    setSubmitting(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit item" : "Add an item"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "You can change the name and cost until funding starts."
              : "Name what you need and its cost. It starts open for sponsors to fund."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-title">Item</Label>
            <Input
              id="item-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Cricket bat set for 10 girls"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-cost">Cost in rupees</Label>
            <Input
              id="item-cost"
              type="number"
              min={1}
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="5000"
              className="font-mono tabular-nums"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save changes" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  target,
  onClose,
  onDone,
}: {
  target: WishlistItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [target?.id]);

  async function confirm() {
    if (!target) return;
    setSubmitting(true);
    const supabase = createClient();
    // RLS permits delete only while open and funded_amount 0 (0049).
    const { error: deleteError } = await supabase
      .from("upa_wishlist_items")
      .delete()
      .eq("id", target.id);
    setSubmitting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    onDone();
    onClose();
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this item</DialogTitle>
          <DialogDescription>
            {target ? `Remove "${target.title}" from your wishlist. This cannot be undone.` : null}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Remove item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
