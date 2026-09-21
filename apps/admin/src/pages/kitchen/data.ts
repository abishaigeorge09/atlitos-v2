// Static sample data for the kitchen sink, no live queries. Names taken
// from scripts/seed-shop-search.mjs's seeded gear so the sink reads like
// the real catalog rather than invented placeholder copy.

export interface SampleGearRow {
  id: string;
  title: string;
  brand: string;
  sport: string;
  priceInr: number;
  offerCount: number;
  status: "ok" | "price_changed" | "out_of_stock" | "gone" | "unchecked";
  checkedAgo: string;
}

export const SAMPLE_GEAR_ROWS: SampleGearRow[] = [
  { id: "1", title: "Yonex Voltric Junior Badminton Racket", brand: "Yonex", sport: "Badminton", priceInr: 1899, offerCount: 3, status: "ok", checkedAgo: "checked 2 h ago" },
  { id: "2", title: "Yonex Badminton Shoes Adult Advanced", brand: "Yonex", sport: "Badminton", priceInr: 3499, offerCount: 2, status: "ok", checkedAgo: "checked 6 h ago" },
  { id: "3", title: "Wilson Pro Staff Tennis Racket", brand: "Wilson", sport: "Tennis", priceInr: 14999, offerCount: 4, status: "price_changed", checkedAgo: "checked 1 h ago" },
  { id: "4", title: "Babolat Pure Drive Tennis Racket", brand: "Babolat", sport: "Tennis", priceInr: 12499, offerCount: 3, status: "ok", checkedAgo: "checked 3 h ago" },
  { id: "5", title: "Cosco Cricket Bat Starter", brand: "Cosco", sport: "Cricket", priceInr: 999, offerCount: 1, status: "out_of_stock", checkedAgo: "checked 9 days ago" },
  { id: "6", title: "SG Cricket Bat Pro Adult", brand: "SG", sport: "Cricket", priceInr: 5999, offerCount: 2, status: "ok", checkedAgo: "checked 5 h ago" },
  { id: "7", title: "Adidas Football Junior", brand: "Adidas", sport: "Football", priceInr: 1299, offerCount: 3, status: "ok", checkedAgo: "checked 4 h ago" },
  { id: "8", title: "Nivia Football Pro Adult", brand: "Nivia", sport: "Football", priceInr: 1799, offerCount: 1, status: "gone", checkedAgo: "checked 14 days ago" },
];

export const SAMPLE_SPARSE_ROW: SampleGearRow[] = [
  { id: "9", title: "Kookaburra Cricket Ball Set", brand: "Kookaburra", sport: "Cricket", priceInr: 2499, offerCount: 1, status: "unchecked", checkedAgo: "not checked yet" },
];
