import { cn } from '@/lib/utils';
import * as Haptics from 'expo-haptics';
import { formatINR } from '@atlitos/theme';
import { Heart, Minus, Package, Plus, ShoppingCart } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 21: ProductCard. image, title, price, Add to Cart, wishlist
 * heart. `grid` (default) stacks vertically for 2-col grids, `row` lays
 * out horizontally for list results, `cartLine` swaps the Add to Cart
 * action for a quantity stepper.
 */
export type ProductCardVariant = 'grid' | 'row' | 'cartLine';

export interface ProductCardProps {
  /** Optional: a product with no `product_media` row yet renders a token
   * driven placeholder rather than a broken image box. The gear media bucket
   * lands with PRD-04's admin catalog CRUD (AT-81), so a seeded but
   * un-photographed catalog is a real state this card has to survive. */
  imageUri?: string;
  title: string;
  price: number;
  originalPrice?: number;
  wishlisted?: boolean;
  quantity?: number;
  variant?: ProductCardVariant;
  onPress?: () => void;
  onAddToCart?: () => void;
  onToggleWishlist?: () => void;
  onQuantityChange?: (quantity: number) => void;
  className?: string;
}

function ProductCard({
  imageUri,
  title,
  price,
  originalPrice,
  wishlisted,
  quantity = 1,
  variant = 'grid',
  onPress,
  onAddToCart,
  onToggleWishlist,
  onQuantityChange,
  className,
}: ProductCardProps) {
  const colors = useThemeColors();
  const isRow = variant === 'row' || variant === 'cartLine';

  const priceBlock = (
    <View className="flex-row items-center gap-xs">
      <Text className="font-mono-semibold text-base text-text">{formatINR(price)}</Text>
      {originalPrice && originalPrice > price ? (
        // text-secondary, not tertiary: sits on bg-card, textTertiary fails
        // AA contrast against the card surface in dark mode.
        <Text className="font-mono text-xs text-text-secondary line-through">
          {formatINR(originalPrice)}
        </Text>
      ) : null}
    </View>
  );

  return (
    // Pressable overlay card, see docs/design/DESIGN-LANGUAGE.md. The card is a
    // plain View; the card level press is an absolutely filled Pressable
    // sibling that sits under the wishlist heart, the Add to cart button and
    // the quantity stepper, so no action control is ever a descendant of
    // another pressable.
    <View
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card',
        isRow ? 'flex-row' : 'flex-col',
        className,
      )}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={title}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View pointerEvents="none" className={cn(isRow ? 'h-24 w-24' : 'w-full')}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            className={cn(isRow ? 'h-24 w-24 rounded-lg' : 'h-32 w-full rounded-t-xl')}
            resizeMode="cover"
          />
        ) : (
          <View
            accessibilityLabel="Product photo coming soon"
            className={cn(
              'items-center justify-center bg-surface-muted',
              isRow ? 'h-24 w-24 rounded-lg' : 'h-32 w-full rounded-t-xl',
            )}
          >
            <Package size={isRow ? 24 : 32} strokeWidth={1.75} color={colors.textTertiary} />
          </View>
        )}
      </View>

      {variant === 'grid' ? (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
              // Haptics unavailable, not fatal.
            });
            onToggleWishlist?.();
          }}
          accessibilityRole="button"
          accessibilityLabel={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          style={{ zIndex: 1 }}
          className="absolute right-xs top-xs h-11 w-11 items-center justify-center rounded-pill bg-surface"
        >
          <Heart
            size={18}
            strokeWidth={1.75}
            color={wishlisted ? colors.danger : colors.textSecondary}
            fill={wishlisted ? colors.danger : 'transparent'}
          />
        </Pressable>
      ) : null}

      <View
        pointerEvents="box-none"
        style={{ zIndex: 1 }}
        className={cn('gap-sm p-lg', isRow && 'flex-1 justify-center')}
      >
        <View pointerEvents="none" className="gap-sm">
          <Text className="font-sans-medium text-sm text-text" numberOfLines={2}>
            {title}
          </Text>

          {priceBlock}
        </View>

        {variant === 'grid' ? (
          <Button variant="ghost" size="sm" className="border border-border-strong" onPress={onAddToCart}>
            <ShoppingCart size={16} strokeWidth={1.75} color={colors.text} />
            <Text>Add to cart</Text>
          </Button>
        ) : null}

        {variant === 'cartLine' ? (
          <View className="flex-row items-center gap-md">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
                  // Haptics unavailable, not fatal.
                });
                onQuantityChange?.(Math.max(1, quantity - 1));
              }}
              accessibilityRole="button"
              className="h-11 w-11 items-center justify-center rounded-sm border border-border-strong active:bg-surface-muted"
            >
              <Minus size={16} strokeWidth={1.75} color={colors.text} />
            </Pressable>
            <View pointerEvents="none">
              <Text className="font-mono-semibold min-w-6 text-center text-base text-text">{quantity}</Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
                  // Haptics unavailable, not fatal.
                });
                onQuantityChange?.(quantity + 1);
              }}
              accessibilityRole="button"
              className="h-11 w-11 items-center justify-center rounded-sm border border-border-strong active:bg-surface-muted"
            >
              <Plus size={16} strokeWidth={1.75} color={colors.text} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export { ProductCard };
