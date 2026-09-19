/**
 * Date of birth entry helpers, shared by every screen that collects a DOB
 * (today only the profile editor, since DOB came off signup).
 *
 * The validator answers with a SPECIFIC message per failure so a shopper who
 * types month 32 is told the month is wrong, not handed the generic "year
 * first" format hint (QA round 2026-09-15: "getting a valid warning only for
 * the year"). Copy follows the house rules, no hyphens or em dashes.
 */

/** YYYY-MM-DD mask: digits only, dashes re-derived on every change so
 * deleting works. */
export function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** Oldest plausible age. Anything earlier is a typo in the year. */
const MAX_AGE_YEARS = 120;

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Returns null when `iso` is a complete, real, plausible date of birth,
 * otherwise the message the field should show. Checks run from the most
 * specific complaint (month, then day, then year) so the shopper is pointed
 * at the exact part to fix.
 */
export function dobValidationError(iso: string, today: Date = new Date()): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return 'Enter your full date of birth, year first.';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return 'Month must be between 01 and 12.';

  const lastDay = daysInMonth(year, month);
  if (day < 1 || day > lastDay) {
    return lastDay === 31
      ? 'Day must be between 01 and 31.'
      : `That month has only ${lastDay} days.`;
  }

  const currentYear = today.getUTCFullYear();
  if (year < currentYear - MAX_AGE_YEARS) return 'Enter a valid birth year.';

  const entered = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (entered > todayUtc) return 'Date of birth cannot be in the future.';

  return null;
}
