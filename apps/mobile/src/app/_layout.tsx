import '../../global.css';

import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { StatusBar, Text, View } from 'react-native';

import { usePushRegistration } from '@/hooks/use-push-registration';
import { applyTheme } from '@/lib/apply-theme';
import { Sentry } from '@/lib/sentry';
import { startSessionListener, useSessionStore } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Not fatal, the splash screen just hides on its own default timing.
});

function RootLayout() {
  // nativewind's resolved scheme, not RN's own useColorScheme, so the
  // status bar style always agrees with useThemeColors()/the `dark` class,
  // see src/theme/use-theme-colors.ts for why the two can disagree on web.
  const { colorScheme: scheme } = useColorScheme();
  const colors = useThemeColors();

  // Loaded from local files under assets/fonts (not from
  // @expo-google-fonts/* package requires) so `expo export --platform web`
  // never has to resolve a font asset through the pnpm virtual store. That
  // matters because these packages are hoisted into the workspace root's
  // node_modules/.pnpm/<pkg>/node_modules/<pkg>/... symlink target, which
  // sits outside apps/mobile (the Metro projectRoot). Metro's web export
  // resolves each font's real (symlink-followed) path to build its output
  // location, so it lands the TTF under
  // dist/assets/__node_modules/.pnpm/<pkg>/node_modules/<pkg>/... The
  // deepest segment of that path is a literal directory named
  // `node_modules`, and Vercel's static deploy silently drops any file
  // under a `node_modules`-named directory (the same default ignore
  // `.gitignore` applies), even though the file is present and correctly
  // referenced in the local `expo export` output. The six fonts 404 on the
  // deployed site as a result. Requiring local copies here keeps the asset
  // path entirely inside the project root (dist/assets/assets/fonts/...),
  // so it never crosses through any node_modules directory and survives
  // the Vercel upload. See docs/design/DESIGN-LANGUAGE.md for the token
  // names these map to (`packages/theme` `rnFontFamily`).
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require('../../assets/fonts/Inter_400Regular.ttf'),
    Inter_500Medium: require('../../assets/fonts/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('../../assets/fonts/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('../../assets/fonts/Inter_700Bold.ttf'),
    JetBrainsMono_500Medium: require('../../assets/fonts/JetBrainsMono_500Medium.ttf'),
    JetBrainsMono_600SemiBold: require('../../assets/fonts/JetBrainsMono_600SemiBold.ttf'),
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

  // Apply the signed-in user's persisted appearance preference (0087) once
  // their profile resolves, defaulting guests (no me row) to 'system'.
  // applyTheme() (not a bare nativewind colorScheme.set()) is required here:
  // see apply-theme.ts for why passing 'system' straight through leaves the
  // DOM `dark` class stuck on light while useThemeColors() correctly
  // resolves dark, the root cause of the J/K section contrast bug.
  const themePref = useSessionStore((state) => state.me?.theme);
  useEffect(() => {
    applyTheme(themePref ?? 'system');
  }, [themePref]);

  // Push registration: requests permission, registers/unregisters the
  // device's Expo push token against the current session, and routes taps
  // through expo-router. Phase 4 Track D, CT-D, PRD-01 FR-61/62. See
  // src/hooks/use-push-registration.ts for the full lifecycle.
  usePushRegistration();

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

function RootLayoutFallback() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text>Something went wrong. Restart the app to continue.</Text>
    </View>
  );
}

// Sentry.wrap adds native crash and render-error reporting when a DSN is
// configured (src/lib/sentry.ts). The wrapped ErrorBoundary catches a render
// crash in this tree and shows a fallback instead of a blank screen; a
// missing DSN just means the boundary reports nowhere, it still catches.
export default Sentry.wrap(function WrappedRootLayout() {
  return (
    <Sentry.ErrorBoundary fallback={<RootLayoutFallback />}>
      <RootLayout />
    </Sentry.ErrorBoundary>
  );
});
