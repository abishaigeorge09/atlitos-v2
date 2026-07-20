import type { OrderStatus } from "@atlitos/types";
import { ORDER_TRANSITIONS } from "@atlitos/types";

type BadgeTone = "neutral" | "success" | "warning" | "danger";

export function orderStatusTone(status: OrderStatus): BadgeTone {
  if (status === "delivered") return "success";
  if (status === "cancelled") return "danger";
  if (status === "placed") return "warning";
  return "neutral";
}

/**
 * The single forward step available from `status`, or null at a terminal.
 *
 * Reads `ORDER_TRANSITIONS` from packages/types, which is the client-side
 * mirror of the machine 0035's `order_transition` enforces, rather than
 * restating the sequence here. This decides only WHICH BUTTON TO OFFER; it is
 * not the rule. The database rejects an illegal edge with INVALID_TRANSITION
 * regardless of what this returns, which is what AT-82's skip proof exercises.
 *
 * `cancelled` is filtered out deliberately: it is a legal edge from `placed`
 * in the machine, but the admin-order-advance edge function refuses to relay
 * it while the refund path it would owe the shopper is unbuilt (P4 scope,
 * PHASE-4-STATUS.md open question 5). Offering a button that always fails
 * would be worse than offering none.
 */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  const forward = ORDER_TRANSITIONS[status].filter((s) => s !== "cancelled");
  return (forward[0] as OrderStatus | undefined) ?? null;
}

export function statusLabel(status: string): string {
  return status.replace("_", " ");
}
