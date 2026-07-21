import type { ClipStatus } from "@atlitos/types";

import type { ReportStatus } from "./api";

// Copy strings only, no hyphens or em dashes (CLAUDE.md house style). Shared by
// the Moderation Queue and Reports Queue so a status reads the same everywhere.

type Tone = "neutral" | "success" | "warning" | "danger";

export function clipStatusLabel(status: ClipStatus): string {
  switch (status) {
    case "uploading":
      return "Uploading";
    case "processing":
      return "Processing";
    case "ready":
      return "Ready for review";
    case "published":
      return "Published";
    case "rejected":
      return "Rejected";
    case "removed":
      return "Removed";
    default:
      return status;
  }
}

export function clipStatusTone(status: ClipStatus): Tone {
  switch (status) {
    case "published":
      return "success";
    case "ready":
      return "warning";
    case "rejected":
    case "removed":
      return "danger";
    default:
      return "neutral";
  }
}

export function reportStatusLabel(status: ReportStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "actioned":
      return "Taken down";
    case "dismissed":
      return "Dismissed";
    default:
      return status;
  }
}

export function reportStatusTone(status: ReportStatus): Tone {
  switch (status) {
    case "pending":
      return "warning";
    case "actioned":
      return "danger";
    case "dismissed":
      return "neutral";
    default:
      return "neutral";
  }
}
