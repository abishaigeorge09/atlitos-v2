import type { CommerceFeeConfig, OrderBill } from '@atlitos/api';

/**
 * The commerce bill shape, derived in one place.
 *
 * PHASE-4-STATUS.md D1 fixes the row order and the terms: subtotal, delivery
 * charges, GST, donation roundup, total. Commerce is the third pricing shape
 * in this app and it is additive with NO seller split and NO platform fee
 * row; do not copy the courts shape here.
 *
 * PHASE-4-STATUS.md founder decision 2 (2026-07-20) fixes the roundup rule:
 * the cart total rounds UP to the next multiple of `donationRoundupMultiple`
 * (10 today, from `fee_config` key `commerce.donation_roundup_multiple`), and
 * the roundup is the distance travelled. So it is a DERIVED amount that moves
 * as the cart moves, not a static config figure, and it is computed on the
 * total AFTER delivery and GST, never before.
 *
 * The consequence the checkout screen has to honour: when the pre roundup
 * total already lands on a multiple, the roundup is exactly zero. That row is
 * SUPPRESSED entirely rather than rendered as a zero, and the checkout payload
 * carries a zero amount so the server writes no donation ledger leg (a zero
 * amount leg would break the balanced group assertion). `shouldShowRoundupRow`
 * below is the single predicate both of those depend on.
 *
 * Everything here is a PREVIEW. The `checkout` edge function re-derives every
 * figure server side from live prices and rejects a disagreement with
 * PRICE_MISMATCH before any charge occurs (PRD-07 FR-18, FR-19). Nothing this
 * module returns is ever authoritative, which is exactly why it is safe for it
 * to live client side.
 */

/**
 * The arithmetic below is done ENTIRELY IN PAISE, mirroring
 * `supabase/functions/checkout/index.ts` statement for statement, because that
 * function compares the client's figures to its own with
 * `toPaise(actual) !== toPaise(expected)` on all four rows, not just the
 * total. Computing in rupees and rounding at the end drifts by a paise on
 * some subtotals and trips PRICE_MISMATCH on a bill that is actually correct,
 * which costs the shopper a re-confirmation for nothing. Same units, same
 * order of operations, same rounding points.
 */
function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

function fromPaise(paise: number): number {
  return paise / 100;
}

export interface CommerceBillInput {
  subtotal: number;
  config: CommerceFeeConfig;
  /** Whether the shopper ticked the roundup box. Unchecked by default per
   * PRD-07 FR-13. */
  roundupOptedIn: boolean;
}

/** The bill, plus the pre roundup total the roundup was derived from, which
 * the checkout screen shows nowhere but which makes the derivation auditable
 * in a test and in a debugger. */
export interface DerivedCommerceBill extends OrderBill {
  preRoundupTotal: number;
}

export function deriveCommerceBill({ subtotal, config, roundupOptedIn }: CommerceBillInput): DerivedCommerceBill {
  const subtotalPaise = toPaise(subtotal);
  // Flat per order, unconditionally, per founder decision 4. Not skipped on a
  // zero subtotal: the server does not skip it either, and checkout is
  // unreachable with an empty cart anyway.
  const deliveryPaise = toPaise(config.deliveryFlat);
  // `gst_percent` is stored as a FRACTION (0.18 means 18 percent), the same
  // convention `book-court` uses. Multiply by it; do NOT divide by 100.
  const gstPaise = Math.round(subtotalPaise * config.gstRate);
  const preRoundupPaise = subtotalPaise + deliveryPaise + gstPaise;

  const multiplePaise = toPaise(config.donationRoundupMultiple);
  const roundupPaise =
    roundupOptedIn && multiplePaise > 0 && preRoundupPaise > 0
      ? Math.ceil(preRoundupPaise / multiplePaise) * multiplePaise - preRoundupPaise
      : 0;

  return {
    subtotal: fromPaise(subtotalPaise),
    deliveryCharges: fromPaise(deliveryPaise),
    gstAndOthers: fromPaise(gstPaise),
    donationRoundup: fromPaise(roundupPaise),
    preRoundupTotal: fromPaise(preRoundupPaise),
    total: fromPaise(preRoundupPaise + roundupPaise),
  };
}

/**
 * Whether the donation roundup row renders at all.
 *
 * The box being unticked hides the row's AMOUNT but not the row: an unticked
 * checkbox is how a shopper opts in, so it has to stay visible and tappable.
 * What gets suppressed is the ticked-but-zero case, where the total already
 * sits on a multiple of 10 and there is nothing to round up. Rendering a
 * checked row reading zero there reads as a broken donation, so the row goes
 * away and the shopper sees an unchanged total, which is the honest outcome.
 */
export function shouldShowRoundupRow(bill: DerivedCommerceBill, roundupOptedIn: boolean): boolean {
  if (!roundupOptedIn) return true;
  return bill.donationRoundup > 0;
}

/** PRD-07 FR-13's exact row labels and order. Kept beside the derivation so a
 * screen cannot render the rows in a different order than they were computed,
 * and so there is exactly one place a copy pass has to touch. No hyphens or em
 * dashes, per the house style. */
export const COMMERCE_BILL_LABELS = {
  subtotal: 'Subtotal',
  delivery: 'Delivery charges',
  gst: 'GST and others',
  donation: 'Support a Rising Athlete in Need',
} as const;

/** The four `BillSummary` line rows, in FR-13 order. The donation row is not
 * here: it is `BillSummary`'s own `donationRow` prop, because it carries a
 * checkbox rather than being a plain label and amount pair. */
export function commerceBillRows(bill: OrderBill): { label: string; amount: number }[] {
  return [
    { label: COMMERCE_BILL_LABELS.subtotal, amount: bill.subtotal },
    { label: COMMERCE_BILL_LABELS.delivery, amount: bill.deliveryCharges },
    { label: COMMERCE_BILL_LABELS.gst, amount: bill.gstAndOthers },
  ];
}
