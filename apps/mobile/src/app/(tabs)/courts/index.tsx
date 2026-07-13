import { useCourts } from '@atlitos/api';
import type { ApiError, Court, Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock, LandPlot, MapPin, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CourtCard } from '@/components/ui/court-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const SPORT_FILTERS: Sport[] = ['football', 'cricket', 'badminton', 'tennis'];

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * Courts tab root. PRD-01 3.5 / SPEC.md 6.6: sport chips filter over a
 * CourtCard list, real `venues`/`courts` data (RLS already restricts reads
 * to `venues.status = 'verified'`), sorted by distance from the location
 * store. Guest-open per FR-2 (nothing here mutates; Book routes to the
 * detail screen, which is where the guest gate actually lives, on the pay
 * step). States: loading (skeleton cards), empty (no courts for this
 * sport/location yet), populated, error (fetch failed, retry).
 */
export default function CourtsIndexScreen() {
  const colors = useThemeColors();
  const courts = useCourts(supabase);
  const isGuest = useSessionStore((state) => state.status === 'guest');
  const [gateVisible, setGateVisible] = useState(false);

  const locationStatus = useLocationStore((state) => state.status);
  const locationRequested = useLocationStore((state) => state.requested);
  const city = useLocationStore((state) => state.city);
  const coords = useLocationStore((state) => state.coords);
  const requestLocation = useLocationStore((state) => state.requestLocation);

  const [sport, setSport] = useState<Sport | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<Court[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setState('loading');
      setError(null);
      try {
        const result = await courts.listCourts({ sport: sport ?? undefined, near: coords });
        const sorted = [...result].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
        setItems(sorted);
        setState(sorted.length === 0 ? 'empty' : 'populated');
      } catch (err) {
        setError(err as ApiError);
        setState('error');
      }
    },
    [sport, coords],
  );

  useEffect(() => {
    if (!locationRequested) {
      void requestLocation();
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
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <View className="flex-row items-center justify-between">
          <Text style={[textStyle('h1'), { color: colors.text }]}>Courts</Text>
          <Pressable
            accessibilityRole="button"
            className="min-h-11 flex-row items-center gap-xs rounded-pill px-md active:bg-surface-muted"
            onPress={() => {
              if (isGuest) {
                setGateVisible(true);
                return;
              }
              router.push('/(tabs)/courts/bookings');
            }}
          >
            <CalendarClock size={18} strokeWidth={1.75} color={colors.accent} />
            <Text className="font-sans-semibold text-sm text-accent">My bookings</Text>
          </Pressable>
        </View>

        <View className="flex-row items-center gap-xs">
          <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
          <Text className="font-sans text-sm text-text-secondary">
            {locationStatus === 'loading' ? 'Finding your location...' : `Showing courts near ${city}`}
          </Text>
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={SPORT_FILTERS}
          keyExtractor={(item) => item}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
          ListHeaderComponent={
            <Chip label="All sports" variant="filter" selected={sport === null} onPress={() => setSport(null)} />
          }
          ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
          renderItem={({ item }) => (
            <Chip
              label={SPORT_LABEL[item]}
              variant="filter"
              selected={sport === item}
              onPress={() => setSport(item)}
            />
          )}
        />
      </View>

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={220} />
          <Skeleton shape="card" height={220} />
          <Skeleton shape="card" height={220} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load courts</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
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
            <LandPlot size={48} color={colors.textTertiary} strokeWidth={1.75} />
          </View>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            No courts near you yet
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {sport
              ? `No verified ${SPORT_LABEL[sport].toLowerCase()} courts near ${city} right now. Try another sport.`
              : `No verified courts near ${city} right now. Check back soon.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          renderItem={({ item }) => (
            <CourtCard
              imageUri={item.images[0]}
              name={item.name}
              location={item.location}
              pricePerHour={item.basePricePerHour}
              distanceKm={item.distanceKm}
              onPress={() => router.push({ pathname: '/(tabs)/courts/court/[id]', params: { id: item.id } })}
              onBookPress={() => router.push({ pathname: '/(tabs)/courts/court/[id]', params: { id: item.id } })}
            />
          )}
        />
      )}

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
