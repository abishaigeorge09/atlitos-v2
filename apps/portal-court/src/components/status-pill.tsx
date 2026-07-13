import { Badge } from "@/components/ui/badge";

type Tone = "default" | "accent" | "success" | "warning" | "danger" | "outline";

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <Badge variant={tone}>{label}</Badge>;
}

/** Venue verification status, PRD-03 FR-6. */
export function venueStatusPill(status: "pending" | "verified" | "rejected") {
  switch (status) {
    case "verified":
      return { label: "Verified", tone: "success" as const };
    case "rejected":
      return { label: "Rejected", tone: "danger" as const };
    default:
      return { label: "Pending review", tone: "warning" as const };
  }
}

/**
 * `court_bookings.status` plus the `checked_in_at` side channel (PRD-03 FR-16
 * deliberately keeps check in out of the status column, see
 * 0009_courts.sql). `checkedInAt` wins over a plain `confirmed` label so the
 * Live Today list visibly distinguishes "confirmed, not here yet" from
 * "confirmed, checked in".
 */
export function courtBookingStatusPill(status: string, checkedInAt: string | null) {
  if (status === "confirmed" && checkedInAt) {
    return { label: "Checked in", tone: "success" as const };
  }
  switch (status) {
    case "pending_payment":
      return { label: "Awaiting payment", tone: "warning" as const };
    case "confirmed":
      return { label: "Upcoming", tone: "accent" as const };
    case "completed":
      return { label: "Completed", tone: "success" as const };
    case "cancelled":
      return { label: "Cancelled", tone: "outline" as const };
    case "no_show":
      return { label: "No show", tone: "danger" as const };
    case "rescheduled":
      return { label: "Rescheduled", tone: "outline" as const };
    case "expired":
      return { label: "Expired", tone: "outline" as const };
    default:
      return { label: status, tone: "default" as const };
  }
}

/** Transfer (payout run) status, PRD-03 3.6. */
export function transferStatusPill(status: "processing" | "paid" | "failed") {
  switch (status) {
    case "paid":
      return { label: "Paid", tone: "success" as const };
    case "failed":
      return { label: "Failed", tone: "danger" as const };
    default:
      return { label: "Processing", tone: "warning" as const };
  }
}
