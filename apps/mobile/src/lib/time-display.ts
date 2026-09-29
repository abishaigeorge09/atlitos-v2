/**
 * Display formatting for the "HH:MM" times and "YYYY-MM-DD" dates the server
 * stores. BUG-069: slot pickers, session cards and booking rows printed the
 * raw values ("2026-09-29, 13:00 to 13:45") while search and Courts said
 * "today at 1:00 PM", so the same slot read two ways on two screens. Every
 * time range and slot date now goes through here.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseTime(time: string): { h12: number; minutes: string; period: 'AM' | 'PM' } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const h = Number(match[1]) % 24;
  return { h12: h % 12 === 0 ? 12 : h % 12, minutes: match[2], period: h >= 12 ? 'PM' : 'AM' };
}

/** "19:00" -> "7:00 PM". Anything unparseable is returned as given. */
export function formatTime(time: string): string {
  const t = parseTime(time);
  return t ? `${t.h12}:${t.minutes} ${t.period}` : time;
}

/** "13:00", "13:45" -> "1:00 to 1:45 PM"; "11:30", "12:15" -> "11:30 AM to
 * 12:15 PM". The period is written once when both ends share it, which keeps
 * a slot chip short enough for three to a row. */
export function formatTimeRange(from: string, to: string): string {
  const a = parseTime(from);
  const b = parseTime(to);
  if (!a || !b) return `${from} to ${to}`;
  if (a.period === b.period) return `${a.h12}:${a.minutes} to ${b.h12}:${b.minutes} ${b.period}`;
  return `${a.h12}:${a.minutes} ${a.period} to ${b.h12}:${b.minutes} ${b.period}`;
}

/** "2026-09-29" -> "Tue 29 Sep". Parsed as a calendar date, never through
 * `new Date(iso)`, which reads UTC midnight and can shift the day. */
export function formatSlotDate(dateISO: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) return dateISO;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "2026-09-29", "13:00", "13:45" -> "Tue 29 Sep, 1:00 to 1:45 PM". */
export function formatSlotWhen(dateISO: string, from: string, to: string): string {
  return `${formatSlotDate(dateISO)}, ${formatTimeRange(from, to)}`;
}
