import { useCourts } from '@atlitos/api';
import type { ApiError, Court, TimeSlot } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { LandPlot, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBannerCarousel } from '@/components/molecules/AdBannerCarousel';
import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { SlotPicker } from '@/components/molecules/SlotPicker';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/ui/star-rating';
import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useLocationStore } from '@/store/location-store';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type SlotsState = 'loading' | 'empty' | 'populated' | 'error';

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Court detail. PRD-01 3.5 / SPEC.md 6.6: image carousel, rating, price per
 * hour (with a peak pricing note, since `court_pricing_rules` can override
 * the base price on specific days/times, PRD-03 FR-11), CalendarPicker +
 * SlotPicker fed by `get_court_available_slots`. Guest-open per FR-2; Book
 * is the mutating action, gated per FR-3. States: loading, populated, error
 * (not found); the slot section carries its own loading/empty/populated/
 * error quartet, since it refetches independently of the court itself on
 * every date change.
 */
export default function CourtDetailScreen() {
  const colors = useThemeColors();
  const courts = useCourts(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const coords = useLocationStore((state) => state.coords);

  const [state, setState] = useState<ScreenState>('loading');
  const [court, setCourt] = useState<Court | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const [date, setDate] = useState(todayISO());
  const [slotsState, setSlotsState] = useState<SlotsState>('loading');
  const [slots, setSlots] = useState<{ from: string; to: string; price: number }[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | undefined>(undefined);
  const [gateVisible, setGateVisible] = useState(false);

  const loadCourt = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await courts.getCourt(id, coords);
      if (!result) {
        setError({ code: 'NOT_FOUND', message: 'This court could not be found.', status: 404 });
        setState('error');
        return;
      }
      setCourt(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
    // Depends on `coords` too (not just `id`): the location store resolves
    // asynchronously and can still be null on first mount, this re-runs
    // once real coordinates land so `distanceKm` is not permanently stuck
    // undefined for a court opened before location finished resolving.
  }, [id, coords]);

  const loadSlots = useCallback(
    async (forDate: string) => {
      setSlotsState('loading');
      setSelectedSlot(undefined);
      try {
        const result = await courts.getAvailableSlots(id, forDate);
        setSlots(result);
        setSlotsState(result.length === 0 ? 'empty' : 'populated');
      } catch {
        setSlotsState('error');
      }
    },
    [id],
  );

  useEffect(() => {
    void loadCourt();
  }, [loadCourt]);

  useEffect(() => {
    void loadSlots(date);
  }, [date, loadSlots]);

  function handleBook() {
    if (!court || !selectedSlot) return;
    if (requiresAuthGate) {
      setGateVisible(true);
      return;
    }
    router.push({
      pathname: '/(tabs)/courts/book/pay',
      params: {
        courtId: court.id,
        courtName: court.name,
        venueLocation: court.location,
        date,
        slotFrom: selectedSlot.from,
        slotTo: selectedSlot.to,
      },
    });
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={220} />
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="line" width="40%" />
          <Skeleton shape="card" height={160} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !court) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.message ?? 'This court could not be found.'}
          </Text>
          <Button variant="secondary" onPress={() => void loadCourt()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const SportIcon = SPORT_ICON[court.sport];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="back" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ paddingBottom: spacing['4xl'], gap: spacing.lg }}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          {court.images.length > 0 ? (
            <AdBannerCarousel
              variant="productGallery"
              banners={court.images.map((url, index) => ({ id: String(index), imageUrl: url }))}
            />
          ) : (
            <View
              style={{
                aspectRatio: 1,
                borderRadius: radii.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceMuted,
              }}
            >
              <LandPlot size={48} color={colors.textTertiary} strokeWidth={1.75} />
            </View>
          )}
        </View>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <View className="flex-row items-center justify-between">
            <Text style={[textStyle('h1'), { color: colors.text, flexShrink: 1 }]}>{court.name}</Text>
            <View className="flex-row items-center gap-xs">
              <SportIcon size={18} strokeWidth={1.75} color={colors.textSecondary} />
              <Text className="font-sans text-sm text-text-secondary">{SPORT_LABEL[court.sport]}</Text>
            </View>
          </View>

          <Text style={[textStyle('body'), { color: colors.textSecondary }]}>{court.location}</Text>

          <StarRating mode="display" value={court.rating} count={court.ratingCount} />

          <View className="flex-row items-baseline gap-xs pt-xs">
            <PriceText amount={court.basePricePerHour} size="lg" />
            <Text className="font-sans text-sm text-text-secondary">per hour</Text>
          </View>
          <Text className="font-sans text-xs text-text-tertiary">
            Prices can be higher during peak hours, the exact price for your chosen slot shows below.
          </Text>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a date</Text>
          <CalendarPicker value={date} onChange={setDate} />
        </View>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a time</Text>

          {slotsState === 'loading' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} shape="tile" width={92} height={44} />
              ))}
            </View>
          ) : slotsState === 'error' ? (
            <Text style={[textStyle('callout'), { color: colors.danger }]}>
              Couldn't load slots for this date. Try another date or check back.
            </Text>
          ) : slotsState === 'empty' ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              No open slots on this date. Try another date.
            </Text>
          ) : (
            <>
              <SlotPicker
                slots={slots.map((slot) => ({ from: slot.from, to: slot.to }))}
                value={selectedSlot}
                onChange={setSelectedSlot}
              />
              {selectedSlot ? (
                <View className="flex-row items-center gap-xs">
                  <Text className="font-sans text-sm text-text-secondary">Price for this slot</Text>
                  <PriceText
                    amount={slots.find((s) => s.from === selectedSlot.from && s.to === selectedSlot.to)?.price ?? court.basePricePerHour}
                    size="sm"
                  />
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
        <Button disabled={!selectedSlot} onPress={handleBook}>
          <Text style={{ color: colors.inkOnAccent }}>{selectedSlot ? 'Book this slot' : 'Select a time to book'}</Text>
        </Button>
      </View>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
