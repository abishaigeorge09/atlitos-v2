import { spacing } from '@atlitos/theme';
import { Link } from 'expo-router';
import { LayoutGrid, Palette } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Dev tools hub, /dev. Not linked from any product screen, reached directly
 * during development or by a QA/reviewer typing the route. Entry point to
 * the states gallery (phase gate visual evidence) and the token reference.
 */
export default function DevIndexScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Internal, not user facing</Text>

        <Link href="/dev/gallery" asChild>
          <Pressable accessibilityRole="button">
            <Card>
              <CardContent>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <LayoutGrid size={24} strokeWidth={1.75} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <CardTitle>States gallery</CardTitle>
                    <CardDescription>All 42 components, every variant and state, light and dark.</CardDescription>
                  </View>
                </View>
              </CardContent>
            </Card>
          </Pressable>
        </Link>

        <Link href="/dev/tokens" asChild>
          <Pressable accessibilityRole="button">
            <Card>
              <CardContent>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Palette size={24} strokeWidth={1.75} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <CardTitle>Design tokens</CardTitle>
                    <CardDescription>Color swatches, type scale and the spacing ruler.</CardDescription>
                  </View>
                </View>
              </CardContent>
            </Card>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}
