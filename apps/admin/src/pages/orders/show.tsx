import type { Db, OrderStatus } from "@atlitos/types";
import { BillSummary } from "@atlitos/ui-web";
import { AlertTriangle, ArrowLeft, CircleCheck, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { Field, Input } from "../../components/form";
import { advanceOrder, type CommerceError } from "../commerce/api";
import { nextStatus, orderStatusTone, statusLabel } from "../commerce/status";
import { supabaseClient } from "../../providers/supabaseClient";

// AT-82, PRD-04 FR-21, FR-22, FR-23, FR-26. This is the admin half of
// PHASE-4-STATUS.md gate clause 2.
//
// FR-21's money breakdown renders through the SHARED `BillSummary` from
// @atlitos/ui-web, not a hand rolled admin table (CLAUDE.md's financial
// invariant, and the trap list's item 5). The rows are read from the ORDER's
// own stored money columns, never recomputed from the line items or from
// fee_config, so a later catalog price edit cannot rewrite what the shopper
// was charged (trap list item 4, "snapshot, do not recompute").
//
// The donation roundup row is suppressed when it is zero, matching the founder
// decision recorded in PHASE-4-STATUS.md open question 2: a cart total already
// on a multiple of 10 produces no roundup and writes no donation ledger leg,
// so rendering "Rs 0.00" here would imply a leg that does not exist.
//
// FR-26 holds structurally: the only mutation on this screen is
// `advanceOrder`, which posts to the admin-order-advance edge function. There
// is no `.update()` against orders anywhere in this bundle.

type LoadState = "loading" | "error" | "ready" | "not_found";

export function OrderShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Db.OrderRow | null>(null);
  const [items, setItems] = useState<Db.OrderItemRow[]>([]);
  const [timeline, setTimeline] = useState<Db.OrderTimelineRow[]>([]);
  const [buyer, setBuyer] = useState<{ name: string; phone: string | null } | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommerceError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setState("loading");

    const { data: orderData, error: orderError } = await supabaseClient
      .from("orders")
      .select(
        "id,order_number,user_id,address_id,subtotal,delivery_charges,gst_and_others,donation_roundup,total,status,payment_intent_id,created_at,updated_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (orderError) {
      setState("error");
      return;
    }
    if (!orderData) {
      setState("not_found");
      return;
    }

    const row = orderData as Db.OrderRow;
    setOrder(row);

    const [{ data: itemRows }, { data: timelineRows }, { data: buyerRow }] = await Promise.all([
      supabaseClient
        .from("order_items")
        .select(
          "id,order_id,product_variant_id,product_title_snapshot,variant_label_snapshot,qty,unit_price,created_at",
        )
        .eq("order_id", row.id)
        .order("created_at"),
      supabaseClient
        .from("order_timeline")
        .select("id,order_id,status,note,location,actor_id,created_at")
        .eq("order_id", row.id)
        .order("created_at"),
      supabaseClient.from("users").select("name,phone").eq("id", row.user_id).maybeSingle(),
    ]);

    setItems((itemRows as Db.OrderItemRow[]) ?? []);
    setTimeline((timelineRows as Db.OrderTimelineRow[]) ?? []);
    setBuyer((buyerRow as { name: string; phone: string | null }) ?? null);
    setState("ready");
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onAdvance(to: OrderStatus) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await advanceOrder({
        orderId: id as string,
        toStatus: to,
        location: location.trim() || null,
        note: note.trim() || null,
      });
      setNotice(`Order moved to ${statusLabel(result.status)}.`);
      setLocation("");
      setNote("");
      await load();
    } catch (err) {
      // Shown verbatim, code and all. AT-82: the refusal is surfaced as a real
      // error, never swallowed into a generic failure.
      setError(err as CommerceError);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading order...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Order not found"
          description="This order does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !order) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this order"
          description="Something went wrong reading this order. Try again."
        />
      </Card>
    );
  }

  const target = nextStatus(order.status);

  // FR-21's exact row set, in D1's order. Roundup suppressed at zero.
  const billRows = [
    { label: "Subtotal", amount: Number(order.subtotal) },
    { label: "Delivery charges", amount: Number(order.delivery_charges) },
    { label: "GST and others", amount: Number(order.gst_and_others) },
    ...(Number(order.donation_roundup) > 0
      ? [{ label: "Donation roundup", amount: Number(order.donation_roundup) }]
      : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 760 }}>
      <button
        type="button"
        onClick={() => navigate("/orders")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          border: "none",
          background: "none",
          color: "var(--color-text-secondary)",
          fontSize: 14,
          cursor: "pointer",
          padding: 0,
          alignSelf: "flex-start",
        }}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        Back to orders
      </button>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
          <div>
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                margin: 0,
              }}
            >
              Order
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>
              <Mono>{order.order_number}</Mono>
            </h1>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
              {buyer?.name ?? order.user_id}
              {buyer?.phone ? `, ${buyer.phone}` : ""}
            </p>
          </div>
          <Badge tone={orderStatusTone(order.status)}>{statusLabel(order.status)}</Badge>
        </div>
      </Card>

      {/* FR-21 line items */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-lg)" }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              margin: 0,
            }}
          >
            Items
          </p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                  {item.product_title_snapshot}
                  <span style={{ display: "block", fontSize: 13, fontWeight: 400, color: "var(--color-text-secondary)" }}>
                    {item.variant_label_snapshot}
                  </span>
                </td>
                <td style={{ padding: "var(--space-md) var(--space-lg)", width: 80 }}>
                  <Mono style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>x{item.qty}</Mono>
                </td>
                <td style={{ padding: "var(--space-md) var(--space-lg)", width: 140, textAlign: "right" }}>
                  <Mono style={{ fontSize: 13 }}>Rs {Number(item.unit_price).toFixed(2)}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* FR-21 money breakdown, through the shared BillSummary */}
      <Card>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
            margin: "0 0 var(--space-md)",
          }}
        >
          Bill
        </p>
        <BillSummary rows={billRows} total={Number(order.total)} totalLabel="Total paid" />
      </Card>

      {/* FR-22, FR-23 the advance action */}
      <Card>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
            margin: "0 0 var(--space-md)",
          }}
        >
          Advance this order
        </p>

        {error ? (
          <div
            style={{
              padding: "var(--space-md)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-danger)",
              backgroundColor: "var(--color-danger-tint)",
              marginBottom: "var(--space-md)",
            }}
          >
            <Mono style={{ fontSize: 12, fontWeight: 600, color: "var(--color-danger)" }}>{error.code}</Mono>
            <p style={{ fontSize: 14, color: "var(--color-danger)", margin: "var(--space-xs) 0 0" }}>
              {error.message}
            </p>
          </div>
        ) : null}

        {notice ? (
          <p
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              fontSize: 14,
              color: "var(--color-success)",
              margin: "0 0 var(--space-md)",
            }}
          >
            <CircleCheck size={16} strokeWidth={1.75} />
            {notice}
          </p>
        ) : null}

        {target === null ? (
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            This order has reached {statusLabel(order.status)} and cannot be advanced further.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <div style={{ display: "flex", gap: "var(--space-md)" }}>
              <Field label="Location" style={{ flex: 1 }}>
                <Input value={location} onChange={setLocation} placeholder="Bengaluru hub" />
              </Field>
              <Field label="Note" style={{ flex: 1 }}>
                <Input value={note} onChange={setNote} placeholder="Handed to courier" />
              </Field>
            </div>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
              A location or a note is required. It is recorded on the timeline the shopper sees.
            </p>
            <div>
              <Button
                disabled={busy || (location.trim().length === 0 && note.trim().length === 0)}
                onClick={() => onAdvance(target)}
              >
                <Truck size={16} strokeWidth={1.75} />
                Move to {statusLabel(target)}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* FR-21 full timeline history */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-lg)" }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              margin: 0,
            }}
          >
            Timeline
          </p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {timeline.map((entry) => (
              <tr key={entry.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ padding: "var(--space-md) var(--space-lg)", width: 150 }}>
                  <Badge tone={orderStatusTone(entry.status)}>{statusLabel(entry.status)}</Badge>
                </td>
                <td style={{ padding: "var(--space-md) 0", fontSize: 14 }}>
                  {entry.location ? <span style={{ fontWeight: 600 }}>{entry.location}</span> : null}
                  {entry.location && entry.note ? ", " : null}
                  {entry.note ? (
                    <span style={{ color: "var(--color-text-secondary)" }}>{entry.note}</span>
                  ) : null}
                </td>
                <td style={{ padding: "var(--space-md) var(--space-lg)", width: 190, textAlign: "right" }}>
                  <Mono style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {new Date(entry.created_at).toLocaleString()}
                  </Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
