import {
  useAppConfig,
  useSearch,
  useShop,
  useWishlist,
  toApiError,
  type AffiliateProduct,
  type ShopProduct,
} from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import type { ApiError, SearchHit, Sport } from '@atlitos/types';
import { SPORTS } from '@atlitos/types';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Heart, RefreshCw, ShoppingBag, ShoppingCart, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { Chip } from '@/components/ui/chip';
import { GearResultTile } from '@/components/ui/gear-result-tile';
import { ProductCard } from '@/components/ui/product-card';
import { SearchBar } from '@/components/ui/search-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { SPORT_LABEL } from '@/lib/sport-display';
import { useGuestWishlist } from '@/store/guest-wishlist';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ShopParams = {
  /** Set by `CategoriesRow` and the (redirecting) category route, pre-selects
   * the matching sport chip. */
  sport?: string;
};

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/** One tile in the two column grid: an affiliate product (direction C,
 * `GearResultTile`) or, only while `shop.owned_enabled` is true, an owned
 * product (`ProductCard`, unchanged from the old category screen). */
type GridItem = { kind: 'affiliate'; product: AffiliateProduct } | { kind: 'owned'; product: ShopProduct };

/** The three "Under INR n" ceilings the one price chip cycles through
 * (PHASE-S3-STATUS.md scope row 2). `null` (the chip unselected) applies no
 * ceiling. */
const PRICE_TIERS = [2000, 5000, 10000] as const;

function isSport(value: string | undefined): value is Sport {
  return typeof value === 'string' && (SPORTS as readonly string[]).includes(value);
}

/** How long ago a nightly check ran, in hours, for `GearResultTile`'s
 * freshness line. Null (never checked, e.g. a just-ingested offer with no
 * `gear-recheck` sweep yet) reads as a deliberately stale 90 days rather than
 * a fabricated "just now": nothing here was actually checked recently. */
