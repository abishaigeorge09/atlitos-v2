import { formatINR } from '@atlitos/theme';
import { Package, Store } from 'lucide-react-native';
import { Image, Pressable, View } from 'react-native';

import { freshnessLabel } from '@/components/ui/gear-result-card';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * GearResultTile, direction C (DIRECTION-SHOP.md): Amazon's result card.
 * A FLAT square image area (no corners, no border) on the white surface, so
 * retailer photos shot on white blend into the tile the way they do on Amazon,
 * with the product centred, then the text stack Amazon uses: brand bold,
 * title regular over up to three lines, the price larger than the title
 * with the old price struck through beside it and the saving named, the
 * retailer the price comes from, and freshness.
 *
 * Three sizes on the tile: 18 (price), 13 (brand, title), 12 (everything
 * else). The price is mono per the numeric rule and in ink. The only accent
 * is the store glyph before the retailer name.
 */
export interface GearResultTileProps {
  imageUri?: string | null;
  brand?: string | null;
  title: string;
  fromPrice: number | null;
  /** The retailer carrying the cheapest in stock offer. */
  retailer: string | null;
  storeCount: number;
  previousPrice?: number | null;
  checkedHoursAgo: number;
  onPress?: () => void;
}

function GearResultTile({ imageUri, brand, title, fromPrice, retailer, storeCount, previousPrice, checkedHoursAgo, onPress }: GearResultTileProps) {
  const colors = useThemeColors();
  const more = storeCount - 1;
  const storeLine = retailer === null ? 'No store has it in stock' : more > 0 ? `${retailer} & ${more} more` : retailer;
  const dropped = fromPrice !== null && previousPrice != null && previousPrice > fromPrice;
  const pctOff = dropped ? Math.round(((previousPrice! - fromPrice!) / previousPrice!) * 100) : 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${fromPrice === null ? 'out of stock' : formatINR(fromPrice)}, ${storeLine}`}
    >
      <View style={{ backgroundColor: colors.surface, aspectRatio: 1 }} className="w-full items-center justify-center">
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={{ width: '80%', height: '80%' }} resizeMode="contain" />
        ) : (
          <Package size={28} strokeWidth={1.5} color={colors.textTertiary} accessibilityLabel="No photo yet" />
        )}
      </View>

      <View className="gap-2xs pt-sm">
        {brand ? (
          <Text className="font-sans-semibold text-base" style={{ color: colors.text, lineHeight: 18 }} numberOfLines={1}>
            {brand}
          </Text>
        ) : null}
        <Text className="text-base" style={{ color: colors.text, lineHeight: 18 }} numberOfLines={3}>
          {title}
        </Text>

        <View className="flex-row flex-wrap items-baseline gap-xs pt-2xs">
          {fromPrice === null ? (
            <Text className="font-sans-semibold text-base" style={{ color: colors.textSecondary, lineHeight: 22 }}>
              Out of stock
            </Text>
          ) : (
            <Text style={[textStyle('numericBase'), { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '600' }]}>
              {formatINR(fromPrice)}
            </Text>
          )}
          {dropped ? (
            <Text className="text-sm" style={{ color: colors.textSecondary }}>
              <Text className="font-mono text-sm line-through" style={{ color: colors.textTertiary }}>
                {formatINR(previousPrice!)}
              </Text>
              {`  (${pctOff}% off)`}
            </Text>
          ) : null}
        </View>

        <View className="flex-row items-center gap-xs">
          <Store size={12} strokeWidth={2} color={retailer === null ? colors.textTertiary : colors.accent} />
          <Text className="text-sm" style={{ color: colors.textSecondary }} numberOfLines={1}>
            {storeLine}
          </Text>
        </View>
        <Text className="text-sm" style={{ color: colors.textTertiary }} numberOfLines={1}>
          {freshnessLabel(checkedHoursAgo)}
        </Text>
      </View>
    </Pressable>
  );
}

export { GearResultTile };
