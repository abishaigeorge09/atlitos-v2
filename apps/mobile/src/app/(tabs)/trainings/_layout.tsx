import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the Trainings tab (PRD-01 3.3, PRD-02 3.2 to 3.9). `index` is
 * the tab root (guest lock, coach verification gate, or the Stats
 * dashboard); every other screen here is pushed on top of it and renders
 * its own in-screen back header via AppBar, matching the `courts` route
 * group's own nested-stack pattern, so no screen here gets a second native
 * header on top of that.
 */
export default function TrainingsLayout() {
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
