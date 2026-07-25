import {
  useCoachTrainees,
  useGroups,
  type GroupSession,
  type TraineeSummary,
  type TrainingGroup,
} from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { SessionFilterChips, type SessionFilterKey } from '@/components/organisms/trainings/SessionFilterChips';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

interface GroupListEntry {
  group: TrainingGroup;
  totalSessions: number;
  nextSession: GroupSession | null;
}

type RosterItem =
  | { kind: 'group'; key: string; entry: GroupListEntry }
  | { kind: 'trainee'; key: string; trainee: TraineeSummary };

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * AT-48, PRD-02 3.5, FR-20, extended to the Figma My Trainees screen
 * (node 1047:13612): filter chips All / 1 on 1 / Group / Online, group
 * cards (name, member count, total sessions, next session) interleaved
 * with the 1:1 trainee cards. Groups come from `useGroups.listMyGroups`
 * (explicitly coach scoped, RLS is not scoping) with each group's
 * sessions read for the two card figures; trainees keep the FR-20 read,
 * now carrying online/in person flags for the chips. States: loading,
 * empty, populated (with per filter empty text), error. Renders as tab
 * content inside the Trainings shell layout.
 */
export default function CoachTraineesScreen() {
  const colors = useThemeColors();
  const trainees = useCoachTrainees(supabase);
  const groups = useGroups(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [traineeItems, setTraineeItems] = useState<TraineeSummary[]>([]);
  const [groupItems, setGroupItems] = useState<GroupListEntry[]>([]);
  const [filter, setFilter] = useState<SessionFilterKey>('all');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const [traineeResult, groupResult] = await Promise.all([
        trainees.listTrainees(),
        groups.listMyGroups(),
      ]);
      const today = todayISO();
      const sessionsPerGroup = await Promise.all(
        groupResult.map((group) => groups.groupSessions(group.id)),
      );
      const entries: GroupListEntry[] = groupResult.map((group, index) => {
        const sessions = (sessionsPerGroup[index] ?? []).filter((s) => s.status !== 'cancelled');
        const upcoming = sessions
          .filter((s) => s.date >= today && (s.status === 'accepted' || s.status === 'in_progress'))
          .sort((a, b) => (a.date === b.date ? a.slotStart.localeCompare(b.slotStart) : a.date.localeCompare(b.date)));
        return { group, totalSessions: sessions.length, nextSession: upcoming[0] ?? null };
      });
      setTraineeItems(traineeResult);
      setGroupItems(entries);
      setState(traineeResult.length === 0 && entries.length === 0 ? 'empty' : 'populated');
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

  const visibleGroups = filter === 'all' || filter === 'group' ? groupItems : [];
  const visibleTrainees =
    filter === 'group'
      ? []
      : traineeItems.filter((trainee) => {
          if (filter === 'one_on_one') return trainee.hasInPerson;
          if (filter === 'online') return trainee.hasOnline;
          return true;
        });

  const items: RosterItem[] = [
    ...visibleGroups.map((entry): RosterItem => ({ kind: 'group', key: `group-${entry.group.id}`, entry })),
    ...visibleTrainees.map((trainee): RosterItem => ({ kind: 'trainee', key: `trainee-${trainee.playerId}`, trainee })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton shape="card" height={80} />
          <Skeleton shape="card" height={80} />
          <Skeleton shape="card" height={80} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load trainees</Text>
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
            <Users size={48} color={colors.textTertiary} strokeWidth={1.75} />
          </View>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No trainees yet</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Athletes you have trained will show up here once they book a session with you.
          </Text>
        </View>
      ) : (
        <>
          <SessionFilterChips active={filter} onChange={setFilter} />
          <FlatList
            data={items}
            keyExtractor={(item) => item.key}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
            ListEmptyComponent={
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg }}>
                <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                  {filter === 'group'
                    ? 'No training groups yet.'
                    : filter === 'online'
                      ? 'No online trainees yet.'
                      : 'No trainees match this filter.'}
                </Text>
              </View>
            }
            renderItem={({ item }) =>
              item.kind === 'group' ? (
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/(tabs)/trainings/group/[id]', params: { id: item.entry.group.id } })
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    borderRadius: radii.xl,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    padding: spacing.lg,
                  }}
                >
                  <View
                    style={{
                      height: 56,
                      width: 56,
                      borderRadius: radii.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.accentTint,
                    }}
                  >
                    <Users size={28} color={colors.accent} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text style={[textStyle('h3'), { color: colors.text }]}>{item.entry.group.name}</Text>
                    <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                      {item.entry.group.activeMembers ?? 0} {(item.entry.group.activeMembers ?? 0) === 1 ? 'member' : 'members'}, {item.entry.totalSessions} {item.entry.totalSessions === 1 ? 'session' : 'sessions'}
                    </Text>
                    <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                      {item.entry.nextSession
                        ? `Next on ${item.entry.nextSession.date} at ${item.entry.nextSession.slotStart}`
                        : 'No upcoming session'}
                    </Text>
                  </View>
                  <View
                    style={{
                      borderRadius: radii.pill,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                      backgroundColor: colors.accentTint,
                    }}
                  >
                    <Text style={[textStyle('label'), { color: colors.accent }]}>Group</Text>
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/(tabs)/trainings/trainee/[id]', params: { id: item.trainee.playerId } })
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    borderRadius: radii.xl,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    padding: spacing.lg,
                  }}
                >
                  <Avatar uri={item.trainee.avatarUrl ?? undefined} name={item.trainee.name} size={56} />
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text style={[textStyle('h3'), { color: colors.text }]}>{item.trainee.name}</Text>
                    <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                      {item.trainee.sessionCount} {item.trainee.sessionCount === 1 ? 'session' : 'sessions'}, last on {item.trainee.lastSessionDate}
                    </Text>
                    {item.trainee.hasOnline ? (
                      <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Trains online</Text>
                    ) : null}
                  </View>
                  <View
                    style={{
                      borderRadius: radii.pill,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                      backgroundColor: item.trainee.hasUpcoming ? colors.successTint : colors.surfaceMuted,
                    }}
                  >
                    <Text
                      style={[textStyle('label'), { color: item.trainee.hasUpcoming ? colors.success : colors.textSecondary }]}
                    >
                      {item.trainee.hasUpcoming ? 'Active' : 'No upcoming'}
                    </Text>
                  </View>
                </Pressable>
              )
            }
          />
        </>
      )}
    </View>
  );
}
