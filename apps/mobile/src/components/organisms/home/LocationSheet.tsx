import { radii, spacing } from '@atlitos/theme';
import { Check, LocateFixed, MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** Cities where Atlitos has coaches, courts or players today. */
const POPULAR_CITIES = ['Hyderabad', 'Chennai', 'Bengaluru', 'Mumbai', 'Delhi', 'Pune', 'Kochi', 'Kolkata'];

export interface LocationSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Change location from the Home header (founder, 2026-09-30: the location
 * could not be changed from Home). Three ways, most useful first: use the
 * phone's location, pick a popular city, or type any city. A picked or typed
 * city goes through `setManualCity`, the same path Courts uses after a
 * denial, so every location aware surface agrees.
 */
export function LocationSheet({ visible, onClose }: LocationSheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const city = useLocationStore((state) => state.city);
  const status = useLocationStore((state) => state.status);
  const requestLocation = useLocationStore((state) => state.requestLocation);
  const setManualCity = useLocationStore((state) => state.setManualCity);
  const profileCity = useSessionStore((state) => state.me?.city ?? null);
  const [typed, setTyped] = useState('');
  const [locating, setLocating] = useState(false);

  function choose(next: string) {
    setManualCity(next);
    setTyped('');
    onClose();
  }

  async function locateMe() {
    setLocating(true);
    try {
      await requestLocation(profileCity);
    } finally {
      setLocating(false);
    }
    onClose();
  }

  const located = status === 'granted' || status === 'manual';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Swallow taps on the sheet so they do not close it. */}
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: colors.bg,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              gap: spacing.lg,
            }}
          >
            <View style={{ gap: spacing.xs }}>
              <Text style={[textStyle('h3'), { color: colors.text }]}>Choose your city</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                Coaches, courts and players near you.
              </Text>
            </View>

            <Button variant="secondary" loading={locating} onPress={() => void locateMe()}>
              <LocateFixed size={18} strokeWidth={1.75} color={colors.accent} />
              <Text style={[textStyle('label'), { color: colors.text }]}>Use my current location</Text>
            </Button>

            <ScrollView horizontal={false} style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {POPULAR_CITIES.map((name) => {
                  const selected = located && name === city;
                  return (
                    <Pressable
                      key={name}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => choose(name)}
                      className="active:opacity-70"
                      style={{
                        minHeight: 44,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.xs,
                        paddingHorizontal: spacing.md,
                        borderRadius: radii.pill,
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? colors.accentTint : colors.card,
                      }}
                    >
                      {selected ? (
                        <Check size={14} strokeWidth={2} color={colors.accentOnTint} />
                      ) : (
                        <MapPin size={14} strokeWidth={1.75} color={colors.textSecondary} />
                      )}
                      <Text style={[textStyle('label'), { color: selected ? colors.accentOnTint : colors.text }]}>
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Input
                  label="Another city"
                  placeholder="Type a city"
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={() => typed.trim() && choose(typed.trim())}
                />
              </View>
              <Button disabled={!typed.trim()} onPress={() => choose(typed.trim())}>
                <Text style={[textStyle('button'), { color: colors.inkOnAccent }]}>Set</Text>
              </Button>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
