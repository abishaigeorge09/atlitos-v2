import { cn } from '@/lib/utils';
import { LandPlot, MapPin } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { PriceText } from '@/components/ui/price-text';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 20: CourtCard. image, stadium name, location, price per hour,
 * Book button. `imageUri`/`distanceKm` are Phase 2 courts-slice additions
 * (both optional, backward compatible with every existing caller): real
 * venues can have zero photos uploaded yet (falls back to a LandPlot glyph
 * tile rather than an `<Image>` with an empty `uri`, which would render a
 * blank box), and the list screen sorts/labels by distance from the
 * location store, the same mono numeric convention CoachCard already uses
 * for its own `distanceKm`. D18: the price row rendered the amount as a bare
 * string sibling nested inside the same className'd `<Text>` as the "/hour"
 * label (`<Text>{formatINR(...)}<Text>/hour</Text></Text>`). On web that
 * left only the "/hour" span in the DOM, the leading amount never rendered,
 * while the court detail screen (PRD-01 3.5), which renders the identical
 * `basePricePerHour` value through `PriceText` as a sibling next to a plain
 * "per hour" `Text` rather than nested inside it, has always shown the price
 * correctly. Fixed by matching that working composition: `PriceText` and
 * "/hour" as siblings in a row, not one nested in the other. Name color
 * also sourced from the JS-resolved theme (colors.text) rather than the
 * `text-text` Tailwind class, matching the FB-002 fix already applied to
 * this card's surface/border.
 */
export interface CourtCardProps {
  imageUri?: string;
  name: string;
  location: string;
  pricePerHour: number;
  distanceKm?: number;
  onPress?: () => void;
  onBookPress?: () => void;
  className?: string;
}

function CourtCard({
  imageUri,
  name,
  location,
  pricePerHour,
  distanceKm,
  onPress,
  onBookPress,
  className,
}: CourtCardProps) {
  const colors = useThemeColors();

  return (
    // Pressable overlay card, see docs/design/DESIGN-LANGUAGE.md. The card is a
    // plain View so Book is a sibling of the card level press target, not a
    // button nested inside another button.
    // bg-card/border-border are shadcn compat slots (var(--card) -> hsl(var(--color-card))),
    // a double-nested CSS var nativewind's native runtime does not re-resolve on the dark
    // toggle, so they stayed at the light #FFFFFF/cream value in dark mode (FB-002). Source
    // the card surface + border from the JS-resolved theme instead, matching the chrome.
    <View
      style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}
      className={cn('overflow-hidden rounded-xl', className)}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={name}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View style={{ pointerEvents: 'none' }}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} className="h-36 w-full rounded-t-xl" resizeMode="cover" />
        ) : (
          <View
            style={{ backgroundColor: colors.surfaceMuted }}
            className="h-36 w-full items-center justify-center rounded-t-xl"
          >
            <LandPlot size={32} strokeWidth={1.75} color={colors.textTertiary} />
          </View>
        )}
      </View>

      <View style={{ pointerEvents: 'box-none', zIndex: 1 }} className="gap-sm p-lg">
        <View style={{ pointerEvents: 'none' }} className="gap-sm">
          <Text style={{ color: colors.text }} className="font-sans-semibold text-lg">
            {name}
          </Text>

          <View className="flex-row items-center gap-xs">
          <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
          <Text className="flex-1 font-sans text-sm text-text-secondary" numberOfLines={1}>
            {location}
          </Text>
          {distanceKm !== undefined ? (
            <Text className="font-mono text-xs text-text-secondary">{distanceKm.toFixed(1)} km</Text>
          ) : null}
          </View>
        </View>

        <View style={{ pointerEvents: 'box-none' }} className="flex-row items-center justify-between pt-xs">
          <View style={{ pointerEvents: 'none' }} className="flex-row items-baseline gap-xs">
            <PriceText amount={pricePerHour} size="base" />
            <Text className="font-sans text-sm text-text-secondary">/hour</Text>
          </View>

          <Button variant="primary" size="sm" onPress={onBookPress}>
            <Text>Book</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}

export { CourtCard };
