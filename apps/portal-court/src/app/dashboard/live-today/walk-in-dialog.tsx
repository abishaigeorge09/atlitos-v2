"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { BillSummary } from "@atlitos/ui-web";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Database as AppDatabase } from "@atlitos/types";
import { formatSlotRange, sportLabel } from "@/lib/format";

type CourtRow = AppDatabase["public"]["Tables"]["courts"]["Row"];
type AvailableSlot = { slot_start: string; slot_end: string; price: number };

interface WalkInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courts: CourtRow[];
  date: string;
  onBooked: () => void;
}

/**
 * PRD-03 FR-17 / the Today dashboard's "Record a walk in" action. Calls the
 * `book-court` edge function's walk-in variant (see
 * supabase/functions/book-court/index.ts's header comment): the portal
 * never writes court_bookings/payment_intents/ledger_entries directly, only
 * the service-role edge function does, matching CLAUDE.md's financial
 * invariant. Shows `BillSummary` before confirming, per PRD-03 3.3.
 */
export function WalkInDialog({ open, onOpenChange, courts, date, onBooked }: WalkInDialogProps) {
  const [courtId, setCourtId] = useState(courts[0]?.id ?? "");
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotKey, setSlotKey] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [overridePrice, setOverridePrice] = useState(false);
  const [priceValue, setPriceValue] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [feeConfig, setFeeConfig] = useState<{ gstPercent: number; platformFeeFlat: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCourtId(courts[0]?.id ?? "");
    setSlotKey("");
    setName("");
    setPhone("");
    setOverridePrice(false);
    setPriceValue("");
    setPriceReason("");
    setError(null);

    const supabase = createClient();
    supabase
      .from("fee_config")
      .select("key, value")
      .eq("domain", "courts")
      .then(({ data }) => {
        const gst = data?.find((r) => r.key === "gst_percent")?.value ?? 0.1;
        const flat = data?.find((r) => r.key === "platform_fee_flat")?.value ?? 10;
        setFeeConfig({ gstPercent: gst, platformFeeFlat: flat });
      });
  }, [open, courts]);

  useEffect(() => {
    if (!open || !courtId) return;
    setSlotsLoading(true);
    setSlotKey("");
    const supabase = createClient();
    supabase
      .rpc("get_court_available_slots", { p_court_id: courtId, p_date: date })
      .then(({ data }) => {
        setSlots((data as AvailableSlot[]) ?? []);
        setSlotsLoading(false);
      });
  }, [open, courtId, date]);

  const selectedSlot = slots.find((s) => `${s.slot_start}-${s.slot_end}` === slotKey) ?? null;
  const selectedCourt = courts.find((c) => c.id === courtId) ?? null;

  const bill = useMemo(() => {
    if (!selectedSlot || !feeConfig) return null;
    const subtotal = overridePrice && priceValue ? Number(priceValue) : selectedSlot.price;
    const gst = Math.round(subtotal * feeConfig.gstPercent * 100) / 100;
    const platformFee = feeConfig.platformFeeFlat;
    const total = Math.round((subtotal + gst + platformFee) * 100) / 100;
    return { subtotal, gst, platformFee, total };
  }, [selectedSlot, feeConfig, overridePrice, priceValue]);

  async function confirm() {
    if (!selectedSlot || !selectedCourt) return;
    if (overridePrice && !priceReason.trim()) {
      setError("A reason is required when overriding the price.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: fnError } = await supabase.functions.invoke("book-court", {
      body: {
        court_id: selectedCourt.id,
        date,
        slot_start: selectedSlot.slot_start,
        slot_end: selectedSlot.slot_end,
        booking_source: "walk_in",
        walk_in_name: name || undefined,
        walk_in_phone: phone || undefined,
        ...(overridePrice && priceValue
          ? { price_override: Number(priceValue), price_override_reason: priceReason.trim() }
          : {}),
      },
    });
    setSubmitting(false);
    if (fnError) {
      setError(fnError.message);
      return;
    }
    onBooked();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record a walk in</DialogTitle>
          <DialogDescription>Occupies the slot immediately and blocks it from further booking.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Court</Label>
            <Select value={courtId} onChange={(e) => setCourtId(e.target.value)}>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({sportLabel(c.sport)})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Available slot today</Label>
            {slotsLoading ? (
              <p className="text-sm text-muted-foreground">Loading available slots...</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No available slots left today on this court.</p>
            ) : (
              <Select value={slotKey} onChange={(e) => setSlotKey(e.target.value)}>
                <option value="">Choose a slot</option>
                {slots.map((s) => (
                  <option key={`${s.slot_start}-${s.slot_end}`} value={`${s.slot_start}-${s.slot_end}`}>
                    {formatSlotRange(s.slot_start, s.slot_end)} · ₹{s.price}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Athlete name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span className="text-sm text-foreground">Override price</span>
            <Switch checked={overridePrice} onCheckedChange={setOverridePrice} />
          </div>

          {overridePrice ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>New price</Label>
                <Input type="number" min={0} step="0.01" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Reason</Label>
                <Input value={priceReason} onChange={(e) => setPriceReason(e.target.value)} placeholder="Required" />
              </div>
            </div>
          ) : null}

          {bill ? (
            <BillSummary
              rows={[
                { label: "Subtotal", amount: bill.subtotal },
                { label: "GST", amount: bill.gst, emphasis: "muted" },
                { label: "Platform fee", amount: bill.platformFee, emphasis: "muted" },
              ]}
              total={bill.total}
            />
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!bill || submitting} onClick={confirm}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirm walk in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
