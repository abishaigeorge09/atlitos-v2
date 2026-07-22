import { useLearn, toApiError, type Drill } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing, radii } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Dumbbell, RefreshCw, TriangleAlert, Zap } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { DIFFICULTY_LABEL } from '@/lib/learn-display';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Drill detail, `/learn/drill/[id]`. AT-135, PRD-01 FR-49. Shows the drill
 * instructions and a mark-complete action.
 *
 * Mark-complete is the ONE client write in the XP path: the hook INSERTs the
 * caller's own `drill_completions` row and Track A's trigger grants the XP and
 * unlocks milestones server side. This screen NEVER writes xp_events or
 * user_milestones and never computes XP. There is no redo: a re-complete
 * attempt (the UNIQUE guard) resolves to the completed state, never a crash.
 * The completed state persists across reload because it reads
 * `drill_completions`, not local state. The confirm uses ConfirmSheet, never
 * Alert.alert (inert on web, AT-64).
 */
export default function DrillDetailScreen() {
  const colors = useThemeColors();
  const learn = useLearn(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();
  const status = useSessionStore((s) => s.status);
  const isGuest = status === 'guest';

  const [state, setState] = useState<LoadState>('loading');
  const [drill, setDrill] = useState<Drill | null>(null);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const [drillRow, completedIds] = await Promise.all([learn.getDrill(id), learn.getCompletedDrillIds()]);
      setDrill(drillRow);
      setCompleted(completedIds.has(id));
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [learn, id]);

  useEffect(() => {
    void load();
  }, [load]);

  function onMarkCompletePress() {
    if (isGuest) {
      setGateVisible(true);
      return;
    }
    setSubmitError(null);
    setConfirmVisible(true);
  }

  async function onConfirmComplete() {
    if (!id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Own-row insert only. The trigger grants XP and milestones server side;
      // an already-completed drill comes back gracefully, not as an error.
      await learn.markDrillComplete(id);
      setCompleted(true);
      setConfirmVisible(false);
    } catch (err) {
      setSubmitError(toApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Drill" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="70%" />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={56} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Drill" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load drill</Text>
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

  if (!drill) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Drill" onPressBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={Dumbbell}
            title="Drill not available"
            body="This drill is no longer active. Browse the library for the current drills."
            ctaLabel="Back to drills"
            onCtaPress={() => router.replace('/learn/drills')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Drill" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>
            {SPORT_LABEL[drill.sport]}. {drill.skillCategory}. {DIFFICULTY_LABEL[drill.difficulty]}.
          </Text>
          <Text style={[textStyle('h1'), { color: colors.text }]}>{drill.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Zap size={16} strokeWidth={2} color={colors.accent} />
            <Text style={[textStyle('numericBase'), { color: colors.accent }]}>{drill.xpValue}</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>XP on completion</Text>
          </View>
        </View>

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
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>How to do it</Text>
          <Text style={[textStyle('body'), { color: colors.text }]}>{drill.description}</Text>
        </View>

        {completed ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              padding: spacing.lg,
              borderRadius: radii.xl,
              backgroundColor: colors.successTint,
            }}
          >
            <CircleCheck size={22} strokeWidth={2} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[textStyle('label'), { color: colors.success }]}>Completed</Text>
              <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                XP is added to your total. Drills count once, so there is nothing more to do here.
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {submitError ? (
              <Text style={[textStyle('caption'), { color: colors.danger }]}>{submitError}</Text>
            ) : null}
            <Button variant="primary" onPress={onMarkCompletePress}>
              <CircleCheck size={18} strokeWidth={2} color={colors.inkOnAccent} />
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Mark complete</Text>
            </Button>
          </View>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={confirmVisible}
        icon={CircleCheck}
        title="Mark this drill complete?"
        body="This adds the drill's XP to your total and cannot be undone. Drills count once."
        confirmLabel="Mark complete"
        cancelLabel="Not yet"
        loading={submitting}
        onConfirm={() => void onConfirmComplete()}
        onCancel={() => {
          if (!submitting) setConfirmVisible(false);
        }}
      />

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
