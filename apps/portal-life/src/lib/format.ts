import type { Database } from "@atlitos/types";

export type Sport = Database["public"]["Enums"]["sport"];

const SPORT_LABELS: Record<Sport, string> = {
  football: "Football",
  cricket: "Cricket",
  badminton: "Badminton",
  tennis: "Tennis",
};

export function sportLabel(sport: Sport | string): string {
  return SPORT_LABELS[sport as Sport] ?? sport;
}

/** Rupee amount with Indian digit grouping, two decimals, for tabular mono. */
export function formatRupees(amount: number | string | null | undefined): string {
  const value = typeof amount === "string" ? Number(amount) : (amount ?? 0);
  const safe = Number.isFinite(value) ? value : 0;
  return `₹${safe.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** ISO timestamp to "13 Jul 2026". */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Integer percentage of funded over cost, clamped to 0 to 100. */
export function fundedPercent(funded: number | string, cost: number | string): number {
  const f = Number(funded);
  const c = Number(cost);
  if (!Number.isFinite(c) || c <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((f / c) * 100)));
}
