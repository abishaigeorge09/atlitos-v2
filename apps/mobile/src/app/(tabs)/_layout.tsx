import { useNotifications } from '@atlitos/api';
import { Tabs, router, useSegments } from 'expo-router';
import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

import { BottomNav, type BottomNavTab, NavBarInsetProvider } from '@/components/ui/bottom-nav';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
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

// `expo-router` vendors its own copy of react-navigation and only re-exports
// `Tabs` from its package root, so the tab bar's prop type is derived from
// `Tabs`'s own `tabBar` prop rather than imported (see PHASE-1-SPIKE.md on the
// same pnpm module resolution snag).
//
// NAV-04, do not undo this by installing a navigator. Swipe between tabs was
// attempted with `@react-navigation/material-top-tabs` plus a pager, and
// expo-router SDK 57 refuses to start when ANY `@react-navigation/*` package
// is a direct dependency: it throws from withMetroMultiPlatform.js the moment
// `@react-navigation/core` resolves to a second copy. A swipeable pager has to
// come from expo-router itself or from a hand rolled pager that does not pull
// in a second react-navigation.
type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>['tabBar']>;
type TabBarProps = Parameters<TabBarRenderer>[0];

/** Adapts BottomNav to the navigator's `tabBar` prop. */
function CustomTabBar({ state, navigation }: TabBarProps) {
  const activeRouteName = state.routes[state.index]?.name ?? 'index';
  const activeTab = ROUTE_TO_TAB[activeRouteName] ?? 'home';
  // NAV-03: the You tab shows the member's own avatar instead of a glyph.
  // Guests and members with no photo fall back to the CircleUser icon.
  const avatarUri = useSessionStore((s) => s.me?.avatarUrl) ?? undefined;

  // NAV-03: the unread dot on You, the same owner-scoped count the Home bell
  // uses. Re-read whenever the active tab changes, which is the cheapest
  // refresh point that still catches "read them, come back". Fails silent, so
  // the dot never blocks navigation.
  const status = useSessionStore((s) => s.status);
  const notifications = useNotifications(supabase);
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    if (status !== 'signed_in') {
      setHasUnread(false);
      return;
    }
    let active = true;
    notifications
      .unreadCount()
      .then((count) => {
        if (active) setHasUnread(count > 0);
      })
      .catch(() => {
        if (active) setHasUnread(false);
      });
    return () => {
      active = false;
    };
    // `notifications` is a fresh object each render, deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeRouteName]);

  function handleTabPress(tab: BottomNavTab) {
    const routeName = Object.entries(ROUTE_TO_TAB).find(([, value]) => value === tab)?.[0] ?? 'index';
    navigation.navigate(routeName);
  }

  return (
    <BottomNav
      activeTab={activeTab}
      onTabPress={handleTabPress}
      avatarUri={avatarUri}
      badgedTabs={hasUnread ? ['you'] : undefined}
    />
  );
}

/**
 * NAV-06: swipe left and right to change tab.
 *
 * Why a PanResponder and not a pager. The obvious answer is a pager backed
 * navigator (`@react-navigation/material-top-tabs`), which drags the page
 * under your finger. It cannot be used here: expo-router SDK 57 refuses to
 * start when ANY `@react-navigation/*` package is a direct dependency, because
 * it vendors its own copy and a second `@react-navigation/core` on the graph
 * throws from withMetroMultiPlatform.js. So the gesture is recognised here and
 * handed to the navigator, and the navigator animates the change (`animation:
 * 'shift'` below). You get swipe to change page; you do not get the page
 * tracking your finger mid drag.
 *
 * The recogniser is deliberately fussy, and only claims a touch when it is
 * unambiguously a horizontal flick:
 *
 *   - It uses onMoveShouldSetPanResponder, NOT the Capture variant, so any
 *     child that wants the touch first still wins. That is what keeps the
 *     Home carousels, the Shop rail and every vertical ScrollView working.
 *   - It needs SWIPE_MIN_DX of travel, and that travel must be at least
 *     SWIPE_AXIS_RATIO times the vertical movement, so a diagonal scroll never
 *     flips the tab.
 */
const TAB_PATHS = ['/', '/trainings', '/clutch', '/courts', '/you'] as const;
/** Minimum horizontal travel before a drag counts as a swipe. */
const SWIPE_MIN_DX = 56;
/** How much more horizontal than vertical the gesture has to be. */
const SWIPE_AXIS_RATIO = 1.8;

export default function TabsLayout() {
  const colors = useThemeColors();

  // First segment inside (tabs) tells us which tab is showing. `coaching` is
  // reachable but is not a swipe stop, so it maps to no index and swiping is
  // simply inert there.
  const segments = useSegments() as string[];
  const current = segments[1] ?? 'index';
  const indexRef = useRef(0);
  indexRef.current = ['index', 'trainings', 'clutch', 'courts', 'you'].indexOf(current);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) =>
          Math.abs(g.dx) > SWIPE_MIN_DX && Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_AXIS_RATIO,
        onPanResponderRelease: (_evt, g) => {
          const i = indexRef.current;
          if (i < 0) return;
          if (g.dx <= -SWIPE_MIN_DX && i < TAB_PATHS.length - 1) router.navigate(TAB_PATHS[i + 1]);
          else if (g.dx >= SWIPE_MIN_DX && i > 0) router.navigate(TAB_PATHS[i - 1]);
        },
      }),
    [],
  );

  return (
    <NavBarInsetProvider>
    <View style={{ flex: 1 }} {...pan.panHandlers}>
      <Tabs
      // The bar is absolutely positioned and floats over the pages, so it is
      // rendered as the tab bar but takes no layout height. See
      // components/ui/bottom-nav.tsx.
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // The navigator's own cross fade plus lateral shift. Without this the
        // tab change is an instant cut, which makes a swipe feel broken even
        // when it worked.
        animation: 'shift',
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="trainings" options={{ title: 'Trainings' }} />
      <Tabs.Screen name="clutch" options={{ title: 'Clutch' }} />
      <Tabs.Screen name="courts" options={{ title: 'Courts' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
      </Tabs>
    </View>
    </NavBarInsetProvider>
  );
}
