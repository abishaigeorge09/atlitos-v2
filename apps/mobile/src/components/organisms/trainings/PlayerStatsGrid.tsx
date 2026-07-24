import { formatINR, spacing } from '@atlitos/theme';
import { CalendarCheck2, CalendarClock, Clock, Wallet } from 'lucide-react-native';
import { View } from 'react-native';

import { StatTile } from '@/components/ui/stat-tile';

/**
 * Athlete Stats tab 2x2 tile grid (PRD-01 3.3 FR-27, Figma "player -
 * training" 1642:37833): Total Sessions, Sessions this month, Hours
 * trained, Payments done. Every number is computed upstream from the
 * player's real session rows (`listMySessions()`, explicitly player
 * scoped), never a cached estimate. StatTile renders values in mono per
 * DESIGN-LANGUAGE.md.
 */
export interface PlayerStatsGridProps {
  totalSessions: number;
  sessionsThisMonth: number;
  hoursTrained: number;
  paymentsDone: number;
}

export function PlayerStatsGrid({ totalSessions, sessionsThisMonth, hoursTrained, paymentsDone }: PlayerStatsGridProps) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <StatTile label="Total sessions" value={totalSessions} icon={CalendarCheck2} />
        <StatTile label="This month" value={sessionsThisMonth} icon={CalendarClock} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <StatTile label="Hours trained" value={hoursTrained} icon={Clock} />
        <StatTile label="Payments done" value={formatINR(paymentsDone)} icon={Wallet} />
      </View>
    </View>
  );
}
