import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the unified social profile route group (Track C: cover, avatar,
 * handle, bio, counts, four content tabs, edit screen). Each screen renders
 * its own AppBar back header, so no native header stacks on top of it,
 * matching every other nested stack in this app (account, shop, learn).
 */
export default function ProfileLayout() {
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
