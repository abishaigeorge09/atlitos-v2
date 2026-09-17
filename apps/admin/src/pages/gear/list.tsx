import { SPORTS, type Sport } from "@atlitos/types";
import { AlertTriangle, Plus, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { fetchGear, type GearListFilters, type GearWithOffers } from "./api";

// The affiliate gear catalog: every item with brand, sport, retailer count and
// cheapest in stock price. This admin list is the ONE surface that sees
// delisted items (0120 admin SELECT policy); the shopper surface filters
// active = true. Every narrowing here is an explicit filter in fetchGear.

type LoadState = "loading" | "error" | "ready";

const ACTIVE_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Listed" },
  { key: "inactive", label: "Delisted" },
] as const;

const cell: React.CSSProperties = { padding: "var(--space-md) var(--space-lg)", fontSize: 14 };

function cheapest(item: GearWithOffers): number | null {
  const inStock = item.offers.filter((o) => o.in_stock);
  if (inStock.length === 0) return null;
  return Math.min(...inStock.map((o) => Number(o.price)));
}

export function GearList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sportParam = (searchParams.get("sport") as Sport | null) ?? null;
  const activeParam = searchParams.get("active") ?? "all";

  const [items, setItems] = useState<GearWithOffers[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const filters = useMemo<GearListFilters>(() => {
    const next: GearListFilters = {};
    if (sportParam) next.sport = sportParam;
    if (activeParam === "active") next.active = true;
    if (activeParam === "inactive") next.active = false;
    return next;
  }, [sportParam, activeParam]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetchGear(filters)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Gear</h1>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
            The affiliate catalog. Each item lists retailer prices and sends the shopper out to buy.
          </p>
        </div>
        <Button onClick={() => navigate("/gear/create")}>
          <Plus size={16} strokeWidth={1.75} />
          New gear item
        </Button>
      </div>

      <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <FilterGroup label="Sport">
          <Chip active={!sportParam} onClick={() => setParam("sport", null)}>
            All
          </Chip>
          {SPORTS.map((sport) => (
            <Chip key={sport} active={sportParam === sport} onClick={() => setParam("sport", sport)}>
              {sport}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="State">
          {ACTIVE_TABS.map((tab) => (
            <Chip
              key={tab.key}
              active={activeParam === tab.key}
              onClick={() => setParam("active", tab.key === "all" ? null : tab.key)}
            >
              {tab.label}
            </Chip>
          ))}
        </FilterGroup>
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>Loading gear...</div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load gear"
            description="Something went wrong reading the catalog. Try again."
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Tag size={32} strokeWidth={1.75} />}
            title="No gear yet"
            description="Nothing matches these filters. Add the first item to start the catalog."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Title", "Brand", "Sport", "Retailers", "From", "State"].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      padding: "var(--space-sm) var(--space-lg)",
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const from = cheapest(item);
                return (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`/gear/show/${item.id}`)}
                    style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                  >
                    <td style={{ ...cell, fontWeight: 600 }}>{item.title}</td>
                    <td style={{ ...cell, color: "var(--color-text-secondary)" }}>{item.brand ?? ""}</td>
                    <td style={{ ...cell, color: "var(--color-text-secondary)" }}>{item.sport ?? "any"}</td>
                    <td style={cell}>
                      <Mono>{item.offers.length}</Mono>
                    </td>
                    <td style={cell}>{from === null ? <span style={{ color: "var(--color-text-tertiary)" }}>none in stock</span> : <Mono>INR {from.toLocaleString("en-IN")}</Mono>}</td>
                    <td style={cell}>
                      <Badge tone={item.active ? "success" : "neutral"}>{item.active ? "listed" : "delisted"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)" }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "var(--space-xs) var(--space-md)",
        borderRadius: "var(--radius-pill)",
        border: active ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
        backgroundColor: active ? "var(--color-accent-tint)" : "transparent",
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        textTransform: "capitalize",
      }}
    >
      {children}
    </button>
  );
}
