import { formatINR } from '@atlitos/theme';
import { Package } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * GearResultCard. The affiliate result tile for the shop grid (PRD-07 s11,
 * FR-40/FR-41, DIRECTION-SHOP.md). Four lines in a fixed order: image tile,
 * title, "from" price, store count with freshness. The price is the ONE
 * accent on the card and the only mono text: that is the signature move.
 *
 * `fromPrice` is the cheapest in stock offer read from product_offers at
 * display time; `null` means no offer is in stock and the card says so
 * rather than showing a number it cannot stand behind (FR-38).
 */
export interface GearResultCardProps {
  imageUri?: string | null;
  title: string;
  brand?: string | null;
  fromPrice: number | null;
  storeCount: number;
  /** Hours since the cheapest offer was last checked. */
  checkedHoursAgo: number;
  onPress?: () => void;
  className?: string;
}

/** `null` covers an offer the nightly check has never reached yet (Phase S3,
 * FR-41/FR-48, `product_offers.last_checked_at` before its first run); every
 * numeric caller is unaffected. */
export function freshnessLabel(hours: number | null): string {
  if (hours === null) return 'not checked yet';
  if (hours < 1) return 'checked just now';
  if (hours < 24) return `checked ${Math.round(hours)} h ago`;
  const days = Math.round(hours / 24);
  return `checked ${days} day${days === 1 ? '' : 's'} ago`;
}

function GearResultCard({
  imageUri,
  title,
  brand,
  fromPrice,
  storeCount,
  checkedHoursAgo,
  onPress,
  className,
}: GearResultCardProps) {
  const colors = useThemeColors();
  const stores = `${storeCount} store${storeCount === 1 ? '' : 's'}`;

  return (
    <View
      style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}
      className={cn('overflow-hidden rounded-xl', className)}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${fromPrice === null ? 'no store has it in stock' : `from ${formatINR(fromPrice)}`}, ${stores}`}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View style={{ pointerEvents: 'none', backgroundColor: colors.surfaceMuted }} className="h-36 w-full items-center justify-center">
        {imageUri ? (
          <Image source={{ uri: imageUri }} className="h-36 w-full" resizeMode="contain" />
        ) : (
          <Package size={32} strokeWidth={1.75} color={colors.textTertiary} accessibilityLabel="No photo yet" />
        )}
      </View>

      <View style={{ pointerEvents: 'none' }} className="gap-xs p-sm">
        {brand ? (
          <Text className="text-xs" style={{ color: colors.textSecondary }} numberOfLines={1}>
            {brand}
          </Text>
        ) : null}
        <Text className="text-sm" style={{ color: colors.text }} numberOfLines={2}>
          {title}
        </Text>
        {fromPrice === null ? (
          <Text className="font-sans-semibold text-sm" style={{ color: colors.textTertiary, lineHeight: 30 }}>
            Out of stock
          </Text>
        ) : (
          <Text style={[textStyle('numericLg'), { color: colors.accent }]}>{formatINR(fromPrice)}</Text>
        )}
        <Text className="text-xs" style={{ color: colors.textTertiary }} numberOfLines={1}>
          {stores}, {freshnessLabel(checkedHoursAgo)}
        </Text>
      </View>
    </View>
  );
}

export { GearResultCard };
