import { useShop, toApiError, type AffiliateProduct, type ProductOffer } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { ExternalLink, Package, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
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

  const inStockOffers = product.offers.filter((offer) => offer.inStock);
  const cheapestId = inStockOffers[0]?.id ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="back" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}>
        <Hero imageUrl={product.imageUrl} />

        <View style={{ gap: spacing.xs }}>
          {product.brand ? (
            <Text style={[textStyle('overline'), { color: colors.accent }]}>{product.brand}</Text>
          ) : null}
          <Text style={[textStyle('h2'), { color: colors.text }]}>{product.title}</Text>
          <Attributes product={product} />
          {product.bestPrice !== null ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: spacing.xs }}>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>From</Text>
              <Text style={[textStyle('numericLg'), { color: colors.text }]}>{formatINR(product.bestPrice)}</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                across {inStockOffers.length} retailers
              </Text>
            </View>
          ) : null}
        </View>

        {product.description ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Details</Text>
            <Text style={[textStyle('body'), { color: colors.textSecondary }]}>{product.description}</Text>
          </View>
        ) : null}

        {/* FR-35 / FR-36: the price comparison. Every retailer, cheapest first,
         * the cheapest highlighted; each row clicks out to its own retailer. */}
        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Compare prices</Text>
          {product.offers.length === 0 ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              No retailer offers listed yet. Check back soon.
            </Text>
          ) : (
            product.offers.map((offer) => (
              <OfferRow key={offer.id} offer={offer} isCheapest={offer.id === cheapestId} />
            ))
          )}
        </View>

        <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
          Prices are updated regularly. You complete the purchase on the retailer site. Atlitos may earn a commission.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Hero({ imageUrl }: { imageUrl: string | null }) {
  const colors = useThemeColors();
  if (!imageUrl) {
    return (
      <View
        accessibilityLabel="Product photo coming soon"
        style={{
          height: 260,
          borderRadius: radii.xl,
          backgroundColor: colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Package size={48} strokeWidth={1.75} color={colors.textTertiary} />
      </View>
    );
  }
  return <Image source={{ uri: imageUrl }} style={{ height: 260, borderRadius: radii.xl }} resizeMode="cover" />;
}

function Attributes({ product }: { product: AffiliateProduct }) {
  const colors = useThemeColors();
  const parts = [
    product.categoryName,
    product.skillLevel ? capitalize(product.skillLevel) : null,
    product.ageRange ? capitalize(product.ageRange) : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  return (
    <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{parts.join(' . ')}</Text>
  );
}

/** One retailer offer row. The cheapest in-stock offer carries an accent border
 * and a "Cheapest" chip; every in-stock row has a Buy click-out that opens the
 * retailer's affiliate_url. An out-of-stock offer is dimmed and its button
 * disabled, so the cheapest price a shopper cannot buy is never presented as
 * buyable. */
function OfferRow({ offer, isCheapest }: { offer: ProductOffer; isCheapest: boolean }) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        borderRadius: radii.md,
        borderWidth: isCheapest ? 2 : 1,
        borderColor: isCheapest ? colors.accent : colors.border,
        backgroundColor: colors.card,
        padding: spacing.lg,
        gap: spacing.md,
        opacity: offer.inStock ? 1 : 0.6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={[textStyle('label'), { color: colors.text }]}>{offer.retailer}</Text>
            {isCheapest ? (
              <View style={{ borderRadius: radii.pill, backgroundColor: colors.accentTint, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <Text style={[textStyle('caption'), { color: colors.accent }]}>Cheapest</Text>
              </View>
            ) : null}
          </View>
          <Text style={[textStyle('caption'), { color: offer.inStock ? colors.textSecondary : colors.danger }]}>
            {offer.inStock ? 'In stock' : 'Out of stock'}
          </Text>
        </View>
        <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(offer.price)}</Text>
      </View>

      <Button
        variant={isCheapest ? 'primary' : 'secondary'}
        disabled={!offer.inStock}
        onPress={() => void Linking.openURL(offer.affiliateUrl)}
      >
        <ExternalLink size={18} strokeWidth={1.75} color={isCheapest ? colors.inkOnAccent : colors.text} />
        <Text style={{ color: isCheapest ? colors.inkOnAccent : colors.text }}>Buy on {offer.retailer}</Text>
      </Button>
    </View>
  );
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
