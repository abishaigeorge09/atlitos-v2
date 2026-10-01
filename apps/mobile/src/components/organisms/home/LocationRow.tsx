import { ChevronDown, MapPin, MapPinOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { LocationSheet } from '@/components/organisms/home/LocationSheet';

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
 * Tapping the row opens `LocationSheet` (current location, a popular city, or
 * any typed city); a picked city persists across launches.
 */
export function LocationRow() {
  const colors = useThemeColors();
  const city = useLocationStore((state) => state.city);
  const status = useLocationStore((state) => state.status);

  const unresolved = status === 'denied' || status === 'unavailable' || status === 'idle';

  const [sheetVisible, setSheetVisible] = useState(false);

  // Founder, 2026-09-30: the location could not be changed from Home. The
  // row itself now opens the city picker; the chevron says it is tappable.
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${unresolved ? `Location is off, showing ${city}` : city}. Change location`}
        onPress={() => setSheetVisible(true)}
        hitSlop={{ top: 10, bottom: 10 }}
        className="min-h-11 flex-row items-center gap-xs self-start active:opacity-70"
      >
        {unresolved ? (
          <MapPinOff size={16} color={colors.textSecondary} strokeWidth={1.75} />
        ) : (
          <MapPin size={16} color={colors.textSecondary} strokeWidth={1.75} />
        )}
        <Text className="font-sans text-sm text-text-secondary">
          {status === 'loading' ? 'Finding your location...' : city}
        </Text>
        <ChevronDown size={14} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
      <LocationSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </>
  );
}
