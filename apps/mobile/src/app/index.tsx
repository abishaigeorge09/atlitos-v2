import { radii, spacing } from '@atlitos/theme';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

export default function HomeScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <View style={[styles.eyebrowChip, { backgroundColor: colors.accentTint }]}>
          <Text style={[textStyle('overline'), { color: colors.accent }]}>Sport superapp</Text>
        </View>

        <Text style={[textStyle('display'), styles.wordmark, { color: colors.text }]}>
          Atlitos
        </Text>

        <Text style={[textStyle('body'), styles.tagline, { color: colors.textSecondary }]}>
          Learn, book courts, hire coaches and follow the game, all in one place.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  eyebrowChip: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  wordmark: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    maxWidth: 320,
  },
});
