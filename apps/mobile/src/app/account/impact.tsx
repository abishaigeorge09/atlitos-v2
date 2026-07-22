import { useEmpower, toApiError, type MyImpact } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { HeartHandshake, MessageSquareHeart, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * My Impact, `/account/impact`. AT-122, PRD-06 FR-12/FR-13/FR-14; screen spec
 * 3.5. Reads EXCLUSIVELY from `get_my_impact_summary` (ledger and empower
 * tables scoped to auth.uid(), never a client sum, never another user's rows),
 * plus a separate `gratitude_posts` read for gratitude received (FR-14, the gap
 * Track B flagged in the summary RPC). A roundup donation renders as General
 * Fund (upa_id null, FR-11). A never donated user sees the empty state, not
 * zero valued rows (FR-13).
 */
export default function MyImpactScreen() {
  const colors = useThemeColors();
  const empower = useEmpower(supabase);
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');

  const [state, setState] = useState<LoadState>('loading');
  const [impact, setImpact] = useState<MyImpact | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    setState('loading');
    setError(null);
    try {
      const row = await empower.getMyImpact();
      setImpact(row);
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [empower, isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isSignedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="My Impact" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Sign in to see your impact</Text>
          <Button variant="secondary" onPress={() => router.push('/(auth)/login')}>
            <Text style={{ color: colors.text }}>Sign in</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="My Impact" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={96} />
          <Skeleton shape="card" height={160} />
          <Skeleton shape="card" height={120} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !impact) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="My Impact" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load My Impact</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // FR-13: a never donated user sees the empty state, not zero rows.
  if (impact.donations.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="My Impact" onPressBack={() => router.back()} />
        <EmptyState
          icon={HeartHandshake}
          title="No donations yet"
          body="Support a verified athlete and your giving will show up here."
          ctaLabel="Explore Empower"
          onCtaPress={() => router.push('/home/empower')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="My Impact" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
        <StatTile label="Total given" value={formatINR(impact.totalGiven)} icon={HeartHandshake} />
        <View className="flex-row gap-md">
          <View style={{ flex: 1 }}>
            <StatTile label="Athletes supported" value={impact.athletesSupported} />
          </View>
          <View style={{ flex: 1 }}>
            <StatTile label="Items funded" value={impact.itemsFunded} />
          </View>
        </View>

        {/* Donation history. Each row: UPA name or General Fund, amount, date,
         * and the item title when item specific. */}
        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Donation history</Text>
          {impact.donations.map((donation) => (
            <View
              key={donation.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spacing.md,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
              }}
            >
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[textStyle('callout'), { color: colors.text }]} numberOfLines={1}>
                  {donation.upaName}
                </Text>
                {donation.itemTitle ? (
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]} numberOfLines={1}>
                    {donation.itemTitle}
                  </Text>
                ) : null}
                <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>
                  {formatDate(donation.createdAt)}
                </Text>
              </View>
              <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(donation.amount)}</Text>
            </View>
          ))}
        </View>

        {/* Gratitude received (FR-14). Queried separately from the summary RPC. */}
        {impact.gratitude.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Gratitude received</Text>
            {impact.gratitude.map((post) => (
              <View
                key={post.id}
                style={{
                  gap: spacing.xs,
                  borderRadius: radii.lg,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  padding: spacing.lg,
                }}
              >
                <View className="flex-row items-center gap-xs">
                  <MessageSquareHeart size={16} color={colors.accent} strokeWidth={1.75} />
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                    {post.upaName ?? 'A verified athlete'}
                    {post.itemTitle ? `, ${post.itemTitle}` : ''}
                  </Text>
                </View>
                <Text style={[textStyle('body'), { color: colors.text }]}>{post.body}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
