import type { Db } from "@atlitos/types";
import { AlertTriangle, Building2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Card, EmptyState } from "../../components/ui";
import { supabaseClient } from "../../providers/supabaseClient";

// Admin additions task (AT-4, AT-10): Venues resource. Lists every
// public.venues row (RLS: venues_select_admin, admin reads all,
// 0009_courts.sql), filterable by verification status, with the partner's
// name resolved from public.users for display. Detail lives in
// venues/show.tsx (courts, partner info, approve/reject).
type VenueRow = Db.VenueRow;
type StatusFilter = "all" | Db.VenueRow["status"];

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

type LoadState = "loading" | "error" | "ready";

function statusTone(status: VenueRow["status"]): "neutral" | "success" | "warning" | "danger" {
  if (status === "verified") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

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
        .from("venues")
        .select("id,partner_user_id,name,address,city,pincode,lat,lng,description,status,rejection_reason,created_at,updated_at")
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Venues</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Every court partner venue on the platform, with its verification status.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)" }}>
        <div style={{ display: "flex", gap: "var(--space-xs)", borderBottom: "1px solid var(--color-border)" }}>
          {statusTabs.map((tab) => {
            const isActive = tab.key === activeFilter;
            const count =
              tab.key === "all" ? venues.length : venues.filter((v) => v.status === tab.key).length;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSearchParams(tab.key === "all" ? {} : { status: tab.key })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-xs)",
                  padding: "var(--space-sm) var(--space-lg)",
                  border: "none",
                  borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
                  backgroundColor: "transparent",
                  color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {tab.label}
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 12,
                    padding: "0 6px",
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: "var(--color-surface-muted)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface-muted)",
            width: 280,
          }}
        >
          <Search size={16} strokeWidth={1.75} color="var(--color-text-tertiary)" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, city, or partner"
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
            Loading venues...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load venues"
            description="Something went wrong reading the venues table. Try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 size={32} strokeWidth={1.75} />}
            title="No venues found"
            description="No venues match this filter and search."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Venue", "City", "Partner", "Created", "Status"].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      padding: "var(--space-sm) var(--space-lg)",
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((venue) => (
                <tr
                  key={venue.id}
                  onClick={() => navigate(`/venues/show/${venue.id}`)}
                  style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                    {venue.name}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {venue.city}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {partnerNames[venue.partner_user_id] ?? venue.partner_user_id}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-md) var(--space-lg)",
                      fontSize: 13,
                      fontFamily: "JetBrains Mono, monospace",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {new Date(venue.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone={statusTone(venue.status)}>{venue.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
