import { useLearn, toApiError, type Drill, type LearnHome } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing, radii } from '@atlitos/theme';
import { router } from 'expo-router';
import { ChevronRight, Dumbbell, Map, RefreshCw, Trophy, TriangleAlert, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { DrillCard } from '@/components/ui/drill-card';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { stageProgress } from '@/lib/learn-display';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

const DRILL_PREVIEW_COUNT = 4;

/**
 * Learn home, `/learn`. AT-134, PRD-01 FR-48/FR-50/FR-51. Every XP, level and
 * progress number comes from `get_learn_home()`, derived server side (the hook
 * never computes XP). A player with no primary sport, or a sport with no seeded
 * ladder, sees the FR-48 empty state, never a zero-filled roadmap. The drill
 * preview reads the active catalog for the player's sport (the `.eq('active',
 * true)` filter lives in the hook), with links into the full library, the
 * roadmap and the milestones.
 */
export default function LearnHomeScreen() {
  const colors = useThemeColors();
  const learn = useLearn(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [home, setHome] = useState<LearnHome | null>(null);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const homeRow = await learn.getLearnHome();
      if (homeRow.sport) {
        const [drillRows, completedIds] = await Promise.all([
          learn.listDrills({ sport: homeRow.sport }),
          learn.getCompletedDrillIds(),
        ]);
        setDrills(drillRows);
        setCompleted(completedIds);
      } else {
        setDrills([]);
        setCompleted(new Set());
      }
      setHome(homeRow);
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [learn]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Learn" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={96} />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={96} />
          <Skeleton shape="card" height={96} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Learn" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load Learn</Text>
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

  // FR-48 empty state: no primary sport, or no seeded ladder for it.
  if (!home || home.sport === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Learn" onPressBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={Map}
            title="Pick a sport to start"
            body="Choose your primary sport to unlock a roadmap, drills and milestones tuned to it."
          />
        </View>
      </SafeAreaView>
    );
  }

  const progress = stageProgress(home);
  const earnedCount = home.milestones.filter((m) => m.earned).length;
  const previewDrills = drills.slice(0, DRILL_PREVIEW_COUNT);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Learn" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
        {/* XP total and earned milestones, both server derived. */}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <StatTile label="Total XP" value={home.xpTotal} icon={Zap} />
          <StatTile label="Milestones" value={earnedCount} icon={Trophy} />
        </View>

        {/* Current stage and progress toward the next, from get_learn_home. */}
        <View
          style={{
            gap: spacing.sm,
            padding: spacing.lg,
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>
            {SPORT_LABEL[home.sport]} roadmap
          </Text>
          <Text style={[textStyle('h2'), { color: colors.text }]}>
            {home.currentStage?.name ?? 'Getting started'}
          </Text>

          <View style={{ height: 8, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
            <View
              style={{
                height: '100%',
                borderRadius: radii.pill,
                backgroundColor: colors.accent,
                width: `${progress.ratio * 100}%`,
              }}
            />
          </View>

          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
            {progress.atTop || !home.nextStage ? (
              'Top stage reached. Keep training to earn more milestones.'
            ) : (
              <>
                <Text style={[textStyle('numericSm'), { color: colors.text }]}>{progress.xpToNext}</Text>
                {` XP to ${home.nextStage.name}.`}
              </>
            )}
          </Text>

          <Button variant="secondary" onPress={() => router.push('/learn/roadmap')}>
            <Map size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={[textStyle('label'), { color: colors.text }]}>View roadmap</Text>
          </Button>
        </View>

        {/* Milestones entry. */}
        <Button variant="secondary" onPress={() => router.push('/learn/milestones')}>
          <Trophy size={16} strokeWidth={1.75} color={colors.text} />
          <Text style={[textStyle('label'), { color: colors.text }]}>
            Milestones, {earnedCount} of {home.milestones.length} earned
          </Text>
        </Button>

        {/* Drill library preview for the player's sport. */}
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Dumbbell size={18} strokeWidth={1.75} color={colors.text} />
              <Text style={[textStyle('h3'), { color: colors.text }]}>Drills</Text>
            </View>
            <Button variant="text" onPress={() => router.push('/learn/drills')}>
              <Text style={[textStyle('label'), { color: colors.accent }]}>See all</Text>
              <ChevronRight size={16} strokeWidth={1.75} color={colors.accent} />
            </Button>
          </View>

          {previewDrills.length === 0 ? (
            <EmptyState
              icon={Dumbbell}
              title="No drills yet"
              body="Drills for your sport will appear here as they are published."
            />
          ) : (
            <View style={{ gap: spacing.md }}>
              {previewDrills.map((drill) => (
                <DrillCard
                  key={drill.id}
                  drill={drill}
                  completed={completed.has(drill.id)}
                  onPress={() => router.push(`/learn/drill/${drill.id}`)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
