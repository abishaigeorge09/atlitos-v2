import { useShop, useWishlist, toApiError, type ShopProduct } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Heart, RefreshCw, ShoppingBag, ShoppingCart, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
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
 * Guest open: nothing on this screen mutates server state. The wishlist heart
 * saves locally for a guest per FR-7/AC-B3 and never raises the login gate;
 * Add to Cart is where the gate actually lives, on the PDP.
 *
 * Four states per FR-31: skeleton grid, empty (the Recommended Gears rail
 * still renders if it has anything, else an empty state pointing back to the
 * catalog), populated, error with retry.
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
  const [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const visible = shop.filterBySearch(products, search);
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

      {recommended.length > 0 ? <RecommendedRail items={recommended} /> : null}
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
            onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.id } })}
            onAddToCart={() => router.push({ pathname: '/shop/product/[id]', params: { id: item.id } })}
            onToggleWishlist={() => void handleToggleWishlist(item.id)}
          />
        )}
      />
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
