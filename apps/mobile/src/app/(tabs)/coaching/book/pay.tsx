import { useCoaching, type BookSessionResult } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Clock, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillSummary } from '@/components/molecules/BillSummary';
import { AppBar } from '@/components/ui/app-bar';
import { useNavBarInset } from '@/components/ui/bottom-nav';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { SESSION_FREQUENCY_LABEL } from '@/lib/session-display';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';
import type { RazorpayCheckoutResult } from '@/lib/razorpay-checkout.types';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { offerPushPrimer } from '@/store/push-primer-store';

type ScreenState = 'reserving' | 'ready' | 'paying' | 'verifying' | 'confirmed' | 'error';

// A plain `type` literal, not an `interface`, matching
// `(tabs)/courts/book/pay.tsx`'s own comment: expo-router's
// `useLocalSearchParams<TParams>()` overload resolution needs the
// structural (no implicit index signature via declaration merging) shape a
// `type` gives it, an `interface` here resolves the wrong overload.
type PayParams = {
  coachId: string;
  coachName: string;
  sessionTypeId: string;
  sessionTypeName: string;
  durationMinutes: string;
  frequency: 'one_time' | 'weekly' | 'monthly';
  date: string;
  slotFrom: string;
  slotTo: string;
  expectedTotal: string;
  focusArea: string;
  location: string;
};

const RAZORPAY_KEY_ID = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';

// Backoff between automatic verify attempts once the sheet has returned a
// payment. verify-payment is idempotent (a no-op once the webhook finalized
// the same payment), so retrying it can never charge twice.
const VERIFY_RETRY_DELAYS_MS = [1000, 3000];

/**
 * Book: pay. PRD-01 FR-22/FR-23/FR-24 (AT-53): reserves the session via
 * `book-session` (server re-prices, returns the Razorpay order), shows the
 * shared `BillSummary`, opens the Razorpay standard checkout (same
 * native/web wrapper Courts uses, `@/lib/razorpay-checkout`; the native path
 * has never actually been exercised end to end per this story's brief,
 * flagged here rather than assumed), then `verify-payment`, then a
 * confirmation state. Never writes a money row or status transition client
 * side (CLAUDE.md): `book-session` and `verify-payment` are both
 * service-role edge functions, this screen only calls them and displays
 * their response.
 *
 * Sessions carve the platform fee OUT of the price (SCHEMA.md): `total`
 * always equals `price`, so unlike Courts' BillSummary (subtotal/GST/
 * platform fee/total), this renders a single "Session fee" line plus Total,
 * never a separate platform fee row (PRD-01 FR-31 reserves that row for
 * courts only).
 */
