import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the Courts tab (PRD-01 3.5, SPEC.md 6.6). `index` is the tab
 * root (sport chips + CourtCard list); every other screen here is pushed on
 * top of it and renders its own in-screen back header via AppBar, matching
 * the `(auth)`/`(onboarding)`/`dev` route groups' own nested-stack pattern,
 * so no screen here gets a second, native header on top of that.
 */
export default function CourtsLayout() {
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
