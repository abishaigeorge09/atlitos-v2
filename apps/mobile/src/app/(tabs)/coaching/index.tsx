import { useCoaching, type CoachListItem } from '@atlitos/api';
import type { ApiError, Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock, MapPin, RefreshCw, TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CoachCard } from '@/components/ui/coach-card';
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
 * Coach discovery. PRD-01 FR-20/FR-21 (AT-52): sport chips over a CoachCard
 * list, real `coach_profiles_public` data (already filtered to `status =
 * 'verified'` by the view itself, see `useCoaching.listCoaches`), same
 * "reflects the current location context" reading as Courts, but as a
 * same-city-first sort rather than a haversine distance (`coach_profiles`
 * has no lat/lng, see `use-coaching.ts`). Guest-open per FR-2, nothing here
 * mutates; the Book action gates on the profile screen instead, matching
 * Courts' own "gate lives on the detail screen" pattern. States: loading
 * (skeleton cards), empty, populated, error (retry).
 */
export default function CoachingIndexScreen() {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);
  const isGuest = useSessionStore((state) => state.status === 'guest');
  const [gateVisible, setGateVisible] = useState(false);

  const locationStatus = useLocationStore((state) => state.status);
  const city = useLocationStore((state) => state.city);

  const [sport, setSport] = useState<Sport | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<CoachListItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setState('loading');
      setError(null);
      try {
        const result = await coaching.listCoaches({ sport: sport ?? undefined, city });
        setItems(result);
        setState(result.length === 0 ? 'empty' : 'populated');
      } catch (err) {
        setError(err as ApiError);
        setState('error');
      }
    },
    [sport, city],
  );

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
          <Text style={[textStyle('h1'), { color: colors.text }]}>Coaches</Text>
          <Pressable
            accessibilityRole="button"
            className="min-h-11 flex-row items-center gap-xs rounded-pill px-md active:bg-surface-muted"
            onPress={() => {
              if (isGuest) {
                setGateVisible(true);
                return;
              }
              router.push('/(tabs)/coaching/bookings');
            }}
          >
            <CalendarClock size={18} strokeWidth={1.75} color={colors.accent} />
            <Text className="font-sans-semibold text-sm text-accent">My sessions</Text>
          </Pressable>
        </View>

        <View className="flex-row items-center gap-xs">
          <MapPin size={14} strokeWidth={1.75} color={colors.textTertiary} />
          <Text className="font-sans text-sm text-text-secondary">
            {locationStatus === 'loading' ? 'Finding your location...' : `Showing coaches near ${city}`}
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
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load coaches</Text>
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
            <Users size={48} color={colors.textTertiary} strokeWidth={1.75} />
          </View>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No coaches found</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {sport
              ? `No verified ${SPORT_LABEL[sport].toLowerCase()} coaches near ${city} right now. Try another sport.`
              : `No verified coaches near ${city} right now. Check back soon.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.userId}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          renderItem={({ item }) => (
            <CoachCard
              avatarUri={item.avatarUrl}
              name={item.name}
              rating={item.rating}
              sport={SPORT_LABEL[item.sport]}
              experienceYears={item.experienceYears}
              priceFrom={item.priceFrom}
              city={item.city}
              onPress={() => router.push({ pathname: '/(tabs)/coaching/coach/[id]', params: { id: item.userId } })}
            />
          )}
        />
      )}

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
