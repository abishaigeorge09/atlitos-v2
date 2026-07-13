import { radii, spacing } from '@atlitos/theme';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Text as UIText } from '@/components/ui/text';
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

        <View className="w-full max-w-sm gap-lg">
          {/* Phase 1 spike proof: react-native-reusables Card, themed via
              tailwind.config.js generated from @atlitos/theme. See
              docs/phases/PHASE-1-SPIKE.md. */}
          <Card>
            <CardHeader>
              <CardTitle>Book a court</CardTitle>
              <CardDescription>Instant confirmation, no back and forth.</CardDescription>
            </CardHeader>
            <CardContent>
              <UIText className="text-text-secondary">
                Nativewind and react-native-reusables proof components, themed with
                @atlitos/theme tokens.
              </UIText>
            </CardContent>
            <CardFooter>
              <Button className="flex-1">
                <UIText>Reserve now</UIText>
              </Button>
            </CardFooter>
          </Card>

          <Button variant="secondary">
            <UIText>Secondary action</UIText>
          </Button>
        </View>
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
