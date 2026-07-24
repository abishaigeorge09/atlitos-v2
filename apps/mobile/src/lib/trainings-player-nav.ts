import { router } from 'expo-router';

import type { TrainingsSubNavTab } from '@/components/ui/trainings-sub-nav';

/**
 * Shared TrainingsSubNav navigation for the athlete side of the Trainings
 * module (Stats, Coaches, Payments, Chat, Analytics), so every player tab
 * screen routes the same way. Stats is the module root; the rest are
 * sibling routes under `(tabs)/trainings`.
 */
export function navigatePlayerSubNav(tab: TrainingsSubNavTab) {
  switch (tab) {
    case 'stats':
      router.push('/(tabs)/trainings');
      return;
    case 'coaches':
      router.push('/(tabs)/trainings/coaches');
      return;
    case 'payments':
      router.push('/(tabs)/trainings/payments');
      return;
    case 'chat':
      router.push('/(tabs)/trainings/chat');
      return;
    case 'analytics':
      router.push('/(tabs)/trainings/analytics');
      return;
    default:
      return;
  }
}
