import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'atlitos.guest.wishlist.products';

/**
 * The guest half of the gear wishlist (PRD-07 FR-7, AC-B3): "guest users may
 * browse category and PDP screens and use client side wishlist", and tapping
 * the heart "saves locally and does not require authentication". So a guest's
 * heart must NOT raise the login gate. Add to Cart and Checkout still do, and
 * that gate lives on those actions, not here.
 *
 * Deliberately local only. `product_wishlist_items` is owner scoped to a real
 * `users` row, and a guest is an anonymous auth session, so persisting a
 * guest's saves server side would either need a row keyed to a throwaway
 * identity or a relaxed policy. Neither is in PRD-07's scope, and FR-7 asks
 * for exactly the local behavior instead.
 *
 * The store is hydrated once on first read and written through on every
 * toggle. AsyncStorage is the same adapter the Supabase session uses, so this
 * survives an app restart on native and a reload on web without a second
 * persistence mechanism.
 */
interface GuestWishlistState {
  productIds: string[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  toggle: (productId: string) => Promise<boolean>;
  has: (productId: string) => boolean;
  clear: () => Promise<void>;
}

export const useGuestWishlist = create<GuestWishlistState>((set, get) => ({
  productIds: [],
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const productIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
      set({ productIds, hydrated: true });
    } catch {
      // A malformed or unreadable value is not worth failing a browse over;
      // start from an empty list and let the next toggle overwrite it.
      set({ productIds: [], hydrated: true });
    }
  },

  async toggle(productId: string) {
    const current = get().productIds;
    const nowSaved = !current.includes(productId);
    const next = nowSaved ? [...current, productId] : current.filter((id) => id !== productId);
    set({ productIds: next });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // In-memory state already reflects the tap; a failed write only costs
      // persistence across a restart, which is not worth an error surface on
      // a save-for-later action.
    }
    return nowSaved;
  },

  has(productId: string) {
    return get().productIds.includes(productId);
  },

  async clear() {
    set({ productIds: [] });
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {
      // Nothing to recover; the in-memory list is already empty.
    });
  },
}));
