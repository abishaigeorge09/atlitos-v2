import { useLearn, toApiError, type LearnHome, type RoadmapStage } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing, radii } from '@atlitos/theme';
import { router } from 'expo-router';
import { Check, Lock, Map, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { stageProgress } from '@/lib/learn-display';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Roadmap, `/learn/roadmap`. AT-136, PRD-01 FR-50. The stage ladder for the
 * player's sport with the current stage highlighted and the XP threshold shown
 * on each. Every number, the XP total, the current stage, the thresholds and
 * the progress toward the next stage, comes from `get_learn_home()`, derived
 * server side as a pure function of the append-only XP log. This screen never
 * computes XP; it only positions the derived total on the ladder.
 */
export default function RoadmapScreen() {
  const colors = useThemeColors();
  const learn = useLearn(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [home, setHome] = useState<LearnHome | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setHome(await learn.getLearnHome());
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
        <AppBar variant="backTitle" title="Roadmap" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton shape="card" height={80} />
          <Skeleton shape="card" height={72} />
          <Skeleton shape="card" height={72} />
          <Skeleton shape="card" height={72} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Roadmap" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load roadmap</Text>
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

  if (!home || home.sport === null || home.stages.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Roadmap" onPressBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={Map}
            title="No roadmap yet"
            body="Pick a primary sport to unlock a roadmap tuned to it."
          />
        </View>
      </SafeAreaView>
    );
  }

  const progress = stageProgress(home);

  const renderStage = (stage: RoadmapStage) => {
    const isCurrent = home.currentStage?.id === stage.id;
    const reached = stage.xpThreshold <= home.xpTotal;

    return (
      <View
        key={stage.id}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radii.xl,
          borderWidth: isCurrent ? 2 : 1,
          borderColor: isCurrent ? colors.accent : colors.border,
          backgroundColor: isCurrent ? colors.accentTint : colors.card,
        }}
      >
        <View
          style={{
            height: 40,
            width: 40,
            borderRadius: radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: reached ? colors.accent : colors.surfaceMuted,
          }}
        >
          {reached ? (
            <Check size={20} strokeWidth={2.5} color={colors.inkOnAccent} />
          ) : (
            <Lock size={18} strokeWidth={2} color={colors.textTertiary} />
          )}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[textStyle('overline'), { color: isCurrent ? colors.accent : colors.textTertiary }]}>
            Stage <Text style={textStyle('numericSm')}>{stage.stageOrder}</Text>
            {isCurrent ? '  You are here' : ''}
          </Text>
          <Text style={[textStyle('h3'), { color: colors.text }]}>{stage.name}</Text>
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[textStyle('numericSm'), { color: colors.text }]}>{stage.xpThreshold}</Text>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>XP</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Roadmap" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['3xl'] }}>
        {/* Progress header, from get_learn_home. */}
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
            {SPORT_LABEL[home.sport]}. <Text style={textStyle('numericSm')}>{home.xpTotal}</Text> XP total
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
              'Top stage reached.'
            ) : (
              <>
                <Text style={[textStyle('numericSm'), { color: colors.text }]}>{progress.xpToNext}</Text>
                {` XP to ${home.nextStage.name}.`}
              </>
            )}
          </Text>
        </View>

        {home.stages.map(renderStage)}
      </ScrollView>
    </SafeAreaView>
  );
}
