import { useCoachTrainees } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarX2, MessageCircle, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { SESSION_STATUS_PILL } from '@/lib/session-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * AT-48, PRD-02 3.5, FR-21. Full session history with one athlete, newest
 * first, status pills matching the session state machine. Quick actions:
 * message (deep links into the shared chat organism, Track E); "book follow
 * up" is explicitly out of scope (PRD-02 section 8: coach initiated
 * sessions are not built, all sessions originate from athlete booking).
 * States: loading, empty (no sessions somehow, an edge case since a trainee
 * row always implies at least one), populated, error.
 */
export default function CoachTraineeDetailScreen() {
  const colors = useThemeColors();
  const trainees = useCoachTrainees(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await trainees.getTraineeSessions(id);
      setSessions(result);
      setState(result.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const first = sessions[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Trainee" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="circle" width={56} height={56} />
          <Skeleton shape="card" height={100} />
          <Skeleton shape="card" height={100} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load trainee</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <CalendarX2 size={48} color={colors.textTertiary} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No sessions found</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
              <Avatar name={first?.playerName} size={56} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[textStyle('h2'), { color: colors.text }]}>{first?.playerName ?? 'Athlete'}</Text>
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                  {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} together
                </Text>
              </View>
              <Button variant="secondary" size="sm" onPress={() => router.push('/(tabs)/trainings/chat')}>
                <MessageCircle size={16} strokeWidth={1.75} color={colors.text} />
                <Text style={{ color: colors.text }}>Message</Text>
              </Button>
            </View>
          }
          renderItem={({ item }) => (
            <View
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
                <Text style={[textStyle('h3'), { color: colors.text }]}>{item.sessionTypeName ?? 'Session'}</Text>
                <StatusPill status={SESSION_STATUS_PILL[item.status]} />
              </View>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                {item.date}, {item.slot.from} to {item.slot.to}
              </Text>
              <View className="flex-row items-center justify-between pt-xs">
                {item.focusArea ? (
                  <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{item.focusArea}</Text>
                ) : (
                  <View />
                )}
                <PriceText amount={item.total - item.platformFee} size="sm" />
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
