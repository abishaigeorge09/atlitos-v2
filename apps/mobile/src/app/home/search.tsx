import { useSearch } from '@atlitos/api';
import { formatINR, spacing } from '@atlitos/theme';
import type { ApiError, SearchEntityType, SearchHit } from '@atlitos/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Clock, RefreshCw, SearchX, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SearchResults,
  type SearchResultItem,
  type SearchSegment,
} from '@/components/organisms/SearchResults';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'idle' | 'loading' | 'empty' | 'populated' | 'error';

// Recent searches: last 8, most recent first, persisted locally. Not owner
// scoped data, just a client convenience, so AsyncStorage (like the guest
// wishlist) rather than a server round trip.
const RECENT_SEARCHES_KEY = 'atlitos.search.recent';
const MAX_RECENT_SEARCHES = 8;

// Suggestion chips shown above results when the query is empty, one per
// segment plus a price cut and a donate prompt.
const SUGGESTIONS = ['Courts near me', 'Badminton gear', 'Coaches under 500', 'Athletes to support'];

// The search entity types map onto the organism's three segments. Keeping the
// mapping here, not in the organism, lets the transport stay in v1's
// gear/coach/court vocabulary while the UI reads gear/coaches/courts.
const SEGMENT_OF: Record<SearchEntityType, SearchSegment> = {
  gear: 'gear',
  coach: 'coaches',
  court: 'courts',
  athlete: 'athletes',
  clip: 'clips',
};

/**
 * AI Search screen. SPEC 6.2 / PRD-01: a single query box over the whole
 * catalog (coaches, courts, gear) that calls the `ai-search` edge function
 * (AT-144) and renders its ranked, grouped results. Each result routes to the
 * matching detail screen. Guest open, nothing here mutates; the visibility of
 * every row is decided server side, so this screen never re-filters.
 *
 * States: idle (no query yet), loading, populated (with segment tabs when the
 * results span more than one type), empty, error.
 */