function hoursSince(iso: string | null): number {
  if (iso === null) return 24 * 90;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

/**
 * The shop, `/shop`. Phase S3 (PRD-07 section 11, FR-40 to FR-42, FR-53).
 * Replaces the old bare redirect to `/shop/category/all`: this is now the
 * screen itself, per PHASE-S3-STATUS.md hard decision 1 (IA-SHOP.md's
 * `/(tabs)/shop` does not exist, there is no shop tab two weeks before
 * submission).
 *
 * Search first (direction C, DIRECTION-SHOP.md): `SearchBar variant="ai"`,
 * sport chips (single select, toggle off), one cycling price ceiling chip,
 * then a two column grid. Empty query reads `listAffiliateProducts` (the
 * catalogue, newest first, hard decision 3); a query two characters or
 * longer goes through `search.aiSearch` after a 400 ms debounce.
 *
 * `shop.owned_enabled` (FR-53) is read once on mount through `useAppConfig`.
 * False (the launch default): no owned product anywhere on this screen, no
 * cart button, no wishlist hearts, and a typed query keeps only the `gear`
 * hits whose `entityId` is prefixed `affiliate:` (the honest `ai-search`
 * contract also returns owned `gear` hits under the same entityType, per
 * `supabase/functions/ai-search/index.ts`'s doc comment on why). True: owned
 * products browse alongside affiliate ones exactly as the old category
 * screen did, cart button and wishlist hearts visible.
 */
export default function ShopScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const wishlist = useWishlist(supabase);
  const search = useSearch(supabase);
  const appConfig = useAppConfig(supabase);
  const params = useLocalSearchParams<ShopParams>();

  const isGuest = useSessionStore((state) => state.status === 'guest');
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');
  const guestWishlist = useGuestWishlist();

  // `undefined` until the flag read resolves, so the grid and the cart
  // button never flash owned content for one frame before the flag lands.
  const [ownedEnabled, setOwnedEnabled] = useState<boolean | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  // -1 is "unselected", else an index into PRICE_TIERS.
  const [priceTierIndex, setPriceTierIndex] = useState(-1);
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<GridItem[]>([]);
  const [broaden, setBroaden] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  useEffect(() => {
    if (isSport(params.sport)) setSelectedSport(params.sport);
  }, [params.sport]);

  useEffect(() => {
    appConfig
      .getBoolean('shop.owned_enabled', false)
      .then(setOwnedEnabled)
      .catch(() => setOwnedEnabled(false));
  }, [appConfig]);

  useEffect(() => {
    if (ownedEnabled === undefined) return;
    if (isGuest) {
      void guestWishlist.hydrate();
      return;
    }
    if (!isSignedIn) return;
    wishlist
      .listWishlistedProductIds()
      .then(setSavedIds)
      .catch(() => {
        // A failed wishlist read must not take the catalog down with it.
      });
  }, [ownedEnabled, isGuest, isSignedIn]);

  const guestSavedIds = useGuestWishlist((store) => store.productIds);
  const effectiveSavedIds = isGuest ? guestSavedIds : savedIds;

  const priceMax = priceTierIndex === -1 ? undefined : PRICE_TIERS[priceTierIndex];

  // Guards a late response from an earlier keystroke or chip tap overwriting
  // a newer one (the same shape home/search.tsx uses for BUG-001).
  const requestSeq = useRef(0);

  const runLoad = useCallback(async () => {
    if (ownedEnabled === undefined) return;
    const seq = ++requestSeq.current;
    setState('loading');
    setError(null);
    setBroaden(null);
    const trimmed = query.trim();

    try {
      if (trimmed.length >= 2) {
        const res = await search.search({
          query: trimmed,
          entityTypes: ['gear'],
          sport: selectedSport ?? undefined,
          priceMax,
        });
        if (seq !== requestSeq.current) return;
        const relevant = res.results.filter(
          (hit: SearchHit) => hit.entityType === 'gear' && (ownedEnabled || hit.entityId.startsWith('affiliate:')),
        );
        const hydrated = await Promise.all(
          relevant.map(async (hit): Promise<GridItem | null> => {
            if (hit.entityId.startsWith('affiliate:')) {
              const product = await shop.getAffiliateProduct(hit.entityId.slice('affiliate:'.length)).catch(() => null);
              return product ? { kind: 'affiliate', product } : null;
            }
            const product = await shop.getProduct(hit.entityId).catch(() => null);
            return product ? { kind: 'owned', product } : null;
          }),
        );
        if (seq !== requestSeq.current) return;
        const grid = hydrated.filter((item): item is GridItem => item !== null);
        setItems(grid);
        setBroaden(res.broaden ?? null);
        setState(grid.length === 0 ? 'empty' : 'populated');
        return;
      }

      // Empty query: the catalogue, newest first (hard decision 3), filtered
      // client side by the chips.
      const affiliate = await shop.listAffiliateProducts({ sport: selectedSport ?? undefined });
      const owned = ownedEnabled ? await shop.listProducts({ sport: selectedSport ?? undefined }) : [];
      if (seq !== requestSeq.current) return;

      const filteredAffiliate =
        priceMax === undefined ? affiliate : affiliate.filter((p) => p.cheapest !== null && p.cheapest.price <= priceMax);
      const filteredOwned = priceMax === undefined ? owned : owned.filter((p) => p.priceFrom <= priceMax);

      const grid: GridItem[] = [
        ...filteredOwned.map((product): GridItem => ({ kind: 'owned', product })),
        ...filteredAffiliate.map((product): GridItem => ({ kind: 'affiliate', product })),
      ];
      setItems(grid);
      setState(grid.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(toApiError(err));
      setState('error');
    }
  }, [ownedEnabled, query, selectedSport, priceMax, search, shop]);

  const runLoadRef = useRef(runLoad);
  useEffect(() => {
    runLoadRef.current = runLoad;
  }, [runLoad]);

  // 400 ms debounce (FR-40/FR-42's typed path), applied uniformly to a chip
  // tap too: a tap is not a keystroke storm, so the extra 400 ms is
  // imperceptible, and one effect keeps the empty and typed paths from
  // racing each other.
  useEffect(() => {
    const handle = setTimeout(() => void runLoadRef.current(), 400);
    return () => clearTimeout(handle);
  }, [query, selectedSport, priceTierIndex, ownedEnabled]);

  async function handleToggleWishlist(productId: string) {
    if (isGuest) {
      await guestWishlist.toggle(productId);
      return;
    }
    if (!isSignedIn) return;
    const wasSaved = savedIds.includes(productId);
    setSavedIds((current) => (wasSaved ? current.filter((id) => id !== productId) : [...current, productId]));
    try {
      const nowSaved = await wishlist.toggle(productId);
      setSavedIds((current) => {
        const without = current.filter((id) => id !== productId);
        return nowSaved ? [...without, productId] : without;
      });
    } catch {
      setSavedIds((current) => (wasSaved ? [...current, productId] : current.filter((id) => id !== productId)));
    }
  }

  const header = (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <SearchBar
        variant="ai"
        testID="shop-search-input"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        returnKeyType="search"
      />

      <View className="flex-row flex-wrap items-center gap-sm">
        {SPORTS.map((sport) => (
          <View key={sport} testID={`shop-sport-chip-${sport}`}>
            <Chip
              label={SPORT_LABEL[sport]}
              variant="filter"
              selected={selectedSport === sport}
              onPress={() => setSelectedSport((current) => (current === sport ? null : sport))}
            />
          </View>
        ))}
        <View testID="shop-price-chip">
          <Chip
            label={priceTierIndex === -1 ? 'Under INR 2,000' : `Under INR ${PRICE_TIERS[priceTierIndex].toLocaleString('en-IN')}`}
            variant="filter"
            selected={priceTierIndex !== -1}
            onPress={() => setPriceTierIndex((current) => (current === PRICE_TIERS.length - 1 ? -1 : current + 1))}
          />
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ShopHeaderBar ownedEnabled={ownedEnabled} />
      <FlatList
        data={state === 'loading' ? [] : items}
        key="shop-grid"
        numColumns={2}
        keyExtractor={(item) => `${item.kind}:${item.product.id}`}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing['3xl'] }}
        ListEmptyComponent={
          // The list, and with it the search field, stays mounted through every
          // state. An early return for loading unmounted the TextInput 400 ms
          // after the first keystroke and dropped every character after it
          // (found on the Release build, 2026-09-18). Loading and error render
          // here, inside the list, never as a replacement tree.
          state === 'loading' ? (
            <View testID="shop-loading" style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
              <View className="flex-row gap-md">
                <Skeleton shape="card" height={220} className="flex-1" />
                <Skeleton shape="card" height={220} className="flex-1" />
              </View>
              <View className="flex-row gap-md">
                <Skeleton shape="card" height={220} className="flex-1" />
                <Skeleton shape="card" height={220} className="flex-1" />
              </View>
            </View>
          ) : state === 'error' ? (
            <View testID="shop-error" style={{ padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
              <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
              <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load gear</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                {error?.message ?? 'Something went wrong. Please try again.'}
              </Text>
              <Button variant="secondary" onPress={() => void runLoad()}>
                <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
                <Text style={{ color: colors.text }}>Retry</Text>
              </Button>
            </View>
          ) : (
          <View testID="shop-empty" style={{ gap: spacing.md }}>
            <EmptyState
              icon={ShoppingBag}
              title="Nothing matches yet."
              body={
                // The broaden line (FR-42) renders once, in its own
                // `shop-broaden` block below, never duplicated into the
                // empty state's own body copy.
                broaden
                  ? ''
                  : query.trim()
                    ? 'Try a different word, or clear the search to see everything.'
                    : 'New gear lands here regularly. Check back soon.'
              }
              ctaLabel={query ? 'Clear search' : undefined}
              onCtaPress={query ? () => setQuery('') : undefined}
            />
            {broaden ? (
              <View testID="shop-broaden" style={{ paddingHorizontal: spacing.lg }}>
                <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                  {broaden}
                </Text>
              </View>
            ) : null}
          </View>
          )
        }
        renderItem={({ item, index }) => (
          <View testID={`gear-tile-${index}`} style={{ flex: 1 }}>
            {item.kind === 'affiliate' ? (
              <GearResultTile
                imageUri={item.product.imageUrl}
                brand={item.product.brand}
                title={item.product.title}
                fromPrice={item.product.cheapest?.price ?? null}
                retailer={item.product.cheapest?.retailer ?? null}
                storeCount={item.product.retailerCount}
                checkedHoursAgo={hoursSince(item.product.cheapest?.lastCheckedAt ?? null)}
                onPress={() => router.push({ pathname: '/shop/affiliate/[id]', params: { id: item.product.id } })}
              />
            ) : (
              <ProductCard
                className="flex-1"
                imageUri={item.product.imageUrl}
                title={item.product.title}
                price={item.product.priceFrom}
                wishlisted={effectiveSavedIds.includes(item.product.id)}
                onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.product.id } })}
                onAddToCart={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.product.id } })}
                onToggleWishlist={() => void handleToggleWishlist(item.product.id)}
              />
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

