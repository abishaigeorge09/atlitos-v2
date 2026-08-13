import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import { BottomNav, type BottomNavTab } from '@/components/ui/bottom-nav';
import { useThemeColors } from '@/theme/use-theme-colors';

const ROUTE_TO_TAB: Record<string, BottomNavTab> = {
  index: 'home',
  trainings: 'trainings',
  clutch: 'clutch',
  courts: 'courts',
  you: 'you',
  // Not a bottom tab of its own (no BottomNav button navigates here
  // directly, reached via a "book a coach" CTA from Home/Trainings, see
  // (tabs)/coaching/_layout.tsx); mapped to `trainings` purely so the tab
  // bar highlights the closest concept while an athlete is browsing
  // coaches/sessions instead of falling back to `home`.
  coaching: 'trainings',
};

// `expo-router` vendors its own copy of react-navigation's bottom-tabs types
// but only re-exports the `Tabs` component itself from its package root
// (`@react-navigation/bottom-tabs` is not a direct workspace dependency, see
// docs/phases/PHASE-1-SPIKE.md's pnpm module resolution snag for the same
// class of issue). Deriving the prop type from `Tabs`'s own `tabBar` prop
// avoids importing from either package directly.
type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>['tabBar']>;
type BottomTabBarProps = Parameters<TabBarRenderer>[0];

/** Adapts BottomNav's `activeTab`/`onTabPress` API to expo-router's `Tabs`
 * `tabBar` prop, so the same locked BottomNav component (Phase 1 spike
 * proof list, molecule 14) drives navigation instead of a stock tab bar. */
/**
 * F3 (P5 fix pass, LAUNCH-PHASE-5-STATUS.md P5-22, P5-ANDROID-FINDINGS.md
 * finding A-3): hardware BACK from any non-Home bottom tab exited the app
 * directly with no intermediate "return to Home" step, the common Android
 * convention. React Navigation's own default back handling already pops a
 * pushed screen WITHIN a tab's stack (that case was not reported broken);
 * this only fires at a tab's own root, so it never intercepts an in-tab
 * back-pop. Registered once at the tab bar, LIFO with any Portal sheet's
 * `usePortalBackDismiss` (a visible sheet's listener is added later and so
 * fires first, correctly taking priority).
 */
function useTabRootBackHandler(state: BottomTabBarProps['state'], navigation: BottomTabBarProps['navigation']) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const activeRoute = state.routes[state.index];
      const isHome = (activeRoute?.name ?? 'index') === 'index';
      // A route's nested stack state (if the active tab has its own Stack
      // navigator, e.g. courts/clutch's post/booking screens) reports its own
      // `index`. Only treat this tab as "at its root" when that nested index
      // is 0 (or absent, a tab with no nested stack), so a pushed screen
      // inside a tab still pops normally instead of jumping to Home.
      const nestedState = activeRoute?.state as { index?: number } | undefined;
      const atTabRoot = (nestedState?.index ?? 0) === 0;

      if (atTabRoot && !isHome) {
        navigation.navigate('index');
        return true;
      }
      // At Home's own root, or mid-stack in any tab: let the default handler
      // (React Navigation's own back-pop, or Android's exit at Home) proceed.
      return false;
    });
    return () => subscription.remove();
  }, [state, navigation]);
}

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const activeRouteName = state.routes[state.index]?.name ?? 'index';
  const activeTab = ROUTE_TO_TAB[activeRouteName] ?? 'home';
  useTabRootBackHandler(state, navigation);

  function handleTabPress(tab: BottomNavTab) {
    const routeName = Object.entries(ROUTE_TO_TAB).find(([, value]) => value === tab)?.[0] ?? 'index';
    navigation.navigate(routeName);
  }

  return <BottomNav activeTab={activeTab} onTabPress={handleTabPress} />;
}

export default function TabsLayout() {
  const colors = useThemeColors();

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="trainings" options={{ title: 'Trainings' }} />
      <Tabs.Screen name="clutch" options={{ title: 'Clutch' }} />
      <Tabs.Screen name="courts" options={{ title: 'Courts' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
    </Tabs>
  );
}
