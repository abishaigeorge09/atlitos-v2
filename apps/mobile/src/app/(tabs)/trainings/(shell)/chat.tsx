import { router } from 'expo-router';
import { View } from 'react-native';

import { ChatThreadList } from '@/components/organisms/chat/ChatThreadList';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Trainings module Chat tab (PRD-01 FR-58 to FR-60, PRD-02 3.8). Embeds
 * the shared ChatThreadList organism inline as tab content inside the
 * Trainings shell, no redirect to the standalone /chat surface anymore, so
 * switching to Chat swaps only the content below the fixed module header
 * and sub nav. Tapping a thread pushes the conversation full screen above
 * the module (trainings/chat-thread/[id] on the trainings Stack); backing
 * out of it returns here with the shell intact.
 */
export default function TrainingsChatTab() {
  const colors = useThemeColors();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ChatThreadList
        onOpenThread={(threadId) =>
          router.push({ pathname: '/(tabs)/trainings/chat-thread/[id]', params: { id: threadId } })
        }
      />
    </View>
  );
}
