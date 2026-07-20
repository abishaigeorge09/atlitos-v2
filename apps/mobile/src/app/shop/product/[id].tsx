import { useShop, useWishlist, variantLabel, toApiError, type ShopProduct, type ShopVariant } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Heart, Package, PackageX, ShoppingCart, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useGuestWishlist } from '@/store/guest-wishlist';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ProductParams = { id: string };

type LoadState = 'loading' | 'populated' | 'notFound' | 'error';

/**
 * Product Detail, `/shop/product/[id]`. AT-75, PRD-07 FR-4, FR-5, FR-6, FR-7;
 * screen spec PRD-07 section 3 item 2.
 *
 * FR-4: every variant carries its own price and its own AVAILABLE stock,
 * individually visible before adding to cart (AC-A2). Those numbers come from
 * `product_variant_availability`, the one definition of what a shopper may
 * buy; this screen never reads `product_variants.stock`, which is raw
 * inventory and would let the PDP promise units the checkout would then
 * refuse (PHASE-4-STATUS.md D2).
 *
 * FR-5 / AC-A3: selecting a zero stock variant disables Add to Cart and shows
 * an inline out of stock notice, without blocking the rest of the PDP.
 *
 * FR-6: the heart toggles through `toggle_product_wishlist`, an atomic
 * insert-or-delete, so a double tap cannot race itself.
 *
 * FR-7 / AC-B3: a guest browses freely and their heart saves locally with no
 * auth prompt. Add to Cart is the gated action, and it raises the existing
 * LoginGateModal rather than a raw permission error.
 */
