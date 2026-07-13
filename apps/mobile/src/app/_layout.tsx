import '../../global.css';

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { StatusBar } from 'react-native';

import { startSessionListener } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Not fatal, the splash screen just hides on its own default timing.
});

export default function RootLayout() {
  // nativewind's resolved scheme, not RN's own useColorScheme, so the
  // status bar style always agrees with useThemeColors()/the `dark` class,
  // see src/theme/use-theme-colors.ts for why the two can disagree on web.
  const { colorScheme: scheme } = useColorScheme();
  const colors = useThemeColors();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {
        // Not fatal.
      });
    }
  }, [fontsLoaded, fontError]);

  // Starts the one supabase.auth.onAuthStateChange subscription for the
  // whole app (src/store/session-store.ts). Inside an effect, not at module
  // scope: this app's web target builds with `web.output: "static"`
  // (app.json), which pre-renders every route's module graph once in a
  // Node SSR pass with no `window`/browser storage; a module-level call
  // reached the Supabase auth client's AsyncStorage web adapter during that
  // pass and crashed the export with "window is not defined". An effect
  // only runs after a real commit (native, or a real browser), never during
  // that SSR pass, which is exactly the guard needed here.
  // `startSessionListener()` itself is idempotent (a `listenerStarted`
  // guard), so this still safely survives RootLayout remounts (fast
  // refresh) without double subscribing.
  useEffect(() => {
    startSessionListener();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
      <PortalHost />
    </>
  );
}
