import { useCoachEarnings } from '@atlitos/api';
import type { ApiError, Transaction } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { TriangleAlert, Wallet } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { EarningsHeader } from '@/components/organisms/EarningsHeader';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TrainingsSubNav } from '@/components/ui/trainings-sub-nav';
import { TransactionRow } from '@/components/molecules/TransactionRow';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type KindFilter = 'all' | 'earning' | 'payout';

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });

function groupByMonth(transactions: Transaction[]): { month: string; label: string; rows: Transaction[] }[] {
  const map = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const key = transaction.createdAt.slice(0, 7);
    const bucket = map.get(key) ?? [];
    bucket.push(transaction);
    map.set(key, bucket);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, rows]) => ({
      month,
      label: MONTH_FORMATTER.format(new Date(`${month}-01T00:00:00`)),
      rows,
    }));
}

/**
 * AT-50, PRD-02 3.7, FR-26. Balance/this month from `EarningsHeader`,
 * derived entirely from `get_coach_wallet_balance()`, never a stored
 * balance. "Send" reuses the header's secondary action for managing where
 * money is sent (Payout Account Setup), "Transfer" opens the amount entry
 * flow (FR-27 gates it there, not here, on `payout_accounts.status`).
 * Transaction list grouped by month, filterable by kind. States: loading,
 * empty (no earnings yet), populated, error.
 */
export default function CoachEarningsScreen() {
  const colors = useThemeColors();
  const earnings = useCoachEarnings(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [balance, setBalance] = useState<{ balance: number; thisMonth: number } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<KindFilter>('all');

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setState('loading');
      setError(null);
      try {
        const [walletResult, transactionsResult] = await Promise.all([
          earnings.getWalletBalance(),
          earnings.listTransactions(filter === 'all' ? undefined : filter),
        ]);
        setBalance({ balance: walletResult.balance, thisMonth: walletResult.thisMonth });
        setTransactions(transactionsResult);
        setState('populated');
      } catch (err) {
        setError(err as ApiError);
        setState('error');
      }
    },
    [filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  const groups = groupByMonth(transactions);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Earnings" onPressBack={() => router.back()} />
      <TrainingsSubNav role="coach" active="earnings" onChange={(tab) => navigateSubNav(tab)} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={200} />
          <Skeleton shape="card" height={100} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Could not load your earnings
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
        >
          {balance ? (
            <EarningsHeader
              balance={balance.balance}
              thisMonth={balance.thisMonth}
              onSend={() => router.push('/(tabs)/trainings/earnings/payout-setup')}
              onTransfer={() => router.push('/(tabs)/trainings/earnings/transfer')}
            />
          ) : null}

          <View className="flex-row gap-sm">
            <Chip label="All" variant="filter" selected={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip
              label="Session income"
              variant="filter"
              selected={filter === 'earning'}
              onPress={() => setFilter('earning')}
            />
            <Chip
              label="Transfer out"
              variant="filter"
              selected={filter === 'payout'}
              onPress={() => setFilter('payout')}
            />
          </View>

          {transactions.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No earnings yet"
              body="Complete a session to see it appear here, then transfer it to your bank account."
            />
          ) : (
            <View style={{ gap: spacing.lg }}>
              {groups.map((group) => (
                <View key={group.month} style={{ gap: spacing.xs }}>
                  <Text style={[textStyle('overline'), { color: colors.textSecondary }]}>{group.label}</Text>
                  {group.rows.map((transaction) => (
                    <TransactionRow key={transaction.id} transaction={transaction} />
                  ))}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function navigateSubNav(tab: string) {
  switch (tab) {
    case 'stats':
      router.push('/(tabs)/trainings');
      return;
    case 'trainees':
      router.push('/(tabs)/trainings/trainees');
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
