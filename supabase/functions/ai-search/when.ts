// ATLITOS v2 — supabase/functions/ai-search/when.ts
//
// Reads WHEN out of a court query: "tonight", "tomorrow evening", "after 7",
// "7 to 9pm", "this weekend", "saturday at 6am". Pure, no Deno, no network, so
// scripts/verify-court-search.ts can exercise it with a fixed clock.
//
// WHY IT EXISTS. Before this, a time word was just another keyword, and the
// honesty gate requires a court's own text to contain at least one keyword. No
// court's text contains "tonight", so "badminton court tonight" returned zero
// courts and told the user to remove "tonight". Verified in production on
// 2026-09-26. Time words are now parsed into a window and REMOVED from the
// keywords, and the window is answered from real availability
// (search_court_slots) instead of text.
//
// EVERYTHING IS IST. Courts are in India and a slot's times are Indian local
// time, whichever edge region serves the request.

export interface WhenWindow {
  /** Inclusive, YYYY-MM-DD, IST. */
  dateFrom: string;
  /** Inclusive, YYYY-MM-DD, IST. */
  dateTo: string;
  /** Slot START time lower bound, inclusive, HH:MM. */
  timeFrom: string;
  /** Slot START time upper bound, exclusive, HH:MM. "24:00" means end of day. */
  timeTo: string;
  /** Human phrase for copy, e.g. "tonight after 7:00 PM". No hyphens. */
  label: string;
  /** True when the query named a time or a part of the day. */
  hasTime: boolean;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAYPARTS: Record<string, { from: string; to: string; label: string }> = {
  morning: { from: "05:00", to: "12:00", label: "morning" },
  afternoon: { from: "12:00", to: "16:00", label: "afternoon" },
  evening: { from: "16:00", to: "21:00", label: "evening" },
  night: { from: "19:00", to: "24:00", label: "night" },
};

/** Words that describe WHEN or booking intent, never WHAT. Removed from the
 * keyword list so they cannot fail the honesty gate's text match. */
export const TEMPORAL_TOKENS = new Set([
  "today", "tonight", "tomorrow", "tmrw", "tmr", "day", "after", "before", "between", "till", "until",
  "from", "to", "and", "this", "next", "weekend", "weekday", "weekdays", "morning", "afternoon",
  "evening", "night", "am", "pm", "oclock", "clock", "hour", "hours", "hr", "hrs", "now", "asap",
  "free", "available", "availability", "open", "slot", "slots", "book", "booking", "play", "game",
  ...Object.keys(WEEKDAYS),
]);

/** A token that is itself a time, like "7pm", "730pm", "19", "0730". */
export function isTimeToken(tok: string): boolean {
  return /^\d{1,4}(am|pm)?$/.test(tok);
}

interface Ist {
  y: number;
  m: number;
  d: number;
  dow: number;
  minutes: number;
}

function toIst(now: Date): Ist {
  const t = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    dow: t.getUTCDay(),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

function isoPlusDays(ist: Ist, days: number): string {
  const t = new Date(Date.UTC(ist.y, ist.m, ist.d + days));
  return t.toISOString().slice(0, 10);
}

function hhmm(totalMinutes: number): string {
  if (totalMinutes >= 24 * 60) return "24:00";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** "19:00" -> "7:00 PM"; "24:00" -> "midnight". */
export function friendlyTime(t: string): string {
  if (t === "24:00") return "midnight";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

interface ParsedTime {
  minutes: number;
  meridiem?: "am" | "pm";
  explicit24: boolean;
}

function readTime(hour: string, minute: string | undefined, meridiem: string | undefined): ParsedTime | null {
  const h = Number(hour);
  const m = minute ? Number(minute) : 0;
  if (!Number.isInteger(h) || !Number.isInteger(m) || m > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const base = h % 12;
    return { minutes: (base + (meridiem === "pm" ? 12 : 0)) * 60 + m, meridiem: meridiem as "am" | "pm", explicit24: false };
  }
  if (h > 23) return null;
  return { minutes: h * 60 + m, explicit24: h >= 13 || h === 0 };
}

/** A bare hour with no am or pm. Sports are played in daylight and evening,
 * so 1 to 11 reads as PM unless the query says morning. 12 is noon; 13 and up
 * are 24 hour. Documented here because it is a choice, not a fact. */
function resolveBare(t: ParsedTime, morningContext: boolean): number {
  if (t.meridiem || t.explicit24) return t.minutes;
  const h = Math.floor(t.minutes / 60);
  if (h === 12) return t.minutes;
  if (h >= 1 && h <= 11) return morningContext ? t.minutes : t.minutes + 12 * 60;
  return t.minutes;
}

// Word-bounded so "500" or "U12" can never be read as a time.
const TIME_RE = String.raw`\b(\d{1,2})(?!\d)(?:[:.](\d{2}))?\s*(am|pm)?\b`;

export function parseWhen(query: string, now: Date = new Date()): WhenWindow | undefined {
  const q = query.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ");
  const ist = toIst(now);
  const tokens = q.replace(/[^a-z0-9:.\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  const has = (w: string) => tokens.includes(w);
  const morningContext = has("morning") || /\bam\b|\d\s*am\b/.test(q);

  // ---- date ----
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let dateLabel = "";
  if (/\bday after tomorrow\b/.test(q)) {
    dateFrom = dateTo = isoPlusDays(ist, 2);
    dateLabel = "the day after tomorrow";
  } else if (has("tomorrow") || has("tmrw") || has("tmr")) {
    dateFrom = dateTo = isoPlusDays(ist, 1);
    dateLabel = "tomorrow";
  } else if (has("today") || has("tonight") || has("now") || has("asap")) {
    dateFrom = dateTo = isoPlusDays(ist, 0);
    dateLabel = has("tonight") ? "tonight" : "today";
  } else if (has("weekend")) {
    const toSat = (6 - ist.dow + 7) % 7;
    const start = ist.dow === 0 ? 0 : toSat;
    const end = ist.dow === 0 ? 0 : toSat + 1;
    dateFrom = isoPlusDays(ist, start);
    dateTo = isoPlusDays(ist, end);
    dateLabel = "this weekend";
  } else {
    for (const tok of tokens) {
      if (tok in WEEKDAYS) {
        const target = WEEKDAYS[tok];
        let delta = (target - ist.dow + 7) % 7;
        if (delta === 0 && has("next")) delta = 7;
        dateFrom = dateTo = isoPlusDays(ist, delta);
        dateLabel = delta === 0 ? "today" : WEEKDAY_NAME[target];
        break;
      }
    }
  }

  // ---- time ----
  let from: number | undefined;
  let to: number | undefined;
  let timeLabel = "";

  const range = new RegExp(String.raw`(?:between\s+)?${TIME_RE}\s*(?:-|to|and|till|until)\s*${TIME_RE}`).exec(q);
  const after = new RegExp(String.raw`\b(?:after|from)\s+${TIME_RE}`).exec(q);
  const before = new RegExp(String.raw`\b(?:before|by)\s+${TIME_RE}`).exec(q);
  const at = new RegExp(String.raw`(?:\bat\s+${TIME_RE}|\b(\d{1,2})(?!\d)(?:[:.](\d{2}))?\s*(am|pm)\b)`).exec(q);

  if (range) {
    const a = readTime(range[1], range[2], range[3]);
    const b = readTime(range[4], range[5], range[6]);
    if (a && b) {
      const end = resolveBare(b, morningContext);
      let start: number;
      if (a.meridiem || a.explicit24) {
        start = a.minutes;
      } else if (b.meridiem) {
        // "7 to 9pm": the start takes the end's meridiem, unless that puts it
        // at or after the end ("11 to 1pm" means 11 AM to 1 PM).
        start = readTime(range[1], range[2], b.meridiem)?.minutes ?? resolveBare(a, morningContext);
        if (start >= end) start = readTime(range[1], range[2], "am")?.minutes ?? start;
      } else {
        start = resolveBare(a, morningContext);
      }
      if (end > start) {
        from = start;
        to = end;
        timeLabel = `between ${friendlyTime(hhmm(start))} and ${friendlyTime(hhmm(end))}`;
      }
    }
  }
  if (from === undefined && after) {
    const a = readTime(after[1], after[2], after[3]);
    if (a) {
      from = resolveBare(a, morningContext);
      to = 24 * 60;
      timeLabel = `after ${friendlyTime(hhmm(from))}`;
    }
  }
  if (from === undefined && before) {
    const b = readTime(before[1], before[2], before[3]);
    if (b) {
      to = resolveBare(b, morningContext);
      from = 5 * 60;
      if (to <= from) to = undefined;
      else timeLabel = `before ${friendlyTime(hhmm(to))}`;
      if (to === undefined) from = undefined;
    }
  }
  const clock = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(q);
  if (from === undefined && (at || clock)) {
    const t = at ? (at[1] !== undefined ? readTime(at[1], at[2], at[3]) : readTime(at[4], at[5], at[6])) : readTime(clock![1], clock![2], undefined);
    if (t) {
      const center = resolveBare(t, morningContext);
      // A slot that starts within half an hour before or an hour after.
      from = Math.max(0, center - 30);
      to = Math.min(24 * 60, center + 60);
      timeLabel = `around ${friendlyTime(hhmm(center))}`;
    }
  }
  if (from === undefined) {
    const partKey = has("tonight") ? "tonight" : ["morning", "afternoon", "evening", "night"].find((p) => has(p));
    if (partKey === "tonight") {
      from = 18 * 60;
      to = 24 * 60;
      timeLabel = "";
    } else if (partKey) {
      const p = DAYPARTS[partKey];
      from = minutesOf(p.from);
      to = minutesOf(p.to);
      timeLabel = `in the ${p.label}`;
    }
  }

  const hasTime = from !== undefined && to !== undefined;
  if (!dateFrom && !hasTime) return undefined;

  // A time with no date means today, unless that window has already passed
  // today, in which case the only sensible reading is tomorrow.
  if (!dateFrom) {
    if (hasTime && (to as number) <= ist.minutes) {
      dateFrom = dateTo = isoPlusDays(ist, 1);
      dateLabel = "tomorrow";
    } else {
      dateFrom = dateTo = isoPlusDays(ist, 0);
      dateLabel = "today";
    }
  }

  const label = [dateLabel, timeLabel].filter(Boolean).join(" ");
  return {
    dateFrom: dateFrom as string,
    dateTo: dateTo as string,
    timeFrom: hhmm(from ?? 0),
    timeTo: hhmm(to ?? 24 * 60),
    label: label || dateLabel,
    hasTime,
  };
}

/** Today in IST, YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return isoPlusDays(toIst(now), 0);
}

/** Friendly label for a concrete slot relative to today: "today at 7:00 PM",
 * "tomorrow at 6:00 AM", "Saturday at 8:00 AM". */
export function slotLabel(date: string, start: string, now: Date = new Date()): string {
  const ist = toIst(now);
  const today = isoPlusDays(ist, 0);
  const tomorrow = isoPlusDays(ist, 1);
  const time = friendlyTime(start.slice(0, 5));
  if (date === today) return `today at ${time}`;
  if (date === tomorrow) return `tomorrow at ${time}`;
  const d = new Date(`${date}T00:00:00Z`);
  const diffDays = Math.round((d.getTime() - Date.UTC(ist.y, ist.m, ist.d)) / 86400000);
  if (diffDays > 1 && diffDays < 7) return `${WEEKDAY_NAME[d.getUTCDay()]} at ${time}`;
  return `${d.getUTCDate()} ${d.toLocaleString("en-IN", { month: "short", timeZone: "UTC" })} at ${time}`;
}
