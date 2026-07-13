import type { Db } from "@atlitos/types";
import { AlertTriangle, CalendarClock, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, Card, EmptyState } from "../../components/ui";
import { supabaseClient } from "../../providers/supabaseClient";

// Admin additions task (AT-4, AT-11, AT-10): Bookings, read only, for
// support. Reads public.court_bookings (RLS: court_bookings_select_admin,
// 0013_admin_courts_bookings.sql, admin/moderator read all) joined to
// public.courts / public.venues for a human readable location, and
// public.payment_intents (RLS: payment_intents_select_admin,
// 0010_payments_core.sql) for payment status. No mutating action anywhere
// on this page: booking status transitions stay behind
// court_booking_transition / court_booking_confirm_payment /
// court_booking_expire_payment (all RPC gated already), matching CLAUDE.md's
// financial invariant and this resource's own read only scope.
//
// court_bookings.status can also be 'pending_payment' or 'expired'
// (0011_courts_payment_state.sql added these enum values after
// packages/types's hand authored CourtBookingStatus union was written;
// known, pre-existing type package debt, not in this task's scope to fix).
// Status is rendered generically here rather than narrowed to that union so
// this page does not need to wait on that fix.
type BookingListRow = Db.CourtBookingRow & {
  courts: { name: string; sport: string; venue_id: string } | null;
};

type LoadState = "loading" | "error" | "ready";

function bookingStatusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "confirmed" || status === "completed") return "success";
  if (status === "cancelled" || status === "expired" || status === "no_show") return "danger";
  return "warning";
}

function paymentStatusTone(status: string | null): "neutral" | "success" | "warning" | "danger" {
  if (!status) return "neutral";
  if (status === "captured") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

export function BookingsList() {
  const [rows, setRows] = useState<BookingListRow[]>([]);
  const [venueNames, setVenueNames] = useState<Record<string, string>>({});
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [paymentStatuses, setPaymentStatuses] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState>("loading");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const { data, error } = await supabaseClient
        .from("court_bookings")
        .select(
          "id,court_id,user_id,booking_source,walk_in_name,walk_in_phone,created_by_staff_id,date,slot_start,slot_end,subtotal,gst,platform_fee,total,status,checked_in_at,cancellation_reason,rating,remarks,payment_intent_id,created_at,updated_at,courts(name,sport,venue_id)",
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (cancelled) return;

      if (error) {
        setState("error");
        return;
      }

      const bookingRows = (data as unknown as BookingListRow[]) ?? [];
      setRows(bookingRows);

      const venueIds = Array.from(
        new Set(bookingRows.map((r) => r.courts?.venue_id).filter((v): v is string => Boolean(v))),
      );
      const userIds = Array.from(new Set(bookingRows.map((r) => r.user_id).filter((v): v is string => Boolean(v))));
      const paymentIntentIds = Array.from(
        new Set(bookingRows.map((r) => r.payment_intent_id).filter((v): v is string => Boolean(v))),
      );

      const [venuesResult, usersResult, paymentIntentsResult] = await Promise.all([
        venueIds.length > 0
          ? supabaseClient.from("venues").select("id,name").in("id", venueIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        userIds.length > 0
          ? supabaseClient.from("users").select("id,name").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        paymentIntentIds.length > 0
          ? supabaseClient.from("payment_intents").select("id,status").in("id", paymentIntentIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
      ]);

      if (cancelled) return;

      setVenueNames(Object.fromEntries((venuesResult.data ?? []).map((v) => [v.id, v.name])));
      setUserNames(Object.fromEntries((usersResult.data ?? []).map((u) => [u.id, u.name])));
      setPaymentStatuses(Object.fromEntries((paymentIntentsResult.data ?? []).map((p) => [p.id, p.status])));

      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const venueName = row.courts ? venueNames[row.courts.venue_id] ?? "" : "";
      const bookedBy = row.user_id ? userNames[row.user_id] ?? "" : row.walk_in_name ?? "";
      return (
        venueName.toLowerCase().includes(q) ||
        (row.courts?.name ?? "").toLowerCase().includes(q) ||
        bookedBy.toLowerCase().includes(q)
      );
    });
  }, [rows, search, venueNames, userNames]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Bookings</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Every court booking with its payment status, read only, for support. The most recent 200 bookings.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", maxWidth: 320 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface-muted)",
            width: "100%",
          }}
        >
          <Search size={16} strokeWidth={1.75} color="var(--color-text-tertiary)" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by venue, court, or player"
            style={{
              border: "none",
              outline: "none",
              backgroundColor: "transparent",
              fontSize: 14,
              color: "var(--color-text)",
              width: "100%",
            }}
          />
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            Loading bookings...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load bookings"
            description="Something went wrong reading the court_bookings table. Try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={32} strokeWidth={1.75} />}
            title="No bookings found"
            description="No bookings match this search."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                  {["Venue / Court", "Booked by", "Date / slot", "Total", "Booking status", "Payment status"].map(
                    (heading) => (
                      <th
                        key={heading}
                        style={{
                          padding: "var(--space-sm) var(--space-lg)",
                          fontSize: 12,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: "var(--color-text-tertiary)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const venueName = row.courts ? venueNames[row.courts.venue_id] ?? "Unknown venue" : "Unknown venue";
                  const bookedBy = row.user_id
                    ? userNames[row.user_id] ?? row.user_id
                    : row.walk_in_name
                      ? `${row.walk_in_name}, walk in`
                      : "Walk in";
                  const paymentStatus = row.payment_intent_id ? paymentStatuses[row.payment_intent_id] ?? null : null;

                  return (
                    <tr key={row.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14 }}>
                        <div style={{ fontWeight: 600 }}>{venueName}</div>
                        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{row.courts?.name ?? row.court_id}</div>
                      </td>
                      <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                        {bookedBy}
                      </td>
                      <td
                        style={{
                          padding: "var(--space-md) var(--space-lg)",
                          fontSize: 13,
                          fontFamily: "JetBrains Mono, monospace",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.date}, {row.slot_start}, {row.slot_end}
                      </td>
                      <td
                        style={{
                          padding: "var(--space-md) var(--space-lg)",
                          fontSize: 14,
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        Rs {Number(row.total).toFixed(2)}
                      </td>
                      <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                        <Badge tone={bookingStatusTone(row.status)}>{row.status}</Badge>
                      </td>
                      <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                        <Badge tone={paymentStatusTone(paymentStatus)}>{paymentStatus ?? "no payment intent"}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
