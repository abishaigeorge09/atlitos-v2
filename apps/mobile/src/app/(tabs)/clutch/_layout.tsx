import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the Clutch tab (PRD-01 3.4). `index` is the full-bleed vertical
 * feed; post detail, upload, and creator/own profile push on top and render
 * their own in-screen AppBar back header, matching the Courts tab's nested
 * stack (no second native header).
 */
export default function ClutchLayout() {
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
