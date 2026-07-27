import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { Button } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import { Heart } from 'lucide-react-native';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

export interface WishlistProductItem {
  kind: 'product';
  id: string;
  title: string;
  price: number;
  imageUrl?: string;
  onPress: () => void;
  onRemove: () => void;
  /** PRD-07 FR-29's Move to Cart. Optional so the component still serves any
   * read only wishlist surface; when present it renders as the card's action,
   * mirroring the `upa` variant's Fund This. */
  onMoveToCart?: () => void;
  /** Live AVAILABLE stock at display time (FR-28), read from
   * `product_variant_availability`. Zero disables Move to Cart and labels the
   * card sold out instead. */
  availableStock?: number;
}

export interface WishlistUpaItem {
  kind: 'upa';
  id: string;
  title: string;
  cost: number;
  fundedAmount: number;
  imageUrl?: string;
  onPress: () => void;
  onFund: () => void;
  /** PRD-06 3.2 fully funded state: the item reached its cost, so Fund This is
   * replaced by a Funded marker rather than a live action (FR-5). */
  funded?: boolean;
}

export type WishlistItem = WishlistProductItem | WishlistUpaItem;

/**
 * SPEC.md organism #40. `variant: product` (heart-saved gear) or `upa`
 * (item + cost + funded progress + Fund This).
 */
export interface WishlistGridProps {
  variant: 'product' | 'upa';
  items: WishlistItem[];
  numColumns?: number;
  /** Rendered above the grid inside the SAME FlatList (the UPA profile passes
   * its story header here), so the whole screen is one scroller rather than a
   * FlatList nested in a ScrollView. */
  header?: ReactElement;
  /** Shown when `items` is empty (the profile with no wishlist yet). */
  emptyComponent?: ReactElement;
  /** Rendered below the grid inside the SAME FlatList (the UPA profile passes
   * its supporters and thank you notes here), keeping one scroller. */
  footer?: ReactElement;
  /** Passed straight to the FlatList so a screen using this grid as its one
   * scroller (the unified profile's wishlist tab) can offer pull to refresh. */
  refreshControl?: ReactElement<RefreshControlProps>;
}

export function WishlistGrid({ variant, items, numColumns = 2, header, emptyComponent, footer, refreshControl }: WishlistGridProps) {
  const colors = useThemeColors();

  return (
    <FlatList
      data={items}
      key={numColumns}
      numColumns={numColumns}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={emptyComponent}
      ListFooterComponent={footer}
      refreshControl={refreshControl}
      columnWrapperStyle={numColumns > 1 ? { gap: spacing.md } : undefined}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      renderItem={({ item }) => (
        // Pressable overlay card, see docs/design/DESIGN-LANGUAGE.md. The card
        // is a plain View so the remove heart and the Move to cart / Fund this
        // buttons are siblings of the card level press target, not descendants
        // of it.
        <View
          style={{
            flex: 1,
            gap: spacing.sm,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.md,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              item.onPress();
            }}
            style={StyleSheet.absoluteFill}
          />

          <View
            pointerEvents="box-none"
            style={{
              zIndex: 1,
              borderRadius: radii.md,
              backgroundColor: colors.surfaceMuted,
              aspectRatio: 1,
              overflow: 'hidden',
            }}
          >
            {item.imageUrl ? (
              <View pointerEvents="none" style={{ flex: 1 }}>
                <Image source={{ uri: item.imageUrl }} style={{ flex: 1 }} />
              </View>
            ) : null}
            {variant === 'product' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove from wishlist"
                hitSlop={8}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  (item as WishlistProductItem).onRemove();
                }}
                style={{
                  position: 'absolute',
                  top: spacing.xs,
                  right: spacing.xs,
                  height: 32,
                  width: 32,
                  borderRadius: radii.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.overlay,
                }}
              >
                <Heart size={16} color={colors.textInverse} fill={colors.danger} strokeWidth={1.75} />
              </Pressable>
            ) : null}
          </View>

          <View pointerEvents="none">
            <Text style={[textStyle('callout'), { color: colors.text }]} numberOfLines={2}>
              {item.title}
            </Text>
          </View>

          {variant === 'product' ? (
            <ProductActions item={item as WishlistProductItem} />
          ) : (
            <UpaProgress item={item as WishlistUpaItem} />
          )}
        </View>
      )}
    />
  );
}

/** Price, live stock state, and PRD-07 FR-29's Move to Cart. The stock line
 * reads AVAILABLE stock, never raw inventory, so a wishlisted item cannot
 * offer a unit the checkout would then refuse. */
function ProductActions({ item }: { item: WishlistProductItem }) {
  const colors = useThemeColors();
  const soldOut = item.availableStock !== undefined && item.availableStock === 0;

  return (
    <View pointerEvents="box-none" style={{ zIndex: 1, gap: spacing.xs }}>
      <View pointerEvents="none" style={{ gap: spacing.xs }}>
        <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(item.price)}</Text>
        {item.availableStock !== undefined ? (
          <Text style={[textStyle('numericSm'), { color: soldOut ? colors.danger : colors.textSecondary }]}>
            {soldOut ? 'Out of stock' : `${item.availableStock} in stock`}
          </Text>
        ) : null}
      </View>
      {item.onMoveToCart ? (
        <Button size="sm" disabled={soldOut} onPress={item.onMoveToCart}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Move to cart</Text>
        </Button>
      ) : null}
    </View>
  );
}

function UpaProgress({ item }: { item: WishlistUpaItem }) {
  const colors = useThemeColors();
  const pct = item.cost > 0 ? Math.min(1, item.fundedAmount / item.cost) : 0;

  return (
    <View pointerEvents="box-none" style={{ zIndex: 1, gap: spacing.xs }}>
      <View pointerEvents="none" style={{ gap: spacing.xs }}>
        <View style={{ height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
          <View style={{ height: 6, width: `${pct * 100}%`, backgroundColor: colors.accent }} />
        </View>
        <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>
          {formatINR(item.fundedAmount)} of {formatINR(item.cost)}
        </Text>
      </View>
      {item.funded ? (
        <View
          pointerEvents="none"
          style={{
            minHeight: 36,
            borderRadius: radii.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.successTint,
          }}
        >
          <Text style={[textStyle('label'), { color: colors.success }]}>Funded</Text>
        </View>
      ) : (
        <Button size="sm" onPress={item.onFund}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Fund this</Text>
        </Button>
      )}
    </View>
  );
}
