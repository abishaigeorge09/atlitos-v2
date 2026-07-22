import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the Empower route group (PRD-06 section 3: the empower hub, UPA
 * public profile and donation flow live in the consumer app under `/home`).
 * Each screen renders its own AppBar back header, so no native header stacks
 * on top of it, matching every other nested stack in this app.
 */
export default function HomeLayout() {
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
