import { formatINR } from "@atlitos/theme";
import { SPORTS, type Sport } from "@atlitos/types";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Select } from "../../components/kit/Select";
import { Tabs } from "../../components/kit/Tabs";
import { fetchGear, worstOutcomeOf, type GearListFilters, type GearWithOffers } from "./api";
import { outcomeLabel, outcomeTone, relativeDays } from "./format";
import "./gear.css";

// The affiliate gear catalog: every item with brand, sport, retailer count and
// cheapest in stock price. This admin list is the ONE surface that sees
// delisted items (0120 admin SELECT policy); the shopper surface filters
// active = true. Every narrowing here is an explicit filter in fetchGear.

type LoadState = "loading" | "error" | "ready";

const ACTIVE_TABS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Listed" },
  { key: "inactive", label: "Delisted" },
];

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
  const [search, setSearch] = useState("");

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return items;
    return items.filter(
      (item) => item.title.toLowerCase().includes(q) || (item.brand ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const columns: DataTableColumn<GearWithOffers>[] = [
    {
      key: "title",
      header: "Product",
      render: (item) => (
        <div className="ak-gear-title-cell">
          <span className="ak-gear-image-tile">
            {item.image_url ? <img src={item.image_url} alt="" /> : null}
          </span>
          <div>
            <span className="ak-gear-title-text">{item.title}</span>
            <span className="ak-gear-brand-text">{item.brand ?? "No brand"}</span>
          </div>
        </div>
      ),
    },
    { key: "sport", header: "Sport", render: (item) => item.sport ?? "any" },
    { key: "offers", header: "Retailers", numeric: true, render: (item) => item.offers.length },
    {
      key: "price",
      header: "From",
      numeric: true,
      render: (item) => {
        const price = cheapest(item);
        return price === null ? "None in stock" : formatINR(price);
      },
    },
    {
      key: "health",
      header: "Health",
      render: (item) => <Badge tone={outcomeTone(worstOutcomeOf(item.offers))}>{outcomeLabel(worstOutcomeOf(item.offers))}</Badge>,
    },
    { key: "updated", header: "Updated", render: (item) => relativeDays(item.health_checked_at) },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Catalog" }, { label: "Gear" }]}
        title="Gear"
        description="The affiliate catalog. Each item lists retailer prices and sends the shopper out to buy."
        primaryAction={
          <Button variant="primary" onClick={() => navigate("/gear/create")}>
            <Plus size={16} strokeWidth={1.75} />
            Add gear
          </Button>
        }
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate("/gear/health")}>
            Catalog health
          </Button>
        }
      />

      <Tabs
        items={ACTIVE_TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
        active={activeParam}
        onChange={(key) => setParam("active", key === "all" ? null : key)}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search gear by title or brand"
        filters={
          <Select
            value={sportParam ?? ""}
            onChange={(value) => setParam("sport", value || null)}
            placeholder="All sports"
            options={SPORTS.map((sport) => ({ value: sport, label: sport }))}
          />
        }
        resultCount={filtered.length}
        resultNoun="products"
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(item) => item.id}
        rowHref={(item) => `/gear/show/${item.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load gear" : search || sportParam || activeParam !== "all" ? "No products match this filter" : "No gear yet"}
        emptyBody={
          state === "error"
            ? "Something went wrong reading the catalog. Try again."
            : search || sportParam || activeParam !== "all"
              ? "Try a different sport, state or search."
              : "Add a product to start building the shop catalog."
        }
        emptyAction={
          state === "error" ? undefined : (
            <Button variant="primary" onClick={() => navigate("/gear/create")}>
              <Plus size={16} strokeWidth={1.75} />
              Add gear
            </Button>
          )
        }
      />
    </div>
  );
}
