import { useShop, useWishlist, variantLabel, toApiError, type ShopVariant, type WishlistEntry } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Check, HeartOff, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { WishlistGrid } from '@/components/organisms/WishlistGrid';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * My Wishlist (gear), `/account/wishlist`. AT-80, PRD-07 FR-28, FR-29; screen
 * spec PRD-07 section 3 item 10.
 *
 * FR-28: every price and stock figure is read LIVE at display time through the
 * same product mapper the browse grid uses, so a saved item can never quote a
 * price the PDP disagrees with. The `product_wishlist_items` read carries an
 * explicit `user_id` filter (`listWishlist`), because the joined `products` is
 * public browse and would happily return everyone's rows to an unscoped
 * select.
 *
 * FR-29: Move to Cart adds at qty 1 through `add_to_cart`, so it is subject to
 * the same FR-9 server side stock revalidation and capping as every other cart
 * write. A product with more than one variant asks which one first, because
 * there is no correct default size to pick on the shopper's behalf.
 *
 * AC-B1 / AC-B2: the PDP heart writes the same `product_wishlist_items` rows,
 * so toggling there is reflected here on the next load with no separate cache
 * to invalidate.
 */
export default function WishlistScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const wishlist = useWishlist(supabase);
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');

  const [state, setState] = useState<LoadState>('loading');
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [variantPicker, setVariantPicker] = useState<WishlistEntry | null>(null);

  const load = useCallback(async () => {
    if (!isSignedIn) {
      setState('empty');
      return;
    }
    setState('loading');
    setError(null);
    try {
      const rows = await wishlist.listWishlist();
      setEntries(rows);
      setState(rows.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRemove(productId: string) {
    setEntries((current) => current.filter((entry) => entry.productId !== productId));
    try {
      await wishlist.toggle(productId);
      await load();
    } catch (err) {
      setError(toApiError(err));
      await load();
    }
  }

  async function addVariantToCart(variant: ShopVariant) {
    setVariantPicker(null);
    setNotice(null);
    try {
      const result = await shop.addToCart(variant.id, 1);
      setNotice(
        result.capped
          ? `Only ${result.availableStock} left, so your cart has ${result.qty}.`
          : 'Moved to your cart.',
      );
      await load();
    } catch (err) {
      const apiError = toApiError(err);
      setNotice(
        apiError.code === 'OUT_OF_STOCK'
          ? 'That one just sold out. Try another size.'
          : apiError.message || 'Could not move this to your cart.',
      );
    }
  }

  function handleMoveToCart(entry: WishlistEntry) {
    const buyable = entry.product.variants.filter((variant) => variant.availableStock > 0);
    if (buyable.length === 0) {
      setNotice('This gear is out of stock right now.');
      return;
    }
    // FR-29: variant selection is required when the product has more than one.
    if (buyable.length === 1) {
      void addVariantToCart(buyable[0]);
      return;
    }
    setVariantPicker(entry);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="My wishlist" onPressBack={() => router.back()} />

      {notice ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: colors.accentTint,
              padding: spacing.md,
            }}
          >
            <Check size={16} strokeWidth={2} color={colors.accent} />
            <Text style={[textStyle('caption'), { color: colors.accent, flex: 1 }]}>{notice}</Text>
          </View>
        </View>
      ) : null}

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View className="flex-row gap-md">
            <Skeleton shape="card" height={200} className="flex-1" />
            <Skeleton shape="card" height={200} className="flex-1" />
          </View>
          <View className="flex-row gap-md">
            <Skeleton shape="card" height={200} className="flex-1" />
            <Skeleton shape="card" height={200} className="flex-1" />
          </View>
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Couldn't load your wishlist
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' ? (
        <EmptyState
          icon={HeartOff}
          title="Nothing saved yet"
          body="Tap the heart on any gear and it waits for you here, with live prices."
          ctaLabel="Browse gear"
          onCtaPress={() => router.push('/shop/category/all')}
        />
      ) : (
        <WishlistGrid
          variant="product"
          items={entries.map((entry) => ({
            kind: 'product' as const,
            id: entry.productId,
            title: entry.product.title,
            price: entry.product.priceFrom,
            imageUrl: entry.product.imageUrl,
            availableStock: entry.product.availableStock,
            onPress: () => router.push({ pathname: '/shop/product/[id]', params: { id: entry.productId } }),
            onRemove: () => void handleRemove(entry.productId),
            onMoveToCart: () => handleMoveToCart(entry),
          }))}
        />
      )}

      {/* FR-29's variant selection. A plain RN Modal, which react-native-web
       * genuinely implements, so this works on both targets. */}
      <Modal
        visible={variantPicker !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setVariantPicker(null)}
      >
        <Pressable
          accessibilityLabel="Close"
          style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
          onPress={() => setVariantPicker(null)}
        >
          <Pressable onPress={(event) => event.stopPropagation()}>
            <View
              style={{
                borderTopLeftRadius: radii['2xl'],
                borderTopRightRadius: radii['2xl'],
                backgroundColor: colors.surface,
                padding: spacing.xl,
                paddingBottom: spacing['3xl'],
                gap: spacing.md,
              }}
            >
              <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a size</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                {variantPicker?.product.title}
              </Text>
              <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: spacing.sm }}>
                {(variantPicker?.product.variants ?? [])
                  .filter((variant) => variant.availableStock > 0)
                  .map((variant) => (
                    <Pressable
                      key={variant.id}
                      accessibilityRole="button"
                      onPress={() => void addVariantToCart(variant)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: 56,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                      }}
                    >
                      <View style={{ flex: 1, gap: spacing.xs }}>
                        <Text style={[textStyle('label'), { color: colors.text }]}>{variantLabel(variant)}</Text>
                        <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>
                          {variant.availableStock} in stock
                        </Text>
                      </View>
                      <Text style={[textStyle('numericBase'), { color: colors.text }]}>
                        {formatINR(variant.price)}
                      </Text>
                    </Pressable>
                  ))}
              </ScrollView>
              <Button variant="secondary" onPress={() => setVariantPicker(null)}>
                <Text style={{ color: colors.text }}>Cancel</Text>
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
