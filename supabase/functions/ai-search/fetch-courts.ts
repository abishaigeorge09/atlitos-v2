// ATLITOS v2 — supabase/functions/ai-search/fetch-courts.ts
//
// Court candidates from real availability (0134 search_court_slots) and the
// honest court broaden line, moved out of index.ts unchanged in Phase L0
// (ADR-014 component boundaries; docs/PLAN-SEARCH-LOCATION-AFFILIATE.md L0-T2).
// Phase L2 adds link venues here (ADR-014 D5).

import { AppError } from "../_shared/app-error.ts";
import { type Candidate, type ParsedIntent, type Sport } from "./search-core.ts";
import { istToday, slotLabel, type WhenWindow } from "./when.ts";

// Courts come from REAL availability (0134 search_court_slots), not from
// matching text. Before this, "badminton court tonight" returned nothing in
// production because "tonight" had to appear in a court's name or address.
// Now the window is answered by the same slot function the booking screen
// uses, so a result is always bookable at the time and price shown.
//
// No time in the query means "the coming week": each court shows its next
// free slot, and a court with nothing free this week is not offered, since it
// cannot be booked. The candidate set is capped in SQL (60 courts, 14 days).
export function defaultWindow(): WhenWindow {
  const today = istToday();
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return { dateFrom: today, dateTo: end.toISOString().slice(0, 10), timeFrom: "00:00", timeTo: "24:00", label: "this week", hasTime: false };
}

export interface CourtSlotRow {
  court_id: string;
  court_name: string;
  sport: Sport;
  venue_id: string;
  venue_name: string;
  city: string;
  address: string;
  distance_km: number | null;
  first_date: string;
  first_start: string;
  first_end: string;
  first_price: number;
  matching_slots: number;
}

// deno-lint-ignore no-explicit-any
export async function searchCourtSlots(supabase: any, args: {
  window: WhenWindow;
  sport: Sport | "general";
  priceMax?: number;
  city?: string;
  lat?: number;
  lng?: number;
  limit: number;
}): Promise<CourtSlotRow[]> {
  const { data, error } = await supabase.rpc("search_court_slots", {
    p_date_from: args.window.dateFrom,
    p_date_to: args.window.dateTo,
    p_time_from: args.window.timeFrom,
    p_time_to: args.window.timeTo === "24:00" ? null : args.window.timeTo,
    p_sport: args.sport === "general" ? null : args.sport,
    p_price_max: args.priceMax ?? null,
    p_city: args.lat === undefined ? args.city ?? null : null,
    p_lat: args.lat ?? null,
    p_lng: args.lng ?? null,
    p_limit: args.limit,
  });
  if (error) throw new AppError("INTERNAL", `Failed to search courts: ${error.message}`, 500);
  return (data ?? []) as CourtSlotRow[];
}

// deno-lint-ignore no-explicit-any
export async function fetchCourts(supabase: any, intent: ParsedIntent, lat?: number, lng?: number, city?: string): Promise<Candidate[]> {
  const window = intent.when ?? defaultWindow();
  const rows = await searchCourtSlots(supabase, { window, sport: intent.sport, priceMax: intent.priceMax, city, lat, lng, limit: 50 });

  // One row per VENUE. Three identical courts at one venue at the same time
  // are one choice to a shopper; listing them separately pushed every other
  // venue off the first screen. SQL returns courts soonest first, so the
  // first court seen per venue is that venue's soonest free slot; the rest
  // are counted and shown as "more courts free here".
  const byVenue = new Map<string, { row: CourtSlotRow; others: number }>();
  for (const r of rows) {
    const seen = byVenue.get(r.venue_id);
    if (seen) seen.others += 1;
    else byVenue.set(r.venue_id, { row: r, others: 0 });
  }

  return [...byVenue.values()].map(({ row: r, others }): Candidate => ({
    entityType: "court",
    entityId: r.court_id,
    title: r.venue_name,
    subtitle: [r.court_name, r.city].filter(Boolean).join(" . "),
    sport: r.sport,
    price: Number(r.first_price),
    rating: undefined,
    distanceKm: r.distance_km ?? undefined,
    slot: {
      date: r.first_date,
      start: r.first_start.slice(0, 5),
      end: r.first_end.slice(0, 5),
      price: Number(r.first_price),
      label: slotLabel(r.first_date, r.first_start),
      freeSlots: r.matching_slots,
      otherCourtsFree: others,
    },
    text: [r.court_name, r.sport, r.venue_name, r.city, r.address].filter(Boolean).join(" ").toLowerCase(),
  }));
}

/** The honest empty answer for a court search: name ONE real alternative
 * that relaxes ONE constraint, rather than telling the shopper to delete their
 * words. With both a time and a budget, keep the budget and move the time
 * first ("the soonest under Rs 300 is ..."), then keep the time and move the
 * budget ("the cheapest tonight is ..."). Copy obeys house style. */
// deno-lint-ignore no-explicit-any
export async function courtBroaden(supabase: any, intent: ParsedIntent, lat?: number, lng?: number, city?: string): Promise<string> {
  const sportWord = intent.sport === "general" ? "" : `${intent.sport} `;
  const budget = intent.priceMax !== undefined ? ` under Rs ${intent.priceMax}` : "";
  const what = intent.when
    ? `No ${sportWord}courts free ${intent.when.label}${budget}`
    : `No ${sportWord}courts${budget} have a free slot this week`;
  const base = { sport: intent.sport, city, lat, lng, limit: 1 };
  const describe = (s: CourtSlotRow) =>
    `${s.venue_name}, ${slotLabel(s.first_date, s.first_start)}, Rs ${Number(s.first_price)}`;

  if (intent.priceMax !== undefined) {
    const inBudget = await searchCourtSlots(supabase, { ...base, window: defaultWindow(), priceMax: intent.priceMax }).catch(() => []);
    if (inBudget.length > 0) return `${what}. The soonest${budget} is ${describe(inBudget[0])}.`;
    if (intent.when) {
      const sameTime = await searchCourtSlots(supabase, { ...base, window: intent.when, limit: 50 }).catch(() => []);
      const cheapest = sameTime.sort((a, b) => Number(a.first_price) - Number(b.first_price))[0];
      if (cheapest) return `${what}. The cheapest ${intent.when.label} is ${describe(cheapest)}.`;
    }
  }
  const soonest = await searchCourtSlots(supabase, { ...base, window: defaultWindow() }).catch(() => []);
  if (soonest.length === 0) return `${what}. Try another sport or area.`;
  return `${what}. The soonest is ${describe(soonest[0])}.`;
}
