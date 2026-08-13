import { spacing } from '@atlitos/theme';
import { MapPin, MapPinOff } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useLocationStore, type LocationStatus } from '@/store/location-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface LocationStatusRowProps {
  /** What to say once a location IS known, e.g. "Showing courts near Pune".
   * Owned by the caller because only the caller knows what it is listing, and
   * because Courts suppresses the "near" claim entirely when every result is
   * implausibly far (the F4 rule in courts/index.tsx). */
  resolvedLabel: string;
  /** The athlete's own profile city, handed to a retry so a second denial
   * still shows their real city rather than the Hyderabad default. */
  profileCity?: string | null;
}

/**
 * The location line every browse surface shows above its filters, WITH its
 * terminal states.
 *
 * WHY IT EXISTS. Courts and the coach browse list each rendered
 * `status === 'loading' ? 'Finding your location...' : 'Showing ... near X'`.
 * That is a two state ternary over a five state machine: `denied`,
 * `unavailable` and `manual` all fell into the "near X" branch, and `loading`
 * had no exit at all, so a permission dialog nobody answered or a simulator
 * with no location left "Finding your location..." on screen permanently, in
 * both themes. The store now carries deadlines (location-store.ts), which
 * makes those terminal states reachable; this component is where they become
 * visible, once, so the next browse surface cannot render the same dead end.
 *
 * Every non resolved state offers a WAY FORWARD, which is the point: retry the
 * prompt while the OS will still show it, open Settings once it will not, and
 * name a city by hand in either case.
 */
export function LocationStatusRow({ resolvedLabel, profileCity }: LocationStatusRowProps) {
  const colors = useThemeColors();
  const status = useLocationStore((state) => state.status);
  const canAskAgain = useLocationStore((state) => state.canAskAgain);
  const timedOut = useLocationStore((state) => state.timedOut);
  const requestLocation = useLocationStore((state) => state.requestLocation);
  const setManualCity = useLocationStore((state) => state.setManualCity);

  const [picking, setPicking] = useState(false);
  const [draftCity, setDraftCity] = useState('');

  const needsFallback: LocationStatus[] = ['denied', 'unavailable'];
  const showFallback = needsFallback.includes(status);

  function applyCity() {
    const next = draftCity.trim();
    if (next.length === 0) return;
    setManualCity(next);
    setPicking(false);
    setDraftCity('');
  }

  const message =
    status === 'loading'
      ? 'Finding your location...'
      : status === 'denied'
        ? 'Location is off, so distances are hidden.'
        : status === 'unavailable'
          ? timedOut
            ? 'We could not get your location in time.'
            : 'Your location is not available right now.'
          : resolvedLabel;

  return (
    <View style={{ gap: spacing.xs }}>
      <View className="flex-row items-center gap-xs">
        {showFallback ? (
          <MapPinOff size={14} strokeWidth={1.75} color={colors.textTertiary} />
        ) : (
          <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
        )}
        <Text className="flex-1 font-sans text-sm text-text-secondary">{message}</Text>
      </View>

      {showFallback ? (
        <>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{resolvedLabel}</Text>

          <View className="flex-row items-center gap-sm">
            {status === 'denied' && !canAskAgain ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open location settings"
                hitSlop={8}
                onPress={() => void Linking.openSettings()}
                className="min-h-11 justify-center"
              >
                <Text className="font-sans-semibold text-sm text-accent">Open settings</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try finding your location again"
                hitSlop={8}
                onPress={() => void requestLocation(profileCity)}
                className="min-h-11 justify-center"
              >
                <Text className="font-sans-semibold text-sm text-accent">Try again</Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enter your city"
              hitSlop={8}
              onPress={() => setPicking((open) => !open)}
              className="min-h-11 justify-center"
            >
              <Text className="font-sans-semibold text-sm text-accent">
                {picking ? 'Cancel' : 'Enter city'}
              </Text>
            </Pressable>
          </View>

          {picking ? (
            <View className="flex-row items-end gap-sm">
              <View className="flex-1">
                <Input
                  value={draftCity}
                  onChangeText={setDraftCity}
                  placeholder="Your city"
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={applyCity}
                  accessibilityLabel="City"
                />
              </View>
              <Button size="sm" onPress={applyCity} disabled={draftCity.trim().length === 0}>
                <Text style={{ color: colors.inkOnAccent }}>Use city</Text>
              </Button>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export default LocationStatusRow;
