import { useSearch } from '@atlitos/api';
import { formatINR, spacing } from '@atlitos/theme';
import type { ApiError, SearchEntityType, SearchHit } from '@atlitos/types';
import { router } from 'expo-router';
import { RefreshCw, SearchX, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SearchResults,
  type SearchResultItem,
  type SearchSegment,
} from '@/components/organisms/SearchResults';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { SearchBar } from '@/components/ui/search-bar';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'idle' | 'loading' | 'empty' | 'populated' | 'error';

// The search entity types map onto the organism's three segments. Keeping the
// mapping here, not in the organism, lets the transport stay in v1's
// gear/coach/court vocabulary while the UI reads gear/coaches/courts.
const SEGMENT_OF: Record<SearchEntityType, SearchSegment> = {
  gear: 'gear',
  coach: 'coaches',
  court: 'courts',
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
  const [error, setError] = useState<ApiError | null>(null);
  const [activeSegment, setActiveSegment] = useState<SearchSegment>('coaches');

  // Guards a late response from an earlier keystroke overwriting a newer one.
  const requestSeq = useRef(0);

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (q.length < 2) {
        setState('idle');
        setHits([]);
        return;
      }
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
        setState(res.results.length === 0 ? 'empty' : 'populated');
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(err as ApiError);
        setState('error');
      }
    },
    [search, city, coords],
  );

  // Debounce keystrokes so a query fires once the user pauses, not per letter.
  useEffect(() => {
    const handle = setTimeout(() => void runSearch(query), 300);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  const segments = useMemo(() => {
    const present = new Set<SearchSegment>();
    for (const hit of hits) present.add(SEGMENT_OF[hit.entityType]);
    // Stable order: coaches, courts, gear.
    return (['coaches', 'courts', 'gear'] as SearchSegment[]).filter((s) => present.has(s));
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
        <View style={{ flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <SearchX size={40} color={colors.textTertiary} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Find coaches, courts and gear
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Try "badminton coach near me" or "cricket bat under 1500".
          </Text>
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
          emptyLabel={`No matches for "${query.trim()}" near ${city}. Try another search.`}
        />
      )}
    </SafeAreaView>
  );
}
