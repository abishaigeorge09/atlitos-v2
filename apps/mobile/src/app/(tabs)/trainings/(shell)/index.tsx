import { useCoaching, useCoachSessions, useCoachVerification, useGroups, useLearn, type GroupMembership, type LearnHome } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock, Dumbbell, IndianRupee, Lock, Star, Users, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { CoachVerificationStatus } from '@/components/organisms/CoachVerificationStatus';
import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { FindCoachCard } from '@/components/organisms/trainings/FindCoachCard';
import { MilestonesRail } from '@/components/organisms/trainings/MilestonesRail';
import { MyGroupsCard } from '@/components/organisms/trainings/MyGroupsCard';
import { MySportsCard } from '@/components/organisms/trainings/MySportsCard';
import { PlayerSessionRequests } from '@/components/organisms/trainings/PlayerSessionRequests';
import { PlayerStatsGrid } from '@/components/organisms/trainings/PlayerStatsGrid';
import { PlayerUpcomingSessions } from '@/components/organisms/trainings/PlayerUpcomingSessions';
import { Button } from '@/components/ui/button';
import { SessionCard } from '@/components/ui/session-card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { formatINR } from '@atlitos/theme';
import { fetchMyGroupSessions, type MyGroupSessionEntry } from '@/lib/group-sessions';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'populated' | 'error';

const REQUEST_PREVIEW_COUNT = 3;
const UPCOMING_PREVIEW_COUNT = 3;

/** Sessions that were actually paid for and not declined or cancelled,
 * mirroring the coaching bookings list's stat definitions (PRD-01 FR-27). */
const LIVE_STATUSES: Session['status'][] = ['requested', 'accepted', 'completed', 'rescheduled', 'rated'];

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
 * (locked preview), error (retry), populated. Renders as the Stats tab
 * content inside the Trainings shell layout, which owns the module title
 * and TrainingsSubNav; this screen renders no header of its own.
 */
