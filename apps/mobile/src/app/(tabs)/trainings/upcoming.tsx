import { isOnlineSessionTypeName, useCoachSessions, useGroups } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarX2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SessionFilterChips, type SessionFilterKey } from '@/components/organisms/trainings/SessionFilterChips';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { SessionCard } from '@/components/ui/session-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

interface UpcomingEntry {
  key: string;
  kind: 'one_on_one' | 'group';
  online: boolean;
  date: string;
  from: string;
  to: string;
  personName: string;
  sessionType: string;
  focusArea: string;
  location: string;
  targetId: string;
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Dedicated coach Upcoming Sessions list (Figma node 1047:15461), a drill
 * in above the fixed shell, reached from the dashboard's Upcoming
 * "View all". Mixes the 1:1 upcoming read (`listUpcoming`, accepted or
 * rescheduled) with every group's upcoming sessions (accepted or
 * in_progress, from `useGroups.listMyGroups` + `groupSessions`, both
 * coach scoped reads), soonest first, behind the shared All / 1 on 1 /
 * Group / Online filter chips. 1:1 cards open the session detail, group
 * cards open the group session detail. States: loading, empty, populated
 * (with per filter empty text), error.
 */
export default function CoachUpcomingSessionsScreen() {
  const colors = useThemeColors();
  const coachSessions = useCoachSessions(supabase);
  const groups = useGroups(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [entries, setEntries] = useState<UpcomingEntry[]>([]);
  const [filter, setFilter] = useState<SessionFilterKey>('all');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const [oneOnOne, myGroups] = await Promise.all([
        coachSessions.listUpcoming(),
        groups.listMyGroups(),
      ]);
      // One query for every group, not one per group. Grouped by id below so
      // the rendering below is unchanged.
      const allGroupSessions = await groups.groupSessionsForGroups(myGroups.map((g) => g.id));
      const sessionsByGroupId = new Map<string, typeof allGroupSessions>();
      for (const session of allGroupSessions) {
        if (!session.groupId) continue;
        const bucket = sessionsByGroupId.get(session.groupId);
        if (bucket) bucket.push(session);
        else sessionsByGroupId.set(session.groupId, [session]);
      }
      const today = todayISO();

      const oneOnOneEntries = oneOnOne.map((session: Session): UpcomingEntry => ({
        key: `session-${session.id}`,
        kind: 'one_on_one',
        online: isOnlineSessionTypeName(session.sessionTypeName),
        date: session.date,
        from: session.slot.from,
        to: session.slot.to,
        personName: session.playerName ?? 'Athlete',
        sessionType: session.sessionTypeName ?? '',
        focusArea: session.focusArea || 'No focus area noted',
        location: session.location || 'Location to be confirmed',
        targetId: session.id,
      }));

      const groupEntries = myGroups.flatMap((group) =>
        (sessionsByGroupId.get(group.id) ?? [])
          .filter(
            (session) =>
              session.date >= today && (session.status === 'accepted' || session.status === 'in_progress'),
          )
          .map((session): UpcomingEntry => ({
            key: `group-session-${session.id}`,
            kind: 'group',
            online: false,
            date: session.date,
            from: session.slotStart,
            to: session.slotEnd,
            personName: group.name,
            sessionType: 'Group session',
            focusArea: session.focusArea || 'No focus area noted',
            location: session.location || 'Location to be confirmed',
            targetId: session.id,
          })),
      );

      const merged = [...oneOnOneEntries, ...groupEntries].sort((a, b) =>
        a.date === b.date ? a.from.localeCompare(b.from) : a.date.localeCompare(b.date),
      );
      setEntries(merged);
      setState(merged.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  const visible = entries.filter((entry) => {
    if (filter === 'one_on_one') return entry.kind === 'one_on_one' && !entry.online;
    if (filter === 'group') return entry.kind === 'group';
    if (filter === 'online') return entry.online;
    return true;
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Upcoming sessions" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={140} />
          <Skeleton shape="card" height={140} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Could not load upcoming sessions
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              height: 80,
              width: 80,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceMuted,
            }}
          >
            <CalendarX2 size={48} color={colors.textTertiary} strokeWidth={1.75} />
          </View>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No upcoming sessions</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Accepted sessions and scheduled group sessions will show up here.
          </Text>
        </View>
      ) : (
        <>
          <SessionFilterChips active={filter} onChange={setFilter} />
          <FlatList
            data={visible}
            keyExtractor={(item) => item.key}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
            ListEmptyComponent={
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg }}>
                <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                  {filter === 'group'
                    ? 'No upcoming group sessions.'
                    : filter === 'online'
                      ? 'No upcoming online sessions.'
                      : 'No upcoming sessions match this filter.'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <SessionCard
                variant="upcoming"
                date={item.date}
                timeSlot={`${item.from} to ${item.to}`}
                personName={item.personName}
                sessionType={item.sessionType}
                focusArea={item.focusArea}
                location={item.location}
                onPress={() =>
                  router.push(
                    item.kind === 'group'
                      ? { pathname: '/(tabs)/trainings/group-session/[id]', params: { id: item.targetId } }
                      : { pathname: '/(tabs)/trainings/session/[id]', params: { id: item.targetId } },
                  )
                }
              />
            )}
          />
        </>
      )}
    </SafeAreaView>
  );
}
