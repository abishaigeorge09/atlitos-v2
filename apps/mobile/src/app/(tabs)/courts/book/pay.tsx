import { useCourts, type BookCourtResult } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillSummary } from '@/components/molecules/BillSummary';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'reserving' | 'ready' | 'paying' | 'confirmed' | 'error';

// A plain `type` object literal, not an `interface`: expo-router's
// `useLocalSearchParams<TParams>()` overload picks between "TParams extends
// UnknownOutputParams" (a Record<string, string | string[]>) and "TRoute
// extends RoutePath"; TypeScript's structural check that lets an object
// type satisfy an index-signature constraint without declaring one only
// applies to type literal syntax, not to a named `interface` (an interface
// is open to declaration merging elsewhere, so TS won't assume it has no
// other properties). An `interface` here resolves the wrong overload and
// fails with "does not satisfy the constraint 'RoutePath'".
type PayParams = {
  courtId: string;
  courtName: string;
  venueLocation: string;
  date: string;
  slotFrom: string;
  slotTo: string;
};

const RAZORPAY_KEY_ID = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';

/**
 * Book: pay. PRD-01 3.5 / SPEC.md 6.6: reserves the slot via `book-court`
 * (server re-prices, returns the Razorpay order), shows the shared
 * `BillSummary` (subtotal, GST, platform fee, total per FR-31), opens the
 * Razorpay standard checkout, then `verify-payment`, then a confirmation
 * state. Never writes a money row or status transition client side
 * (CLAUDE.md's financial invariant): `book-court` and `verify-payment` are
 * both service-role edge functions, this screen only calls them and
 * displays their response.
 */
export default function BookCourtPayScreen() {
  const colors = useThemeColors();
  const courts = useCourts(supabase);
  const me = useSessionStore((state) => state.me);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const params = useLocalSearchParams<PayParams>();

  const [state, setState] = useState<ScreenState>('reserving');
  const [booking, setBooking] = useState<BookCourtResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    if (requiresAuthGate) {
      router.back();
      return;
    }
    void reserveSlot();
  }, []);

  async function reserveSlot() {
    setState('reserving');
    setError(null);
    try {
      const result = await courts.bookCourt({
        courtId: params.courtId,
        date: params.date,
        slot: { from: params.slotFrom, to: params.slotTo },
      });
      setBooking(result);
      setState('ready');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }

  async function handlePay() {
    if (!booking) return;
    setPayLoading(true);
    setState('paying');
    try {
      const checkoutResult = await openRazorpayCheckout({
        keyId: booking.keyId || RAZORPAY_KEY_ID,
        amountPaise: booking.amountPaise,
        currency: booking.currency,
        orderId: booking.razorpayOrderId,
        name: 'Atlitos',
        description: `${params.courtName} booking`,
        prefill: { name: me?.name ?? undefined, email: undefined, contact: me?.phone ?? undefined },
      });

      await courts.verifyPayment({
        razorpayOrderId: checkoutResult.razorpayOrderId,
        razorpayPaymentId: checkoutResult.razorpayPaymentId,
        razorpaySignature: checkoutResult.razorpaySignature,
      });

      setState('confirmed');
    } catch (err) {
      // Two distinct error shapes can land here: a real `ApiError` from
      // `courts.verifyPayment` (mapped by `packages/api`'s edge function
      // error mapper), or a plain `Error` (`RazorpayCheckoutCancelledError`)
      // from a dismissed/failed checkout sheet, which never reaches the
      // edge function at all. Normalize both to `ApiError` here rather than
      // casting the second shape into a lie the render below would read
      // `.code` off of incorrectly.
      const isApiError = typeof err === 'object' && err !== null && 'code' in err && 'status' in err;
      setError(
        isApiError
          ? (err as ApiError)
          : { code: 'PAYMENT_FAILED', message: (err as Error).message || 'Payment was not completed.', status: 400 },
      );
      setState('ready');
    } finally {
      setPayLoading(false);
    }
  }

  if (state === 'reserving') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Reserving your slot" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="70%" />
          <Skeleton shape="card" height={140} />
          <Skeleton shape="line" width="50%" />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' && !booking) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.code === 'SLOT_TAKEN' ? 'This slot was just taken' : "Couldn't reserve this slot"}
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.code === 'SLOT_TAKEN'
              ? 'Someone else booked it first. Go back and pick another time.'
              : error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => router.back()}>
            <Text style={{ color: colors.text }}>Choose another slot</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'confirmed' && booking) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                height: 72,
                width: 72,
                borderRadius: radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.successTint,
              }}
            >
              <CheckCircle2 size={40} color={colors.success} strokeWidth={1.75} />
            </View>
            <Text style={[textStyle('h1'), { color: colors.text, textAlign: 'center' }]}>Court booked</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {params.courtName} is confirmed for {params.date}, {params.slotFrom} to {params.slotTo}.
            </Text>
            <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>Booking ID {booking.bookingId}</Text>
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
                { label: 'Subtotal', amount: booking.bill.subtotal },
                { label: 'GST', amount: booking.bill.gst },
                { label: 'Platform fee', amount: booking.bill.platformFee },
              ]}
              total={booking.bill.total}
            />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Button
              onPress={() =>
                router.replace({ pathname: '/(tabs)/courts/booking/[id]', params: { id: booking.bookingId } })
              }
            >
              <Text style={{ color: colors.inkOnAccent }}>View booking</Text>
            </Button>
            <Button variant="secondary" onPress={() => router.replace('/(tabs)/courts')}>
              <Text style={{ color: colors.text }}>Explore more courts</Text>
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Confirm and pay" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
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
          <Text style={[textStyle('h3'), { color: colors.text }]}>{params.courtName}</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{params.venueLocation}</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
            {params.date}, {params.slotFrom} to {params.slotTo}
          </Text>
        </View>

        {booking ? (
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
                { label: 'Subtotal', amount: booking.bill.subtotal },
                { label: 'GST', amount: booking.bill.gst },
                { label: 'Platform fee', amount: booking.bill.platformFee },
              ]}
              total={booking.bill.total}
            />
          </View>
        ) : null}

        {error ? (
          <View className="flex-row items-center gap-xs">
            <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
            <Text className="flex-1 font-sans text-sm text-danger">
              {error.code === 'INVALID_SIGNATURE'
                ? 'Payment could not be verified. Please try again.'
                : error.message || 'Payment was not completed.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Button loading={payLoading || state === 'paying'} disabled={!booking} onPress={() => void handlePay()}>
          <Text style={{ color: colors.inkOnAccent }}>
            Pay{booking ? ' ' : ''}
            {booking ? (
              <Text style={[textStyle('numericSm'), { color: colors.inkOnAccent }]}>{formatINR(booking.bill.total)}</Text>
            ) : null}
          </Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