export default function TrainingsScreen() {
  const colors = useThemeColors();
  const coachSessions = useCoachSessions(supabase);
  const verification = useCoachVerification(supabase);
  const coaching = useCoaching(supabase);
  const groups = useGroups(supabase);
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
    totalSessions: number;
    sessionsThisMonth: number;
    earningsThisMonth: number;
    lifetimeEarnings: number;
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
  const [myMemberships, setMyMemberships] = useState<GroupMembership[]>([]);
  const [myGroupSessions, setMyGroupSessions] = useState<MyGroupSessionEntry[]>([]);

  const isGuest = status === 'guest';
  const isVerifiedCoach = me?.coachStatus === 'verified';
  const isPendingOrRejectedCoach = me?.coachStatus === 'pending_review' || me?.coachStatus === 'rejected';
  const isPlayer = status === 'signed_in' && !!me && !isVerifiedCoach && !isPendingOrRejectedCoach;

  const loadDashboard = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setDashState('loading');
      setDashError(null);
      try {
        // The Learn read only feeds the coach milestones rail (Figma node
        // 1047:13282 shows it on the coach dashboard too), so its failure
        // degrades that rail to its empty state instead of erroring the
        // whole dashboard, mirroring the athlete load below.
        const [statsResult, requestsResult, upcomingResult, learnResult] = await Promise.all([
          coachSessions.getStats(),
          coachSessions.listRequests(),
          coachSessions.listUpcoming(),
          learn.getLearnHome().catch(() => null),
        ]);
        setStats(statsResult);
        setRequests(requestsResult);
        setUpcoming(upcomingResult);
        setLearnHome(learnResult);
        setDashState('populated');
      } catch (err) {
        setDashError(err as ApiError);
        setDashState('error');
      }
    },
    [learn],
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

  // Groups: my memberships (My groups card + renew prompts) and, once those
  // resolve, the group sessions they unlock for the Upcoming sessions list.
  // Explicitly player scoped through `myMemberships()` (player_id = me,
  // RLS is not scoping); a failure here degrades to no groups shown rather
  // than blocking the rest of the dashboard, same allSettled posture as the
  // Learn read above.
  const loadGroups = useCallback(async () => {
    try {
      const memberships = await groups.myMemberships();
      setMyMemberships(memberships);
      const sessions = await fetchMyGroupSessions(supabase, memberships);
      setMyGroupSessions(sessions);
    } catch {
      setMyMemberships([]);
      setMyGroupSessions([]);
    }
  }, []);

  useEffect(() => {
    if (isPlayer) void loadGroups();
  }, [isPlayer, loadGroups]);

  function handleRenewMembership(membership: GroupMembership) {
    router.push({
      pathname: '/(tabs)/coaching/group/renew',
      params: {
        membershipId: membership.id,
        groupName: membership.group?.name ?? 'Group',
        monthlyFee: String(membership.group?.monthlyFee ?? membership.price),
      },
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    if (isVerifiedCoach) {
      await loadDashboard({ silent: true });
    } else {
      await Promise.all([loadPlayerDashboard({ silent: true }), loadGroups()]);
    }
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
  // history, never cached estimates). Same stat definitions as the
  // coaching bookings list (its own documented judgment call): total and
  // this month count every paid, not declined or cancelled session; hours
  // and payments only count sessions that actually happened, so a pending
  // request never inflates hours trained or payments done.
  const liveSessions = mySessions.filter((session) => LIVE_STATUSES.includes(session.status));
  const today = todayISO();
  const liveThisMonth = liveSessions.filter((session) => session.date.slice(0, 7) === today.slice(0, 7));
  const heldSessions = mySessions.filter((session) => session.status === 'completed' || session.status === 'rated');
  const heldMinutes = heldSessions.reduce(
    (sum, session) => sum + (timeToMinutes(session.slot.to) - timeToMinutes(session.slot.from)),
    0,
  );
  const hoursTrained = Math.round((heldMinutes / 60) * 10) / 10;
  const paymentsDone = heldSessions.reduce((sum, session) => sum + session.total, 0);
  const upcomingSessions = mySessions.filter((session) => session.status === 'accepted' && session.date >= today).sort(bySoonest);
  const requestedSessions = mySessions.filter((session) => session.status === 'requested').sort(bySoonest);
  const hasAnySession = mySessions.length > 0;

  // Group sessions upcoming for the same "accepted future" window as 1:1
  // sessions above (`in_progress` also counts, the coach may already have
  // started it; a group session skips `requested` entirely, see 0076).
  const upcomingGroupSessions = myGroupSessions.filter(
    (entry) =>
      entry.session.date >= today && (entry.session.status === 'accepted' || entry.session.status === 'in_progress'),
  );
  const totalUpcomingCount = upcomingSessions.length + upcomingGroupSessions.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, gap: spacing.lg }}
        refreshControl={
          isVerifiedCoach || isPlayer ? (
            <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
          ) : undefined
        }
      >
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
                    <StatTile label="Total sessions" value={stats.totalSessions} icon={Dumbbell} />
                    <StatTile label="Sessions this month" value={stats.sessionsThisMonth} icon={CalendarClock} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <StatTile label="Total earnings" value={formatINR(stats.lifetimeEarnings)} icon={IndianRupee} />
                    <StatTile label="Earnings this month" value={formatINR(stats.earningsThisMonth)} icon={IndianRupee} />
                  </View>
                </View>
              ) : null}

              {/* PRD-02 3.3 dashboard order: stat grid, Upcoming sessions,
                  Session Requests. Availability keeps a persistent entry
                  here; the empty state CTA was its only route in before. */}
              <View style={{ gap: spacing.sm }}>
                <View className="flex-row items-center justify-between">
                  <Text style={[textStyle('h3'), { color: colors.text }]}>Upcoming sessions</Text>
                  <View className="flex-row items-center">
                    <Button variant="text" size="sm" onPress={() => router.push('/(tabs)/trainings/availability')}>
                      <Text style={{ color: colors.accent }}>Availability</Text>
                    </Button>
                    <Button variant="text" size="sm" onPress={() => router.push('/(tabs)/trainings/upcoming')}>
                      <Text style={{ color: colors.accent }}>View all</Text>
                    </Button>
                  </View>
                </View>
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

              <MilestonesRail milestones={learnHome ? learnHome.milestones : null} />
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
            <View style={{ gap: spacing.xs }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>Your trainings at a glance</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                Your growth, goals and game, all in one place.
              </Text>
            </View>
            <PlayerStatsGrid
              totalSessions={liveSessions.length}
              sessionsThisMonth={liveThisMonth.length}
              hoursTrained={hoursTrained}
              paymentsDone={paymentsDone}
            />
            {me?.sports?.length ? <MySportsCard sports={me.sports} /> : null}
            <MyGroupsCard memberships={myMemberships} onRenew={handleRenewMembership} />
            {!hasAnySession ? <FindCoachCard /> : null}
            <View style={{ gap: spacing.sm }}>
              {totalUpcomingCount > UPCOMING_PREVIEW_COUNT ? (
                <View className="flex-row items-center justify-between">
                  <Text style={[textStyle('h3'), { color: colors.text }]}>Upcoming sessions</Text>
                  <Button variant="text" size="sm" onPress={() => router.push('/(tabs)/coaching/bookings')}>
                    <Text style={{ color: colors.accent }}>View all</Text>
                  </Button>
                </View>
              ) : null}
              <PlayerUpcomingSessions
                sessions={upcomingSessions}
                groupSessions={upcomingGroupSessions}
                maxItems={UPCOMING_PREVIEW_COUNT}
                onPressSession={goToSession}
                hideHeader={totalUpcomingCount > UPCOMING_PREVIEW_COUNT}
              />
            </View>
            <PlayerSessionRequests sessions={requestedSessions} />
            <MilestonesRail milestones={learnHome ? learnHome.milestones : null} />
            {hasAnySession ? <FindCoachCard /> : null}
          </View>
        )}
      </ScrollView>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </View>
  );
}
