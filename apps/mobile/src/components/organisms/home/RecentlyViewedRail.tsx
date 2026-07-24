import { useShop, type ShopProduct } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ProductCard } from '@/components/ui/product-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { getRecentlyViewedProductIds } from '@/lib/recently-viewed';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's product rail (PRD-01 3.2). Prefers "Recently viewed": the client
 * local ring buffer (`recently-viewed.ts`, written from the PDP on mount)
 * hydrated against the same public catalog `useShop().listProducts` already
 * reads, filtered client side to the viewed ids since there is no `byIds`
 * read on `useShop` yet, and re-ordered to the viewed order (most recent
 * first) rather than the catalog's own relevance order.
 *
 * Falls back to today's plain "Shop" rail, unchanged, whenever there is
 * nothing recently viewed (a new install, a guest who has never opened a
 * PDP) or either read fails, so the section is never empty for a shopper
 * with any catalog at all.
 */
export function RecentlyViewedRail({ reloadKey }: { reloadKey: number }) {
  const colors = useThemeColors();
  const shop = useShop(supabase);

  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [recentProducts, setRecentProducts] = useState<ShopProduct[]>([]);
  const [fallbackProducts, setFallbackProducts] = useState<ShopProduct[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [viewedIds, allProducts] = await Promise.all([
        getRecentlyViewedProductIds(),
        shop.listProducts(),
      ]);
      const byId = new Map(allProducts.map((product) => [product.id, product]));
      const hydrated = viewedIds
        .map((id) => byId.get(id))
        .filter((product): product is ShopProduct => Boolean(product));
      setRecentProducts(hydrated);
      setFallbackProducts(allProducts.slice(0, 8));
    } catch {
      setRecentProducts([]);
      setFallbackProducts([]);
    } finally {
      setState('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (state === 'loading') {
    return (
      <View style={{ gap: spacing.sm }}>
        <Skeleton shape="line" width="40%" />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Skeleton shape="card" width={200} />
          <Skeleton shape="card" width={200} />
        </View>
      </View>
    );
  }

  const showRecent = recentProducts.length > 0;
  const products = showRecent ? recentProducts : fallbackProducts;

  if (products.length === 0) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <View className="flex-row items-center justify-between">
        <Text style={[textStyle('h3'), { color: colors.text }]}>
          {showRecent ? 'Recently viewed' : 'Shop'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all gear"
          onPress={() => router.push('/shop')}
          className="flex-row items-center gap-xs"
        >
          <Text className="font-sans-semibold text-sm" style={{ color: colors.accent }}>
            See all
          </Text>
          <ChevronRight size={16} color={colors.accent} strokeWidth={1.75} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-md">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            variant="row"
            className="w-64"
            imageUri={product.imageUrl}
            title={product.title}
            price={product.priceFrom}
            onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: product.id } })}
          />
        ))}
      </ScrollView>
    </View>
  );
}
