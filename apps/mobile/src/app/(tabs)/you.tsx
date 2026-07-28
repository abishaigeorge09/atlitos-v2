import { spacing } from '@atlitos/theme';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsContent } from '@/components/organisms/settings/SettingsContent';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * You tab (Phase 9 WS-personalization). The fifth bottom tab: a personalization
 * home rendering the shared SettingsContent surface, the same options reachable
 * from the Profile page and the Trainings tab. No back header (it is a tab
 * root); the title renders inline above the content.
 */
export default function YouScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <Text style={[textStyle('h1'), { color: colors.text }]}>You</Text>
      </View>
      <SettingsContent />
    </SafeAreaView>
  );
}
