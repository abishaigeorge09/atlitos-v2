import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearnHomeContent } from '@/components/organisms/learn/LearnHomeContent';
import { AppBar } from '@/components/ui/app-bar';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Learn home, `/learn`. AT-134, PRD-01 FR-48/FR-50/FR-51. The standalone
 * screen chrome (SafeAreaView plus a back AppBar) wraps the shared
 * LearnHomeContent body, which the Trainings module's Learn tab also renders
 * without this chrome. All the data, states and deep links live in that
 * component.
 */
export default function LearnHomeScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Learn" onPressBack={() => router.back()} />
      <LearnHomeContent />
    </SafeAreaView>
  );
}
