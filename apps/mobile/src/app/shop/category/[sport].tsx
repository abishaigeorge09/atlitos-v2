import { useShop, useWishlist, toApiError, type AffiliateProduct, type ShopProduct } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft, Heart, RefreshCw, ShoppingBag, ShoppingCart, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Chip } from '@/components/ui/chip';
import { ProductCard } from '@/components/ui/product-card';
import { SearchBar } from '@/components/ui/search-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useGuestWishlist } from '@/store/guest-wishlist';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type CategoryParams = {
  /** A `categories.slug`, or "all" for the whole catalog. */
  sport: string;
};

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * Category Browse, `/shop/category/[sport]`. AT-74, PRD-07 FR-1, FR-2, FR-3,
 * FR-31, FR-32; screen spec PRD-07 section 3 item 1.
 *
 * Products come from `products` joined to `product_variant_availability`, so
 * every price and every stock figure on this grid is AVAILABLE stock, never
 * raw `product_variants.stock` (PHASE-4-STATUS.md D2). Default relevance order
 * is recommended rank first, then title, applied in `listProducts`.
 *
 * Guest open: browsing never mutates server state. The wishlist heart saves
 * locally for a guest per FR-7/AC-B3 and never raises the login gate; the
 * grid's Add to cart is where the gate lives (FR-7), same as the PDP.
 *
 * Grid Add to cart (QA 2026-09-15, "not adding the item to cart"): the
 * button used to be a disguised link to the PDP. It now follows FR-29's
 * wishlist rule: one buyable variant adds it at qty 1 through `add_to_cart`
 * (server side stock revalidation, FR-9, capped never rounded up), more
 * than one routes to the PDP where the size is chosen, none in stock says
 * so. A notice above the grid confirms what happened and links to the cart.
 *
 * Four states per FR-31: skeleton grid, empty (the Recommended Gears rail
 * still renders if it has anything, else an empty state pointing back to the
 * catalog), populated, error with retry.
 *
 * The Recommended Gears rail (FR-2) only carries products that are NOT
 * already in the grid below it. `listProducts` sorts recommended items
 * first (FR-1), so on "All gear" the rail was a copy of the grid's first
 * row and read as the same product listed twice (QA 2026-09-15). On a
 * category view it still surfaces recommended gear from other categories.
 *
 * FR-33: affiliate products (Phase 9 WS4) browse alongside owned products.
 * `listAffiliateProducts` was defined but never called by any screen (QA I48),
 * leaving `/shop/affiliate/[id]` unreachable from the shop UI. The Compare
 * Prices rail below fixes that: it is the shop's one stable entry point
 * (shop home redirects here), so this is where "All gear" browse and the
 * in-page search surface affiliate matches too. It only renders on the "All
 * gear" view, because affiliate products carry a `sport`, not a
 * `shopper_categories` slug, so there is no category-scoped mapping to filter
 * them by.
 */
