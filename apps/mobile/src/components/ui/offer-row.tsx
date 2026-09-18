import { formatINR } from '@atlitos/theme';
import { ExternalLink } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { freshnessLabel } from '@/components/ui/gear-result-card';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * OfferRow. One retailer line on the compare screen (PRD-07 FR-35 to FR-37,
 * DIRECTION-SHOP.md). Retailer name, price right aligned and heavy, a quiet
 * second line for stock and freshness, and the click-out. The cheapest in
 * stock row is the ONE accent on the screen (its price); its border is the
 * strong border token, never the accent, so the accent count stays at one. An
 * out of stock row is dimmed and has no buy action, so a price the shopper
 * cannot buy is never presented as buyable (FR-36).
 */
export interface OfferRowProps {
  retailer: string;
  price: number;
  inStock: boolean;
  cheapest?: boolean;
  checkedHoursAgo: number;
  /** Set when the nightly recheck saw a drop; rendered struck through beside the price. */
  previousPrice?: number | null;
  onBuy?: () => void;
  /** Direction B: body-sized price in ink, the word Cheapest as the one accent. */
  dense?: boolean;
}

function OfferRow({ retailer, price, inStock, cheapest = false, checkedHoursAgo, previousPrice, onBuy, dense = false }: OfferRowProps) {
  const colors = useThemeColors();
  const priceColor = !inStock ? colors.textTertiary : cheapest && !dense ? colors.accent : colors.text;

  return (
    <View
      style={{ backgroundColor: colors.card, borderColor: cheapest && inStock && !dense ? colors.borderStrong : colors.border, borderWidth: 1, opacity: inStock ? 1 : 0.6 }}
      className={dense ? 'flex-row items-center gap-md rounded-lg px-md py-sm' : 'flex-row items-center gap-md rounded-xl p-md'}
    >
      <View className="flex-1 gap-2xs">
        <View className="flex-row items-center gap-xs">
          <Text className={dense ? 'font-sans-semibold text-base' : 'font-sans-semibold text-sm'} style={{ color: colors.text }}>
            {retailer}
          </Text>
          {dense && cheapest && inStock ? (
            <Text className="font-sans-semibold text-sm" style={{ color: colors.accent }}>
              Cheapest
            </Text>
          ) : null}
        </View>
        <Text className="text-xs" style={{ color: inStock ? colors.success : colors.warning }}>
          {inStock ? 'In stock' : 'Out of stock'}
          <Text className="text-xs" style={{ color: colors.textTertiary }}>
            {`, ${freshnessLabel(checkedHoursAgo)}`}
          </Text>
        </Text>
      </View>

      <View className="items-end gap-2xs">
        <View className="flex-row items-baseline gap-xs">
          {previousPrice && previousPrice > price ? (
            <Text className="font-mono text-xs line-through" style={{ color: colors.textTertiary }}>
              {formatINR(previousPrice)}
            </Text>
          ) : null}
          <Text style={[textStyle(dense ? 'numericSm' : 'numericLg'), { color: priceColor, fontWeight: dense ? '600' : undefined }]}>
            {formatINR(price)}
          </Text>
        </View>
        {inStock ? (
          <Pressable
            onPress={onBuy}
            accessibilityRole="link"
            accessibilityLabel={`Buy on ${retailer}`}
            className="flex-row items-center gap-xs"
          >
            <Text className="font-sans-semibold text-xs" style={{ color: colors.text }}>
              Buy on {retailer}
            </Text>
            <ExternalLink size={14} strokeWidth={1.75} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export { OfferRow };
