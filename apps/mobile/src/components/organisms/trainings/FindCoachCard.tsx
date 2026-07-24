import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { ChevronRight, Search } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * The athlete's path into coaching (PRD-01 FR-20): a prominent card routing
 * to the coach browse at `/(tabs)/coaching`. Always available from the
 * Trainings dashboard so a new athlete with zero sessions has an obvious
 * next step, and an active athlete can book the next one.
 */
export function FindCoachCard() {
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Find a coach"
      onPress={() => router.push('/(tabs)/coaching')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.accent,
        backgroundColor: colors.accentTint,
        padding: spacing.lg,
      }}
    >
      <View
        style={{
          height: 44,
          width: 44,
          borderRadius: radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accent,
        }}
      >
        <Search size={22} strokeWidth={2} color={colors.inkOnAccent} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[textStyle('label'), { color: colors.text }]}>Find a coach</Text>
        <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
          Browse verified coaches, compare pricing and book a session that fits your week.
        </Text>
      </View>

      <ChevronRight size={20} strokeWidth={1.75} color={colors.textTertiary} />
    </Pressable>
  );
}
