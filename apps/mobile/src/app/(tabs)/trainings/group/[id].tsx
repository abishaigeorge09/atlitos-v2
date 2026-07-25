import { useGroups, type GroupDetail, type GroupMember, type GroupSession } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarCheck2, CalendarX2, ClipboardList, Percent, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { SESSION_STATUS_PILL } from '@/lib/session-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type GroupTab = 'overview' | 'sessions';

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/** Membership display state for the Team Members chips. `lapsed` rows are
 * excluded from `getGroup`, but an `active` membership whose paid period
 * has ended reads as Lapsed under the manual renewal fares model (no
 * autopay, D-053): the member keeps their seat, the chip tells the coach
 * the month has not been renewed yet. */
function memberChip(member: GroupMember): { label: string; tone: 'active' | 'lapsed' | 'pending' } {
  if (member.membership.status === 'pending') return { label: 'Pending', tone: 'pending' };
  const periodEnd = member.membership.periodEnd;
  if (periodEnd && periodEnd < todayISO()) return { label: 'Lapsed', tone: 'lapsed' };
  return { label: 'Active', tone: 'active' };
}

function AttributeRow({ label, children }: { label: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * Group/Team profile drill in (Figma node 1047:14094 Overview, 1047:14630
 * Sessions), pushed above the fixed Trainings shell like
 * `trainee/[id].tsx`. Overview: the group attribute card (sport, skill
 * level, capacity, monthly fee, billing), Total Sessions + Attendance
 * Rate tiles from the real `getGroup` read (attendance rate is present
 * over marked participant rows, undefined until one session has marked
 * attendance), the Team Members list from `group_memberships` with
 * Active / Lapsed / Pending chips, and the attendance policy block.
 * Sessions: upcoming then all of `groupSessions`, each row opening the
 * group session detail. No money figure here is hand rolled: the only
 * amount shown is the group's monthly fee via PriceText.
 */
export default function GroupProfileScreen() {
  const colors = useThemeColors();
  const groups = useGroups(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [sessions, setSessions] = useState<GroupSession[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<GroupTab>('overview');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const [detailResult, sessionsResult] = await Promise.all([
        groups.getGroup(id),
        groups.groupSessions(id),
      ]);
      // RLS is not scoping (CLAUDE.md): training_groups has a public browse
      // policy, so getGroup happily returns another verified coach's group
      // for a guessed id. This is the coach's own group profile screen, so
      // ownership is asserted explicitly here.
      const { data: authData } = await supabase.auth.getUser();
      if (!detailResult || !authData.user || detailResult.group.coachId !== authData.user.id) {
        setError({ code: 'NOT_FOUND', message: 'This group could not be found.', status: 404 });
        setState('error');
        return;
      }
      setDetail(detailResult);
      setSessions(sessionsResult);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="card" height={160} />
          <Skeleton shape="card" height={96} />
          <Skeleton shape="card" height={140} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !detail) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.message ?? 'This group could not be found.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const { group, members, attendanceRate } = detail;
  const today = todayISO();
  const liveSessions = sessions.filter((s) => s.status !== 'cancelled');
  const upcoming = liveSessions
    .filter((s) => s.date >= today && (s.status === 'accepted' || s.status === 'in_progress'))
    .sort((a, b) => (a.date === b.date ? a.slotStart.localeCompare(b.slotStart) : a.date.localeCompare(b.date)));

  const chipToneStyles = {
    active: { backgroundColor: colors.successTint, color: colors.success },
    lapsed: { backgroundColor: colors.warningTint, color: colors.warning },
    pending: { backgroundColor: colors.surfaceMuted, color: colors.textSecondary },
  } as const;

  function goToSession(sessionId: string) {
    router.push({ pathname: '/(tabs)/trainings/group-session/[id]', params: { id: sessionId } });
  }

  function SessionRow({ session }: { session: GroupSession }) {
    return (
      <Pressable
        onPress={() => goToSession(session.id)}
        style={{
          borderRadius: radii.xl,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          padding: spacing.lg,
          gap: spacing.xs,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[textStyle('body'), { color: colors.text }]}>
            {session.date}, {session.slotStart} to {session.slotEnd}
          </Text>
          <StatusPill status={SESSION_STATUS_PILL[session.status]} />
        </View>
        <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
          {session.focusArea || 'No focus area noted'}{session.location ? `, ${session.location}` : ''}
        </Text>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title={group.name} onPressBack={() => router.back()} />

      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
        {(['overview', 'sessions'] as const).map((key) => {
          const isActive = tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              onPress={() => setTab(key)}
              style={{
                borderRadius: radii.pill,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderWidth: 1,
                borderColor: isActive ? colors.accent : colors.border,
                backgroundColor: isActive ? colors.accentTint : colors.surfaceMuted,
              }}
            >
              <Text style={[textStyle('label'), { color: isActive ? colors.accent : colors.textSecondary }]}>
                {key === 'overview' ? 'Overview' : 'Sessions'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
      >
        {tab === 'overview' ? (
          <View style={{ gap: spacing.lg }}>
            <View
              style={{
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
                gap: spacing.md,
              }}
            >
              <AttributeRow label="Sport">
                <Text style={[textStyle('body'), { color: colors.text }]}>{titleCase(group.sport)}</Text>
              </AttributeRow>
              {group.skillLevel ? (
                <AttributeRow label="Skill level">
                  <Text style={[textStyle('body'), { color: colors.text }]}>{titleCase(group.skillLevel)}</Text>
                </AttributeRow>
              ) : null}
              <AttributeRow label="Capacity">
                <Text style={[textStyle('numericBase'), { color: colors.text }]}>
                  {group.activeMembers ?? members.length} of {group.capacity}
                </Text>
              </AttributeRow>
              <AttributeRow label="Monthly fee">
                <PriceText amount={group.monthlyFee} />
              </AttributeRow>
              <AttributeRow label="Billing">
                <Text style={[textStyle('body'), { color: colors.text }]}>Monthly, renewed manually</Text>
              </AttributeRow>
              <AttributeRow label="Status">
                <Text style={[textStyle('body'), { color: group.active ? colors.success : colors.textSecondary }]}>
                  {group.active ? 'Active' : 'Inactive'}
                </Text>
              </AttributeRow>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <StatTile label="Total sessions" value={liveSessions.length} icon={CalendarCheck2} />
              <StatTile
                label="Attendance rate"
                value={attendanceRate !== undefined ? `${Math.round(attendanceRate * 100)}%` : 'No data'}
                icon={Percent}
              />
            </View>

            <View style={{ gap: spacing.sm }}>
              <Text style={[textStyle('h3'), { color: colors.text }]}>Team members</Text>
              {members.length === 0 ? (
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                  No members yet. Athletes join from your coach profile.
                </Text>
              ) : (
                members.map((member) => {
                  const chip = memberChip(member);
                  const tone = chipToneStyles[chip.tone];
                  return (
                    <Pressable
                      key={member.playerId}
                      onPress={() =>
                        router.push({ pathname: '/(tabs)/trainings/trainee/[id]', params: { id: member.playerId } })
                      }
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                        borderRadius: radii.xl,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                        padding: spacing.md,
                      }}
                    >
                      <Avatar uri={member.avatarUrl} name={member.name} size={40} />
                      <View style={{ flex: 1, gap: 0 }}>
                        <Text style={[textStyle('body'), { color: colors.text }]}>{member.name}</Text>
                        {member.attendanceRate !== undefined ? (
                          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                            Attendance {Math.round(member.attendanceRate * 100)}%
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={{
                          borderRadius: radii.pill,
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.xs,
                          backgroundColor: tone.backgroundColor,
                        }}
                      >
                        <Text style={[textStyle('label'), { color: tone.color }]}>{chip.label}</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

            {group.attendancePolicy ? (
              <View
                style={{
                  borderRadius: radii.xl,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  padding: spacing.lg,
                  gap: spacing.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <ClipboardList size={20} color={colors.textSecondary} strokeWidth={1.75} />
                  <Text style={[textStyle('h3'), { color: colors.text }]}>Attendance policy</Text>
                </View>
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{group.attendancePolicy}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.sm }}>
              <Text style={[textStyle('h3'), { color: colors.text }]}>Upcoming sessions</Text>
              {upcoming.length === 0 ? (
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>No upcoming sessions.</Text>
              ) : (
                upcoming.map((session) => <SessionRow key={session.id} session={session} />)
              )}
            </View>

            <View style={{ gap: spacing.sm }}>
              <Text style={[textStyle('h3'), { color: colors.text }]}>All sessions</Text>
              {sessions.length === 0 ? (
                <View style={{ alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
                  <CalendarX2 size={40} color={colors.textTertiary} strokeWidth={1.75} />
                  <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                    No sessions scheduled for this group yet.
                  </Text>
                </View>
              ) : (
                sessions.map((session) => <SessionRow key={session.id} session={session} />)
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
