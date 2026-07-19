import { cn } from '@/lib/utils';
import { formatINR } from '@atlitos/theme';
import { MapPin, Star } from 'lucide-react-native';
import { Image, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 19: CoachCard. avatar, name, rating, sport, experience,
 * price-from, distance. Row-style card for search/list results.
 */
export interface CoachCardProps {
  avatarUri?: string;
  name: string;
  rating: number;
  sport: string;
  experienceYears: number;
  /** Undefined when the coach has no active session type priced yet
   * (freshly verified profile); the price row is omitted rather than
   * showing a misleading "From ₹0". Phase 3 coaching-slice addition,
   * backward compatible with every existing caller (mirrors CourtCard's
   * own optional `distanceKm`, same reasoning). */
  priceFrom?: number;
  /** `coach_profiles` carries no lat/lng (SCHEMA.md), unlike `venues`, so
   * this is genuinely never computable the way CourtCard's is; falls back
   * to rendering `city` as plain text instead of a distance. */
  distanceKm?: number;
  city?: string;
  onPress?: () => void;
  className?: string;
}

function CoachCard({
  avatarUri,
  name,
  rating,
  sport,
  experienceYears,
  priceFrom,
  distanceKm,
  city,
  onPress,
  className,
}: CoachCardProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row gap-md rounded-xl border border-border bg-card p-lg active:opacity-90',
        className,
      )}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} className="h-14 w-14 rounded-pill" />
      ) : (
        <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-muted">
          <Text className="font-sans-semibold text-lg text-text-secondary">{name.charAt(0)}</Text>
        </View>
      )}

      <View className="flex-1 gap-xs">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-lg text-text">{name}</Text>
          <View className="flex-row items-center gap-xs">
            <Star size={14} strokeWidth={1.75} color={colors.warning} fill={colors.warning} />
            <Text className="font-mono text-sm text-text">{rating.toFixed(1)}</Text>
          </View>
        </View>

        <Text className="font-sans text-sm text-text-secondary">
          {sport}, {experienceYears} yrs experience
        </Text>

        <View className="flex-row items-center justify-between pt-xs">
          {priceFrom !== undefined ? (
            <Text className="font-mono-semibold text-sm text-accent">
              From {formatINR(priceFrom)}
            </Text>
          ) : (
            <Text className="font-sans text-sm text-text-tertiary">Pricing coming soon</Text>
          )}
          <View className="flex-row items-center gap-xs">
            {/* Icon can stay textTertiary (icons only need the 3:1 non-text
                minimum), but the distance text sits on bg-card and needs
                text-secondary to clear AA in dark mode. */}
            <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
            {distanceKm !== undefined ? (
              <Text className="font-mono text-xs text-text-secondary">{distanceKm} km</Text>
            ) : (
              <Text className="font-sans text-xs text-text-secondary">{city}</Text>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export { CoachCard };