export default function SearchScreen() {
  const colors = useThemeColors();
  const search = useSearch(supabase);
  const city = useLocationStore((state) => state.city);
  const coords = useLocationStore((state) => state.coords);

  const [query, setQuery] = useState('');
  const [state, setState] = useState<LoadState>('idle');
  const [hits, setHits] = useState<SearchHit[]>([]);
  // FR-16: the specific broaden suggestion the server returns with an honest
  // empty result set (e.g. "No Babolat rackets under 2000. Try raising to 3000,
  // or removing the brand."). Rendered verbatim in the empty state.
  const [broaden, setBroaden] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [activeSegment, setActiveSegment] = useState<SearchSegment>('coaches');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Guards a late response from an earlier keystroke overwriting a newer one.
  const requestSeq = useRef(0);
  // The last trimmed query we actually searched. Short-circuits a repeat fetch
  // of an unchanged query (BUG-001): the debounce must fire exactly one request
  // per distinct query, never re-run on an unchanged one.
  const lastSearchedRef = useRef('');

  useEffect(() => {
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then((raw) => {
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.filter((q): q is string => typeof q === 'string'));
        }
      })
      .catch(() => {
        // A malformed or unreadable value is not worth failing the screen
        // over, start from an empty recent list.
      });
  }, []);

  const rememberSearch = useCallback((q: string) => {
    setRecentSearches((current) => {
      const next = [q, ...current.filter((existing) => existing.toLowerCase() !== q.toLowerCase())].slice(
        0,
        MAX_RECENT_SEARCHES,
      );
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(() => {
        // In-memory state already reflects it; a failed write only costs
        // persistence across a restart.
      });
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    AsyncStorage.removeItem(RECENT_SEARCHES_KEY).catch(() => {
      // Nothing to recover, the in-memory list is already empty.
    });
  }, []);

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (q.length < 2) {
        lastSearchedRef.current = '';
        setState('idle');
        setHits([]);
        return;
      }
      // Already searched this exact query and it is still on screen: do nothing.
      // Without this a repeat call (or an effect refire) re-fetches an unchanged
      // query and flips loading<->populated (BUG-001).
      if (q === lastSearchedRef.current) return;
      lastSearchedRef.current = q;
      const seq = ++requestSeq.current;
      setState('loading');
      setError(null);
      try {
        const res = await search.search({
          query: q,
          city,
          lat: coords?.lat,
          lng: coords?.lng,
        });
        if (seq !== requestSeq.current) return; // a newer query already ran
        setHits(res.results);
        setBroaden(res.broaden ?? null);
        setState(res.results.length === 0 ? 'empty' : 'populated');
        rememberSearch(q);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        // Clear the guard so the Retry button can re-run the same query.
        lastSearchedRef.current = '';
        setError(err as ApiError);
        setState('error');
      }
    },
    [search, city, coords, rememberSearch],
  );

  // Keep the debounce effect keyed only on `query`. It reads the latest
  // `runSearch` through a ref so a change in `runSearch` identity (e.g. from a
  // location change) never reschedules or refires the debounce. Typing once
  // changes `query` once, which fires exactly one delayed search.
  const runSearchRef = useRef(runSearch);
  useEffect(() => {
    runSearchRef.current = runSearch;
  }, [runSearch]);

  // Debounce keystrokes so a query fires once the user pauses, not per letter.
  useEffect(() => {
    const handle = setTimeout(() => void runSearchRef.current(query), 300);
    return () => clearTimeout(handle);
  }, [query]);

  const segments = useMemo(() => {
    const present = new Set<SearchSegment>();
    for (const hit of hits) present.add(SEGMENT_OF[hit.entityType]);
    // Stable order: coaches, courts, gear, athletes, clips.
    return (['coaches', 'courts', 'gear', 'athletes', 'clips'] as SearchSegment[]).filter((s) => present.has(s));
  }, [hits]);

  // Keep the active segment valid as results change.
  useEffect(() => {
    if (segments.length > 0 && !segments.includes(activeSegment)) {
      setActiveSegment(segments[0]);
    }
  }, [segments, activeSegment]);

  function openHit(hit: SearchHit) {
    switch (hit.entityType) {
      case 'gear':
        router.push({ pathname: '/shop/product/[id]', params: { id: hit.entityId } });
        break;
      case 'coach':
        router.push({ pathname: '/(tabs)/coaching/coach/[id]', params: { id: hit.entityId } });
        break;
      case 'court':
        router.push({ pathname: '/(tabs)/courts/court/[id]', params: { id: hit.entityId } });
        break;
      case 'athlete':
        router.push({ pathname: '/home/upa/[id]', params: { id: hit.entityId } });
        break;
      case 'clip':
        router.push({ pathname: '/(tabs)/clutch/post/[id]', params: { id: hit.entityId } });
        break;
    }
  }

  const visibleItems: SearchResultItem[] = useMemo(() => {
    const source = segments.length > 1 ? hits.filter((h) => SEGMENT_OF[h.entityType] === activeSegment) : hits;
    return source.map((hit) => ({
      id: `${hit.entityType}:${hit.entityId}`,
      title: hit.title,
      subtitle: hit.subtitle,
      imageUrl: hit.imageUrl,
      price: typeof hit.price === 'number' ? formatINR(hit.price) : undefined,
      rankReason: hit.rankReason,
      onPress: () => openHit(hit),
    }));
  }, [hits, segments, activeSegment]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Search" onPressBack={() => router.back()} />

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <SearchBar
          variant="ai"
          autoFocus
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => void runSearch(query)}
        />
        <Text style={[textStyle('caption'), { color: colors.textTertiary, paddingTop: spacing.xs }]}>
          {`Searching near ${city}`}
        </Text>
      </View>

      {state === 'idle' ? (
        <View style={{ flex: 1, gap: spacing.lg }}>
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            <Text style={[textStyle('label'), { color: colors.textTertiary }]}>Suggested</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {SUGGESTIONS.map((suggestion) => (
                <Chip
                  key={suggestion}
                  label={suggestion}
                  onPress={() => {
                    setQuery(suggestion);
                    void runSearch(suggestion);
                  }}
                />
              ))}
            </View>
          </View>

          {recentSearches.length > 0 ? (
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={[textStyle('label'), { color: colors.textTertiary }]}>Recent searches</Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={clearRecentSearches}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
                >
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>Clear</Text>
                </Pressable>
              </View>
              {recentSearches.map((recent) => (
                <Pressable
                  key={recent}
                  accessibilityRole="button"
                  onPress={() => {
                    setQuery(recent);
                    void runSearch(recent);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    minHeight: 44,
                  }}
                >
                  <Clock size={18} color={colors.textTertiary} strokeWidth={1.75} />
                  <Text style={[textStyle('body'), { color: colors.text }]} numberOfLines={1}>
                    {recent}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={{ flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
            <SearchX size={40} color={colors.textTertiary} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
              Find coaches, courts, gear, athletes and clips
            </Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              Try "badminton coach near me" or "cricket bat under 1500".
            </Text>
          </View>
        </View>
      ) : state === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't run that search</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void runSearch(query)}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : (
        <SearchResults
          query={query.trim()}
          segments={segments}
          activeSegment={activeSegment}
          onSegmentChange={setActiveSegment}
          results={visibleItems}
          emptyLabel={broaden ?? `No matches for "${query.trim()}" near ${city}. Try another search.`}
        />
      )}
    </SafeAreaView>
  );
}
