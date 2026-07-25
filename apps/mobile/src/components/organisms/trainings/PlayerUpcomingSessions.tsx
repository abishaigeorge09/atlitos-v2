import type { MyGroupSessionEntry } from '@/lib/group-sessions';
import type { Session } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { View } from 'react-native';

import { EmptyState } from '@/components/organisms/EmptyState';
import { SessionCard } from '@/components/ui/session-card';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

function bySoonestDateTime(a: { date: string; from: string }, b: { date: string; from: string }): number {
  return a.date === b.date ? a.from.localeCompare(b.from) : a.date.localeCompare(b.date);
}

/**
 * Athlete dashboard "Upcoming sessions" section (PRD-01 3.3): the player's
 * accepted future sessions, soonest first, filtered upstream from
 * `useCoaching().listMySessions()` (explicitly player scoped, RLS is not
 * scoping), merged with the athlete's upcoming group sessions (Trainings
 * Groups Track D). Group rows carry no coach name or single session type
 * (0076: a group session has no `player_id`/`session_type_id`), so they
 * render with the group's name and the literal "Group" label the ticket
 * calls for, distinguishing them from 1:1 rows at a glance. Card tap opens
 * the trainings session detail for 1:1 rows; group rows have no athlete
 * facing detail screen yet (chat lives on Track E), so they render inert.
 * Empty state guides to the coach browse, the only way a new athlete can
 * get a session on the books.
 */
export interface PlayerUpcomingSessionsProps {
  sessions: Session[];
  onPressSession: (sessionId: string) => void;
  /** Upcoming group sessions, already scoped to the athlete's own
   * memberships upstream (fetchMyGroupSessions). */
  groupSessions?: MyGroupSessionEntry[];
  /** The Stats tab renders its own header row when a View all link is
   * needed; set to avoid a doubled heading. */
  hideHeader?: boolean;
  /** Caps the merged, date sorted row count (the Stats tab's preview
   * count); the caller decides View all visibility from its own combined
   * `sessions.length + groupSessions.length`, this only trims the render. */
  maxItems?: number;
}

export function PlayerUpcomingSessions({
  sessions,
  onPressSession,
  groupSessions = [],
  hideHeader,
  maxItems,
}: PlayerUpcomingSessionsProps) {
  const colors = useThemeColors();

  type Row =
    | { kind: 'session'; date: string; from: string; session: Session }
    | { kind: 'group'; date: string; from: string; entry: MyGroupSessionEntry };

  const allRows: Row[] = [
    ...sessions.map((session): Row => ({ kind: 'session', date: session.date, from: session.slot.from, session })),
    ...groupSessions.map(
      (entry): Row => ({ kind: 'group', date: entry.session.date, from: entry.session.slotStart, entry }),
    ),
  ].sort(bySoonestDateTime);
  const rows = typeof maxItems === 'number' ? allRows.slice(0, maxItems) : allRows;

  return (
    <View style={{ gap: spacing.sm }}>
      {hideHeader ? null : <Text style={[textStyle('h3'), { color: colors.text }]}>Upcoming sessions</Text>}
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No upcoming sessions"
          body="Book a coach and your confirmed sessions will show up here."
          ctaLabel="Find a coach"
          onCtaPress={() => router.push('/(tabs)/coaching')}
        />
      ) : (
        rows.map((row) =>
          row.kind === 'session' ? (
            <SessionCard
              key={row.session.id}
              variant="upcoming"
              date={row.session.date}
              timeSlot={`${row.session.slot.from} to ${row.session.slot.to}`}
              personName={row.session.coachName ?? 'Coach'}
              sessionType={row.session.sessionTypeName ?? ''}
              focusArea={row.session.focusArea || 'No focus area noted'}
              location={row.session.location || 'Location to be confirmed'}
              onPress={() => onPressSession(row.session.id)}
            />
          ) : (
            <SessionCard
              key={row.entry.session.id}
              variant="upcoming"
              date={row.entry.session.date}
              timeSlot={`${row.entry.session.slotStart} to ${row.entry.session.slotEnd}`}
              personName={row.entry.groupName}
              sessionType="Group"
              focusArea={row.entry.session.focusArea || 'No focus area noted'}
              location={row.entry.session.location || 'Location to be confirmed'}
            />
          ),
        )
      )}
    </View>
  );
}