export default function ProductDetailScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const wishlist = useWishlist(supabase);
  const params = useLocalSearchParams<ProductParams>();

  const isGuest = useSessionStore((state) => state.status === 'guest');
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');
  const guestWishlist = useGuestWishlist();
  const guestSavedIds = useGuestWishlist((store) => store.productIds);

  const [state, setState] = useState<LoadState>('loading');
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [gateVisible, setGateVisible] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [addError, setAddError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const row = await shop.getProduct(params.id);
      if (!row) {
        setState('notFound');
        return;
      }
      setProduct(row);
      // Preselect the first variant that can actually be bought, so the
      // default state of the screen is a buyable one wherever possible.
      const firstInStock = row.variants.find((variant) => variant.availableStock > 0);
      setSelectedVariantId(firstInStock?.id ?? row.variants[0]?.id ?? null);
      setState('populated');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [params.id]);

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
      .then((ids) => setSaved(ids.includes(params.id)))
      .catch(() => {
        // Not fatal; the heart renders unsaved until the next load.
      });
  }, [isGuest, isSignedIn, params.id]);

  const isSaved = isGuest ? guestSavedIds.includes(params.id) : saved;
  const selectedVariant = product?.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const outOfStock = selectedVariant !== null && selectedVariant.availableStock === 0;

  async function handleToggleWishlist() {
    if (isGuest) {
      await guestWishlist.toggle(params.id);
      return;
    }
    if (!isSignedIn) {
      setGateVisible(true);
      return;
    }
    const wasSaved = saved;
    setSaved(!wasSaved);
    try {
      setSaved(await wishlist.toggle(params.id));
    } catch {
      setSaved(wasSaved);
    }
  }

  async function handleAddToCart() {
    // FR-7's guest gate. Add to Cart requires authentication; browsing and the
    // local wishlist do not.
    if (!isSignedIn) {
      setGateVisible(true);
      return;
    }
    if (!selectedVariant || outOfStock) return;

    setAdding(true);
    setAddError(null);
    setAddNotice(null);
    try {
      const result = await shop.addToCart(selectedVariant.id, 1);
      // FR-9: the RPC caps rather than silently rounding up, and the shopper
      // has to be told when it did.
      setAddNotice(
        result.capped
          ? `Only ${result.availableStock} left, so your cart has ${result.qty}.`
          : 'Added to your cart.',
      );
      // Availability moved, so re-read it rather than trusting what this
      // screen loaded a moment ago.
      void load();
    } catch (err) {
      setAddError(toApiError(err));
    } finally {
      setAdding(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={260} />
          <Skeleton shape="line" width="70%" height={24} />
          <Skeleton shape="line" width="35%" />
          <Skeleton shape="line" width="90%" />
          <Skeleton shape="line" width="80%" />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'notFound' || state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View
          style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}
        >
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {state === 'notFound' ? 'This gear is no longer listed' : "Couldn't load this gear"}
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {state === 'notFound'
              ? 'It may have sold out or been delisted. Browse the rest of the catalog.'
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="back" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}>
        <Gallery imageUrls={product.imageUrls} />

        <View style={{ gap: spacing.xs }}>
          <View className="flex-row items-start justify-between gap-md">
            <Text style={[textStyle('h2'), { color: colors.text, flex: 1 }]}>{product.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
              onPress={() => void handleToggleWishlist()}
              className="h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted"
            >
              <Heart
                size={22}
                strokeWidth={1.75}
                color={isSaved ? colors.danger : colors.textSecondary}
                fill={isSaved ? colors.danger : 'transparent'}
              />
            </Pressable>
          </View>
          {product.categoryName ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{product.categoryName}</Text>
          ) : null}
          <Text style={[textStyle('numericLg'), { color: colors.text }]}>
            {formatINR(selectedVariant?.price ?? product.priceFrom)}
          </Text>
        </View>

        {/* FR-4 / AC-A2: each variant's own price and stock, visible before
         * adding to cart. Every figure is AVAILABLE stock from the view. */}
        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Select a size</Text>
          {product.variants.length === 0 ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              No sizes listed for this gear yet.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {product.variants.map((variant) => (
                <VariantRow
                  key={variant.id}
                  variant={variant}
                  selected={variant.id === selectedVariantId}
                  onPress={() => {
                    setSelectedVariantId(variant.id);
                    setAddNotice(null);
                    setAddError(null);
                  }}
                />
              ))}
            </View>
          )}
        </View>

        {product.description ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Details</Text>
            <Text style={[textStyle('body'), { color: colors.textSecondary }]}>{product.description}</Text>
          </View>
        ) : null}

        {/* FR-5 / AC-A3: inline out of stock notice for the selected variant.
         * It explains the disabled CTA below without hiding the PDP. */}
        {outOfStock ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: colors.dangerTint,
              padding: spacing.md,
            }}
          >
            <PackageX size={18} strokeWidth={1.75} color={colors.danger} />
            <Text style={[textStyle('callout'), { color: colors.danger, flex: 1 }]}>
              This size is out of stock. Pick another size, or check back soon.
            </Text>
          </View>
        ) : null}

        {addNotice ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: colors.successTint,
              padding: spacing.md,
            }}
          >
            <Check size={18} strokeWidth={2} color={colors.success} />
            <Text style={[textStyle('callout'), { color: colors.success, flex: 1 }]}>{addNotice}</Text>
          </View>
        ) : null}

        {addError ? (
          <View className="flex-row items-center gap-xs">
            <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
            <Text className="flex-1 font-sans text-sm text-danger">
              {addError.code === 'OUT_OF_STOCK'
                ? 'That size just sold out. Pick another size.'
                : addError.message || 'Could not add this to your cart.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm }}>
        <Button loading={adding} disabled={!selectedVariant || outOfStock} onPress={() => void handleAddToCart()}>
          <ShoppingCart size={18} strokeWidth={1.75} color={colors.inkOnAccent} />
          <Text style={{ color: colors.inkOnAccent }}>Add to cart</Text>
        </Button>
        <Button variant="secondary" onPress={() => router.push('/shop/cart')}>
          <Text style={{ color: colors.text }}>Go to cart</Text>
        </Button>
      </View>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}

/** Image gallery. A product with no media row yet renders a token driven
 * placeholder rather than a broken image; the gear bucket lands with PRD-04's
 * admin catalog CRUD. Gesture driven zoom is deferred to the P8 native pass
 * per PHASE-4-STATUS.md D5. */
function Gallery({ imageUrls }: { imageUrls: string[] }) {
  const colors = useThemeColors();

  if (imageUrls.length === 0) {
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

  return (
    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ borderRadius: radii.xl }}>
      {imageUrls.map((uri) => (
        <Image key={uri} source={{ uri }} style={{ height: 260, width: 320, borderRadius: radii.xl }} resizeMode="cover" />
      ))}
    </ScrollView>
  );
}

/** One variant row: label, its own price, and its own available stock state.
 * The stock count is a numeric readout, so it renders in JetBrains Mono with
 * tabular figures like every other number in the app. */
function VariantRow({
  variant,
  selected,
  onPress,
}: {
  variant: ShopVariant;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const soldOut = variant.availableStock === 0;
  const low = !soldOut && variant.availableStock <= 3;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: soldOut }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        minHeight: 56,
        borderRadius: radii.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: colors.card,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        opacity: soldOut ? 0.6 : 1,
      }}
    >
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={[textStyle('label'), { color: colors.text }]}>{variantLabel(variant)}</Text>
        <Text
          style={[
            textStyle('numericSm'),
            { color: soldOut ? colors.danger : low ? colors.warning : colors.textSecondary },
          ]}
        >
          {soldOut ? 'Out of stock' : `${variant.availableStock} in stock`}
        </Text>
      </View>
      <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(variant.price)}</Text>
      {selected ? <Check size={18} strokeWidth={2.5} color={colors.accent} /> : null}
    </Pressable>
  );
}
