import { useCoaching, type CoachListItem } from '@atlitos/api';
import type { ApiError, Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { RefreshCw, TriangleAlert, Users } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

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

export interface CoachBrowseListProps {
  /** Where a tapped coach opens. The standalone /coaching surface pushes
   * its own coach/[id] sibling; the Trainings Coaches tab pushes the
   * profile above the Trainings module so back returns to the tab with the
   * shell intact. */
  onOpenCoach: (coachId: string) => void;
  /** Optional content rendered above the location line and sport chips, in
   * every state (loading, error, empty, populated). The standalone
   * /coaching surface passes none; the Trainings Coaches tab passes its
   * "My coaches" section here so the whole tab renders as one scroll
   * region instead of a browse list nested inside another scroller. */
  header?: ReactNode;
  /** False when embedded inside a caller-owned ScrollView (the Trainings
   * Coaches tab, which scrolls "My coaches" and this list together as one
   * region so there is only ever one scroller on screen); the standalone
   * /coaching surface leaves this at its default of true, since there the
   * list is the screen's only scroller and needs to fill it. */
  scrollEnabled?: boolean;
}

/**
 * Coach discovery list, extracted from the /coaching route (AT-52,
 * PRD-01 FR-20/FR-21) so the Trainings module's Coaches tab can embed it
 * inline instead of redirecting to the separate coaching tab, same
 * reasoning as ChatThreadList's extraction for the Chat tab. Sport chips
 * over a CoachCard list, real `coach_profiles_public` data (already
 * filtered to `status = 'verified'` by the view itself, see
 * `useCoaching.listCoaches`), same-city-first sort. Guest-open per FR-2,
 * nothing here mutates; the Book action gates on the coach detail screen
 * instead. States: loading (skeleton cards), empty, populated, error
 * (retry).
 */
export function CoachBrowseList({ onOpenCoach, header, scrollEnabled = true }: CoachBrowseListProps) {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);

  const locationStatus = useLocationStore((state) => state.status);
  const city = useLocationStore((state) => state.city);

  // Default the sport filter to the player's primary sport (athlete_sports,
  // via the session me) so a cricket player lands on cricket coaches, not "All
  // sports". The manual chips below still change it. Seeded lazily and, because
  // me can resolve after mount, applied once via the effect below, but only
  // while the player has not touched a chip (userPickedRef) so an intentional
  // "All sports" or another-sport pick is never overwritten.
  const primarySport = useSessionStore((s) => s.me?.primarySport ?? null);
  const [sport, setSport] = useState<Sport | null>(primarySport);
  const userPickedRef = useRef(false);
  useEffect(() => {
    if (!userPickedRef.current && primarySport) setSport(primarySport);
  }, [primarySport]);

  function pickSport(next: Sport | null) {
    userPickedRef.current = true;
    setSport(next);
  }

  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<CoachListItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // CT-5 (P1-3): keyset pagination, page 1 has no cursor. `null` after a
  // page load means the server said this was the last page; `loadingMore`
  // guards against `onEndReached` firing a second request while one is
  // already in flight (FlatList can fire it more than once per scroll).
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setState('loading');
      setError(null);
      try {
        const result = await coaching.listCoaches({ sport: sport ?? undefined, city });
        setItems(result.items);
        setNextCursor(result.nextCursor);
        setState(result.items.length === 0 ? 'empty' : 'populated');
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

  // Loads the next keyset page and appends it. Never refetches page 1 and
  // never issues a second unbounded select: every call still carries the
  // same bounded `.limit()` CT-5 requires.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await coaching.listCoaches({ sport: sport ?? undefined, city, cursor: nextCursor });
      setItems((previous) => [...previous, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch {
      // A failed "load more" leaves the already-shown page intact; the
      // athlete can retry by scrolling again (onEndReached refires), no
      // need to surface a full screen error for a tail-page fetch.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, sport, city]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  const listHeader = (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.md }}>
      {header}

      <Text className="font-sans text-sm text-text-secondary">
        {locationStatus === 'loading' ? 'Finding your location...' : `Showing coaches near ${city}`}
      </Text>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={SPORT_FILTERS}
        keyExtractor={(item) => item}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
        ListHeaderComponent={
          <Chip label="All sports" variant="filter" selected={sport === null} onPress={() => pickSport(null)} />
        }
        ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
        renderItem={({ item }) => (
          <Chip
            label={SPORT_LABEL[item]}
            variant="filter"
            selected={sport === item}
            onPress={() => pickSport(item)}
          />
        )}
      />
    </View>
  );

  if (state === 'loading') {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        {listHeader}
        <View style={{ gap: spacing.lg }}>
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
        </View>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        {listHeader}
        <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}>
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
      </View>
    );
  }

  if (state === 'empty') {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        {listHeader}
        <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}>
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
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.userId}
      ListHeaderComponent={listHeader}
      scrollEnabled={scrollEnabled}
      style={scrollEnabled ? { flex: 1 } : undefined}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      refreshControl={
        scrollEnabled ? <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} /> : undefined
      }
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      // CT-5 (P1-3): the only way this screen ever sees a coach past the
      // first bounded page. `onEndReachedThreshold` fires the next keyset
      // fetch before the athlete hits the literal bottom, `loadMore` itself
      // is a no-op once `nextCursor` is null (last page) or a fetch is
      // already in flight.
      onEndReachedThreshold={0.5}
      onEndReached={() => void loadMore()}
      ListFooterComponent={
        loadingMore ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
            <Skeleton shape="card" height={110} />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <CoachCard
          avatarUri={item.avatarUrl}
          name={item.name}
          rating={item.rating}
          sport={SPORT_LABEL[item.sport]}
          experienceYears={item.experienceYears}
          priceFrom={item.priceFrom}
          city={item.city}
          onPress={() => onOpenCoach(item.userId)}
        />
      )}
    />
  );
}
