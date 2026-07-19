import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/ui/skeleton';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Coach entry point for chat (PRD-02 3.8). The chat organism itself (thread
 * list + thread screen, Realtime, reconnect state) is Track E's build at
 * `/(tabs)/chat`, shared by both roles per that route's own header comment
 * ("the coach tab links here"). This screen only wires the coach side
 * navigation into it, so `TrainingsSubNav`'s Chat tab has somewhere to land
 * without this track building or duplicating chat UI.
 */
export default function TrainingsChatRedirect() {
  const colors = useThemeColors();

  useEffect(() => {
    router.replace('/(tabs)/chat');
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, padding: spacing.lg }}>
        <Skeleton shape="card" height={120} />
      </View>
    </SafeAreaView>
  );
}