export default function CategoryBrowseScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const wishlist = useWishlist(supabase);
  const params = useLocalSearchParams<CategoryParams>();
  const categorySlug = params.sport ?? 'all';

  const isGuest = useSessionStore((state) => state.status === 'guest');
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');
  const guestWishlist = useGuestWishlist();

  const [state, setState] = useState<LoadState>('loading');
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [recommended, setRecommended] = useState<ShopProduct[]>([]);
  const [affiliateProducts, setAffiliateProducts] = useState<AffiliateProduct[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [cartNotice, setCartNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [gateVisible, setGateVisible] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setState('loading');
      setError(null);
      try {
        const [rows, rail, cats] = await Promise.all([
          shop.listProducts({ categorySlug }),
          shop.listRecommended(),
          shop.listCategories(),
        ]);
        setProducts(rows);
        setRecommended(rail);
        setCategories(cats);
        setState(rows.length === 0 ? 'empty' : 'populated');

        // FR-33: browsed alongside owned products, only on the "All gear"
        // view (see the screen doc comment for why). Kept out of the
        // Promise.all above and given its own catch so an affiliate read
        // failure never takes the owned catalog down with it.
        if (categorySlug === 'all') {
          try {
            setAffiliateProducts(await shop.listAffiliateProducts());
          } catch {
            setAffiliateProducts([]);
          }
        } else {
          setAffiliateProducts([]);
        }
      } catch (err) {
        setError(toApiError(err));
        setState('error');
      }
    },
    [categorySlug],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isGuest) {
      void guestWishlist.hydrate();
      return;
    }
    if (!isSignedIn) return;
    wishlist
      .listWishlistedProductIds()
      .then(setSavedIds)
      .catch(() => {
        // A failed wishlist read must not take the catalog down with it; the
        // hearts simply render unsaved until the next load.
      });
  }, [isGuest, isSignedIn]);

  const guestSavedIds = useGuestWishlist((store) => store.productIds);
  const effectiveSavedIds = isGuest ? guestSavedIds : savedIds;

  async function handleToggleWishlist(productId: string) {
    // FR-7 / AC-B3: a guest's heart saves locally and does NOT prompt for
    // auth. Only the cart and checkout gate.
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
      // Roll the optimistic heart back rather than leaving it lying.
      setSavedIds((current) => (wasSaved ? [...current, productId] : current.filter((id) => id !== productId)));
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  // The notice is a toast, not a banner: it clears itself so a shopper who
  // keeps browsing is not left with a stale "Added" line pinned at the top.
  useEffect(() => {
    if (!cartNotice) return;
    const timer = setTimeout(() => setCartNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [cartNotice]);

  async function handleAddToCart(product: ShopProduct) {
    // FR-7: the cart is the first thing a guest cannot do. Gate, do not
    // silently drop the tap.
    if (!isSignedIn) {
      setGateVisible(true);
      return;
    }
    if (addingId) return;

    const buyable = product.variants.filter((variant) => variant.availableStock > 0);
    if (buyable.length === 0) {
      setCartNotice({ text: 'This gear is out of stock right now.', tone: 'warn' });
      return;
    }
    // FR-29's rule for a one tap add: a size has to be chosen when there is
    // more than one, and the PDP is where sizes live.
    if (buyable.length > 1) {
      router.push({ pathname: '/shop/product/[id]', params: { id: product.id } });
      return;
    }

    setAddingId(product.id);
    try {
      const result = await shop.addToCart(buyable[0].id, 1);
      // FR-9: the RPC caps rather than silently rounding up, and the shopper
      // has to be told when it did.
      setCartNotice({
        text: result.capped
          ? `Only ${result.availableStock} left, so your cart has ${result.qty}.`
          : 'Added to your cart.',
        tone: 'ok',
      });
      // Availability moved, so re-read it rather than trusting what this
      // screen loaded a moment ago.
      void load({ silent: true });
    } catch (err) {
      const apiError = toApiError(err);
      setCartNotice({
        text:
          apiError.code === 'OUT_OF_STOCK'
            ? 'That one just sold out.'
            : apiError.message || 'Could not add this to your cart.',
        tone: 'warn',
      });
    } finally {
      setAddingId(null);
    }
  }

  const visible = shop.filterBySearch(products, search);
  // Recommended minus whatever the grid already shows, see the screen doc.
  const gridIds = new Set(products.map((product) => product.id));
  const railItems = recommended.filter((item) => !gridIds.has(item.id));
  // FR-33's search half for affiliate rows: the same title/brand search the
  // owned grid applies, over the affiliate rail, so a search for a brand
  // Atlitos does not stock still surfaces the compare-price entry point.
  const searchTerm = search.trim().toLowerCase();
  const visibleAffiliate = affiliateProducts
    .filter((item): item is AffiliateProduct & { bestPrice: number } => item.bestPrice !== null) // no in-stock offer, no "from" price to show
    .filter(
      (item) =>
        !searchTerm ||
        item.title.toLowerCase().includes(searchTerm) ||
        (item.brand ?? '').toLowerCase().includes(searchTerm),
    );
  const activeCategoryName =
    categorySlug === 'all' ? 'All gear' : categories.find((c) => c.slug === categorySlug)?.name ?? 'Gear';

  const header = (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-sm flex-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted -ml-2"
            onPress={() => router.back()}
          >
            <ChevronLeft size={24} strokeWidth={1.75} color={colors.text} />
          </Pressable>
          <Text style={[textStyle('h1'), { color: colors.text }]}>{activeCategoryName}</Text>
        </View>
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
            accessibilityRole="button"
            accessibilityLabel="My cart"
            className="h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted"
            onPress={() => router.push('/shop/cart')}
          >
            <ShoppingCart size={20} strokeWidth={1.75} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* FR-3: filters by product title and category. */}
      <SearchBar
        variant="plain"
        placeholder="Search gear"
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
      />

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={categories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
        ListHeaderComponent={
          <Chip
            label="All gear"
            variant="filter"
            selected={categorySlug === 'all'}
            onPress={() => router.setParams({ sport: 'all' })}
          />
        }
        ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
        renderItem={({ item }) => (
          <Chip
            label={item.name}
            variant="filter"
            selected={categorySlug === item.slug}
            onPress={() => router.setParams({ sport: item.slug })}
          />
        )}
      />

      {railItems.length > 0 ? <RecommendedRail items={railItems} /> : null}
      {visibleAffiliate.length > 0 ? <ComparePricesRail items={visibleAffiliate} /> : null}
    </View>
  );

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="45%" height={28} />
          <Skeleton shape="line" height={44} />
          <View className="flex-row gap-md">
            <Skeleton shape="card" height={200} className="flex-1" />
            <Skeleton shape="card" height={200} className="flex-1" />
          </View>
          <View className="flex-row gap-md">
            <Skeleton shape="card" height={200} className="flex-1" />
            <Skeleton shape="card" height={200} className="flex-1" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <View
          style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}
        >
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load gear</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {cartNotice ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: cartNotice.tone === 'ok' ? colors.accentTint : colors.surfaceMuted,
              padding: spacing.md,
            }}
          >
            {cartNotice.tone === 'ok' ? (
              <Check size={16} strokeWidth={2} color={colors.accent} />
            ) : (
              <TriangleAlert size={16} strokeWidth={2} color={colors.textSecondary} />
            )}
            <Text
              style={[
                textStyle('caption'),
                { color: cartNotice.tone === 'ok' ? colors.accent : colors.textSecondary, flex: 1 },
              ]}
            >
              {cartNotice.text}
            </Text>
            {cartNotice.tone === 'ok' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View cart"
                hitSlop={8}
                onPress={() => router.push('/shop/cart')}
              >
                <Text style={[textStyle('label'), { color: colors.accent }]}>View cart</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <FlatList
        data={visible}
        key="shop-grid"
        numColumns={2}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
        ListEmptyComponent={
          <EmptyState
            icon={ShoppingBag}
            title={search ? 'No gear matches that search' : 'No gear in this category yet'}
            body={
              search
                ? 'Try a different word, or clear the search to see everything.'
                : 'New gear lands here regularly. Browse the full catalog in the meantime.'
            }
            ctaLabel={search ? 'Clear search' : 'Browse all gear'}
            onCtaPress={() => (search ? setSearch('') : router.setParams({ sport: 'all' }))}
          />
        }
        renderItem={({ item }) => (
          <ProductCard
            className="flex-1"
            imageUri={item.imageUrl}
            title={item.title}
            price={item.priceFrom}
            wishlisted={effectiveSavedIds.includes(item.id)}
            addingToCart={addingId === item.id}
            onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.id } })}
            onAddToCart={() => void handleAddToCart(item)}
            onToggleWishlist={() => void handleToggleWishlist(item.id)}
          />
        )}
      />

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}

