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

/**
 * Athlete dashboard "Upcoming sessions" section (PRD-01 3.3): the player's
 * accepted future sessions, soonest first, filtered upstream from
 * `useCoaching().listMySessions()` (explicitly player scoped, RLS is not
 * scoping). Card tap opens the trainings session detail, which renders the
 * player perspective. Empty state guides to the coach browse, the only way
 * a new athlete can get a session on the books.
 */
export interface PlayerUpcomingSessionsProps {
  sessions: Session[];
  onPressSession: (sessionId: string) => void;
}

export function PlayerUpcomingSessions({ sessions, onPressSession }: PlayerUpcomingSessionsProps) {
  const colors = useThemeColors();

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[textStyle('h3'), { color: colors.text }]}>Upcoming sessions</Text>
      {sessions.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No upcoming sessions"
          body="Book a coach and your confirmed sessions will show up here."
          ctaLabel="Find a coach"
          onCtaPress={() => router.push('/(tabs)/coaching')}
        />
      ) : (
        sessions.map((session) => (
          <SessionCard
            key={session.id}
            variant="upcoming"
            date={session.date}
            timeSlot={`${session.slot.from} to ${session.slot.to}`}
            personName={session.coachName ?? 'Coach'}
            sessionType={session.sessionTypeName ?? ''}
            focusArea={session.focusArea || 'No focus area noted'}
            location={session.location || 'Location to be confirmed'}
            onPress={() => onPressSession(session.id)}
          />
        ))
      )}
    </View>
  );
}
