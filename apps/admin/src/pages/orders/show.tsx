import { formatINR } from "@atlitos/theme";
import type { Db, OrderStatus } from "@atlitos/types";
import { BillSummary } from "@atlitos/ui-web";
import { useNotification } from "@refinedev/core";
import { AlertTriangle, MapPin, Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { EmptyState } from "../../components/kit/EmptyState";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { PageHeader } from "../../components/kit/PageHeader";
import { Mono } from "../../components/mono";
import { advanceOrder, type CommerceError } from "../commerce/api";
import { nextStatus, orderStatusTone, statusLabel } from "../commerce/status";
import { supabaseClient } from "../../providers/supabaseClient";
import "./orders.css";

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
// decision recorded in PHASE-4-STATUS.md open question 2.
//
// FR-26 holds structurally: the only mutation on this screen is
// `advanceOrder`, which posts to the admin-order-advance edge function. There
// is no `.update()` against orders anywhere in this bundle.
//
// Refunds are explicitly out of PRD-04's scope for this rebuild
// (docs/PLAN-ADMIN-UX.md "not in scope") and are removed from this screen;
// `refund-api.ts` is left in place, unused, for whichever future phase picks
// refunds up.

type LoadState = "loading" | "error" | "ready" | "not_found";

export function OrderShow() {
  const { id } = useParams<{ id: string }>();
  const { open } = useNotification();
  const confirmRef = useRef<ConfirmDialogHandle>(null);

  const [order, setOrder] = useState<Db.OrderRow | null>(null);
  const [items, setItems] = useState<Db.OrderItemRow[]>([]);
  const [timeline, setTimeline] = useState<Db.OrderTimelineRow[]>([]);
  const [buyer, setBuyer] = useState<{ name: string; phone: string | null } | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CommerceError | null>(null);

  async function load() {
    if (!id) return;
    setState("loading");

    const { data: orderData, error: orderError } = await supabaseClient
      .from("orders")
      .select(
        "id,order_number,user_id,address_id,ship_to_line1,ship_to_line2,ship_to_city,ship_to_state,ship_to_pincode,subtotal,delivery_charges,gst_and_others,donation_roundup,total,status,payment_intent_id,created_at,updated_at",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onConfirmAdvance(to: OrderStatus) {
    setBusy(true);
    setError(null);
    try {
      const result = await advanceOrder({
        orderId: id as string,
        toStatus: to,
        location: location.trim() || null,
        note: note.trim() || null,
      });
      confirmRef.current?.close();
      open?.({ type: "success", message: `Order moved to ${statusLabel(result.status)}.`, key: "order-advance" });
      setLocation("");
      setNote("");
      await load();
    } catch (err) {
      setError(err as CommerceError);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="ak-page-stack">
        <PageHeader breadcrumbs={[{ label: "Orders", to: "/orders" }]} title="Loading order" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div className="ak-page-stack">
        <PageHeader breadcrumbs={[{ label: "Orders", to: "/orders" }]} title="Order not found" />
        <Card>
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Order not found"
            body="This order does not exist or was removed."
          />
        </Card>
      </div>
    );
  }

  if (state === "error" || !order) {
    return (
      <div className="ak-page-stack">
        <PageHeader breadcrumbs={[{ label: "Orders", to: "/orders" }]} title="Could not load this order" />
        <Card>
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load this order"
            body="Something went wrong reading this order. Try again."
          />
        </Card>
      </div>
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

  const canAdvance = target !== null && (location.trim().length > 0 || note.trim().length > 0);

  return (
    <div className="ak-page-stack">
      <PageHeader
        breadcrumbs={[{ label: "Orders", to: "/orders" }]}
        title={order.order_number}
        description={`${buyer?.name ?? order.user_id}${buyer?.phone ? `, ${buyer.phone}` : ""}`}
      />

      <DetailLayout
        main={
          <>
            <Card className="ak-orders-card-flush">
              <div className="ak-orders-card-heading">Items</div>
              <table className="ak-orders-table">
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="ak-orders-item-title">{item.product_title_snapshot}</div>
                        <div className="ak-orders-item-variant">{item.variant_label_snapshot}</div>
                      </td>
                      <td className="ak-orders-td-numeric">
                        <Mono>x{item.qty}</Mono>
                      </td>
                      <td className="ak-orders-td-numeric">
                        <Mono>{formatINR(Number(item.unit_price))}</Mono>
                      </td>
                      <td className="ak-orders-td-numeric">
                        <Mono>{formatINR(Number(item.unit_price) * item.qty)}</Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* FR-21 delivery address, read from the order's own ship_to_*
             * snapshot (0038, AT-72), never the address_id join: that row is
             * editable and ON DELETE SET NULL, so joining it would let a
             * shopper's later address edit rewrite where a dispatched parcel
             * says it is going. */}
            <Card>
              <div className="ak-orders-card-heading">Shipping address</div>
              <div className="ak-orders-address">
                <MapPin size={18} strokeWidth={1.75} />
                <div>
                  <p className="ak-orders-address-line">
                    {order.ship_to_line1}
                    {order.ship_to_line2 ? `, ${order.ship_to_line2}` : ""}
                  </p>
                  <p className="ak-orders-address-city">
                    {order.ship_to_city}, {order.ship_to_state}
                  </p>
                  <Mono style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                    {order.ship_to_pincode}
                  </Mono>
                </div>
              </div>
            </Card>

            <Card className="ak-orders-card-flush">
              <div className="ak-orders-card-heading">Timeline</div>
              <table className="ak-orders-table">
                <tbody>
                  {timeline.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ width: 150 }}>
                        <Badge tone={orderStatusTone(entry.status)}>{statusLabel(entry.status)}</Badge>
                      </td>
                      <td>
                        {entry.location ? <span className="ak-orders-timeline-location">{entry.location}</span> : null}
                        {entry.location && entry.note ? ", " : null}
                        {entry.note ? <span className="ak-orders-timeline-note">{entry.note}</span> : null}
                      </td>
                      <td className="ak-orders-td-numeric">
                        <Mono style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                          {new Date(entry.created_at).toLocaleString()}
                        </Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        }
        side={
          <>
            <Card>
              <div className="ak-orders-side-header">
                <Badge tone={orderStatusTone(order.status)}>{statusLabel(order.status)}</Badge>
              </div>
              <BillSummary rows={billRows} total={Number(order.total)} totalLabel="Total paid" />
            </Card>

            <Card>
              <div className="ak-orders-card-heading">Advance this order</div>

              {error ? (
                <div className="ak-orders-error-box">
                  <Mono style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: "var(--color-danger)" }}>
                    {error.code}
                  </Mono>
                  <p className="ak-orders-error-message">{error.message}</p>
                </div>
              ) : null}

              {target === null ? (
                <p className="ak-orders-muted">
                  This order has reached {statusLabel(order.status)} and cannot be advanced further.
                </p>
              ) : (
                <div className="ak-orders-advance-form">
                  <Field label="Location"><Input value={location} onChange={setLocation} placeholder="Bengaluru hub" /></Field>
                  <Field label="Note"><Input value={note} onChange={setNote} placeholder="Handed to courier" /></Field>
                  <p className="ak-orders-muted">
                    A location or a note is required. It is recorded on the timeline the shopper sees.
                  </p>
                  <Button disabled={!canAdvance} onClick={() => confirmRef.current?.open()}>
                    <Truck size={16} strokeWidth={1.75} />
                    Advance this order
                  </Button>
                  <ConfirmDialog
                    ref={confirmRef}
                    title="Advance this order"
                    body="This is visible to the shopper on their order timeline immediately, moving"
                    recordName={target ? `${order.order_number} to ${statusLabel(target)}` : order.order_number}
                    confirmLabel={target ? `Move to ${statusLabel(target)}` : "Confirm"}
                    danger={false}
                    loading={busy}
                    onConfirm={() => target && void onConfirmAdvance(target)}
                  />
                </div>
              )}
            </Card>
          </>
        }
      />
    </div>
  );
}
