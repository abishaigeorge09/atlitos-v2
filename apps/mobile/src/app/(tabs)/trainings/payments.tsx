import { useCoaching } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { ReceiptIndianRupee, TriangleAlert, Wallet } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { TrainingsSubNav } from '@/components/ui/trainings-sub-nav';
import { SESSION_STATUS_PILL } from '@/lib/session-display';
import { navigatePlayerSubNav } from '@/lib/trainings-player-nav';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

/**
 * Athlete Trainings module, Payments tab (Figma "player - training"
 * 1642:38440): the athlete's session payment history, READ ONLY. Every row
 * is a `sessions` row the player already paid for (payment capture happens
 * before a session ever reaches `requested`, SCHEMA.md), read via the
 * player scoped `listMySessions()`; this screen never writes a money row
 * or status (CLAUDE.md financial invariant). Cancelled and declined rows
 * stay visible with their status pill, since their refunds are part of the
 * money story; the session detail carries the authoritative refund state.
 * Amounts render mono via PriceText/StatTile.
 */
export default function PlayerPaymentsScreen() {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const result = await coaching.listMySessions();
      // Only sessions that actually carried a payment: every non declined
      // booking was captured before `requested` (SCHEMA.md), declined
      // requests are auto refunded and excluded from the paid total below
      // but still listed for the full money story.
      setSessions(result.filter((session) => session.total > 0));
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

  const totals = useMemo(() => {
    const held = sessions.filter((session) => session.status === 'completed' || session.status === 'rated');
    const booked = sessions.filter(
      (session) => session.status === 'requested' || session.status === 'accepted' || session.status === 'rescheduled',
    );
    return {
      paidForDelivered: held.reduce((sum, session) => sum + session.total, 0),
      bookedAhead: booked.reduce((sum, session) => sum + session.total, 0),
    };
  }, [sessions]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Payments" onPressBack={() => router.back()} />
      <TrainingsSubNav role="player" active="payments" onChange={navigatePlayerSubNav} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Skeleton shape="card" height={96} />
            <Skeleton shape="card" height={96} />
          </View>
          <Skeleton shape="card" height={88} />
          <Skeleton shape="card" height={88} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={TriangleAlert}
            title="Could not load your payments"
            body={error?.message ?? 'Something went wrong. Please try again.'}
            ctaLabel="Retry"
            onCtaPress={() => void load()}
          />
        </View>
      ) : sessions.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={ReceiptIndianRupee}
            title="No payments yet"
            body="Book a session with a coach and your payment history will show up here."
            ctaLabel="Find a coach"
            onCtaPress={() => router.push('/(tabs)/coaching')}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
        >
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <StatTile label="Paid for sessions held" value={formatINR(totals.paidForDelivered)} icon={Wallet} />
            <StatTile label="Booked ahead" value={formatINR(totals.bookedAhead)} icon={ReceiptIndianRupee} />
          </View>

          <Text style={[textStyle('h3'), { color: colors.text }]}>Transactions</Text>

          {sessions.map((session) => (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              accessibilityLabel={`Payment to ${session.coachName ?? 'Coach'} on ${session.date}`}
              onPress={() =>
                router.push({ pathname: '/(tabs)/coaching/booking/[id]', params: { id: session.id } })
              }
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
                <Text style={[textStyle('label'), { color: colors.text }]}>{session.coachName ?? 'Coach'}</Text>
                <PriceText amount={session.total} size="sm" />
              </View>
              <View className="flex-row items-center justify-between">
                <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                  {session.date}, {session.sessionTypeName ?? 'Session'}
                </Text>
                <StatusPill status={SESSION_STATUS_PILL[session.status]} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
