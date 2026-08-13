import { MapPin, MapPinOff } from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useLocationStore } from '@/store/location-store';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's location row (PRD-01 3.2), sitting directly under the SearchBar.
 *
 * Track 3 sweep. This used to read `city` alone and render it flat, on the
 * reasoning that the store "already resolves to the Hyderabad fallback on
 * denial or failure, so this row never has an empty state of its own". That is
 * true of the VALUE and false of the CLAIM: it presented an untried default,
 * a denial fallback and a real GPS fix identically, so a player in Chennai who
 * declined the prompt read a confident "Hyderabad" with nothing saying why.
 * The row now distinguishes the three, and stays a single line while doing it.
 * The actions (retry, Settings, name a city) live on the browse surfaces that
 * actually sort by location, not on Home.
 */
export function LocationRow() {
  const colors = useThemeColors();
  const city = useLocationStore((state) => state.city);
  const status = useLocationStore((state) => state.status);

  const unresolved = status === 'denied' || status === 'unavailable' || status === 'idle';

  return (
    <View className="flex-row items-center gap-xs">
      {unresolved ? (
        <MapPinOff size={16} color={colors.textSecondary} strokeWidth={1.75} />
      ) : (
        <MapPin size={16} color={colors.textSecondary} strokeWidth={1.75} />
      )}
      <Text
        className="font-sans text-sm text-text-secondary"
        accessibilityLabel={unresolved ? `Location is off, showing ${city}` : city}
      >
        {status === 'loading' ? 'Finding your location...' : city}
      </Text>
    </View>
  );
}