/**
 * FR-2's Recommended Gears rail, sourced from `products.recommended_rank`.
 * Heuristic in v1; the contract is a ranked product read, so an LLM ranked
 * value slots in behind it without touching this component.
 */
function RecommendedRail({ items }: { items: ShopProduct[] }) {
  const colors = useThemeColors();

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Recommended gears</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
        {items.map((item) => (
          <ProductCard
            key={item.id}
            variant="row"
            className="w-64"
            imageUri={item.imageUrl}
            title={item.title}
            price={item.priceFrom}
            onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.id } })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * FR-33 to FR-38's discoverable entry point into the affiliate marketplace.
 * `AffiliateProduct` has no `product.priceFrom`; the "from" figure here is
 * `bestPrice`, the lowest in-stock offer, per FR-33. Callers only pass items
 * with a non-null `bestPrice` (an all-out-of-stock product has no "from"
 * price to show). Routes to `/shop/affiliate/[id]`, never `/shop/product/[id]`:
 * this is a compare and click-out surface, not a cartable item, so the row
 * variant (no Add to cart button) is used rather than the grid variant.
 */
function ComparePricesRail({ items }: { items: (AffiliateProduct & { bestPrice: number })[] }) {
  const colors = useThemeColors();

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Compare prices</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
        {items.map((item) => (
          <ProductCard
            key={item.id}
            variant="row"
            className="w-64"
            imageUri={item.imageUrl ?? undefined}
            title={item.title}
            price={item.bestPrice}
            onPress={() => router.push({ pathname: '/shop/affiliate/[id]', params: { id: item.id } })}
          />
        ))}
      </ScrollView>
    </View>
  );
}
