import { useLearn, toApiError, type LearnHome, type LearnMilestone } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing, radii } from '@atlitos/theme';
import { router } from 'expo-router';
import { Lock, RefreshCw, Trophy, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { milestoneIcon } from '@/lib/learn-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Milestones, `/learn/milestones`. AT-136, PRD-01 FR-51. Every milestone from
 * `get_learn_home()`, rendered earned (a `user_milestones` row exists,
 * trigger-inserted) or locked, each with its lucide `icon_name` resolved to a
 * component (never an emoji, CLAUDE.md). The earned flag and the earned/total
 * counts are server derived; this screen computes no XP.
 */
export default function MilestonesScreen() {
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
        <AppBar variant="backTitle" title="Milestones" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton shape="card" height={96} />
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
        <AppBar variant="backTitle" title="Milestones" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load milestones</Text>
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

  if (!home || home.milestones.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Milestones" onPressBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={Trophy}
            title="No milestones yet"
            body="Milestones unlock as you complete drills and earn XP. Start with a drill to get going."
          />
        </View>
      </SafeAreaView>
    );
  }

  const earnedCount = home.milestones.filter((m) => m.earned).length;

  const renderMilestone = (milestone: LearnMilestone) => {
    const Icon = milestoneIcon(milestone.iconName);
    const earned = milestone.earned;

    return (
      <View
        key={milestone.id}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radii.xl,
          borderWidth: 1,
          borderColor: earned ? colors.accent : colors.border,
          backgroundColor: earned ? colors.accentTint : colors.card,
          opacity: earned ? 1 : 0.72,
        }}
      >
        <View
          style={{
            height: 44,
            width: 44,
            borderRadius: radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: earned ? colors.accent : colors.surfaceMuted,
          }}
        >
          {earned ? (
            <Icon size={22} strokeWidth={2} color={colors.inkOnAccent} />
          ) : (
            <Lock size={18} strokeWidth={2} color={colors.textTertiary} />
          )}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[textStyle('label'), { color: colors.text }]}>{milestone.name}</Text>
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{milestone.description}</Text>
        </View>

        <Text style={[textStyle('overline'), { color: earned ? colors.accent : colors.textTertiary }]}>
          {earned ? 'Earned' : 'Locked'}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Milestones" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['3xl'] }}>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <StatTile label="Earned" value={earnedCount} icon={Trophy} />
          <StatTile label="Total XP" value={home.xpTotal} />
        </View>

        {home.milestones.map(renderMilestone)}
      </ScrollView>
    </SafeAreaView>
  );
}
