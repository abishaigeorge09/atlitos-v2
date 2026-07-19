import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the coaching (athlete side) route group: coach discovery,
 * profile, booking, and session management (AT-52/53/54, PRD-01 Journey 2).
 * Mirrors `(tabs)/courts/_layout.tsx` exactly: `index` is the entry point
 * (not a bottom tab of its own, reached from Home/Trainings via a "book a
 * coach" CTA), every other screen here is pushed on top and renders its own
 * in-screen back header via AppBar, so no screen here gets a second native
 * header on top of that.
 */
export default function CoachingLayout() {
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
