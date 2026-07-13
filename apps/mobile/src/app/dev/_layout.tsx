import { Stack } from 'expo-router';

import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Stack for the /dev route group (states gallery, token reference). Only the
 * index hub gets a native header, a back button to get here from nowhere
 * else in the app. gallery.tsx and tokens.tsx render their own in-screen
 * header row (title plus the theme toggle), a native header on top of that
 * would double up.
 */
export default function DevLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: true, title: 'Dev tools' }} />
      <Stack.Screen name="gallery" options={{ headerShown: false }} />
      <Stack.Screen name="tokens" options={{ headerShown: false }} />
    </Stack>
  );
}
