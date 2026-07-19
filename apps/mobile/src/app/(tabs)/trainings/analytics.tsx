import { useCoachAnalytics, type CoachAnalyticsMonth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { ChartNoAxesCombined, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TrainingsSubNav } from '@/components/ui/trainings-sub-nav';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });

function BarRow({
  label,
  value,
  displayValue,
  max,
  color,
}: {
  label: string;
  value: number;
  displayValue: string;
  max: number;
  color: string;
}) {
  const colors = useThemeColors();
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;

  return (
    <View style={{ gap: spacing.xs }}>
      <View className="flex-row items-center justify-between">
        <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[textStyle('numericSm'), { color: colors.text }]}>{displayValue}</Text>
      </View>
      <View style={{ height: 8, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${width}%`, borderRadius: radii.pill, backgroundColor: color }} />
      </View>
    </View>
  );
}

/**
 * AT-51, PRD-02 3.9, FR-32, FR-33. Token styled bar readouts, no chart
 * library, per v1 scope. Sessions per month, hours coached, earnings trend,
 * rating trend, all derived from existing session, ledger, and rating rows
 * (`useCoachAnalytics`), no new tracked metric. Fewer than 3 completed
 * sessions total renders the insufficient data state instead of a one or
 * two point chart (FR-33; the assumed threshold, PHASE-3-STATUS.md "What
 * the founder must do", open question 6). States: loading, empty
 * (insufficient data), populated, error.
 */
export default function CoachAnalyticsScreen() {
  const colors = useThemeColors();
  const analytics = useCoachAnalytics(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [months, setMonths] = useState<CoachAnalyticsMonth[]>([]);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await analytics.getAnalytics();
      setMonths(result.months);
      setTotalCompleted(result.totalCompleted);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const maxSessions = Math.max(1, ...months.map((month) => month.sessions));
  const maxHours = Math.max(1, ...months.map((month) => month.hours));
  const maxEarnings = Math.max(1, ...months.map((month) => month.earnings));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Analytics" onPressBack={() => router.back()} />
      <TrainingsSubNav role="coach" active="analytics" onChange={(tab) => navigateSubNav(tab)} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={140} />
          <Skeleton shape="card" height={140} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Could not load your analytics
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : totalCompleted < analytics.insufficientDataThreshold ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={ChartNoAxesCombined}
            title="Not enough sessions yet"
            body={`Complete at least ${analytics.insufficientDataThreshold} sessions to see your trends here.`}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing['4xl'] }}>
          {months.map((month) => (
            <View
              key={month.month}
              style={{
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
                gap: spacing.md,
              }}
            >
              <Text style={[textStyle('h3'), { color: colors.text }]}>
                {MONTH_FORMATTER.format(new Date(`${month.month}-01T00:00:00`))}
              </Text>
              <BarRow
                label="Sessions"
                value={month.sessions}
                displayValue={String(month.sessions)}
                max={maxSessions}
                color={colors.accent}
              />
              <BarRow
                label="Hours coached"
                value={month.hours}
                displayValue={month.hours.toFixed(1)}
                max={maxHours}
                color={colors.info}
              />
              <BarRow
                label="Earnings"
                value={month.earnings}
                displayValue={formatINR(month.earnings)}
                max={maxEarnings}
                color={colors.success}
              />
              {month.avgRating != null ? (
                <BarRow
                  label="Avg rating"
                  value={month.avgRating}
                  displayValue={`${month.avgRating.toFixed(1)}/5`}
                  max={5}
                  color={colors.warning}
                />
              ) : null}
            </View>
          ))}
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
    case 'earnings':
      router.push('/(tabs)/trainings/earnings');
      return;
    case 'chat':
      router.push('/(tabs)/trainings/chat');
      return;
    default:
      return;
  }
}
