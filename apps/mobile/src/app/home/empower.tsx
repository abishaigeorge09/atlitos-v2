import { useEmpower, toApiError, type EmpowerStats, type HubUpa } from '@atlitos/api';
import type { ApiError, Sport } from '@atlitos/types';
import { formatINR, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { HeartHandshake, RefreshCw, SlidersHorizontal, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
// useMemo is used for derived filter lists below.
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { UPACard } from '@/components/ui/upa-card';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Empower Hub, `/home/empower`. AT-120, PRD-06 FR-1/FR-2/FR-3/FR-20; screen
 * spec 3.1. Guest visible (browse without an account, FR-15 gates only the pay
 * step). The aggregate banner is ledger derived by `get_empower_stats` (FR-3),
 * and the sport/region filters affect ONLY the card grid, never the banner
 * (FR-2): the whole verified set loads once and filters run client side, so the
 * stats never move when a chip toggles. Every list read is verified only, an
 * `.eq("status","verified")` the hook applies explicitly (RLS is not scoping).
 */
export default function EmpowerHubScreen() {
  const colors = useThemeColors();
  const empower = useEmpower(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [stats, setStats] = useState<EmpowerStats | null>(null);
  const [upas, setUpas] = useState<HubUpa[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [sportFilter, setSportFilter] = useState<Sport | null>(null);
  const [regionFilter, setRegionFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [statsRow, upaRows] = await Promise.all([empower.getStats(), empower.listUpas()]);
      setStats(statsRow);
      setUpas(upaRows);
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [empower]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter chip options are derived from the full verified set, not hardcoded,
  // so a region only appears once a verified UPA is in it.
  const sports = useMemo(() => Array.from(new Set(upas.map((u) => u.sport))), [upas]);
  const regions = useMemo(() => Array.from(new Set(upas.map((u) => u.region))).sort(), [upas]);

  // FR-2: combinable filters over the grid only. Stats above are untouched.
  const filtered = useMemo(
    () =>
      upas.filter(
        (u) => (sportFilter === null || u.sport === sportFilter) && (regionFilter === null || u.region === regionFilter),
      ),
    [upas, sportFilter, regionFilter],
  );
  const filtersActive = sportFilter !== null || regionFilter !== null;

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Empower" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={96} />
          <Skeleton shape="card" height={200} />
          <Skeleton shape="card" height={200} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Empower" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load Empower</Text>
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Empower" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
        {/* Aggregate impact banner, ledger derived (FR-3). Unaffected by filters. */}
        <View className="flex-row gap-md">
          <View style={{ flex: 1 }}>
            <StatTile label="Raised so far" value={formatINR(stats?.totalRaised ?? 0)} icon={HeartHandshake} />
          </View>
          <View style={{ flex: 1 }}>
            <StatTile label="Athletes supported" value={stats?.athletesSupported ?? 0} />
          </View>
        </View>

        {/* Filters, combinable (FR-2). */}
        {sports.length > 0 || regions.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <View className="flex-row items-center gap-xs">
              <SlidersHorizontal size={16} strokeWidth={1.75} color={colors.textSecondary} />
              <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Filter</Text>
            </View>
            {sports.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {sports.map((sport) => (
                  <Chip
                    key={sport}
                    variant="filter"
                    label={SPORT_LABEL[sport]}
                    selected={sportFilter === sport}
                    onPress={() => setSportFilter((current) => (current === sport ? null : sport))}
                  />
                ))}
              </ScrollView>
            ) : null}
            {regions.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {regions.map((region) => (
                  <Chip
                    key={region}
                    variant="filter"
                    label={region}
                    selected={regionFilter === region}
                    onPress={() => setRegionFilter((current) => (current === region ? null : region))}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}

        {/* Grid, or the filtered empty state. */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={HeartHandshake}
            title={filtersActive ? 'No athletes match' : 'No athletes yet'}
            body={
              filtersActive
                ? 'No verified athletes match these filters right now. Clear them to see everyone.'
                : 'Verified athletes will appear here as they publish their wishlists.'
            }
            ctaLabel={filtersActive ? 'Clear filters' : undefined}
            onCtaPress={
              filtersActive
                ? () => {
                    setSportFilter(null);
                    setRegionFilter(null);
                  }
                : undefined
            }
          />
        ) : (
          <View style={{ gap: spacing.lg }}>
            {filtered.map((upa) => (
              <UPACard
                key={upa.id}
                variant="hub"
                photoUri={upa.photoUrl ?? ''}
                name={upa.name}
                headline={`${SPORT_LABEL[upa.sport]}, ${upa.region}`}
                raisedAmount={upa.raised}
                goalAmount={upa.goal > 0 ? upa.goal : 1}
                onDonatePress={() => router.push(`/home/donate/${upa.id}`)}
                onViewProfilePress={() => router.push(`/home/upa/${upa.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
