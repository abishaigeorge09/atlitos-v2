import type { Db } from "@atlitos/types";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Tabs } from "../../components/kit/Tabs";
import type { StatusTone } from "../../lib/status";
import { supabaseClient } from "../../providers/supabaseClient";

// `lib/status.ts` (shared, not owned by this track) has no "verified" entry;
// kit gap reported in the final report. Local mapping keeps the same four
// tone vocabulary without editing the shared file.
function venueStatusTone(status: Db.VenueRow["status"]): StatusTone {
  if (status === "verified") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

function venueStatusLabel(status: Db.VenueRow["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Admin additions task (AT-4, AT-10): Venues resource. Lists every
// public.venues row (RLS: venues_select_admin, admin reads all,
// 0009_courts.sql), filterable by verification status, with the partner's
// name resolved from public.users for display. Detail lives in
// venues/show.tsx (courts, partner info, approve/reject).
type VenueRow = Db.VenueRow;
type StatusFilter = "all" | Db.VenueRow["status"];

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

type LoadState = "loading" | "error" | "ready";

export function VenuesList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = (searchParams.get("status") as StatusFilter | null) ?? "all";
  const [search, setSearch] = useState("");

  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [partnerNames, setPartnerNames] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const { data, error } = await supabaseClient
        // invariant-allow: owner-scope the admin verification queue is
        // deliberately every partner's venue. `venues_select_merged` reads
        // `has_role('admin') OR partner_user_id = auth.uid()`, so this list is
        // empty for anyone without the admin role rather than leaking rows.
        .from("venues")
        .select("id,partner_user_id,name,address,city,pincode,lat,lng,description,status,rejection_reason,booking_url,created_at,updated_at")
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setState("error");
        return;
      }

      const rows = (data as VenueRow[]) ?? [];
      setVenues(rows);

      const partnerIds = Array.from(new Set(rows.map((r) => r.partner_user_id)));
      if (partnerIds.length > 0) {
        const { data: users } = await supabaseClient.from("users").select("id,name").in("id", partnerIds);
        if (!cancelled && users) {
          setPartnerNames(Object.fromEntries(users.map((u) => [u.id, u.name as string])));
        }
      }

      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return venues.filter((v) => {
      const matchesStatus = activeFilter === "all" || v.status === activeFilter;
      const matchesSearch =
        q.length === 0 ||
        v.name.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q) ||
        (partnerNames[v.partner_user_id] ?? "").toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [venues, activeFilter, search, partnerNames]);

  const columns: DataTableColumn<VenueRow>[] = [
    { key: "name", header: "Venue", render: (venue) => venue.name },
    { key: "city", header: "City", render: (venue) => venue.city },
    { key: "partner", header: "Partner", render: (venue) => partnerNames[venue.partner_user_id] ?? venue.partner_user_id },
    { key: "created", header: "Created", numeric: true, render: (venue) => new Date(venue.created_at).toLocaleDateString() },
    { key: "status", header: "Status", render: (venue) => <Badge tone={venueStatusTone(venue.status)}>{venueStatusLabel(venue.status)}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Venues" }]}
        title="Venues"
        description="Every court partner venue on the platform, with its verification status."
        primaryAction={
          <Button variant="primary" onClick={() => navigate("/venues/create")}>
            <Plus size={16} strokeWidth={1.75} />
            Add venue
          </Button>
        }
      />

      <Tabs
        items={STATUS_TABS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          count: tab.key === "all" ? venues.length : venues.filter((v) => v.status === tab.key).length,
        }))}
        active={activeFilter}
        onChange={(key) => setSearchParams(key === "all" ? {} : { status: key })}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, city or partner"
        resultCount={filtered.length}
        resultNoun="venues"
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(venue) => venue.id}
        rowHref={(venue) => `/venues/show/${venue.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load venues" : search || activeFilter !== "all" ? "No venues match this filter" : "No venues yet"}
        emptyBody={
          state === "error"
            ? "Something went wrong reading the venues table. Try again."
            : search || activeFilter !== "all"
              ? "Try a different status or search."
              : "Add the first venue to start the courts catalog."
        }
        emptyAction={
          state === "error" ? undefined : (
            <Button variant="primary" onClick={() => navigate("/venues/create")}>
              <Plus size={16} strokeWidth={1.75} />
              Add venue
            </Button>
          )
        }
      />
    </div>
  );
}
