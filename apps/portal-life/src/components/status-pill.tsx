import { Badge } from "@/components/ui/badge";
import type { Database } from "@atlitos/types";

type UpaStatus = Database["public"]["Enums"]["upa_status"];
type ItemStatus = Database["public"]["Enums"]["upa_wishlist_item_status"];
type Tone = "default" | "accent" | "success" | "warning" | "info" | "danger" | "outline";

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <Badge variant={tone}>{label}</Badge>;
}

/** UPA application lifecycle status, PRD-05 FR-7. */
export function upaStatusPill(status: UpaStatus): { label: string; tone: Tone } {
  switch (status) {
    case "submitted":
      return { label: "Submitted", tone: "info" };
    case "under_review":
      return { label: "Under review", tone: "warning" };
    case "needs_info":
      return { label: "Needs more info", tone: "warning" };
    case "verified":
      return { label: "Verified", tone: "success" };
    case "rejected":
      return { label: "Not approved", tone: "danger" };
    case "deactivated":
      return { label: "Deactivated", tone: "outline" };
    default:
      return { label: status, tone: "default" };
  }
}

/** Wishlist item funding status, PRD-05 FR-11. */
export function itemStatusPill(
  status: ItemStatus,
  fundedAmount: number,
): { label: string; tone: Tone } {
  switch (status) {
    case "funded":
      return { label: "Funded", tone: "success" };
    case "delivered":
      return { label: "Delivered", tone: "info" };
    default:
      return fundedAmount > 0
        ? { label: "Partly funded", tone: "accent" }
        : { label: "Open", tone: "outline" };
  }
}

/**
 * Funding pill derived from the ledger truth (donations), not the drift-prone
 * funded_amount cache. Delivered stays a real fulfillment fact from the status
 * column; every other label is computed from derived funding against cost so
 * the pill and the funding bar can never contradict (QA audit found
 * "Funded 100% + 0 donations"). Display only, writes nothing.
 */
export function derivedItemPill(
  status: ItemStatus,
  fundedDerived: number,
  cost: number,
): { label: string; tone: Tone } {
  if (status === "delivered") return { label: "Delivered", tone: "info" };
  if (cost > 0 && fundedDerived >= cost) return { label: "Funded", tone: "success" };
  if (fundedDerived > 0) return { label: "Partly funded", tone: "accent" };
  return { label: "Open", tone: "outline" };
}
