import { spacing } from '@atlitos/theme';
import { router, Tabs, useSegments } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { TrainingsSubNav, type TrainingsSubNavTab } from '@/components/ui/trainings-sub-nav';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** Route name inside this group -> sub nav tab key. `index` is Stats. */
const SEGMENT_TO_TAB: Record<string, TrainingsSubNavTab> = {
  index: 'stats',
  coaches: 'coaches',
  trainees: 'trainees',
  payments: 'payments',
  earnings: 'earnings',
  chat: 'chat',
  analytics: 'analytics',
};

/**
 * Fixed shell for the Trainings module (PRD-01 3.3, PRD-02 3.2 to 3.9).
 * The module title and TrainingsSubNav render ONCE here and never remount
 * while switching tabs; only the content below swaps. The five tabs per
 * role are sibling screens of a nested Tabs navigator with its stock tab
 * bar hidden (TrainingsSubNav drives it instead), which gives per tab
 * state preservation, lazy mounting, and no push animation between tabs.
 * `backBehavior="none"` keeps tab switches out of the back stack, so one
 * back action from any tab leaves the module to Home. Drill in screens
 * (requests, availability, trainee/session detail, payout setup, transfer,
 * chat thread, verification) live on the parent trainings Stack and push
 * full screen ABOVE this shell, then pop back to whichever tab opened
 * them. Guests and pending or rejected coaches see no sub nav; their gate
 * or verification status renders as the Stats tab content inside the
 * shell.
 */
export default function TrainingsShellLayout() {
  const colors = useThemeColors();
  const segments = useSegments() as string[];

  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);

  const isVerifiedCoach = me?.coachStatus === 'verified';
  const isPendingOrRejectedCoach = me?.coachStatus === 'pending_review' || me?.coachStatus === 'rejected';
  const isPlayer = status === 'signed_in' && !!me && !isVerifiedCoach && !isPendingOrRejectedCoach;

  // Active tab from the current route segment: the segment after this
  // "(shell)" group, or Stats at the group root (/trainings -> index).
  const shellIndex = segments.indexOf('(shell)');
  const routeName = (shellIndex >= 0 && segments[shellIndex + 1]) || 'index';
  const active = SEGMENT_TO_TAB[routeName] ?? 'stats';

  function handleTabChange(tab: TrainingsSubNavTab) {
    // navigate, not push: switching tabs must never grow the back stack.
    switch (tab) {
      case 'stats':
        router.navigate('/trainings');
        return;
      case 'coaches':
        router.navigate('/trainings/coaches');
        return;
      case 'trainees':
        router.navigate('/trainings/trainees');
        return;
      case 'payments':
        router.navigate('/trainings/payments');
        return;
      case 'earnings':
        router.navigate('/trainings/earnings');
        return;
      case 'chat':
        router.navigate('/trainings/chat');
        return;
      case 'analytics':
        router.navigate('/trainings/analytics');
        return;
      default:
        return;
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <Text style={[textStyle('h1'), { color: colors.text }]}>Trainings</Text>
      </View>

      {isVerifiedCoach || isPlayer ? (
        <TrainingsSubNav
          role={isVerifiedCoach ? 'coach' : 'player'}
          active={active}
          onChange={handleTabChange}
        />
      ) : null}

      <Tabs
        tabBar={() => null}
        backBehavior="none"
        screenOptions={{
          headerShown: false,
          lazy: true,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="coaches" />
        <Tabs.Screen name="trainees" />
        <Tabs.Screen name="payments" />
        <Tabs.Screen name="earnings" />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="analytics" />
      </Tabs>
    </SafeAreaView>
  );
}
