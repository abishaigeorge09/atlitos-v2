import type { Db, OrderStatus } from "@atlitos/types";
import { AlertTriangle, Search, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { orderStatusTone } from "../commerce/status";
import { supabaseClient } from "../../providers/supabaseClient";

// AT-82, PRD-04 FR-20: every order with id, buyer, current status, total and
// placed date, filterable by status.
//
// Reads `orders` directly, which is correct here: 0032's orders_select_admin
// is a SELECT-only admin policy, and no write path exists from this bundle at
// all (FR-26). The buyer's name is resolved from public.users in a second
// query rather than an embedded join, matching venues/list.tsx.

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

export function OrdersList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = (searchParams.get("status") as StatusFilter | null) ?? "all";
  const [search, setSearch] = useState("");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [buyerNames, setBuyerNames] = useState<Record<string, string>>({});
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
      if (buyerIds.length > 0) {
        const { data: users } = await supabaseClient
          .from("users")
          .select("id,name")
          .in("id", buyerIds);
        if (!cancelled && users) {
          setBuyerNames(Object.fromEntries(users.map((u) => [u.id, u.name as string])));
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
    return orders.filter((o) => {
      const matchesStatus = activeFilter === "all" || o.status === activeFilter;
      const matchesSearch =
        q.length === 0 ||
        o.order_number.toLowerCase().includes(q) ||
        (buyerNames[o.user_id] ?? "").toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [orders, activeFilter, search, buyerNames]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Orders</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Every gear order and where it has reached.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)" }}>
        <div style={{ display: "flex", gap: "var(--space-xs)", borderBottom: "1px solid var(--color-border)" }}>
          {statusTabs.map((tab) => {
            const isActive = tab.key === activeFilter;
            const count =
              tab.key === "all" ? orders.length : orders.filter((o) => o.status === tab.key).length;
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
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
                <Mono
                  style={{
                    fontSize: 12,
                    padding: "0 6px",
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: "var(--color-surface-muted)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {count}
                </Mono>
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
            flexShrink: 0,
          }}
        >
          <Search size={16} strokeWidth={1.75} color="var(--color-text-tertiary)" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by order number or buyer"
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
            Loading orders...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load orders"
            description="Something went wrong reading the orders table. Try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag size={32} strokeWidth={1.75} />}
            title="No orders found"
            description="No orders match this filter and search."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Order", "Buyer", "Placed", "Total", "Status"].map((heading) => (
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
              {filtered.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => navigate(`/orders/show/${order.id}`)}
                  style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, fontWeight: 600 }}>{order.order_number}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {buyerNames[order.user_id] ?? order.user_id}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {new Date(order.created_at).toLocaleDateString()}
                    </Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, fontWeight: 600 }}>Rs {Number(order.total).toFixed(2)}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone={orderStatusTone(order.status)}>{order.status.replace("_", " ")}</Badge>
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
