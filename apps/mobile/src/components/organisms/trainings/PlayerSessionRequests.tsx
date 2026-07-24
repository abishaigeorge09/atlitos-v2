import type { Session } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Inbox } from 'lucide-react-native';
import { View } from 'react-native';

import { EmptyState } from '@/components/organisms/EmptyState';
import { SessionCard } from '@/components/ui/session-card';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Athlete dashboard "Session requests" section (PRD-01 3.3): the player's
 * own `requested` sessions still waiting on the coach. Accept and decline
 * are coach actions, so the cards render without them; tapping a card opens
 * the coaching booking detail, which carries the FR-19/FR-26 self serve
 * cancel with automatic refund (the `cancel-session-refund` edge function,
 * never rebuilt here).
 */
export interface PlayerSessionRequestsProps {
  sessions: Session[];
}

export function PlayerSessionRequests({ sessions }: PlayerSessionRequestsProps) {
  const colors = useThemeColors();

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[textStyle('h3'), { color: colors.text }]}>Session requests</Text>
      {sessions.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No pending requests"
          body="When you request a session it waits here until the coach accepts."
        />
      ) : (
        sessions.map((session) => (
          <View key={session.id} style={{ gap: spacing.xs }}>
            <SessionCard
              variant="upcoming"
              date={session.date}
              timeSlot={`${session.slot.from} to ${session.slot.to}`}
              personName={session.coachName ?? 'Coach'}
              sessionType={session.sessionTypeName ?? ''}
              focusArea={session.focusArea || 'No focus area noted'}
              location={session.location || 'Location to be confirmed'}
              onPress={() =>
                router.push({ pathname: '/(tabs)/coaching/booking/[id]', params: { id: session.id } })
              }
            />
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              Awaiting coach response. Tap to view or cancel.
            </Text>
          </View>
        ))
      )}
    </View>
  );
}
