import { View } from 'react-native';

import { LearnHomeContent } from '@/components/organisms/learn/LearnHomeContent';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Trainings module Learn tab. Surfaces the Learn journey (roadmap, drills, XP,
 * milestones, PRD-01 FR-48/FR-50/FR-51) as a first-class player sub-nav tab
 * instead of leaving it reachable only from the dashboard MilestonesRail. It
 * renders the shared LearnHomeContent body inside the Trainings shell, which
 * owns the module title and TrainingsSubNav; deep links push the `/learn/*`
 * stack above the shell. Tied to the player's primary sport (athlete_sports,
 * now kept consistent by set_athlete_sports, 0088), so it follows sport edits.
 */
export default function TrainingsLearnScreen() {
  const colors = useThemeColors();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LearnHomeContent />
    </View>
  );
}
