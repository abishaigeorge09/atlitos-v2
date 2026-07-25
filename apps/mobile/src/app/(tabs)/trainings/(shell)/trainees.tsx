import { useCoachTrainees, type TraineeSummary } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * AT-48, PRD-02 3.5, FR-20. Every athlete with at least one session against
 * this coach, any status, deduplicated. Row: avatar, name, session count,
 * last session date, status chip (an upcoming accepted/rescheduled session
 * reads as an active relationship). States: loading, empty (no trainees
 * yet), populated, error. Renders as tab content inside the Trainings
 * shell layout, which owns the module header and TrainingsSubNav.
 */
export default function CoachTraineesScreen() {
  const colors = useThemeColors();
  const trainees = useCoachTrainees(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [items, setItems] = useState<TraineeSummary[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const result = await trainees.listTrainees();
      setItems(result);
      setState(result.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton shape="card" height={80} />
          <Skeleton shape="card" height={80} />
          <Skeleton shape="card" height={80} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load trainees</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              height: 80,
              width: 80,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceMuted,
            }}
          >
            <Users size={48} color={colors.textTertiary} strokeWidth={1.75} />
          </View>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No trainees yet</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Athletes you have trained will show up here once they book a session with you.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.playerId}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/(tabs)/trainings/trainee/[id]', params: { id: item.playerId } })
              }
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
              }}
            >
              <Avatar uri={item.avatarUrl ?? undefined} name={item.name} size={56} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[textStyle('h3'), { color: colors.text }]}>{item.name}</Text>
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                  {item.sessionCount} {item.sessionCount === 1 ? 'session' : 'sessions'}, last on {item.lastSessionDate}
                </Text>
              </View>
              <View
                style={{
                  borderRadius: radii.pill,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  backgroundColor: item.hasUpcoming ? colors.successTint : colors.surfaceMuted,
                }}
              >
                <Text
                  style={[textStyle('label'), { color: item.hasUpcoming ? colors.success : colors.textSecondary }]}
                >
                  {item.hasUpcoming ? 'Active' : 'No upcoming'}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
