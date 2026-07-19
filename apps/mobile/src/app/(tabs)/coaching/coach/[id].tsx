import { computeAvailableSessionSlots, useCoaching } from '@atlitos/api';
import type { ApiError, CoachProfile, SessionFrequency, SessionTypeOption, TimeSlot } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { SlotPicker } from '@/components/molecules/SlotPicker';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { TextField } from '@/components/organisms/_shared';
import { Avatar } from '@/components/ui/avatar';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/ui/star-rating';
import { Text } from '@/components/ui/text';
import { SESSION_FREQUENCY_LABEL } from '@/lib/session-display';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type SlotsState = 'loading' | 'empty' | 'populated' | 'error';

const FREQUENCIES: SessionFrequency[] = ['one_time', 'weekly', 'monthly'];

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Coach profile + booking start. PRD-01 FR-21/FR-22 (AT-52/AT-53): rating,
 * experience, specialization, tiered session types, and an availability
 * preview sourced from `get_coach_busy_slots` (never a static fixture).
 * Booking happens in this same screen in the FR-22 mandated order, session
 * type and frequency first (each gates the next with a disabled section
 * rather than a separate wizard screen, same "one screen, progressive
 * disclosure" shape Courts uses for date+slot); Continue to pay only
 * enables once all four are chosen, then hands off to `book/pay`, which is
 * the actual mutating step (`book-session`). Guest-open per FR-2; Continue
 * to pay gates. States: loading, populated, error (not found); the slot
 * section carries its own loading/empty/populated/error quartet since it
 * refetches on every date change, matching the Courts detail screen.
 */
export default function CoachProfileScreen() {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();
  const isGuest = useSessionStore((state) => state.status === 'guest');

  const [state, setState] = useState<ScreenState>('loading');
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [gateVisible, setGateVisible] = useState(false);

  const [sessionType, setSessionType] = useState<SessionTypeOption | undefined>(undefined);
  const [frequency, setFrequency] = useState<SessionFrequency | undefined>(undefined);
  const [date, setDate] = useState(todayISO());
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | undefined>(undefined);
  const [focusArea, setFocusArea] = useState('');
  const [location, setLocation] = useState('');

  const [busySlots, setBusySlots] = useState<{ date: string; slotStart: string }[]>([]);
  const [slotsState, setSlotsState] = useState<SlotsState>('populated');

  const loadCoach = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await coaching.getCoach(id);
      if (!result) {
        setError({ code: 'NOT_FOUND', message: 'This coach could not be found.', status: 404 });
        setState('error');
        return;
      }
      setCoach(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void loadCoach();
  }, [loadCoach]);

  useEffect(() => {
    if (!sessionType) return;
    setSlotsState('loading');
    setSelectedSlot(undefined);
    // A 14 day window is enough to cover the busy slots a single date's
    // slot generation needs; get_coach_busy_slots is cheap and hides the
    // underlying session rows, this is a read-only preview regardless
    // (book-session re-checks authoritatively, see use-coaching.ts).
    coaching
      .getCoachBusySlots(id, date, addDaysISO(date, 14))
      .then((slots) => {
        setBusySlots(slots);
        setSlotsState('populated');
      })
      .catch(() => setSlotsState('error'));
  }, [id, date, sessionType?.id]);

  const availableSlots = useMemo(() => {
    if (!coach || !sessionType) return [];
    return computeAvailableSessionSlots(coach.availability, sessionType.durationMinutes, date, busySlots);
  }, [coach, sessionType, date, busySlots]);

  function handleContinue() {
    if (!coach || !sessionType || !frequency || !selectedSlot) return;
    if (isGuest) {
      setGateVisible(true);
      return;
    }
    router.push({
      pathname: '/(tabs)/coaching/book/pay',
      params: {
        coachId: coach.userId,
        coachName: coach.user?.name ?? 'Coach',
        sessionTypeId: sessionType.id,
        sessionTypeName: sessionType.name,
        durationMinutes: String(sessionType.durationMinutes),
        frequency,
        date,
        slotFrom: selectedSlot.from,
        slotTo: selectedSlot.to,
        expectedTotal: String(sessionType.price),
        focusArea,
        location,
      },
    });
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="circle" />
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="line" width="40%" />
          <Skeleton shape="card" height={160} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !coach) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.message ?? 'This coach could not be found.'}
          </Text>
          <Button variant="secondary" onPress={() => void loadCoach()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const canBook = !!(sessionType && frequency && selectedSlot);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="back" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ paddingBottom: spacing['4xl'], gap: spacing.lg }}>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <View className="flex-row items-center gap-md">
            <Avatar uri={coach.user?.avatarUrl} name={coach.user?.name} size={80} verifiedBadge />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={[textStyle('h1'), { color: colors.text }]}>{coach.user?.name ?? 'Coach'}</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                {SPORT_LABEL[coach.sport]}, {coach.experienceYears} yrs experience
              </Text>
              <StarRating mode="display" value={coach.rating} count={coach.ratingCount} />
            </View>
          </View>

          {coach.bio ? <Text style={[textStyle('body'), { color: colors.text }]}>{coach.bio}</Text> : null}

          {coach.specialization.length > 0 ? (
            <View className="flex-row flex-wrap gap-xs pt-xs">
              {coach.specialization.map((tag) => (
                <Chip key={tag} label={tag} variant="category" />
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <Text style={[textStyle('h3'), { color: colors.text }]}>Session type</Text>
          {coach.sessionTypes.length === 0 ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              This coach has not published session types yet.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {coach.sessionTypes.map((type) => (
                <Pressable
                  key={type.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sessionType?.id === type.id }}
                  onPress={() => setSessionType(type)}
                  style={{
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: sessionType?.id === type.id ? colors.accent : colors.border,
                    backgroundColor: sessionType?.id === type.id ? colors.accentTint : colors.card,
                    padding: spacing.lg,
                  }}
                >
                  <View className="flex-row items-center justify-between">
                    <View style={{ gap: spacing.xs }}>
                      <Text style={[textStyle('label'), { color: colors.text }]}>{type.name}</Text>
                      <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                        {type.durationMinutes} min
                      </Text>
                    </View>
                    <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(type.price)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {sessionType ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Frequency</Text>
            <View className="flex-row flex-wrap gap-sm">
              {FREQUENCIES.map((freq) => (
                <Chip
                  key={freq}
                  label={SESSION_FREQUENCY_LABEL[freq]}
                  variant="select"
                  selected={frequency === freq}
                  onPress={() => setFrequency(freq)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {sessionType && frequency ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a date</Text>
            <CalendarPicker value={date} onChange={setDate} />
          </View>
        ) : null}

        {sessionType && frequency ? (
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
                Couldn't load availability for this date. Try another date or check back.
              </Text>
            ) : availableSlots.length === 0 ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                No open slots on this date. Try another date.
              </Text>
            ) : (
              <SlotPicker slots={availableSlots} value={selectedSlot} onChange={setSelectedSlot} />
            )}
          </View>
        ) : null}

        {sessionType && frequency && selectedSlot ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Details</Text>
            <TextField
              label="Focus area, optional"
              placeholder="What do you want to work on"
              value={focusArea}
              onChangeText={setFocusArea}
            />
            <TextField
              label="Location, optional"
              placeholder="Where you would like to train"
              value={location}
              onChangeText={setLocation}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
        <Button disabled={!canBook} onPress={handleContinue}>
          <Text style={{ color: colors.inkOnAccent }}>
            {canBook ? `Continue, ${formatINR(sessionType!.price)}` : 'Choose a type, date, and time'}
          </Text>
        </Button>
      </View>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
