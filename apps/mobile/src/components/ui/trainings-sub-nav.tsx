import { cn } from '@/lib/utils';
import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';

/**
 * Molecule 15: TrainingsSubNav. Role-aware 5-tab horizontal scroller.
 * Player: Stats, Coaches, Payments, Chat, Analytics.
 * Coach: Stats, Trainees, Earnings, Chat, Analytics.
 * Active tab gets accent text plus an accent underline; each tab keeps a
 * 44pt minimum touch target even though the row itself is compact.
 */
export type TrainingsSubNavRole = 'player' | 'coach';
export type TrainingsSubNavTab = 'stats' | 'coaches' | 'trainees' | 'payments' | 'earnings' | 'chat' | 'analytics';

const TABS_BY_ROLE: Record<TrainingsSubNavRole, Array<{ key: TrainingsSubNavTab; label: string }>> = {
  player: [
    { key: 'stats', label: 'Stats' },
    { key: 'coaches', label: 'Coaches' },
    { key: 'payments', label: 'Payments' },
    { key: 'chat', label: 'Chat' },
    { key: 'analytics', label: 'Analytics' },
  ],
  coach: [
    { key: 'stats', label: 'Stats' },
    { key: 'trainees', label: 'Trainees' },
    { key: 'earnings', label: 'Earnings' },
    { key: 'chat', label: 'Chat' },
    { key: 'analytics', label: 'Analytics' },
  ],
};

export interface TrainingsSubNavProps {
  role: TrainingsSubNavRole;
  active: TrainingsSubNavTab;
  onChange: (tab: TrainingsSubNavTab) => void;
  className?: string;
}

function TrainingsSubNav({ role, active, onChange, className }: TrainingsSubNavProps) {
  const tabs = TABS_BY_ROLE[role];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className={cn('flex-none border-b border-border bg-bg', className)}
      contentContainerClassName="flex-row px-lg"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (!isActive) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
                // Haptics unavailable, not fatal.
              });
              onChange(tab.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            className="min-h-11 items-center justify-center px-lg active:opacity-70"
          >
            <Text
              className={cn(
                'font-sans-semibold text-sm',
                isActive ? 'text-accent' : 'text-text-tertiary',
              )}
            >
              {tab.label}
            </Text>
            {/* h-0.5 (2px): Tailwind's native scale, no @atlitos/theme spacing
                step goes below xs (4px), accepted precedent for a hairline
                underline indicator per PHASE-1-SPIKE.md. */}
            <View className={cn('mt-xs h-0.5 w-full rounded-pill', isActive ? 'bg-accent' : 'bg-transparent')} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export { TrainingsSubNav };
