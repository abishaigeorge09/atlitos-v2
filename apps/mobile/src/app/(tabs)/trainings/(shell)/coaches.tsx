import { useCoaching } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { CoachBrowseList } from '@/components/organisms/coaching/CoachBrowseList';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

interface MyCoachRow {
  coachId: string;
  name: string;
  sessionCount: number;
  nextSessionDate: string | null;
  lastSessionDate: string;
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Athlete Trainings module, Coaches tab (Figma "player - training"
 * 1642:38349 "My Coaches" + 1642:38910 browse entry). "My coaches" is the
 * athlete's own history, derived from `listMySessions()` (explicitly
 * player scoped, RLS is not scoping) grouped by coach: sessions till date,
 * the next accepted session if one exists. Below it, the shared
 * CoachBrowseList organism (also used by the standalone /coaching tab)
 * renders the find and hire surface inline, so browsing coaches never
 * yanks the athlete out of the Trainings module onto the separate
 * coaching bottom nav tab; a tapped coach opens as a drill in above this
 * shell (`trainings/coach/[id]`, a re-export of the coaching profile
 * screen) and backs out to this tab with the shell intact, same pattern as
 * `trainings/booking/[id]`. One outer ScrollView owns both sections so
 * there is only ever one scroller. States: loading, error for "My
 * coaches"; CoachBrowseList carries its own loading/empty/populated/error
 * quartet for the browse section.
 */
export default function PlayerCoachesScreen() {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [rows, setRows] = useState<MyCoachRow[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const sessions = await coaching.listMySessions();
      setRows(groupByCoach(sessions));
      setState('populated');
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

  const myCoachesSection = (
    <View style={{ gap: spacing.md }}>
      <Text style={[textStyle('h3'), { color: colors.text }]}>My coaches</Text>

      {state === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton shape="card" height={72} />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={120} />
        </View>
      ) : state === 'error' ? (
        <EmptyState
          icon={TriangleAlert}
          title="Could not load your coaches"
          body={error?.message ?? 'Something went wrong. Please try again.'}
          ctaLabel="Retry"
          onCtaPress={() => void load()}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="No coaches yet" body="Book your first session and your coaches will show up here. Browse coaches below to get started." />
      ) : (
        rows.map((row) => (
          <Pressable
            key={row.coachId}
            accessibilityRole="button"
            accessibilityLabel={`Coach ${row.name}`}
            onPress={() => router.push({ pathname: '/(tabs)/trainings/coach/[id]', params: { id: row.coachId } })}
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.lg,
              gap: spacing.xs,
            }}
          >
            <Text style={[textStyle('h3'), { color: colors.text }]}>{row.name}</Text>
            <View className="flex-row items-center justify-between">
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Sessions till date</Text>
              <Text style={[textStyle('numericSm'), { color: colors.text }]}>{row.sessionCount}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                {row.nextSessionDate ? 'Next session' : 'Last session'}
              </Text>
              <Text style={[textStyle('numericSm'), { color: colors.text }]}>
                {row.nextSessionDate ?? row.lastSessionDate}
              </Text>
            </View>
          </Pressable>
        ))
      )}

      <Text style={[textStyle('h3'), { color: colors.text }]}>Browse coaches</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing['4xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
      >
        <CoachBrowseList
          header={myCoachesSection}
          scrollEnabled={false}
          onOpenCoach={(coachId) =>
            router.push({ pathname: '/(tabs)/trainings/coach/[id]', params: { id: coachId } })
          }
        />
      </ScrollView>
    </View>
  );
}

/** Group the player's sessions into one row per coach: how many were
 * actually booked with them (not declined), the next accepted date from
 * today, and the most recent date for context. */
function groupByCoach(sessions: Session[]): MyCoachRow[] {
  const today = todayISO();
  const byCoach = new Map<string, MyCoachRow>();
  for (const session of sessions) {
    if (session.status === 'declined') continue;
    const existing = byCoach.get(session.coachId);
    const isUpcoming = session.status === 'accepted' && session.date >= today;
    if (!existing) {
      byCoach.set(session.coachId, {
        coachId: session.coachId,
        name: session.coachName ?? 'Coach',
        sessionCount: 1,
        nextSessionDate: isUpcoming ? session.date : null,
        lastSessionDate: session.date,
      });
    } else {
      existing.sessionCount += 1;
      if (isUpcoming && (!existing.nextSessionDate || session.date < existing.nextSessionDate)) {
        existing.nextSessionDate = session.date;
      }
      if (session.date > existing.lastSessionDate) existing.lastSessionDate = session.date;
    }
  }
  return Array.from(byCoach.values()).sort((a, b) => b.sessionCount - a.sessionCount);
}
