import { useCoaching, type CoachListItem } from '@atlitos/api';
import type { ApiError, Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { RefreshCw, TriangleAlert, Users } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';

import { LocationStatusRow } from '@/components/molecules/LocationStatusRow';
import { useNavBarInset } from '@/components/ui/bottom-nav';
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

/** Shared padding for the loading, error and empty containers, so all four
 * states line up with the populated list's own content padding. */
const STATE_CONTENT_STYLE = {
  padding: spacing.lg,
  gap: spacing.lg,
  paddingBottom: spacing['4xl'],
} as const;

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
  /** Extra work to run on pull to refresh, alongside this list's own reload.
   * The Trainings Coaches tab passes its "My coaches" reload here, because
   * that section renders inside this list's `header` and so has no
   * RefreshControl of its own. */
  onRefresh?: () => Promise<void> | void;
}

// SCALE-CLIENT.md P0-3. There used to be a `scrollEnabled` prop here, and the
// Trainings Coaches tab passed `false` so it could wrap this list in its own
// ScrollView. That combination did not merely disable scrolling, it turned
// virtualization OFF and made pagination run away, and it did so silently.
//
// Read from the React Native VirtualizedList source rather than inferred:
// `_maybeCallOnEdgeReached` fires `onEndReached` when the last rendered cell is
// the last item AND `distanceFromEnd <= threshold * visibleLength`. `_onLayout`
// sets `visibleLength` from the list's own layout height and skips the nesting
// correction unless `_isNestedWithSameOrientation()` is true, which reads
// `VirtualizedListContext`. A plain RN ScrollView does not provide that
// context. So with no `flex: 1` style inside a column content container, the
// list laid out at its FULL CONTENT HEIGHT: `visibleLength === contentLength`,
// offset 0, `distanceFromEnd` permanently 0. Consequences, all three at once:
// the render window covered the entire dataset so every row was mounted, the
// end threshold was always satisfied, and each appended page changed
// `contentLength`, which re-armed the check and fired the next page
// immediately. Nothing stopped it except running out of table.
//
// At 10,000 users with 300 verified coaches that is 15 pages, 45 serial round
// trips (~6.8 s of loading with zero user input) and 300 CoachCards mounted at
// once, each with an avatar image. It is visible at 40 coaches.
//
// The escape hatch is deleted rather than fixed, because a prop that quietly
// disables virtualization is one whose next use is also a bug. This list is
// always its own scroller now; a caller with content to put above it passes
// `header`, which is what the prop was always for.

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
export function CoachBrowseList({ onOpenCoach, header, onRefresh }: CoachBrowseListProps) {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const coaching = useCoaching(supabase);

  const city = useLocationStore((state) => state.city);
  const locationRequested = useLocationStore((state) => state.requested);
  const requestLocation = useLocationStore((state) => state.requestLocation);
  const profileCity = useSessionStore((s) => s.me?.city ?? null);

  // Track 3 sweep. This surface READ the location store but never asked it for
  // anything, so a player who opens Trainings > Coaches before ever opening
  // Courts browsed against the store's Hyderabad DEFAULT while the line above
  // the list claimed "Showing coaches near Hyderabad". The city is a real query
  // filter here (`listCoaches({ city })`), not decoration, so an unrequested
  // default is a wrong result set, not just wrong copy. Same trigger rule as
  // Courts: request once, never on every mount.
  useEffect(() => {
    if (!locationRequested) void requestLocation(profileCity);
    // Intentionally mount only, matching courts/index.tsx: `requested` flipping
    // true must not re-run this, and a retry is user driven from the row below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Both halves of the pull, in parallel: this list's own reload and any
    // caller-owned section rendered inside `header`.
    await Promise.all([load({ silent: true }), onRefresh?.()]);
    setRefreshing(false);
  }

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />;

  const listHeader = (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.md }}>
      {header}

      <LocationStatusRow resolvedLabel={`Showing coaches near ${city}`} profileCity={profileCity} />

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

  // The three non-populated states carry no list, so a ScrollView is the right
  // container for them: there is nothing to virtualize, and `header` can be
  // arbitrarily tall (the Trainings tab puts its whole "My coaches" section
  // there), so it has to be able to scroll. This is never nested inside
  // another scroller, see the note on the props above.
  if (state === 'loading') {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={STATE_CONTENT_STYLE} refreshControl={refreshControl}>
        {listHeader}
        <View style={{ gap: spacing.lg }}>
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
        </View>
      </ScrollView>
    );
  }

  if (state === 'error') {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={STATE_CONTENT_STYLE} refreshControl={refreshControl}>
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
      </ScrollView>
    );
  }

  if (state === 'empty') {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={STATE_CONTENT_STYLE} refreshControl={refreshControl}>
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
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.userId}
      ListHeaderComponent={listHeader}
      // Always its own scroller, always `flex: 1`. Both halves matter: the
      // style is what gives the list a real viewport height, which is what
      // `visibleLength` is read from, which is what makes virtualization and
      // `onEndReached` mean anything at all. See the P0-3 note above.
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: navInset + spacing['4xl'] }}
      refreshControl={refreshControl}
      // Bounded render window. Without these the list still virtualizes, but
      // RN's default `windowSize` of 21 keeps roughly 21 viewports of coach
      // cards (and their avatars) mounted, which is the memory half of the
      // same finding.
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
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
