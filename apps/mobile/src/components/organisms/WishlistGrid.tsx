import { Button } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, spacing } from '@atlitos/theme';
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
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.md,
          }}
        >
          <View style={{ borderRadius: 12, backgroundColor: colors.surfaceMuted, aspectRatio: 1, overflow: 'hidden' }}>
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
                  borderRadius: 999,
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
            <Text style={[textStyle('numericBase'), { color: colors.text }]}>
              {formatINR((item as WishlistProductItem).price)}
            </Text>
          ) : (
            <UpaProgress item={item as WishlistUpaItem} />
          )}
        </Pressable>
      )}
    />
  );
}

function UpaProgress({ item }: { item: WishlistUpaItem }) {
  const colors = useThemeColors();
  const pct = item.cost > 0 ? Math.min(1, item.fundedAmount / item.cost) : 0;

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ height: 6, borderRadius: 999, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
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
