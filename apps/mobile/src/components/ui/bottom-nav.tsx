import { cn } from '@/lib/utils';
import * as Haptics from 'expo-haptics';
import { Dumbbell, Home, LandPlot, Play, SlidersHorizontal, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 14: BottomNav. 5 tabs: Home, Trainings, Clutch, Courts, You. Active
 * tab renders its icon and label in `accent`; inactive tabs render in
 * `textTertiary`. Bottom padding respects the device safe area so the bar
 * never sits under the home indicator. The You tab (Phase 9
 * WS-personalization) opens the settings and personalization surface.
 */
export type BottomNavTab = 'home' | 'trainings' | 'clutch' | 'courts' | 'you';

const TABS: Array<{ key: BottomNavTab; label: string; icon: LucideIcon }> = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'trainings', label: 'Trainings', icon: Dumbbell },
  { key: 'clutch', label: 'Clutch', icon: Play },
  { key: 'courts', label: 'Courts', icon: LandPlot },
  { key: 'you', label: 'You', icon: SlidersHorizontal },
];

export interface BottomNavProps {
  activeTab: BottomNavTab;
  onTabPress: (tab: BottomNavTab) => void;
  className?: string;
}

function BottomNav({ activeTab, onTabPress, className }: BottomNavProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      className={cn('flex-row border-t border-border bg-bg', className)}
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {TABS.map((tab) => {
        const active = tab.key === activeTab;
        const Icon = tab.icon;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (!active) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
                // Haptics unavailable, not fatal.
              });
              onTabPress(tab.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className="min-h-11 flex-1 items-center justify-center gap-xs py-sm active:opacity-70"
          >
            <Icon size={24} strokeWidth={1.75} color={active ? colors.accent : colors.textTertiary} />
            <Text
              className={cn(
                'font-sans-semibold text-xs',
                active ? 'text-accent' : 'text-text-tertiary',
              )}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export { BottomNav };
