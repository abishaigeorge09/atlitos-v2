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
  priceFrom: number;
  distanceKm: number;
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
          <Text className="font-mono-semibold text-sm text-accent">
            From {formatINR(priceFrom)}
          </Text>
          <View className="flex-row items-center gap-xs">
            <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
            <Text className="font-mono text-xs text-text-tertiary">{distanceKm} km</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export { CoachCard };
