import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatThreadList } from '@/components/organisms/chat/ChatThreadList';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Standalone chat surface (AT-55, PRD-01 FR-58 to FR-60, PRD-02 FR-30/
 * FR-31), reachable by path from a coach or session context, never a bottom
 * nav tab itself. The thread list itself lives in the shared
 * `ChatThreadList` organism; the Trainings module embeds that same organism
 * inline as its Chat tab, so this route only wraps it with the Messages
 * header and pushes its sibling `[id]` thread screen.
 */
export default function ChatIndexScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ChatThreadList
        title="Messages"
        onOpenThread={(threadId) =>
          router.push({ pathname: '/(tabs)/chat/[id]', params: { id: threadId } })
        }
      />
    </SafeAreaView>
  );
}
