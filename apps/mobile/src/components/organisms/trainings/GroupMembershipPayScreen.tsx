import type { JoinGroupResult } from '@atlitos/api';
import { useGroups } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
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

const RAZORPAY_KEY_ID = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';

/**
 * Shared join/renew group membership payment screen, the group fares
 * equivalent of `coaching/book/pay.tsx`: reserve (via the caller's
 * `reserve`, either `joinGroup` or `renewMembership`, both edge functions
 * that re-price server side and return a Razorpay order, PRICE_MISMATCH on
 * a stale total), BillSummary, Razorpay checkout, `verifyMembershipPayment`,
 * confirmation. Never writes a money row or status transition client side
 * (CLAUDE.md): this screen only calls the edge functions and displays their
 * response, exactly like the session booking pay screen it mirrors.
 *
 * Membership fares carve the platform fee out of price exactly like
 * sessions (PAYMENTS.md coaching carve-out): `total` always equals `price`,
 * so this renders a single "Monthly fee" line plus Total, matching
 * `book/pay.tsx`'s single "Session fee" line rather than Courts'
 * subtotal/GST/platform fee breakdown.
 */
export interface GroupMembershipPayScreenProps {
  appBarTitle: string;
  groupName: string;
  detailLine: string;
  attendancePolicy?: string;
  reserve: () => Promise<JoinGroupResult>;
  confirmedTitle: string;
  confirmedBody: string;
  payingDescription: string;
}

export function GroupMembershipPayScreen({
  appBarTitle,
  groupName,
  detailLine,
  attendancePolicy,
  reserve,
  confirmedTitle,
  confirmedBody,
  payingDescription,
}: GroupMembershipPayScreenProps) {
  const colors = useThemeColors();
  const groups = useGroups(supabase);
  const me = useSessionStore((state) => state.me);
  const isGuest = useSessionStore((state) => state.status === 'guest');

  const [state, setState] = useState<ScreenState>('reserving');
  const [reserved, setReserved] = useState<JoinGroupResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    if (isGuest) {
      router.back();
      return;
    }
    void doReserve();
  }, []);

  async function doReserve() {
    setState('reserving');
    setError(null);
    try {
      const result = await reserve();
      setReserved(result);
      setState('ready');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }

  async function handlePay() {
    if (!reserved) return;
    setPayLoading(true);
    setState('paying');
    try {
      const checkoutResult = await openRazorpayCheckout({
        keyId: reserved.keyId || RAZORPAY_KEY_ID,
        amountPaise: reserved.amountPaise,
        currency: reserved.currency,
        orderId: reserved.razorpayOrderId,
        name: 'Atlitos',
        description: payingDescription,
        prefill: { name: me?.name ?? undefined, email: undefined, contact: me?.phone ?? undefined },
      });

      await groups.verifyMembershipPayment({
        razorpayOrderId: checkoutResult.razorpayOrderId,
        razorpayPaymentId: checkoutResult.razorpayPaymentId,
        razorpaySignature: checkoutResult.razorpaySignature,
      });

      setState('confirmed');
    } catch (err) {
      // Same two error shapes book/pay.tsx handles: a real ApiError from
      // verifyMembershipPayment, or a plain Error (checkout dismissed or
      // failed before it ever reached the edge function).
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
        <AppBar variant="backTitle" title={appBarTitle} onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="70%" />
          <Skeleton shape="card" height={140} />
          <Skeleton shape="line" width="50%" />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' && !reserved) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.code === 'GROUP_FULL'
              ? 'This group is full'
              : error?.code === 'ALREADY_MEMBER'
                ? 'You are already a member'
                : error?.code === 'GROUP_INACTIVE'
                  ? 'This group is no longer active'
                  : "Couldn't reserve this membership"}
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.code === 'GROUP_FULL'
              ? 'Every seat in this group is taken. Check back if a spot opens up.'
              : error?.code === 'GROUP_INACTIVE'
                ? 'The coach closed this group to new members.'
                : error?.code === 'PRICE_MISMATCH'
                  ? 'The monthly fee changed. Go back and try again.'
                  : error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => router.back()}>
            <Text style={{ color: colors.text }}>Go back</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'confirmed' && reserved) {
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
            <Text style={[textStyle('h1'), { color: colors.text, textAlign: 'center' }]}>{confirmedTitle}</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {confirmedBody}
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
            <BillSummary rows={[{ label: 'Monthly fee', amount: reserved.bill.price }]} total={reserved.bill.total} />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Button onPress={() => router.replace('/(tabs)/trainings')}>
              <Text style={{ color: colors.inkOnAccent }}>Go to my trainings</Text>
            </Button>
            <Button variant="secondary" onPress={() => router.replace('/(tabs)/coaching')}>
              <Text style={{ color: colors.text }}>Find more coaches</Text>
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title={appBarTitle} onPressBack={() => router.back()} />

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
          <Text style={[textStyle('h3'), { color: colors.text }]}>{groupName}</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{detailLine}</Text>
          {attendancePolicy ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{attendancePolicy}</Text>
          ) : null}
        </View>

        {reserved ? (
          <View
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.lg,
            }}
          >
            <BillSummary rows={[{ label: 'Monthly fee', amount: reserved.bill.price }]} total={reserved.bill.total} />
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
        <Button loading={payLoading || state === 'paying'} disabled={!reserved} onPress={() => void handlePay()}>
          <Text style={{ color: colors.inkOnAccent }}>
            Pay{reserved ? ' ' : ''}
            {reserved ? (
              <Text style={[textStyle('numericSm'), { color: colors.inkOnAccent }]}>{formatINR(reserved.bill.total)}</Text>
            ) : null}
          </Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
