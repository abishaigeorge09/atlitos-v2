// Small shared relative time formatter for list and detail tables (A2-T3:
// moderation, reports, drills, users, products). Not a new dependency, just
// a Date arithmetic helper so every owned table reads "3 hours ago" the
// same way instead of each page inventing its own phrasing.

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";

  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 60) return "Just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? "minute" : "minutes"} ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ${diffHour === 1 ? "hour" : "hours"} ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ${diffDay === 1 ? "day" : "days"} ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} ${diffMonth === 1 ? "month" : "months"} ago`;
  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear} ${diffYear === 1 ? "year" : "years"} ago`;
}
