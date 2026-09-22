import { formatINR } from "@atlitos/theme";
import type { Db, OrderStatus } from "@atlitos/types";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "../../components/kit/Badge";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { EmptyState } from "../../components/kit/EmptyState";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Tabs } from "../../components/kit/Tabs";
import { Mono } from "../../components/mono";
import { orderStatusTone } from "../commerce/status";
import { supabaseClient } from "../../providers/supabaseClient";
import "./orders.css";

// AT-82, PRD-04 FR-20: every order with id, buyer, current status, total and
// placed date, filterable by status and searchable by order number or buyer.
//
// Reads `orders` directly, which is correct here: 0032's orders_select_admin
// is a SELECT-only admin policy, and no write path exists from this bundle at
// all (FR-26). The buyer's name is resolved from public.users in a second
// query, matching the existing pattern. The item count is resolved from a
// third, read only `order_items` query so the list can show "items" without
// touching orders_select_admin's own shape.

type OrderRow = Db.OrderRow;
type StatusFilter = "all" | OrderStatus;
type LoadState = "loading" | "error" | "ready";

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "placed", label: "Placed" },
  { key: "shipped", label: "Shipped" },
  { key: "in_transit", label: "In transit" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function OrdersList() {
  const [activeFilter, setActiveFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [buyerNames, setBuyerNames] = useState<Record<string, string>>({});
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const { data, error } = await supabaseClient
        .from("orders")
        .select(
          "id,order_number,user_id,address_id,subtotal,delivery_charges,gst_and_others,donation_roundup,total,status,payment_intent_id,created_at,updated_at",
        )
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        setState("error");
        return;
      }

      const rows = (data as OrderRow[]) ?? [];
      setOrders(rows);

      const buyerIds = Array.from(new Set(rows.map((r) => r.user_id)));
      const orderIds = rows.map((r) => r.id);

      const [usersResult, itemsResult] = await Promise.all([
        buyerIds.length > 0
          ? supabaseClient.from("users").select("id,name").in("id", buyerIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        orderIds.length > 0
          ? supabaseClient.from("order_items").select("order_id").in("order_id", orderIds)
          : Promise.resolve({ data: [] as { order_id: string }[] }),
      ]);

      if (cancelled) return;

      if (usersResult.data) {
        setBuyerNames(Object.fromEntries(usersResult.data.map((u) => [u.id, u.name as string])));
      }
      if (itemsResult.data) {
        const counts: Record<string, number> = {};
        for (const item of itemsResult.data) {
          counts[item.order_id] = (counts[item.order_id] ?? 0) + 1;
        }
        setItemCounts(counts);
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
    return orders.filter((o) => {
      const matchesStatus = activeFilter === "all" || o.status === activeFilter;
      const matchesSearch =
        q.length === 0 ||
        o.order_number.toLowerCase().includes(q) ||
        (buyerNames[o.user_id] ?? "").toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [orders, activeFilter, search, buyerNames]);

  const columns: DataTableColumn<OrderRow>[] = [
    { key: "order", header: "Order", render: (row) => <Mono style={{ fontWeight: "var(--weight-semibold)" }}>{row.order_number}</Mono> },
    { key: "customer", header: "Customer", render: (row) => buyerNames[row.user_id] ?? row.user_id },
    { key: "items", header: "Items", numeric: true, render: (row) => itemCounts[row.id] ?? 0 },
    { key: "total", header: "Total", numeric: true, render: (row) => formatINR(Number(row.total)) },
    { key: "status", header: "Status", render: (row) => <Badge tone={orderStatusTone(row.status)}>{row.status.replace(/_/g, " ")}</Badge> },
    { key: "placed", header: "Placed", render: (row) => relativeTime(row.created_at) },
  ];

  return (
    <div className="ak-page-stack">
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Orders" }]}
        title="Orders"
        description="Every gear order and where it has reached."
      />

      <Tabs
        items={statusTabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          count: tab.key === "all" ? orders.length : orders.filter((o) => o.status === tab.key).length,
        }))}
        active={activeFilter}
        onChange={(key) => setActiveFilter(key as StatusFilter)}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by order number or customer"
        resultCount={filtered.length}
        resultNoun="orders"
      />

      {state === "error" ? (
        <EmptyState title="Could not load orders" body="Something went wrong reading the orders table. Try again." />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/orders/show/${row.id}`}
          loading={state === "loading"}
          emptyTitle="No orders found"
          emptyBody="No orders match this filter and search."
        />
      )}
    </div>
  );
}
