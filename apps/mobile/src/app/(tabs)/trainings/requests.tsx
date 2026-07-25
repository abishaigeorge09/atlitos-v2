import { isOnlineSessionTypeName, useCoachSessions } from '@atlitos/api';
import type { ApiError, Session } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarX2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SessionFilterChips, type SessionFilterKey } from '@/components/organisms/trainings/SessionFilterChips';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { SessionCard } from '@/components/ui/session-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * AT-46, PRD-02 3.4, extended to the Figma Session Requests screen (node
 * 1047:14952): the shared All / 1 on 1 / Group / Online filter chips over
 * the pending list. Only 1:1 sessions can be in `requested` (group
 * sessions are coach scheduled and insert `accepted`; joining a group is
 * a payment, not a request, under the ratified fares model), so the Group
 * filter honestly renders its explanatory empty text instead of inventing
 * request rows. Same Accept/Decline pair as the dashboard preview.
 * States: loading, empty (no pending requests), populated (with per
 * filter empty text), error (action failed, retry surfaces inline per
 * request, matching the dashboard's pattern).
 */
export default function CoachRequestsScreen() {
  const colors = useThemeColors();
  const coachSessions = useCoachSessions(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [items, setItems] = useState<Session[]>([]);
  const [filter, setFilter] = useState<SessionFilterKey>('all');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionErrorId, setActionErrorId] = useState<string | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const result = await coachSessions.listRequests();
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

  async function handleAccept(sessionId: string) {
    setActioningId(sessionId);
    setActionErrorId(null);
    try {
      await coachSessions.acceptSession(sessionId);
      await load({ silent: true });
    } catch (err) {
      setActionErrorId(sessionId);
      setError(err as ApiError);
    } finally {
      setActioningId(null);
    }
  }

  async function handleDecline(sessionId: string) {
    setActioningId(sessionId);
    setActionErrorId(null);
    try {
      await coachSessions.declineSession(sessionId);
      await load({ silent: true });
    } catch (err) {
      setActionErrorId(sessionId);
      setError(err as ApiError);
    } finally {
      setActioningId(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Requests" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={160} />
          <Skeleton shape="card" height={160} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load requests</Text>
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
            <CalendarX2 size={48} color={colors.textTertiary} strokeWidth={1.75} />
          </View>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No pending requests</Text>
        </View>
      ) : (
        <>
        <SessionFilterChips active={filter} onChange={setFilter} />
        <FlatList
          data={items.filter((item) => {
            if (filter === 'one_on_one') return !isOnlineSessionTypeName(item.sessionTypeName);
            if (filter === 'online') return isOnlineSessionTypeName(item.sessionTypeName);
            if (filter === 'group') return false;
            return true;
          })}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg }}>
              <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                {filter === 'group'
                  ? 'Group sessions have no requests. Athletes join a group the moment their payment goes through.'
                  : filter === 'online'
                    ? 'No pending online requests.'
                    : 'No pending requests match this filter.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ gap: spacing.xs }}>
              <SessionCard
                variant="request"
                date={item.date}
                timeSlot={`${item.slot.from} to ${item.slot.to}`}
                personName={item.playerName ?? 'Athlete'}
                sessionType={item.sessionTypeName ?? ''}
                focusArea={item.focusArea || 'No focus area noted'}
                location={item.location || 'Location to be confirmed'}
                onPress={() => router.push({ pathname: '/(tabs)/trainings/session/[id]', params: { id: item.id } })}
                onAccept={() => void handleAccept(item.id)}
                onDecline={() => void handleDecline(item.id)}
              />
              {actioningId === item.id ? (
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Updating...</Text>
              ) : actionErrorId === item.id ? (
                <Text style={[textStyle('caption'), { color: colors.danger }]}>
                  {error?.message ?? 'Could not update this request. Try again.'}
                </Text>
              ) : null}
            </View>
          )}
        />
        </>
      )}
    </SafeAreaView>
  );
}
