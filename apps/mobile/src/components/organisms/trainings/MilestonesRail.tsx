import type { LearnMilestone } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Lock, Trophy } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { EmptyState } from '@/components/organisms/EmptyState';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { milestoneIcon } from '@/lib/learn-display';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Athlete dashboard "Milestones and rewards" section (PRD-01 3.3, FR-51):
 * a compact horizontal rail of the Learn milestones from `get_learn_home()`
 * (server derived earned flags, trigger written `user_milestones`, never a
 * client computation), earned first, each icon resolved through
 * `milestoneIcon` (lucide only, CLAUDE.md). "Open Learn" routes to the full
 * Learn surface. `milestones` is null when the Learn read failed; the rail
 * degrades to the empty state rather than pretending zero progress.
 */
export interface MilestonesRailProps {
  milestones: LearnMilestone[] | null;
}

export function MilestonesRail({ milestones }: MilestonesRailProps) {
  const colors = useThemeColors();

  const sorted = [...(milestones ?? [])].sort((a, b) => Number(b.earned) - Number(a.earned));

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[textStyle('h3'), { color: colors.text }]}>Milestones and rewards</Text>
        <Button variant="text" size="sm" onPress={() => router.push('/learn')}>
          <Text style={{ color: colors.accent }}>Open Learn</Text>
        </Button>
      </View>

      {sorted.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No milestones yet"
          body="Complete drills in Learn to earn XP and unlock milestones."
          ctaLabel="Open Learn"
          onCtaPress={() => router.push('/learn')}
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {sorted.map((milestone) => {
            const Icon = milestoneIcon(milestone.iconName);
            const earned = milestone.earned;
            return (
              <View
                key={milestone.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radii.pill,
                  borderWidth: 1,
                  borderColor: earned ? colors.accent : colors.border,
                  backgroundColor: earned ? colors.accentTint : colors.card,
                  opacity: earned ? 1 : 0.72,
                }}
              >
                <View
                  style={{
                    height: 32,
                    width: 32,
                    borderRadius: radii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: earned ? colors.accent : colors.surfaceMuted,
                  }}
                >
                  {earned ? (
                    <Icon size={16} strokeWidth={2} color={colors.inkOnAccent} />
                  ) : (
                    <Lock size={14} strokeWidth={2} color={colors.textTertiary} />
                  )}
                </View>
                <Text style={[textStyle('label'), { color: colors.text }]}>{milestone.name}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
