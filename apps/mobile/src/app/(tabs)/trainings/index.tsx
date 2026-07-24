import { useCoaching, useCoachSessions, useCoachVerification, useLearn, type LearnHome } from '@atlitos/api';
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
import { FindCoachCard } from '@/components/organisms/trainings/FindCoachCard';
import { MilestonesRail } from '@/components/organisms/trainings/MilestonesRail';
import { PlayerSessionRequests } from '@/components/organisms/trainings/PlayerSessionRequests';
import { PlayerStatsRow } from '@/components/organisms/trainings/PlayerStatsRow';
import { PlayerUpcomingSessions } from '@/components/organisms/trainings/PlayerUpcomingSessions';
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

function timeToMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function bySoonest(a: Session, b: Session): number {
  return a.date === b.date ? a.slot.from.localeCompare(b.slot.from) : a.date.localeCompare(b.date);
}

/**
 * Trainings tab root. AT-45 (verification gating) plus AT-46 (coach Stats
 * dashboard, session requests accept/decline), and the athlete dashboard
 * (PRD-01 3.3, Figma "Trainings - home": Stats, Upcoming sessions, Session
 * Requests, Milestones and Rewards). Role branches: `pending_review`/
 * `rejected` render Verification Status instead of the dashboard (FR-7),
 * `verified` renders the coach Stats dashboard, any other signed in user is
 * an athlete and gets the player dashboard: StatTiles computed from
 * `listMySessions()` (explicitly `player_id` scoped, RLS is not scoping)
 * plus `get_learn_home()`'s server derived XP (FR-27), upcoming accepted
 * sessions, own pending requests (cancel lives on the coaching booking
 * detail, FR-26), the Learn milestones rail (FR-51), and a find a coach
 * entry into `/(tabs)/coaching`. States per role: loading (skeleton), guest
 * (locked preview), error (retry), populated.
 */
export default function TrainingsScreen() {
  const colors = useThemeColors();
  const coachSessions = useCoachSessions(supabase);
  const verification = useCoachVerification(supabase);
  const coaching = useCoaching(supabase);
  const learn = useLearn(supabase);

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

  const [playerState, setPlayerState] = useState<LoadState>('loading');
  const [playerError, setPlayerError] = useState<ApiError | null>(null);
  const [mySessions, setMySessions] = useState<Session[]>([]);
  const [learnHome, setLearnHome] = useState<LearnHome | null>(null);

  const isGuest = status === 'guest';
  const isVerifiedCoach = me?.coachStatus === 'verified';
  const isPendingOrRejectedCoach = me?.coachStatus === 'pending_review' || me?.coachStatus === 'rejected';
  const isPlayer = status === 'signed_in' && !!me && !isVerifiedCoach && !isPendingOrRejectedCoach;

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

  // Athlete dashboard load. Sessions are the load bearing read: a failure
  // there is the section's error state. The Learn read only feeds the XP
  // tile and the milestones rail, so its failure degrades those two
  // gracefully (no XP tile, milestones empty state) instead of blanking the
  // whole dashboard, hence allSettled rather than all.
  const loadPlayerDashboard = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setPlayerState('loading');
      setPlayerError(null);
      const [sessionsResult, learnResult] = await Promise.allSettled([
        coaching.listMySessions(),
        learn.getLearnHome(),
      ]);
      setLearnHome(learnResult.status === 'fulfilled' ? learnResult.value : null);
      if (sessionsResult.status === 'fulfilled') {
        setMySessions(sessionsResult.value);
        setPlayerState('populated');
      } else {
        setPlayerError(sessionsResult.reason as ApiError);
        setPlayerState('error');
      }
    },
    [learn],
  );

  useEffect(() => {
    if (isPlayer) void loadPlayerDashboard();
  }, [isPlayer, loadPlayerDashboard]);

  async function handleRefresh() {
    setRefreshing(true);
    await (isVerifiedCoach ? loadDashboard({ silent: true }) : loadPlayerDashboard({ silent: true }));
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

  // Athlete derivations, all from the player's own rows (FR-27: real
  // history, never cached estimates). Held sessions are the ones that
  // actually happened; a pending request never inflates hours trained.
  const heldSessions = mySessions.filter((session) => session.status === 'completed' || session.status === 'rated');
  const heldMinutes = heldSessions.reduce(
    (sum, session) => sum + (timeToMinutes(session.slot.to) - timeToMinutes(session.slot.from)),
    0,
  );
  const hoursTrained = Math.round((heldMinutes / 60) * 10) / 10;
  const today = todayISO();
  const upcomingSessions = mySessions.filter((session) => session.status === 'accepted' && session.date >= today).sort(bySoonest);
  const requestedSessions = mySessions.filter((session) => session.status === 'requested').sort(bySoonest);
  const hasAnySession = mySessions.length > 0;

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
          isVerifiedCoach || isPlayer ? (
            <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
          ) : undefined
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
        ) : playerState === 'loading' ? (
          <View style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Skeleton shape="card" height={96} />
              <Skeleton shape="card" height={96} />
              <Skeleton shape="card" height={96} />
            </View>
            <Skeleton shape="card" height={140} />
            <Skeleton shape="card" height={140} />
            <Skeleton shape="card" height={72} />
          </View>
        ) : playerState === 'error' ? (
          <EmptyState
            icon={TriangleAlert}
            title="Could not load your dashboard"
            body={playerError?.message ?? 'Something went wrong. Please try again.'}
            ctaLabel="Retry"
            onCtaPress={() => void loadPlayerDashboard()}
          />
        ) : (
          <View style={{ gap: spacing.lg }}>
            <PlayerStatsRow
              sessionsCompleted={heldSessions.length}
              hoursTrained={hoursTrained}
              xpTotal={learnHome ? learnHome.xpTotal : null}
            />
            {!hasAnySession ? <FindCoachCard /> : null}
            <PlayerUpcomingSessions sessions={upcomingSessions} onPressSession={goToSession} />
            <PlayerSessionRequests sessions={requestedSessions} />
            <MilestonesRail milestones={learnHome ? learnHome.milestones : null} />
            {hasAnySession ? <FindCoachCard /> : null}
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
