import { useCoaching } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock, CalendarX2, Clock, TriangleAlert, Wallet } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { AppBar } from '@/components/ui/app-bar';
import { SESSION_STATUS_PILL } from '@/lib/session-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

const LIVE_STATUSES: Session['status'][] = ['requested', 'accepted', 'completed', 'rescheduled', 'rated'];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * My sessions. PRD-01 FR-24/FR-27 (AT-54): the player's upcoming/history
 * list plus the Trainings dashboard's StatTiles, "computed from that
 * player's real session and payment history, never cached client
 * estimates." Lives under this story's own coaching route group rather than
 * `(tabs)/trainings/**`, which Track C owns for the Trainings tab surface
 * this phase; the intent is that Track C's Trainings dashboard links into
 * this screen (or inlines the same `useCoaching().listMySessions()` call)
 * once both land, not that the numbers live in two places.
 *
 * Stat definitions (FR-27 does not pin these down further, so this is a
 * documented judgment call): total sessions and this month count every
 * session that was actually paid for and not declined/cancelled
 * (`requested` through `rated`, since payment capture happens before a
 * session ever reaches `requested`, see SCHEMA.md); hours and payments only
 * count sessions that actually happened (`completed`/`rated`), so a
 * still-pending request does not inflate "hours trained" or "amount paid
 * for training delivered". States: loading, empty, populated, error.
 */
export default function CoachingBookingsListScreen() {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [items, setItems] = useState<Session[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const result = await coaching.listMySessions();
      setItems(result);
      setState(result.length === 0 ? 'empty' : 'populated');
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

  const stats = useMemo(() => {
    const now = new Date();
    const live = items.filter((session) => LIVE_STATUSES.includes(session.status));
    const liveThisMonth = live.filter((session) => {
      const [y, m] = session.date.split('-').map(Number);
      return y === now.getFullYear() && m === now.getMonth() + 1;
    });
    const held = items.filter((session) => session.status === 'completed' || session.status === 'rated');
    const totalMinutes = held.reduce(
      (sum, session) => sum + (timeToMinutes(session.slot.to) - timeToMinutes(session.slot.from)),
      0,
    );
    const totalPayments = held.reduce((sum, session) => sum + session.total, 0);

    return {
      totalSessions: live.length,
      thisMonth: liveThisMonth.length,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      totalPayments,
    };
  }, [items]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="My sessions" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={120} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Couldn't load your sessions
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
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No sessions yet</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Book a coach and it will show up here.
          </Text>
          <Button onPress={() => router.replace('/(tabs)/coaching')}>
            <Text style={{ color: colors.inkOnAccent }}>Find a coach</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
              <View className="flex-row gap-md">
                <StatTile label="Total sessions" value={stats.totalSessions} icon={CalendarClock} />
                <StatTile label="This month" value={stats.thisMonth} icon={CalendarClock} />
              </View>
              <View className="flex-row gap-md">
                <StatTile label="Hours trained" value={stats.totalHours} icon={Clock} />
                <StatTile label="Payments" value={formatINR(stats.totalPayments)} icon={Wallet} />
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/(tabs)/coaching/booking/[id]', params: { id: item.id } })}
              style={{
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
                gap: spacing.xs,
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text style={[textStyle('h3'), { color: colors.text }]}>{item.sessionTypeName ?? 'Session'}</Text>
                <StatusPill status={SESSION_STATUS_PILL[item.status]} />
              </View>
              {item.coachName ? (
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>with {item.coachName}</Text>
              ) : null}
              <View className="flex-row items-center justify-between pt-xs">
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                  {item.date}, {item.slot.from} to {item.slot.to}
                </Text>
                <PriceText amount={item.total} size="sm" />
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
