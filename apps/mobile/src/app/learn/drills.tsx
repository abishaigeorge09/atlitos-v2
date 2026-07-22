import { useLearn, toApiError, type Drill } from '@atlitos/api';
import type { ApiError, DrillDifficulty, Sport } from '@atlitos/types';
import { SPORTS, DRILL_DIFFICULTIES } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Dumbbell, RefreshCw, SlidersHorizontal, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DrillCard } from '@/components/ui/drill-card';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { DIFFICULTY_LABEL } from '@/lib/learn-display';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Drill library, `/learn/drills`. AT-134, PRD-01 FR-49. The full active catalog,
 * filterable by sport and difficulty. Every read runs through the hook, which
 * carries the explicit `.eq('active', true)` filter, so an inactive drill never
 * appears here (the permissive-OR public-catalog contract, CLAUDE.md). The
 * completed badge reads the caller's own `drill_completions`, owner scoped.
 */
export default function DrillLibraryScreen() {
  const colors = useThemeColors();
  const learn = useLearn(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [drills, setDrills] = useState<Drill[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ApiError | null>(null);
  const [sportFilter, setSportFilter] = useState<Sport | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<DrillDifficulty | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [drillRows, completedIds] = await Promise.all([
        learn.listDrills({ sport: sportFilter, difficulty: difficultyFilter }),
        learn.getCompletedDrillIds(),
      ]);
      setDrills(drillRows);
      setCompleted(completedIds);
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [learn, sportFilter, difficultyFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtersActive = sportFilter !== null || difficultyFilter !== null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Drills" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
        {/* Filters, combinable. */}
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <SlidersHorizontal size={16} strokeWidth={1.75} color={colors.textSecondary} />
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Filter</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {SPORTS.map((sport) => (
              <Chip
                key={sport}
                variant="filter"
                label={SPORT_LABEL[sport]}
                selected={sportFilter === sport}
                onPress={() => setSportFilter((current) => (current === sport ? null : sport))}
              />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {DRILL_DIFFICULTIES.map((difficulty) => (
              <Chip
                key={difficulty}
                variant="filter"
                label={DIFFICULTY_LABEL[difficulty]}
                selected={difficultyFilter === difficulty}
                onPress={() => setDifficultyFilter((current) => (current === difficulty ? null : difficulty))}
              />
            ))}
          </ScrollView>
        </View>

        {state === 'loading' ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton shape="card" height={96} />
            <Skeleton shape="card" height={96} />
            <Skeleton shape="card" height={96} />
          </View>
        ) : state === 'error' ? (
          <View style={{ paddingVertical: spacing['3xl'], alignItems: 'center', gap: spacing.md }}>
            <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load drills</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {error?.message ?? 'Something went wrong. Please try again.'}
            </Text>
            <Button variant="secondary" onPress={() => void load()}>
              <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
              <Text style={{ color: colors.text }}>Retry</Text>
            </Button>
          </View>
        ) : drills.length === 0 ? (
          <EmptyState
            icon={Dumbbell}
            title={filtersActive ? 'No drills match' : 'No drills yet'}
            body={
              filtersActive
                ? 'No active drills match these filters right now. Clear them to see everything.'
                : 'Drills will appear here as they are published.'
            }
            ctaLabel={filtersActive ? 'Clear filters' : undefined}
            onCtaPress={
              filtersActive
                ? () => {
                    setSportFilter(null);
                    setDifficultyFilter(null);
                  }
                : undefined
            }
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {drills.map((drill) => (
              <DrillCard
                key={drill.id}
                drill={drill}
                completed={completed.has(drill.id)}
                onPress={() => router.push(`/learn/drill/${drill.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
