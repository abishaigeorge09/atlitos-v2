import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the notifications route group (AT-147). The in-app notification
 * surface (list, mark read, deep links) at `/notifications` and the
 * preferences screen at `/notifications/preferences`. Each screen renders its
 * own AppBar back header, so no native header stacks on top, matching every
 * other nested stack in this app.
 */
export default function NotificationsLayout() {
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
