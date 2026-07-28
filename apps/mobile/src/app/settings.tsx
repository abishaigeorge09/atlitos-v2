import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsContent } from '@/components/organisms/settings/SettingsContent';
import { AppBar } from '@/components/ui/app-bar';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Pushed Settings route (Phase 9 WS-personalization). Renders the same shared
 * SettingsContent surface as the You tab, with a back header. This is the
 * target of the Settings entries on the Profile page and in the Trainings tab,
 * so all three entry points reach identical options.
 */
export default function SettingsScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Settings" onPressBack={() => router.back()} />
      <View style={{ flex: 1 }}>
        <SettingsContent />
      </View>
    </SafeAreaView>
  );
}
