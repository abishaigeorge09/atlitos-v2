import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the chat routes (AT-55, PRD-01 FR-58/FR-59/FR-60, PRD-02
 * FR-30/FR-31). `index` is the thread list, `[id]` is one open thread.
 * This directory is a shared organism reachable by path from both roles:
 * the coach tab links here (see the coach entry point Track C wires at
 * /trainings/chat, itself pointing at this same /chat route), and an
 * athlete opens a thread from a coach or session context (Track D's
 * screens). No screen here gets a second native header on top of its own
 * in-screen AppBar, matching the `(auth)`/`(onboarding)`/`courts` route
 * groups' own nested-stack pattern.
 */
export default function ChatLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
