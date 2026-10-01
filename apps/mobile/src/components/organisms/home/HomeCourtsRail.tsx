import { useCourts } from '@atlitos/api';
import type { Court } from '@atlitos/types';
import { formatINR, inkOnMedia, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { LandPlot, MapPin } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { HomeSection, HomeSectionSkeleton } from '@/components/organisms/home/HomeSection';
import { Text } from '@/components/ui/text';
import { COURT_IN_APP_BOOKING_ENABLED } from '@/lib/feature-flags';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const TILE_WIDTH = 248;
const MAX_VENUES = 10;

/**
 * Home "Courts near you" rail (PRD-01 3.2, FR-14 discovery). One tile per
 * venue (its cheapest court), nearest first when the location store has
 * coordinates. Uses the same filter the Courts tab does while in-app booking
 * is off, so every tile opens a venue the athlete can actually book. Hides
 * itself on an empty list or a read error, like every Home rail.
 */
export function HomeCourtsRail({ reloadKey, onLoaded }: { reloadKey: number; onLoaded?: (ok: boolean) => void }) {
  const colors = useThemeColors();
  const courts = useCourts(supabase);
  const coords = useLocationStore((state) => state.coords);
  const city = useLocationStore((state) => state.city);

  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [venues, setVenues] = useState<Court[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await courts.listCourts({ near: coords, bookingUrlOnly: !COURT_IN_APP_BOOKING_ENABLED });
      const cheapestByVenue = new Map<string, Court>();
      for (const court of result) {
        const current = cheapestByVenue.get(court.venueId);
        if (!current || court.basePricePerHour < current.basePricePerHour) cheapestByVenue.set(court.venueId, court);
      }
      const sorted = [...cheapestByVenue.values()].sort(
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
      );
      setVenues(sorted.slice(0, MAX_VENUES));
      onLoaded?.(true);
    } catch {
      setVenues([]);
      onLoaded?.(false);
    } finally {
      setState('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (state === 'loading') return <HomeSectionSkeleton cardWidth={TILE_WIDTH} cardHeight={220} />;
  if (venues.length === 0) return null;

  return (
    <HomeSection
      title="Courts near you"
      subtitle={`Book a slot in ${city}`}
      seeAllLabel="See all courts"
      onSeeAll={() => router.push('/(tabs)/courts')}
    >
      {venues.map((court) => (
        <Pressable
          key={court.venueId}
          accessibilityRole="button"
          accessibilityLabel={`${court.venueName ?? court.name}, from ${formatINR(court.basePricePerHour)} an hour`}
          onPress={() => router.push({ pathname: '/home/court/[id]', params: { id: court.id } })}
          className="active:opacity-90"
          style={{
            width: TILE_WIDTH,
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            overflow: 'hidden',
          }}
        >
          <View style={{ aspectRatio: 16 / 10, backgroundColor: colors.surfaceMuted }}>
            {court.images[0] ? (
              <Image source={{ uri: court.images[0] }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <LandPlot size={32} color={colors.textTertiary} strokeWidth={1.5} />
              </View>
            )}
            {court.distanceKm !== undefined ? (
              <View
                style={{
                  position: 'absolute',
                  top: spacing.sm,
                  left: spacing.sm,
                  borderRadius: radii.pill,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  backgroundColor: colors.overlay,
                }}
              >
                <Text style={[textStyle('numericSm'), { color: inkOnMedia }]}>{court.distanceKm.toFixed(1)} km</Text>
              </View>
            ) : null}
          </View>
          <View style={{ padding: spacing.md, gap: spacing.xs }}>
            <Text numberOfLines={1} className="font-sans-semibold text-lg text-text">
              {court.venueName ?? court.name}
            </Text>
            <View className="flex-row items-center gap-xs">
              <MapPin size={12} strokeWidth={1.75} color={colors.textTertiary} />
              <Text numberOfLines={1} style={[textStyle('caption'), { flex: 1, color: colors.textSecondary }]}>
                {SPORT_LABEL[court.sport]}, {court.location}
              </Text>
            </View>
            <View className="flex-row items-baseline gap-xs pt-xs">
              <Text style={[textStyle('numericBase'), { color: colors.accent }]}>
                {formatINR(court.basePricePerHour)}
              </Text>
              <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>/hour</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </HomeSection>
  );
}
