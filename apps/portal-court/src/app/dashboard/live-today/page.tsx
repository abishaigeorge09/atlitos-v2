"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, Loader2, Radio, UserPlus, WifiOff, X } from "lucide-react";
import { BillSummary } from "@atlitos/ui-web";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { VenueSwitcher } from "@/components/venue-switcher";
import { useVenueScope } from "@/components/venue-scope";
import { createClient } from "@/lib/supabase/client";
import type { Database as AppDatabase } from "@atlitos/types";
import { formatSlotRange, sportLabel, todayIso } from "@/lib/format";
import { courtBookingStatusPill, StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { WalkInDialog } from "./walk-in-dialog";

type CourtRow = AppDatabase["public"]["Tables"]["courts"]["Row"];

// `venue_bookings_today` is a view joining court_bookings to courts/venues;
// Postgres/`supabase gen types` marks every view column nullable because it
// cannot prove non-null through the join, but the inner join here guarantees
// every row's own court_bookings/courts columns are present. Typed
// explicitly (matching packages/api's `.returns<T>()` pattern) rather than
// scattering non-null assertions at every read site below.
type BookingRow = {
  id: string;
  court_id: string;
  user_id: string | null;
  booking_source: AppDatabase["public"]["Enums"]["booking_source"];
  walk_in_name: string | null;
  walk_in_phone: string | null;
  created_by_staff_id: string | null;
  date: string;
  slot_start: string;
  slot_end: string;
  subtotal: number;
  gst: number;
  platform_fee: number;
  total: number;
  status: AppDatabase["public"]["Enums"]["court_booking_status"];
  checked_in_at: string | null;
  cancellation_reason: string | null;
  rating: number | null;
  remarks: string | null;
  payment_intent_id: string | null;
  created_at: string;
  updated_at: string;
  venue_id: string;
  court_sport: AppDatabase["public"]["Enums"]["sport"];
  court_name: string;
};

export default function LiveTodayPage() {
  const scope = useVenueScope();
  const [courts, setCourts] = useState<CourtRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(true);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<BookingRow | null>(null);
  const [billTarget, setBillTarget] = useState<BookingRow | null>(null);

  const today = useMemo(() => todayIso(), []);

  const load = useCallback(async () => {
    if (!scope.selectedVenueId) return;
    setStatus("loading");
    const supabase = createClient();

    const [courtsResult, bookingsResult] = await Promise.all([
      supabase.from("courts").select("*").eq("venue_id", scope.selectedVenueId).eq("active", true),
      supabase
        .from("venue_bookings_today")
        .select("*")
        .eq("venue_id", scope.selectedVenueId)
        .eq("date", today)
        .order("slot_start", { ascending: true })
        .returns<BookingRow[]>(),
    ]);

    if (courtsResult.error || bookingsResult.error) {
      setError(courtsResult.error?.message ?? bookingsResult.error?.message ?? "Failed to load today's bookings.");
      setStatus("error");
      return;
    }

    setCourts(courtsResult.data ?? []);
    setBookings(bookingsResult.data ?? []);
    setStatus("ready");
  }, [scope.selectedVenueId, today]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: subscribe to the underlying court_bookings table (postgres
  // changes cannot target a view) scoped to this venue's court ids, and
  // simply refetch on any change. PRD-03 FR-15: new bookings, cancellations,
  // check ins and walk ins all reflect here without a manual refresh.
  useEffect(() => {
    if (courts.length === 0) return;
    const supabase = createClient();
    const courtIds = courts.map((c) => c.id);
    const channel = supabase
      .channel(`live-today-${scope.selectedVenueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "court_bookings",
          filter: `court_id=in.(${courtIds.join(",")})`,
        },
        () => load(),
      )
      .subscribe((subStatus) => {
        setRealtimeConnected(subStatus === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courts.map((c) => c.id).join(","), scope.selectedVenueId]);

  async function checkIn(booking: BookingRow) {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("court_booking_check_in", { p_booking_id: booking.id });
    if (!rpcError) load();
  }

  const header = (
    <PageHeader
      eyebrow="Live today"
      title="Today, court by court"
      action={
        <div className="flex items-center gap-2">
          <VenueSwitcher />
          <Button size="sm" onClick={() => setWalkInOpen(true)} disabled={courts.length === 0}>
            <UserPlus className="size-4" strokeWidth={1.75} />
            Record a walk in
          </Button>
        </div>
      }
    />
  );

  if (scope.status === "loading" || (scope.status === "ready" && status === "loading")) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (scope.status === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description={scope.error ?? "Could not load your venues."} onRetry={scope.refresh} />
      </div>
    );
  }

  if (scope.status === "empty") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <EmptyState
          icon={Radio}
          title="Nothing to show until a venue is verified"
          description="Check ins, walk ins and cancellations across every court will update here in real time."
        />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description={error ?? "Failed to load today's bookings."} onRetry={load} />
      </div>
    );
  }

  const grouped = (bookings ?? []).reduce<Record<string, BookingRow[]>>((acc, b) => {
    (acc[b.court_name] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      {!realtimeConnected ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          <WifiOff className="size-4" strokeWidth={1.75} />
          Live updates disconnected.
          <Button variant="link" size="xs" onClick={load} className="h-auto p-0">
            Refresh manually
          </Button>
        </div>
      ) : null}

      {(bookings ?? []).length === 0 ? (
        <EmptyState icon={Radio} title="No bookings today yet" description="New bookings, walk ins and cancellations will appear here the moment they happen." />
      ) : (
        <div className="flex flex-col gap-6">
          {Object.entries(grouped).map(([courtName, rows]) => (
            <div key={courtName} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-foreground">{courtName}</h2>
              <div className="flex flex-col gap-2">
                {rows.map((booking) => {
                  const pill = courtBookingStatusPill(booking.status, booking.checked_in_at);
                  const canCheckIn = booking.status === "confirmed" && !booking.checked_in_at;
                  const canCancel = booking.status === "confirmed";
                  return (
                    <Card key={booking.id}>
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">
                            {booking.walk_in_name || "Athlete booking"}
                            {booking.booking_source === "walk_in" ? (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">Walk in</span>
                            ) : null}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {sportLabel(booking.court_sport)} · {formatSlotRange(booking.slot_start, booking.slot_end)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setBillTarget(booking)}
                            className="font-mono text-sm tabular-nums text-foreground underline-offset-4 hover:underline"
                          >
                            ₹{booking.total}
                          </button>
                          <StatusPill label={pill.label} tone={pill.tone} />
                          {canCheckIn ? (
                            <Button size="sm" variant="outline" onClick={() => checkIn(booking)}>
                              <CircleCheck className="size-4" strokeWidth={1.75} />
                              Check in
                            </Button>
                          ) : null}
                          {canCancel ? (
                            <Button size="sm" variant="ghost" onClick={() => setCancelTarget(booking)}>
                              <X className="size-4" strokeWidth={1.75} />
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <CancelDialog booking={cancelTarget} onClose={() => setCancelTarget(null)} onDone={load} />
      <BillDialog booking={billTarget} onClose={() => setBillTarget(null)} />
      <WalkInDialog
        open={walkInOpen}
        onOpenChange={setWalkInOpen}
        courts={courts}
        date={today}
        onBooked={load}
      />
    </div>
  );
}

function CancelDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: BookingRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setError(null);
  }, [booking?.id]);

  async function confirm() {
    if (!booking) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("court_booking_transition", {
      p_booking_id: booking.id,
      p_action: "cancel",
      p_reason: reason.trim(),
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onDone();
    onClose();
  }

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel booking</DialogTitle>
          <DialogDescription>
            A reason is required. If the slot time has already passed, this is recorded as a no show instead of a cancellation.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Athlete no show, venue issue, weather, other"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={confirm}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirm cancellation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BillDialog({ booking, onClose }: { booking: BookingRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Booking detail</DialogTitle>
          <DialogDescription>
            {booking ? `${sportLabel(booking.court_sport)} · ${formatSlotRange(booking.slot_start, booking.slot_end)}` : null}
          </DialogDescription>
        </DialogHeader>
        {booking ? (
          <BillSummary
            rows={[
              { label: "Subtotal", amount: booking.subtotal },
              { label: "GST", amount: booking.gst, emphasis: "muted" },
              { label: "Platform fee", amount: booking.platform_fee, emphasis: "muted" },
            ]}
            total={booking.total}
            footnote={
              booking.booking_source === "walk_in"
                ? "Walk in booking, cash collected at the desk."
                : "Paid by the athlete at booking time."
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
