// The one status vocabulary. Every page maps its own resource status string
// to one of four badge tones here, so no page picks a color ad hoc (Part B
// plan, B0.12). Add a new resource's statuses to STATUS_TONE, never a new
// tone: four is the budget.

export type StatusTone = "neutral" | "success" | "warning" | "danger";

/**
 * Resource status string (any lowercase snake_case status across the app)
 * to its badge tone. Extend this map when a new resource ships; do not
 * invent a fifth tone.
 */
export const STATUS_TONE: Record<string, StatusTone> = {
  // Verification / moderation / reports
  pending: "warning",
  // The verification_status enum's real pending value, and the venue/coach
  // "verified" terminal state. Both were missing at A2 integration and made
  // a pending badge render neutral, which reads as "nothing to do here".
  pending_review: "warning",
  verified: "success",
  approved: "success",
  rejected: "danger",
  under_review: "warning",
  resolved: "success",
  dismissed: "neutral",
  takedown: "danger",

  // Orders
  placed: "warning",
  confirmed: "success",
  fulfilled: "success",
  cancelled: "danger",
  refunded: "neutral",

  // Bookings
  upcoming: "warning",
  completed: "success",
  no_show: "danger",

  // Clips
  uploading: "neutral",
  processing: "warning",
  ready: "success",
  published: "success",
  flagged: "warning",

  // Users
  active: "success",
  suspended: "danger",
  invited: "neutral",

  // Gear / catalog health
  ok: "success",
  price_changed: "warning",
  out_of_stock: "warning",
  gone: "danger",
  blocked: "danger",
  unchecked: "neutral",
  delisted: "danger",

  // Generic booleans rendered as status text
  inactive: "neutral",
  disabled: "neutral",
  enabled: "success",
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

/** Human label for a snake_case status, e.g. "under_review" -> "Under review". */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  const words = status.toLowerCase().split("_");
  return words.map((word, i) => (i === 0 && word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}
