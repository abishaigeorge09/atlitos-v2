import { useShop, toApiError, type AffiliateProduct } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { Package, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { OfferRow } from '@/components/ui/offer-row';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type AffiliateParams = { id: string };

type LoadState = 'loading' | 'populated' | 'notFound' | 'error';

/**
 * Affiliate Product Detail + price comparison, `/shop/affiliate/[id]`. Phase 9
 * WS4, PRD-07 section 10 (Affiliate model), FR-33 to FR-38.
 *
 * This is the OTHER product model: an external product Atlitos does not stock,
 * sold across several retailers at several prices. There is no variant selector,
 * no stock ceiling, no cart and no in-app checkout here, because Atlitos is not
 * the seller: it earns commission when the shopper clicks out and buys on the
 * retailer's own site. The owned-product PDP (`/shop/product/[id]`) is untouched
 * and still owns cart + checkout for `source = 'owned'` items.
 *
 * FR-35 / FR-36: every retailer offer is listed, sorted cheapest in-stock first
 * (the read layer does the sort), and the cheapest is highlighted. FR-37: "Buy
 * on <retailer>" opens that offer's affiliate_url via Linking, the monetised
 * click-out.
 */
export default function AffiliateProductScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const params = useLocalSearchParams<AffiliateParams>();

  const [state, setState] = useState<LoadState>('loading');
  const [product, setProduct] = useState<AffiliateProduct | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const row = await shop.getAffiliateProduct(params.id);
      if (!row) {
        setState('notFound');
        return;
      }
      setProduct(row);
      setState('populated');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={260} />
          <Skeleton shape="line" width="70%" height={24} />
          <Skeleton shape="line" width="35%" />
          <Skeleton shape="card" height={64} />
          <Skeleton shape="card" height={64} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'notFound' || state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {state === 'notFound' ? 'This gear is no longer listed' : "Couldn't load this gear"}
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {state === 'notFound'
              ? 'It may have been delisted. Browse the rest of the catalog.'
              : error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => router.push('/shop/category/all')}>
            <Text style={{ color: colors.text }}>Back to gear</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (!product) return null;

  // Sorted cheapest in-stock first by the read layer already; the cheapest
  // marker goes on the first in-stock offer in that order (FR-36).
  const cheapestId = product.offers.find((offer) => offer.inStock)?.id ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="back" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ paddingBottom: spacing['4xl'] }}>
        <ImageTile imageUrl={product.imageUrl} />

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs }}>
          {product.brand ? (
            <Text className="font-sans-semibold text-base" style={{ color: colors.text }} numberOfLines={1}>
              {product.brand}
            </Text>
          ) : null}
          <Text className="text-base" style={{ color: colors.text }}>
            {product.title}
          </Text>
          <Attributes product={product} />
          {product.description ? (
            <Text className="text-base" style={{ color: colors.textSecondary, marginTop: spacing.xs }}>
              {product.description}
            </Text>
          ) : null}
        </View>

        {/* FR-35 / FR-36: the price comparison. Every retailer, cheapest in
         * stock first, the cheapest marked; each row clicks out to its own
         * retailer, prices read straight from the live offer values. */}
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
          <Text className="font-sans-semibold text-sm" style={{ color: colors.textSecondary }}>
            Prices at {product.offers.length} store{product.offers.length === 1 ? '' : 's'}
          </Text>
          {product.offers.length === 0 ? (
            <Text className="text-base" style={{ color: colors.textSecondary }}>
              No retailer offers listed yet. Check back soon.
            </Text>
          ) : (
            product.offers.map((offer, index) => (
              <OfferRow
                key={offer.id}
                dense
                testID={`compare-offer-${index}`}
                buyTestID={`compare-buy-${index}`}
                cheapestTestID="compare-cheapest"
                retailer={offer.retailer}
                price={offer.price}
                inStock={offer.inStock}
                cheapest={offer.id === cheapestId}
                checkedHoursAgo={hoursSince(offer.lastCheckedAt)}
                onBuy={() => void Linking.openURL(offer.affiliateUrl)}
              />
            ))
          )}
        </View>

        <Text className="text-sm" style={{ color: colors.textTertiary, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
          You buy on the retailer's site. Atlitos may earn a commission.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Hours elapsed since the offer's nightly check, or null for an offer never
 * checked yet (FR-41/FR-48). `OfferRow`'s `freshnessLabel` renders "not
 * checked yet" for the null case. */
function hoursSince(lastCheckedAt: string | null): number | null {
  if (!lastCheckedAt) return null;
  const parsed = Date.parse(lastCheckedAt);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60));
}

/** Direction C's signature tile: a flat square photo area on the white
 * surface, no corners, no border, product centred at 80 percent, matching
 * `GearResultTile`'s grid treatment so the tile the shopper tapped and the
 * tile they land on read as the same object. */
function ImageTile({ imageUrl }: { imageUrl: string | null }) {
  const colors = useThemeColors();
  return (
    <View style={{ backgroundColor: colors.surface, aspectRatio: 1 }} className="w-full items-center justify-center">
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '80%', height: '80%' }}
          resizeMode="contain"
          accessibilityLabel="Product photo"
        />
      ) : (
        <Package size={48} strokeWidth={1.5} color={colors.textTertiary} accessibilityLabel="No photo yet" />
      )}
    </View>
  );
}

function Attributes({ product }: { product: AffiliateProduct }) {
  const colors = useThemeColors();
  const parts = [
    product.sport ? capitalize(product.sport) : null,
    product.skillLevel ? capitalize(product.skillLevel) : null,
    product.ageRange ? capitalize(product.ageRange) : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  return (
    <Text className="text-sm" style={{ color: colors.textSecondary }}>
      {parts.join(', ')}
    </Text>
  );
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
