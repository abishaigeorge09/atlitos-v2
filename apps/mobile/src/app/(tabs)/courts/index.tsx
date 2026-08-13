import { useCourts } from '@atlitos/api';
import type { ApiError, Court, Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock, LandPlot, MapPin, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CourtCard } from '@/components/ui/court-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { usePendingAuthAction } from '@/hooks/use-pending-auth-action';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const SPORT_FILTERS: Sport[] = ['football', 'cricket', 'badminton', 'tennis'];

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * F4 (P5 fix pass, P5-IOS-FINDINGS.md finding F-3): a device's resolved
 * coordinates are real (not faked, see location-store.ts's fallback rules),
 * but a simulator/emulator's GPS can be nowhere near the seed venues (the
 * reported repro: real San Francisco simulator coords against real
 * Hyderabad/Bangalore venues computed a mathematically correct but useless
 * "13,486.1 km" readout under a header claiming "near San Francisco"). No
 * server-side signal distinguishes "genuinely far within India" from "this
 * location has nothing to do with the venue set", so this is a distance
 * sanity threshold, not a location-source check: past this point a numeric
 * distance and a "near <city>" claim are actively misleading rather than
 * merely large, and the honest move is to say so instead of rendering the
 * number. India's own north-south span is ~3,200 km, so 3,000 km is chosen
 * to stay well clear of any real in-country search.
 */
const IMPLAUSIBLE_DISTANCE_KM = 3000;

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
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const profileCity = useSessionStore((state) => state.me?.city ?? null);
  const [gateVisible, setGateVisible] = useState(false);
  // F8 (P5 fix pass, PRD-01 FR-4): "My bookings" navigation used to be
  // dropped when the gate opened.
  const { requireAuth, clearPendingAction } = usePendingAuthAction(requiresAuthGate);

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

  // F4: coords resolved but implausibly far from every result. Treat as "no
  // meaningful nearby match" rather than claim proximity or show the number.
  const nearestDistanceKm = items.reduce<number | null>((min, item) => {
    if (item.distanceKm === undefined) return min;
    return min === null ? item.distanceKm : Math.min(min, item.distanceKm);
  }, null);
  const locationIsMeaningful = coords === null || nearestDistanceKm === null || nearestDistanceKm <= IMPLAUSIBLE_DISTANCE_KM;

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
      // Track D defect 8: hand the store the athlete's own profile city so a
      // denied/unavailable permission shows their real city (with no faked
      // coords) instead of always pretending Hyderabad.
      void requestLocation(profileCity);
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

  const header = (
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <View className="flex-row items-center justify-between">
        <Text style={[textStyle('h1'), { color: colors.text }]}>Courts</Text>
        <Pressable
          accessibilityRole="button"
          className="min-h-11 flex-row items-center gap-xs rounded-pill px-md active:bg-surface-muted"
          onPress={() => requireAuth(() => router.push('/(tabs)/courts/bookings'), () => setGateVisible(true))}
        >
          <CalendarClock size={18} strokeWidth={1.75} color={colors.accent} />
          <Text className="font-sans-semibold text-sm text-accent">My bookings</Text>
        </Pressable>
      </View>

      <View className="flex-row items-center gap-xs">
        <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
        <Text className="font-sans text-sm text-text-secondary">
          {locationStatus === 'loading'
            ? 'Finding your location...'
            : /* F4: a resolved city with no court within a plausible
                 distance is not a claim this line should make. */
              locationIsMeaningful
              ? `Showing courts near ${city}`
              : 'Showing all verified courts'}
        </Text>
      </View>

      {/* Track D defect 18: the chip row overflows the viewport (5 chips
          don't fit on a standard phone width). The list itself already
          scrolls; what was missing is (a) trailing padding so the last chip
          clears the screen edge with breathing room instead of sitting
          flush against it, and (b) a visible edge fade so the cut off chip
          reads as "more to scroll" rather than a clipped layout bug. */}
      <View style={{ position: 'relative' }}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={SPORT_FILTERS}
          keyExtractor={(item) => item}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.xl }}
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
        <View
          pointerEvents="none"
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: spacing['2xl'] }}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="sport-filter-fade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
                <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#sport-filter-fade)" />
          </Svg>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {state === 'loading' ? (
        <View>
          {header}
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <Skeleton shape="card" height={220} />
            <Skeleton shape="card" height={220} />
            <Skeleton shape="card" height={220} />
          </View>
        </View>
      ) : state === 'error' ? (
        <View>
          {header}
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
        </View>
      ) : state === 'empty' ? (
        <View>
          {header}
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
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          renderItem={({ item }) => (
            <CourtCard
              imageUri={item.images[0]}
              name={item.name}
              location={item.location}
              pricePerHour={item.basePricePerHour}
              distanceKm={locationIsMeaningful ? item.distanceKm : undefined}
              onPress={() => router.push({ pathname: '/(tabs)/courts/court/[id]', params: { id: item.id } })}
              onBookPress={() => router.push({ pathname: '/(tabs)/courts/court/[id]', params: { id: item.id } })}
            />
          )}
        />
      )}

      <LoginGateModal
        visible={gateVisible}
        onClose={() => setGateVisible(false)}
        onDismiss={clearPendingAction}
      />
    </SafeAreaView>
  );
}
