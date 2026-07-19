import { useCoachSessions, useCoachVerification } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock, Dumbbell, IndianRupee, Lock, Star, Users, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachVerificationStatus } from '@/components/organisms/CoachVerificationStatus';
import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Button } from '@/components/ui/button';
import { SessionCard } from '@/components/ui/session-card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { TrainingsSubNav } from '@/components/ui/trainings-sub-nav';
import { formatINR } from '@atlitos/theme';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'populated' | 'error';

const REQUEST_PREVIEW_COUNT = 3;

function goToSession(sessionId: string) {
  router.push({ pathname: '/(tabs)/trainings/session/[id]', params: { id: sessionId } });
}

/**
 * Trainings tab root. AT-45 (verification gating) plus AT-46 (Stats
 * dashboard, session requests accept/decline). Guest and player states carry
 * over their existing behaviour verbatim (Track D owns the player dashboard
 * build out, PRD-01 3.3); this task's real slice is everything from a
 * `me.coachStatus` onward: `pending_review`/`rejected` render Verification
 * Status instead of the dashboard (FR-7), `verified` renders the full Stats
 * dashboard. States: loading (skeleton), guest (locked preview), coach not
 * verified (verification status), error (profile or dashboard fetch
 * failed), populated (dashboard).
 */
export default function TrainingsScreen() {
  const colors = useThemeColors();
  const coachSessions = useCoachSessions(supabase);
  const verification = useCoachVerification(supabase);

  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const meLoading = useSessionStore((state) => state.meLoading);
  const meError = useSessionStore((state) => state.meError);
  const refreshMe = useSessionStore((state) => state.refreshMe);

  const [gateVisible, setGateVisible] = useState(false);

  const [dashState, setDashState] = useState<LoadState>('loading');
  const [dashError, setDashError] = useState<ApiError | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    playersCoached: number;
    avgRating: number;
    sessionsThisMonth: number;
    earningsThisMonth: number;
  } | null>(null);
  const [requests, setRequests] = useState<Session[]>([]);
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  const [actionErrorId, setActionErrorId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isGuest = status === 'guest';
  const isVerifiedCoach = me?.coachStatus === 'verified';
  const isPendingOrRejectedCoach = me?.coachStatus === 'pending_review' || me?.coachStatus === 'rejected';

  const loadDashboard = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setDashState('loading');
      setDashError(null);
      try {
        const [statsResult, requestsResult, upcomingResult] = await Promise.all([
          coachSessions.getStats(),
          coachSessions.listRequests(),
          coachSessions.listUpcoming(),
        ]);
        setStats(statsResult);
        setRequests(requestsResult);
        setUpcoming(upcomingResult);
        setDashState('populated');
      } catch (err) {
        setDashError(err as ApiError);
        setDashState('error');
      }
    },
    [],
  );

  useEffect(() => {
    if (!isPendingOrRejectedCoach) return;
    void verification.getStatus().then((result) => setRejectionReason(result.rejectionReason));
  }, [isPendingOrRejectedCoach]);

  useEffect(() => {
    if (isVerifiedCoach) void loadDashboard();
  }, [isVerifiedCoach, loadDashboard]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadDashboard({ silent: true });
    setRefreshing(false);
  }

  async function handleAccept(sessionId: string) {
    setActioningId(sessionId);
    setActionErrorId(null);
    try {
      await coachSessions.acceptSession(sessionId);
      await loadDashboard({ silent: true });
    } catch (err) {
      setActionErrorId(sessionId);
      setDashError(err as ApiError);
    } finally {
      setActioningId(null);
    }
  }

  async function handleDecline(sessionId: string) {
    setActioningId(sessionId);
    setActionErrorId(null);
    try {
      await coachSessions.declineSession(sessionId);
      await loadDashboard({ silent: true });
    } catch (err) {
      setActionErrorId(sessionId);
      setDashError(err as ApiError);
    } finally {
      setActioningId(null);
    }
  }

  const showLoading = status === 'signed_in' && meLoading && !me;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {isVerifiedCoach ? (
        <>
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <Text style={[textStyle('h1'), { color: colors.text }]}>Trainings</Text>
          </View>
          <TrainingsSubNav role="coach" active="stats" onChange={(tab) => navigateSubNav(tab)} />
        </>
      ) : null}

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, gap: spacing.lg }}
        refreshControl={
          isVerifiedCoach ? <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} /> : undefined
        }
      >
        {!isVerifiedCoach ? <Text style={[textStyle('h1'), { color: colors.text }]}>Trainings</Text> : null}

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
          <EmptyState
            icon={Lock}
            title="Set up your profile to train"
            body="Book coaches, track sessions and see your progress once you have an account."
            ctaLabel="Get started"
            onCtaPress={() => setGateVisible(true)}
          />
        ) : isPendingOrRejectedCoach && me ? (
          <CoachVerificationStatus status={me.coachStatus as 'pending_review' | 'rejected'} rejectionReason={rejectionReason} />
        ) : isVerifiedCoach ? (
          dashState === 'loading' ? (
            <View style={{ gap: spacing.lg }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Skeleton shape="card" height={96} />
                <Skeleton shape="card" height={96} />
              </View>
              <Skeleton shape="card" height={140} />
              <Skeleton shape="card" height={140} />
            </View>
          ) : dashState === 'error' ? (
            <EmptyState
              icon={TriangleAlert}
              title="Could not load your dashboard"
              body={dashError?.message ?? 'Something went wrong. Please try again.'}
              ctaLabel="Retry"
              onCtaPress={() => void loadDashboard()}
            />
          ) : stats && requests.length === 0 && upcoming.length === 0 && stats.sessionsThisMonth === 0 ? (
            <EmptyState
              icon={Dumbbell}
              title="No sessions yet"
              body="Set your availability so athletes can find open slots and send you a request."
              ctaLabel="Set your availability"
              onCtaPress={() => router.push('/(tabs)/trainings/availability')}
            />
          ) : (
            <View style={{ gap: spacing.lg }}>
              {stats ? (
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <StatTile label="Players coached" value={stats.playersCoached} icon={Users} />
                    <StatTile label="Avg rating" value={stats.avgRating.toFixed(1)} icon={Star} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <StatTile label="Sessions this month" value={stats.sessionsThisMonth} icon={CalendarClock} />
                    <StatTile label="Earnings this month" value={formatINR(stats.earningsThisMonth)} icon={IndianRupee} />
                  </View>
                </View>
              ) : null}

              <View style={{ gap: spacing.sm }}>
                <View className="flex-row items-center justify-between">
                  <Text style={[textStyle('h3'), { color: colors.text }]}>Session requests</Text>
                  {requests.length > REQUEST_PREVIEW_COUNT ? (
                    <Button variant="text" size="sm" onPress={() => router.push('/(tabs)/trainings/requests')}>
                      <Text style={{ color: colors.accent }}>View all</Text>
                    </Button>
                  ) : null}
                </View>
                {requests.length === 0 ? (
                  <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>No pending requests</Text>
                ) : (
                  requests.slice(0, REQUEST_PREVIEW_COUNT).map((session) => (
                    <View key={session.id} style={{ gap: spacing.xs }}>
                      <SessionCard
                        variant="request"
                        date={session.date}
                        timeSlot={`${session.slot.from} to ${session.slot.to}`}
                        personName={session.playerName ?? 'Athlete'}
                        sessionType={session.sessionTypeName ?? ''}
                        focusArea={session.focusArea || 'No focus area noted'}
                        location={session.location || 'Location to be confirmed'}
                        onPress={() => goToSession(session.id)}
                        onAccept={() => void handleAccept(session.id)}
                        onDecline={() => void handleDecline(session.id)}
                      />
                      {actioningId === session.id ? (
                        <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Updating...</Text>
                      ) : actionErrorId === session.id ? (
                        <Text style={[textStyle('caption'), { color: colors.danger }]}>
                          {dashError?.message ?? 'Could not update this request. Try again.'}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}
              </View>

              <View style={{ gap: spacing.sm }}>
                <Text style={[textStyle('h3'), { color: colors.text }]}>Upcoming sessions</Text>
                {upcoming.length === 0 ? (
                  <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>No upcoming sessions</Text>
                ) : (
                  upcoming.map((session) => (
                    <SessionCard
                      key={session.id}
                      variant="upcoming"
                      date={session.date}
                      timeSlot={`${session.slot.from} to ${session.slot.to}`}
                      personName={session.playerName ?? 'Athlete'}
                      sessionType={session.sessionTypeName ?? ''}
                      focusArea={session.focusArea || 'No focus area noted'}
                      location={session.location || 'Location to be confirmed'}
                      onPress={() => goToSession(session.id)}
                    />
                  ))
                )}
              </View>
            </View>
          )
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon={Dumbbell}
              title="Your training dashboard is warming up"
              body="Session booking, stats and requests land here in the next phase."
            />
          </View>
        )}
      </ScrollView>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}

function navigateSubNav(tab: string) {
  switch (tab) {
    case 'trainees':
      router.push('/(tabs)/trainings/trainees');
      return;
    case 'earnings':
      router.push('/(tabs)/trainings/earnings');
      return;
    case 'chat':
      router.push('/(tabs)/trainings/chat');
      return;
    case 'analytics':
      router.push('/(tabs)/trainings/analytics');
      return;
    default:
      return;
  }
}
