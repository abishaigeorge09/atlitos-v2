import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'atlitos.home.recently_viewed_products';
const MAX_ENTRIES = 12;

interface RecentlyViewedEntry {
  productId: string;
  viewedAt: number;
}

/**
 * Client local "recently viewed" ring buffer for the Home rail (PRD-01 3.2).
 * Deliberately local only, the same shape as `guest-wishlist.ts`: there is no
 * PRD-07 requirement for a server side view history, and a device local
 * ring buffer is enough to make the Home rail feel personal without a new
 * owner scoped table. Keeps the last `MAX_ENTRIES` distinct product ids,
 * most recently viewed first. Read and write both fail silent, a broken or
 * missing value just means an empty rail, never a blocked product page.
 */
async function readEntries(): Promise<RecentlyViewedEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentlyViewedEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RecentlyViewedEntry).productId === 'string' &&
        typeof (entry as RecentlyViewedEntry).viewedAt === 'number',
    );
  } catch {
    return [];
  }
}

/** Record a product view, most recent first, deduping the id and capping the
 * buffer at `MAX_ENTRIES`. Fire and forget from the PDP mount, failures are
 * swallowed since a missed view is never worth surfacing an error for. */
export async function recordProductView(productId: string): Promise<void> {
  try {
    const existing = await readEntries();
    const next = [
      { productId, viewedAt: Date.now() },
      ...existing.filter((entry) => entry.productId !== productId),
    ].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not fatal, see module docstring.
  }
}

/** Most recently viewed product ids, most recent first. Empty when nothing
 * has been viewed yet or the read fails. */
export async function getRecentlyViewedProductIds(): Promise<string[]> {
  const entries = await readEntries();
  return entries.map((entry) => entry.productId);
}
