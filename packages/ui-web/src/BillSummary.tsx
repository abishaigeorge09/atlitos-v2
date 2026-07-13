import type { ReactNode } from "react";
import "./BillSummary.css";
import { formatINR } from "@atlitos/theme";

/**
 * THE shared money pattern for every web portal (DESIGN-LANGUAGE.md "Money
 * surfaces": "every screen touching money renders a BillSummary component
 * ... never a bare number", CLAUDE.md's financial invariant: "every screen
 * showing a money total uses the shared BillSummary component. No
 * hand-rolled price breakdowns"). Mirrors
 * `apps/mobile/src/components/molecules/BillSummary.tsx`'s rows+total shape
 * one to one, re-expressed as vanilla CSS classes reading `@atlitos/theme`
 * CSS variables (the Eyebrow pattern in this package) instead of nativewind
 * classNames, so it renders identically across portal-court, portal-life,
 * and admin regardless of each app's own Tailwind config.
 *
 * This is a display component only: rows are whatever the caller already
 * has (a client-computed preview, or a server-returned bill), it never
 * treats a client-supplied number as authoritative for what gets charged.
 * The CLAUDE.md `PRICE_MISMATCH` re-pricing invariant is the caller's job.
 */

export interface BillSummaryRow {
  label: string;
  /** Rupees, e.g. 231000 for ₹2,31,000. Negative renders with a minus sign. */
  amount: number;
  /** 'muted' de-emphasizes a row (e.g. a deducted fee); default is normal weight. */
  emphasis?: "muted";
}

export interface BillSummaryProps {
  rows: BillSummaryRow[];
  total: number;
  totalLabel?: string;
  className?: string;
  /** Optional trailing note under the total, e.g. a payment status string. */
  footnote?: ReactNode;
}

export function BillSummary({
  rows,
  total,
  totalLabel = "Total",
  className,
  footnote,
}: BillSummaryProps) {
  const classNames = ["atlitos-bill-summary", className].filter(Boolean).join(" ");

  return (
    <div className={classNames} data-slot="bill-summary">
      {rows.map((row) => (
        <div
          key={row.label}
          className={
            row.emphasis === "muted"
              ? "atlitos-bill-summary__row atlitos-bill-summary__row--muted"
              : "atlitos-bill-summary__row"
          }
        >
          <span className="atlitos-bill-summary__label">{row.label}</span>
          <span className="atlitos-bill-summary__amount">{formatINR(row.amount)}</span>
        </div>
      ))}

      <div className="atlitos-bill-summary__divider" />

      <div className="atlitos-bill-summary__row atlitos-bill-summary__row--total">
        <span className="atlitos-bill-summary__total-label">{totalLabel}</span>
        <span className="atlitos-bill-summary__total-amount">{formatINR(total)}</span>
      </div>

      {footnote ? <div className="atlitos-bill-summary__footnote">{footnote}</div> : null}
    </div>
  );
}
