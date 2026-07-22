import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the Learn route group (PRD-01 FR-48 to FR-51: the Learn home, drill
 * library, drill detail, roadmap and milestones live in the consumer app under
 * `/learn`). Each screen renders its own AppBar back header, so no native
 * header stacks on top of it, matching every other nested stack in this app.
 */
export default function LearnLayout() {
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
