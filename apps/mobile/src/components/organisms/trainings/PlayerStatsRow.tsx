import { spacing } from '@atlitos/theme';
import { CalendarCheck2, Clock, Zap } from 'lucide-react-native';
import { View } from 'react-native';

import { StatTile } from '@/components/ui/stat-tile';

/**
 * Athlete Trainings dashboard stats row (PRD-01 3.3, FR-27). Three tiles,
 * every number computed from the player's real rows upstream: sessions
 * completed (`completed`/`rated` count), hours trained (sum of slot
 * durations of those same sessions), and XP (server derived by
 * `get_learn_home()`, never summed client side). StatTile renders values in
 * mono per DESIGN-LANGUAGE.md. `xpTotal` is null when the Learn read failed
 * or has not resolved; the tile is omitted rather than showing a fake zero.
 */
export interface PlayerStatsRowProps {
  sessionsCompleted: number;
  hoursTrained: number;
  xpTotal: number | null;
}

export function PlayerStatsRow({ sessionsCompleted, hoursTrained, xpTotal }: PlayerStatsRowProps) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <StatTile label="Sessions" value={sessionsCompleted} icon={CalendarCheck2} />
      <StatTile label="Hours" value={hoursTrained} icon={Clock} />
      {xpTotal !== null ? <StatTile label="XP" value={xpTotal} icon={Zap} /> : null}
    </View>
  );
}
