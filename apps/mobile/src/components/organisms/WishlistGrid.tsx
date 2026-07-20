import { Button } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import { Heart } from 'lucide-react-native';
import { FlatList, Image, Pressable, Text, View } from 'react-native';

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
}

export function WishlistGrid({ variant, items, numColumns = 2 }: WishlistGridProps) {
  const colors = useThemeColors();

  return (
    <FlatList
      data={items}
      key={numColumns}
      numColumns={numColumns}
      keyExtractor={(item) => item.id}
      columnWrapperStyle={numColumns > 1 ? { gap: spacing.md } : undefined}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            item.onPress();
          }}
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
          <View style={{ borderRadius: radii.md, backgroundColor: colors.surfaceMuted, aspectRatio: 1, overflow: 'hidden' }}>
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ flex: 1 }} /> : null}
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

          <Text style={[textStyle('callout'), { color: colors.text }]} numberOfLines={2}>
            {item.title}
          </Text>

          {variant === 'product' ? (
            <ProductActions item={item as WishlistProductItem} />
          ) : (
            <UpaProgress item={item as WishlistUpaItem} />
          )}
        </Pressable>
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
    <View style={{ gap: spacing.xs }}>
      <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(item.price)}</Text>
      {item.availableStock !== undefined ? (
        <Text style={[textStyle('numericSm'), { color: soldOut ? colors.danger : colors.textSecondary }]}>
          {soldOut ? 'Out of stock' : `${item.availableStock} in stock`}
        </Text>
      ) : null}
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
    <View style={{ gap: spacing.xs }}>
      <View style={{ height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
        <View style={{ height: 6, width: `${pct * 100}%`, backgroundColor: colors.accent }} />
      </View>
      <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>
        {formatINR(item.fundedAmount)} of {formatINR(item.cost)}
      </Text>
      <Button size="sm" onPress={item.onFund}>
        <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Fund this</Text>
      </Button>
    </View>
  );
}