export default function BookSessionPayScreen() {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const coaching = useCoaching(supabase);
  const me = useSessionStore((state) => state.me);
  const requiresAuthGate = useSessionStore((state) => state.status !== 'signed_in');
  const params = useLocalSearchParams<PayParams>();

  const [state, setState] = useState<ScreenState>('reserving');
  const [booking, setBooking] = useState<BookSessionResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  // The triple the checkout sheet returned. Once set, the money is captured:
  // the Pay button is gone for this order and only verify is ever retried.
  const [captured, setCaptured] = useState<RazorpayCheckoutResult | null>(null);

  useEffect(() => {
    if (requiresAuthGate) {
      router.back();
      return;
    }
    void reserveSession();
  }, []);

  async function reserveSession() {
    setState('reserving');
    setError(null);
    try {
      const result = await coaching.bookSession({
        sessionTypeId: params.sessionTypeId,
        frequency: params.frequency,
        date: params.date,
        slotStart: params.slotFrom,
        focusArea: params.focusArea || undefined,
        location: params.location || undefined,
        expectedTotal: Number(params.expectedTotal),
      });
      setBooking(result);
      setState('ready');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }

  async function handlePay() {
    if (!booking || captured) return;
    setPayLoading(true);
    setState('paying');
    let checkoutResult: RazorpayCheckoutResult;
    try {
      checkoutResult = await openRazorpayCheckout({
        keyId: booking.keyId || RAZORPAY_KEY_ID,
        amountPaise: booking.amountPaise,
        currency: booking.currency,
        orderId: booking.razorpayOrderId,
        name: 'Atlitos',
        description: `Session with ${params.coachName}`,
        prefill: { name: me?.name ?? undefined, email: undefined, contact: me?.phone ?? undefined },
      });
    } catch (err) {
      // Only the checkout sheet can land here (dismissed or failed before a
      // payment existed), so nothing was charged and Pay stays available.
      setError({ code: 'PAYMENT_FAILED', message: (err as Error).message || 'Payment was not completed.', status: 400 });
      setState('ready');
      setPayLoading(false);
      return;
    }

    setCaptured(checkoutResult);
    setPayLoading(false);
    await confirmPayment(checkoutResult);
  }

  // Verify only, never a new order or charge. A failure here means the
  // payment is received but not yet confirmed; the webhook finalizes the
  // same session server side, so the screen offers another check instead of
  // Pay. INVALID_SIGNATURE is definitive (retrying the same triple cannot
  // pass), so it stops the retries and the screen points at My sessions.
  async function confirmPayment(triple: RazorpayCheckoutResult) {
    setState('verifying');
    setError(null);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await coaching.verifySessionPayment({
          razorpayOrderId: triple.razorpayOrderId,
          razorpayPaymentId: triple.razorpayPaymentId,
          razorpaySignature: triple.razorpaySignature,
        });
        setState('confirmed');
        // 3.6: the first real reason to want notifications.
        void offerPushPrimer();
        return;
      } catch (err) {
        const apiError = err as ApiError;
        const delay = apiError?.code === 'INVALID_SIGNATURE' ? undefined : VERIFY_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          setError(apiError);
          setState('ready');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  if (state === 'reserving') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Reserving your session" onPressBack={() => router.back()} />
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
            {error?.code === 'SLOT_TAKEN' ? 'This slot was just taken' : "Couldn't reserve this session"}
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.code === 'SLOT_TAKEN'
              ? 'This coach was booked for that time first. Go back and pick another slot.'
              : error?.code === 'PRICE_MISMATCH'
                ? 'This session type changed price. Go back and choose again.'
                : error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => router.back()}>
            <Text style={{ color: colors.text }}>Choose another time</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'confirmed' && booking) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: 'center', paddingBottom: navInset + spacing.lg }}>
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
            <Text style={[textStyle('h1'), { color: colors.text, textAlign: 'center' }]}>Session requested</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {params.sessionTypeName} with {params.coachName} on {params.date}, {params.slotFrom} to {params.slotTo}.
              {'\n'}Waiting for the coach to accept.
            </Text>
            <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>Session ID {booking.sessionId}</Text>
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
            <BillSummary rows={[{ label: 'Session fee', amount: booking.bill.price }]} total={booking.bill.total} />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Button
              onPress={() =>
                router.replace({ pathname: '/(tabs)/coaching/booking/[id]', params: { id: booking.sessionId } })
              }
            >
              <Text style={{ color: colors.inkOnAccent }}>View session</Text>
            </Button>
            <Button variant="secondary" onPress={() => router.replace('/(tabs)/coaching')}>
              <Text style={{ color: colors.text }}>Find more coaches</Text>
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (captured && booking) {
    const checking = state === 'verifying';
    const unverifiable = !checking && error?.code === 'INVALID_SIGNATURE';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: 'center', paddingBottom: navInset + spacing.lg }}>
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                height: 72,
                width: 72,
                borderRadius: radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.infoTint,
              }}
            >
              <Clock size={40} color={colors.info} strokeWidth={1.75} />
            </View>
            <Text style={[textStyle('h1'), { color: colors.text, textAlign: 'center' }]}>Payment received</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {checking
                ? 'Confirming your session. This takes a moment.'
                : unverifiable
                  ? 'Your payment is safe and you will not be charged again. We are confirming it on our side, and your session will appear in My sessions shortly.'
                  : 'Your payment is safe. We are still confirming your session, so you will not be charged again. Check again in a minute.'}
            </Text>
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
            <BillSummary rows={[{ label: 'Session fee', amount: booking.bill.price }]} total={booking.bill.total} />
          </View>

          {unverifiable ? (
            <Button onPress={() => router.replace('/(tabs)/coaching/bookings')}>
              <Text style={{ color: colors.inkOnAccent }}>Go to My sessions</Text>
            </Button>
          ) : (
            <Button loading={checking} disabled={checking} onPress={() => void confirmPayment(captured)}>
              <Text style={{ color: colors.inkOnAccent }}>Check again</Text>
            </Button>
          )}
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
          <Text style={[textStyle('h3'), { color: colors.text }]}>{params.sessionTypeName}</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>with {params.coachName}</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
            {params.date}, {params.slotFrom} to {params.slotTo}
          </Text>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            {SESSION_FREQUENCY_LABEL[params.frequency]}
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
            <BillSummary rows={[{ label: 'Session fee', amount: booking.bill.price }]} total={booking.bill.total} />
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

      <View style={{ padding: spacing.lg, paddingBottom: navInset + spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
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
