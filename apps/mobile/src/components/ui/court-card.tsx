import { cn } from '@/lib/utils';
import { formatINR } from '@atlitos/theme';
import { LandPlot, MapPin } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
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
 * for its own `distanceKm`.
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
    <View className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={name}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View pointerEvents="none">
        {imageUri ? (
          <Image source={{ uri: imageUri }} className="h-36 w-full rounded-t-xl" resizeMode="cover" />
        ) : (
          <View className="h-36 w-full items-center justify-center rounded-t-xl bg-surface-muted">
            <LandPlot size={32} strokeWidth={1.75} color={colors.textTertiary} />
          </View>
        )}
      </View>

      <View pointerEvents="box-none" style={{ zIndex: 1 }} className="gap-sm p-lg">
        <View pointerEvents="none" className="gap-sm">
          <Text className="font-sans-semibold text-lg text-text">{name}</Text>

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

        <View pointerEvents="box-none" className="flex-row items-center justify-between pt-xs">
          <View pointerEvents="none">
            <Text className="font-mono-semibold text-base text-text">
              {formatINR(pricePerHour)}
              <Text className="font-sans text-sm text-text-secondary">/hour</Text>
            </Text>
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
