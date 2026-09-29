import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Anchor for pushes that arrive from outside this tab (Home search, a push
 * notification). Callers pass `{ withAnchor: true }` so `index` is loaded
 * under the pushed screen; without it the pushed court became the stack's
 * only screen and the Courts tab stayed stuck on it (BUG-050).
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

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
