import { useCourts } from '@atlitos/api';
import type { ApiError, CourtBooking } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarX2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PriceText } from '@/components/ui/price-text';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { COURT_BOOKING_STATUS_PILL } from '@/lib/court-booking-display';
import { supabase } from '@/lib/supabase';
import { AppBar } from '@/components/ui/app-bar';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * Bookings list. PRD-01 3.5 / SPEC.md 6.6's "My bookings" entry point from
 * the Courts tab. Player only (reached only through a signed-in tap on the
 * Courts index, see that screen's guest gate); RLS already scopes
 * `listMyBookings` to the caller's own rows. States: loading, empty
 * (no bookings yet), populated, error.
 */
export default function CourtBookingsListScreen() {
  const colors = useThemeColors();
  const courts = useCourts(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [items, setItems] = useState<CourtBooking[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const result = await courts.listMyBookings();
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="My bookings" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={120} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Couldn't load your bookings
          </Text>
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
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No bookings yet</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Book a court from the Courts tab and it will show up here.
          </Text>
          <Button onPress={() => router.replace('/(tabs)/courts')}>
            <Text style={{ color: colors.inkOnAccent }}>Find a court</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/(tabs)/courts/booking/[id]', params: { id: item.id } })}
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
                <Text style={[textStyle('h3'), { color: colors.text }]}>{item.courtName ?? 'Court'}</Text>
                <StatusPill status={COURT_BOOKING_STATUS_PILL[item.status]} />
              </View>
              {item.venueName ? (
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{item.venueName}</Text>
              ) : null}
              <View className="flex-row items-center justify-between pt-xs">
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                  {item.date}, {item.slot.from} to {item.slot.to}
                </Text>
                <PriceText amount={item.total} size="sm" />
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
