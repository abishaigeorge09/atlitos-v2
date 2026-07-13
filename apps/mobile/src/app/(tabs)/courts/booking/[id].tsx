import { useCourts } from '@atlitos/api';
import { canRateCourtBooking, canTransition, COURT_BOOKING_TRANSITIONS } from '@atlitos/types';
import type { ApiError, CourtBooking } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, TriangleAlert, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillSummary } from '@/components/molecules/BillSummary';
import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { SlotPicker } from '@/components/molecules/SlotPicker';
import { RateReviewForm } from '@/components/organisms/RateReviewForm';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { COURT_BOOKING_STATUS_PILL } from '@/lib/court-booking-display';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Booking detail. PRD-01 3.5 / SPEC.md 6.6: cancel to `cancelled`,
 * reschedule to `rescheduled`, rate via `RateReviewForm` once `completed`.
 * "Identical machine to Sessions" per SPEC, driven entirely by
 * `court_booking_transition`/`rate_court_booking` RPCs (never a client-side
 * status write) and `COURT_BOOKING_TRANSITIONS`/`canRateCourtBooking`
 * (`@atlitos/types`) gating which action can even render. Cancel uses a
 * native in app confirm dialog (`Alert.alert`), not a custom form, per this
 * task's brief. "Query invalidation" after a mutation is a plain refetch
 * (`load()`), this app has no react-query cache to invalidate yet. States:
 * loading, populated, error.
 */
