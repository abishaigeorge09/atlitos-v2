import type { Sport } from "@atlitos/types";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayOfWeekLabel(dow: number, short = false): string {
  const labels = short ? DAY_LABELS_SHORT : DAY_LABELS;
  return labels[dow] ?? String(dow);
}

const SPORT_LABELS: Record<Sport, string> = {
  football: "Football",
  cricket: "Cricket",
  badminton: "Badminton",
  tennis: "Tennis",
};

export function sportLabel(sport: Sport | string): string {
  return SPORT_LABELS[sport as Sport] ?? sport;
}

/** Postgres `time` ("HH:MM" or "HH:MM:SS") as minutes since midnight. */
export function timeToMinutes(value: string): number {
  const parts = value.split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return h * 60 + m;
}

/** Postgres `time` round trips as "HH:MM:SS"; render as "6:00 am". */
export function formatTime(value: string): string {
  const [hStr, mStr] = value.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "pm" : "am";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatSlotRange(start: string, end: string): string {
  return `${formatTime(start)} to ${formatTime(end)}`;
}

/** ISO date (YYYY-MM-DD) -> "13 Jul 2026". */
export function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Today's date as an ISO string (YYYY-MM-DD), local time. */
export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