/**
 * The screen's own header row: back, "Shop" title, and, only while
 * `shop.owned_enabled` is true, a wishlist heart and a cart button
 * (`shop-cart-button`, which per PHASE-S3-STATUS.md scope row 3 MUST NOT
 * render at all when the flag is false, not merely render disabled).
 * `undefined` (flag not resolved yet) renders neither, matching the false
 * behaviour so a slow config read never flashes the cart button on.
 */
function ShopHeaderBar({ ownedEnabled }: { ownedEnabled: boolean | undefined }) {
  const colors = useThemeColors();

  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}
    >
      <View className="flex-row items-center gap-sm flex-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted -ml-2"
          onPress={() => router.back()}
        >
          <ChevronLeft size={24} strokeWidth={1.75} color={colors.text} />
        </Pressable>
        <Text style={[textStyle('h1'), { color: colors.text }]}>Shop</Text>
      </View>
      {ownedEnabled ? (
        <View className="flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="My wishlist"
            className="h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted"
            onPress={() => router.push('/account/wishlist')}
          >
            <Heart size={20} strokeWidth={1.75} color={colors.text} />
          </Pressable>
          <Pressable
            testID="shop-cart-button"
            accessibilityRole="button"
            accessibilityLabel="My cart"
            className="h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted"
            onPress={() => router.push('/shop/cart')}
          >
            <ShoppingCart size={20} strokeWidth={1.75} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
