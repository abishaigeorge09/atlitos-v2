import { spacing } from '@atlitos/theme';
import { Dumbbell, Lock, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { EmptyState } from '@/components/organisms/EmptyState';
import { StatusPill } from '@/components/organisms/_shared';
import { Skeleton } from '@/components/ui/skeleton';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const COACH_STATUS_LABEL: Record<'pending_review' | 'verified' | 'rejected', string> = {
  pending_review: 'Verification pending',
  verified: 'Verified coach',
  rejected: 'Verification rejected',
};

const COACH_STATUS_TONE: Record<'pending_review' | 'verified' | 'rejected', 'warning' | 'success' | 'danger'> = {
  pending_review: 'warning',
  verified: 'success',
  rejected: 'danger',
};

/**
 * Trainings tab. PRD-01 3.3 and PRD-02 3.3 own the full coach/player
 * dashboards (StatTiles, session lists, requests) once the coaching domain
 * migration lands (P3, `useSessions`/`useCoaches` in packages/api/src/hooks.ts
 * are still `TODO`). This screen ships this task's real slice: PRD-01 FR-5's
 * guest-locked preview (never another user's data), the coach's real
 * verification status when one exists, and an honest empty state otherwise.
 * States: loading, error (profile fetch failed), populated (guest-locked or
 * signed-in placeholder).
 */
export default function TrainingsScreen() {
  const colors = useThemeColors();
  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const meLoading = useSessionStore((state) => state.meLoading);
  const meError = useSessionStore((state) => state.meError);
  const refreshMe = useSessionStore((state) => state.refreshMe);

  const [gateVisible, setGateVisible] = useState(false);

  const isGuest = status === 'guest';
  const showLoading = status === 'signed_in' && meLoading && !me;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, gap: spacing.lg }}>
        <Text style={[textStyle('h1'), { color: colors.text }]}>Trainings</Text>

        {showLoading ? (
          <View style={{ gap: spacing.sm }}>
            <Skeleton shape="tile" width="40%" height={24} />
            <Skeleton shape="card" />
            <Skeleton shape="card" />
          </View>
        ) : status === 'signed_in' && meError ? (
          <EmptyState
            icon={TriangleAlert}
            title="Could not load your dashboard"
            body="Check your connection and try again."
            ctaLabel="Retry"
            onCtaPress={() => void refreshMe()}
          />
        ) : isGuest ? (
          // FR-5: guest sees a locked preview with a single CTA to set up a
          // profile, never another player's or coach's data.
          <EmptyState
            icon={Lock}
            title="Set up your profile to train"
            body="Book coaches, track sessions and see your progress once you have an account."
            ctaLabel="Get started"
            onCtaPress={() => setGateVisible(true)}
          />
        ) : (
          <View style={{ flex: 1, gap: spacing.lg }}>
            {me?.coachStatus ? (
              <View style={{ alignItems: 'flex-start' }}>
                <StatusPill
                  label={COACH_STATUS_LABEL[me.coachStatus]}
                  tone={COACH_STATUS_TONE[me.coachStatus]}
                />
              </View>
            ) : null}

            <View style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState
                icon={Dumbbell}
                title="Your training dashboard is warming up"
                body="Session booking, stats and requests land here in the next phase."
              />
            </View>
          </View>
        )}
      </ScrollView>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
