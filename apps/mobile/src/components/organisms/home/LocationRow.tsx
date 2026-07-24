import { MapPin } from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useLocationStore } from '@/store/location-store';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's location row (PRD-01 3.2), sitting directly under the SearchBar.
 * Reads `useLocationStore`'s city, which already resolves to the
 * Hyderabad fallback on denial or failure (`location-store.ts`), so this row
 * never has an empty state of its own to handle.
 */
export function LocationRow() {
  const colors = useThemeColors();
  const city = useLocationStore((state) => state.city);

  return (
    <View className="flex-row items-center gap-xs">
      <MapPin size={16} color={colors.textSecondary} strokeWidth={1.75} />
      <Text className="font-sans text-sm text-text-secondary">{city}</Text>
    </View>
  );
}
