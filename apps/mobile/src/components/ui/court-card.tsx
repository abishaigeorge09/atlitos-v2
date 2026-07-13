import { cn } from '@/lib/utils';
import { formatINR } from '@atlitos/theme';
import { MapPin } from 'lucide-react-native';
import { Image, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 20: CourtCard. image, stadium name, location, price per hour,
 * Book button.
 */
export interface CourtCardProps {
  imageUri: string;
  name: string;
  location: string;
  pricePerHour: number;
  onPress?: () => void;
  onBookPress?: () => void;
  className?: string;
}

function CourtCard({ imageUri, name, location, pricePerHour, onPress, onBookPress, className }: CourtCardProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={onPress}
      className={cn('overflow-hidden rounded-xl border border-border bg-card active:opacity-90', className)}
    >
      <Image source={{ uri: imageUri }} className="h-36 w-full rounded-t-xl" resizeMode="cover" />

      <View className="gap-sm p-lg">
        <Text className="font-sans-semibold text-lg text-text">{name}</Text>

        <View className="flex-row items-center gap-xs">
          <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
          <Text className="font-sans text-sm text-text-secondary">{location}</Text>
        </View>

        <View className="flex-row items-center justify-between pt-xs">
          <Text className="font-mono-semibold text-base text-text">
            {formatINR(pricePerHour)}
            <Text className="font-sans text-sm text-text-secondary">/hour</Text>
          </Text>

          <Button variant="primary" size="sm" onPress={onBookPress}>
            <Text>Book</Text>
          </Button>
        </View>
      </View>
    </Pressable>
  );
}

export { CourtCard };