export default function CourtBookingDetailScreen() {
  const colors = useThemeColors();
  const courts = useCourts(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [booking, setBooking] = useState<CourtBooking | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [reschedOpen, setReschedOpen] = useState(false);
  const [reschedDate, setReschedDate] = useState(todayISO());
  const [reschedSlots, setReschedSlots] = useState<{ from: string; to: string; price: number }[]>([]);
  const [reschedSlotsLoading, setReschedSlotsLoading] = useState(false);
  const [reschedSelected, setReschedSelected] = useState<{ from: string; to: string } | undefined>(undefined);
  const [reschedSubmitting, setReschedSubmitting] = useState(false);

  const [rateSubmitting, setRateSubmitting] = useState(false);
  const [rateSubmitted, setRateSubmitted] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await courts.getBooking(id);
      if (!result) {
        setError({ code: 'NOT_FOUND', message: 'This booking could not be found.', status: 404 });
        setState('error');
        return;
      }
      setBooking(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!reschedOpen || !booking) return;
    setReschedSlotsLoading(true);
    setReschedSelected(undefined);
    courts
      .getAvailableSlots(booking.courtId, reschedDate)
      .then(setReschedSlots)
      .catch(() => setReschedSlots([]))
      .finally(() => setReschedSlotsLoading(false));
  }, [reschedOpen, reschedDate, booking?.courtId]);

  function confirmCancel() {
    if (!booking) return;
    Alert.alert(
      'Cancel this booking',
      'Are you sure you want to cancel? This slot will be released for other athletes.',
      [
        { text: 'Keep booking', style: 'cancel' },
        { text: 'Cancel booking', style: 'destructive', onPress: () => void handleCancel() },
      ],
    );
  }

  async function handleCancel() {
    if (!booking) return;
    setCancelling(true);
    setActionError(null);
    try {
      await courts.transitionBooking({ bookingId: booking.id, action: 'cancel', reason: 'Cancelled by athlete' });
      await load();
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setCancelling(false);
    }
  }

  async function handleConfirmReschedule() {
    if (!booking || !reschedSelected) return;
    setReschedSubmitting(true);
    setActionError(null);
    try {
      const updated = await courts.transitionBooking({
        bookingId: booking.id,
        action: 'reschedule',
        newDate: reschedDate,
        newSlotStart: reschedSelected.from,
      });
      setReschedOpen(false);
      router.replace({ pathname: '/(tabs)/courts/booking/[id]', params: { id: updated.id } });
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setReschedSubmitting(false);
    }
  }

  async function handleRate(rating: number, remarks: string) {
    if (!booking) return;
    setRateSubmitting(true);
    setActionError(null);
    try {
      await courts.rateBooking(booking.id, rating, remarks || undefined);
      setRateSubmitted(true);
      await load();
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setRateSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={160} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !booking) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.message ?? 'This booking could not be found.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const canCancel = canTransition(COURT_BOOKING_TRANSITIONS, booking.status, 'cancelled');
  const canReschedule = canTransition(COURT_BOOKING_TRANSITIONS, booking.status, 'rescheduled');
  const canRate = canRateCourtBooking({ status: booking.status, rating: booking.rating ?? null });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Booking" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}>
        <View
          style={{
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <View className="flex-row items-center justify-between">
            <Text style={[textStyle('h3'), { color: colors.text }]}>{booking.courtName ?? 'Court'}</Text>
            <StatusPill status={COURT_BOOKING_STATUS_PILL[booking.status]} />
          </View>
          {booking.venueName ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{booking.venueName}</Text>
          ) : null}
          {booking.location ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{booking.location}</Text>
          ) : null}
          <Text style={[textStyle('body'), { color: colors.text }]}>
            {booking.date}, {booking.slot.from} to {booking.slot.to}
          </Text>
          {booking.sport ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{SPORT_LABEL[booking.sport]}</Text>
          ) : null}
          {booking.cancellationReason ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              Reason: {booking.cancellationReason}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.lg,
          }}
        >
          <BillSummary
            rows={[
              { label: 'Subtotal', amount: booking.subtotal },
              { label: 'GST', amount: booking.gst },
              { label: 'Platform fee', amount: booking.platformFee },
            ]}
            total={booking.total}
          />
        </View>

        {actionError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{actionError}</Text> : null}

        {canCancel || canReschedule ? (
          <View style={{ gap: spacing.sm }}>
            {canReschedule ? (
              <Button variant="secondary" onPress={() => setReschedOpen((open) => !open)}>
                <CalendarClock size={16} strokeWidth={1.75} color={colors.text} />
                <Text style={{ color: colors.text }}>{reschedOpen ? 'Close reschedule' : 'Reschedule'}</Text>
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="ghost" tone="danger" loading={cancelling} onPress={confirmCancel}>
                <XCircle size={16} strokeWidth={1.75} color={colors.danger} />
                <Text style={{ color: colors.danger }}>Cancel booking</Text>
              </Button>
            ) : null}
          </View>
        ) : null}

        {reschedOpen ? (
          <View style={{ gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a new date</Text>
            <CalendarPicker value={reschedDate} onChange={setReschedDate} />

            <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a new time</Text>
            {reschedSlotsLoading ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} shape="tile" width={92} height={44} />
                ))}
              </View>
            ) : reschedSlots.length === 0 ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                No open slots on this date. Try another date.
              </Text>
            ) : (
              <SlotPicker
                slots={reschedSlots.map((slot) => ({ from: slot.from, to: slot.to }))}
                value={reschedSelected}
                onChange={setReschedSelected}
              />
            )}

            <Button disabled={!reschedSelected} loading={reschedSubmitting} onPress={() => void handleConfirmReschedule()}>
              <Text style={{ color: colors.inkOnAccent }}>Confirm reschedule</Text>
            </Button>
          </View>
        ) : null}

        {canRate ? (
          <View
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <RateReviewForm
              entityName={booking.courtName ?? 'Court'}
              entitySubtitle={booking.venueName ?? ''}
              bookingId={booking.id}
              submitted={rateSubmitted}
              onSubmit={(rating, remarks) => {
                if (rateSubmitting) return;
                void handleRate(rating, remarks);
              }}
            />
          </View>
        ) : booking.rating ? (
          <View
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.lg,
              gap: spacing.xs,
            }}
          >
            <Text style={[textStyle('h3'), { color: colors.text }]}>Your review</Text>
            <Text style={[textStyle('numericBase'), { color: colors.text }]}>{booking.rating.toFixed(1)}/5</Text>
            {booking.remarks ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{booking.remarks}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
