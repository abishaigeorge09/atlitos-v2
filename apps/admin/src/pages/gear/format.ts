import type { OfferOutcome } from "./api";

// Small display helpers shared by list.tsx, show.tsx and health.tsx so the
// three surfaces read the same health state the same way (FR-49, FR-50).

export type BadgeTone = "neutral" | "success" | "warning" | "danger";

/** Design direction: `danger` for a gone link, `warning` for a stale one. */
export function outcomeTone(outcome: OfferOutcome | null): BadgeTone {
  switch (outcome) {
    case "gone":
    case "blocked":
      return "danger";
    case "out_of_stock":
    case "unparsed":
      return "warning";
    case "price_changed":
      return "neutral";
    case "ok":
      return "success";
    default:
      return "neutral";
  }
}

export function outcomeLabel(outcome: OfferOutcome | null): string {
  if (!outcome) return "not checked yet";
  return outcome.replace(/_/g, " ");
}

export function relativeDays(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
