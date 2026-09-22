import { formatINR } from "@atlitos/theme";
import type { CourtBookingStatus, Db } from "@atlitos/types";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "../../components/kit/Badge";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { EmptyState } from "../../components/kit/EmptyState";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Select } from "../../components/kit/Select";
import { Tabs } from "../../components/kit/Tabs";
import { statusTone } from "../../lib/status";
import { supabaseClient } from "../../providers/supabaseClient";
import "./bookings.css";

// Admin additions task (AT-4, AT-11, AT-10): Bookings, read only, for
// support. Reads public.court_bookings (RLS: court_bookings_select_admin,
// 0013_admin_courts_bookings.sql, admin/moderator read all) joined to
// public.courts / public.venues for a human readable location, and
// public.payment_intents (RLS: payment_intents_select_admin,
// 0010_payments_core.sql) for payment status, kept on this page as a
// tooltip on the total rather than a full column. No mutating action
// anywhere on this page: booking status transitions stay behind
// court_booking_transition / court_booking_confirm_payment /
// court_booking_expire_payment (all RPC gated already), matching CLAUDE.md's
// financial invariant and this resource's own read only scope.
type BookingListRow = Db.CourtBookingRow & {
  courts: { name: string; sport: string; venue_id: string } | null;
};

type LoadState = "loading" | "error" | "ready";

const statusTabs: { key: "all" | CourtBookingStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "confirmed", label: "Confirmed" },
  { key: "completed", label: "Completed" },
  { key: "pending_payment", label: "Pending payment" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no_show", label: "No show" },
  { key: "expired", label: "Expired" },
];

export function BookingsList() {
  const [rows, setRows] = useState<BookingListRow[]>([]);
  const [venueNames, setVenueNames] = useState<Record<string, string>>({});
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [paymentStatuses, setPaymentStatuses] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState>("loading");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CourtBookingStatus>("all");
  const [venueFilter, setVenueFilter] = useState("");

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

  function bookedByFor(row: BookingListRow): string {
    if (row.user_id) return userNames[row.user_id] ?? row.user_id;
    return row.walk_in_name ? `${row.walk_in_name}, walk in` : "Walk in";
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      const venueName = row.courts ? venueNames[row.courts.venue_id] ?? "" : "";
      if (venueFilter && (row.courts?.venue_id ?? "") !== venueFilter) return false;
      if (q.length === 0) return true;
      const bookedBy = bookedByFor(row);
      return (
        venueName.toLowerCase().includes(q) ||
        (row.courts?.name ?? "").toLowerCase().includes(q) ||
        bookedBy.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, statusFilter, venueFilter, venueNames, userNames]);

  const venueOptions = useMemo(() => {
    const ids = Array.from(new Set(rows.map((r) => r.courts?.venue_id).filter((v): v is string => Boolean(v))));
    return ids.map((id) => ({ value: id, label: venueNames[id] ?? id }));
  }, [rows, venueNames]);

  const columns: DataTableColumn<BookingListRow>[] = [
    {
      key: "when",
      header: "Date / slot",
      render: (row) => `${row.date}, ${row.slot_start}, ${row.slot_end}`,
    },
    {
      key: "venue",
      header: "Venue",
      render: (row) => (
        <div>
          <div className="ak-bookings-venue-name">{row.courts ? venueNames[row.courts.venue_id] ?? "Unknown venue" : "Unknown venue"}</div>
          <div className="ak-bookings-court-name">{row.courts?.name ?? row.court_id}</div>
        </div>
      ),
    },
    { key: "customer", header: "Customer", render: (row) => bookedByFor(row) },
    { key: "source", header: "Source", render: (row) => row.booking_source },
    {
      key: "total",
      header: "Total",
      numeric: true,
      render: (row) => {
        const paymentStatus = row.payment_intent_id ? paymentStatuses[row.payment_intent_id] : undefined;
        return <span title={paymentStatus ? `Payment ${paymentStatus}` : undefined}>{formatINR(Number(row.total))}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={statusTone(row.status)}>{row.status.replace(/_/g, " ")}</Badge>,
    },
  ];

  return (
    <div className="ak-page-stack">
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Bookings" }]}
        title="Bookings"
        description="Every court booking with its payment status, read only, for support. The most recent 200 bookings."
      />

      <Tabs
        items={statusTabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          count: tab.key === "all" ? rows.length : rows.filter((r) => r.status === tab.key).length,
        }))}
        active={statusFilter}
        onChange={(key) => setStatusFilter(key as "all" | CourtBookingStatus)}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by venue, court, or player"
        filters={
          <Select value={venueFilter} onChange={setVenueFilter} placeholder="All venues" options={venueOptions} />
        }
        resultCount={filtered.length}
        resultNoun="bookings"
      />

      {state === "error" ? (
        <EmptyState title="Could not load bookings" body="Something went wrong reading the court_bookings table. Try again." />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          loading={state === "loading"}
          emptyTitle="No bookings found"
          emptyBody="No bookings match this tab, filter, and search."
        />
      )}
    </div>
  );
}
