import { useEmpower, toApiError, type UpaProfile, type UpaWishlistItem } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, HeartHandshake, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { DonationSheet } from '@/components/organisms/DonationSheet';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';
type Phase = 'select' | 'processing' | 'success' | 'failed';

const PRESET_AMOUNTS = [200, 500, 1000, 2500];
const RAZORPAY_KEY_ID = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';

/**
 * Donation Flow, `/home/donate/[id]` (optional `?itemId=`). AT-121, PRD-06
 * FR-6/FR-7/FR-8/FR-15/FR-17/FR-19; screen spec 3.3. Amount selection through
 * the shared `DonationSheet` (Donation + Total only, no fee row), an explicit
 * confirm through `ConfirmSheet` (never `Alert.alert`, AT-64), then the SAME
 * `openRazorpayCheckout` wrapper every pay screen uses (no fork, no
 * `Platform.OS` branch), captured on the shared `verify-payment` gate.
 *
 * FR-15 guest gate: an unauthenticated tap opens the login gate; the UPA and
 * item context lives in the route params, so the donor returns here intact
 * after signing in. FR-8: the client never writes a `donations`, ledger or
 * `payment_intents` row; the edge function does it all. ITEM_FUNDED mid flow
 * (someone else filled the item first) blocks submission and offers the general
 * fund instead (FR-5).
 */
export default function DonateScreen() {
  const colors = useThemeColors();
  const empower = useEmpower(supabase);
  const params = useLocalSearchParams<{ id: string; itemId?: string }>();
  const upaId = params.id;
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;

  const me = useSessionStore((state) => state.me);
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');

  const [state, setState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<UpaProfile | null>(null);
  const [minAmount, setMinAmount] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);

  const [phase, setPhase] = useState<Phase>('select');
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [gateVisible, setGateVisible] = useState(false);
  const [itemFundedBlock, setItemFundedBlock] = useState(false);

  const load = useCallback(async () => {
    if (!upaId) return;
    setState('loading');
    setError(null);
    try {
      const [row, min] = await Promise.all([empower.getUpaProfile(upaId), empower.getMinDonation()]);
      if (!row) {
        setError({ code: 'NOT_FOUND', message: 'This athlete is not available.', status: 404 });
        setState('error');
        return;
      }
      setProfile(row);
      setMinAmount(min);
      setState('ready');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [empower, upaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const item: UpaWishlistItem | undefined = itemId ? profile?.items.find((i) => i.id === itemId) : undefined;
  const itemAlreadyFunded = item ? item.status === 'funded' || item.status === 'delivered' : false;

  function requestDonate(amount: number) {
    if (!isSignedIn) {
      // FR-15: preserve context (already in the route) and gate.
      setGateVisible(true);
      return;
    }
    setPendingAmount(amount);
  }

  async function confirmDonate() {
    if (pendingAmount === null || !profile) return;
    const amount = pendingAmount;
    setPendingAmount(null);
    setPhase('processing');
    setError(null);
    try {
      const created = await empower.donate({
        upaId: profile.id,
        itemId: item?.id,
        amount,
        expectedTotal: amount,
      });

      const razorpayResult = await openRazorpayCheckout({
        keyId: created.keyId || RAZORPAY_KEY_ID,
        amountPaise: created.amountPaise,
        currency: 'INR',
        orderId: created.razorpayOrderId,
        name: 'Atlitos',
        description: item ? `Donation for ${item.title}` : 'Donation',
        prefill: { name: me?.name ?? undefined, contact: me?.phone ?? undefined },
      });

      await empower.verifyDonationPayment({
        razorpayOrderId: razorpayResult.razorpayOrderId,
        razorpayPaymentId: razorpayResult.razorpayPaymentId,
        razorpaySignature: razorpayResult.razorpaySignature,
      });

      setPhase('success');
    } catch (err) {
      const apiError = toApiError(err, 'PAYMENT_FAILED');
      setError(apiError);
      if (apiError.code === 'ITEM_FUNDED') {
        // FR-5: someone filled this item first. No charge occurred. Offer the
        // general fund rather than a dead end.
        setItemFundedBlock(true);
        setPhase('select');
        return;
      }
      setPhase('failed');
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Donate" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={200} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Donate" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't start donation</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'processing') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Donate" onPressBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg }}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Completing your donation. Please do not close this screen.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'success') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Donate" onPressBack={() => router.replace(`/home/upa/${profile.id}`)} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg }}>
          <CheckCircle2 size={56} color={colors.success} strokeWidth={1.75} />
          <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}>Thank you for giving</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {item
              ? `Your donation moves ${item.title} closer to its goal.`
              : `Your donation supports ${profile.headline}.`}
          </Text>
          <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md }}>
            <Button onPress={() => router.replace('/account/impact')}>
              <Text style={{ color: colors.inkOnAccent }}>View My Impact</Text>
            </Button>
            <Button variant="secondary" onPress={() => router.replace(`/home/upa/${profile.id}`)}>
              <Text style={{ color: colors.text }}>Back to athlete</Text>
            </Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // phase === 'select' or 'failed'
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Donate" onPressBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing['3xl'] }}>
        {itemFundedBlock ? (
          <View
            style={{
              margin: spacing.lg,
              gap: spacing.sm,
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.warning,
              backgroundColor: colors.warningTint,
              padding: spacing.lg,
            }}
          >
            <Text style={[textStyle('h3'), { color: colors.warning }]}>This item is now funded</Text>
            <Text style={[textStyle('callout'), { color: colors.text }]}>
              Someone completed this item before your payment. Nothing was charged. You can still support this athlete
              with a general donation.
            </Text>
            <Button onPress={() => router.replace(`/home/donate/${profile.id}`)}>
              <HeartHandshake size={18} color={colors.inkOnAccent} strokeWidth={2} />
              <Text style={{ color: colors.inkOnAccent }}>Donate to the general fund</Text>
            </Button>
          </View>
        ) : null}

        {itemAlreadyFunded && !itemFundedBlock ? (
          <View
            style={{
              margin: spacing.lg,
              gap: spacing.sm,
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.lg,
            }}
          >
            <Text style={[textStyle('h3'), { color: colors.text }]}>This item is fully funded</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              You can support this athlete with a general donation instead.
            </Text>
            <Button onPress={() => router.replace(`/home/donate/${profile.id}`)}>
              <Text style={{ color: colors.inkOnAccent }}>Donate to the general fund</Text>
            </Button>
          </View>
        ) : (
          <DonationSheet
            causeTitle={item ? item.title : profile.headline}
            presetAmounts={PRESET_AMOUNTS}
            minAmount={minAmount}
            fundItem={item ? { label: item.title, cost: item.cost, fundedAmount: item.fundedAmount } : undefined}
            onDonate={requestDonate}
          />
        )}

        {phase === 'failed' && error ? (
          <View className="flex-row items-center gap-xs" style={{ paddingHorizontal: spacing.lg }}>
            <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
            <Text className="flex-1 font-sans text-sm text-danger">
              {error.code === 'MIN_AMOUNT'
                ? `The minimum donation is ${formatINR(minAmount)}.`
                : error.code === 'PRICE_MISMATCH'
                  ? 'The amount changed. Nothing was charged. Please review and try again.'
                  : error.message || 'Payment was not completed. Your amount is preserved.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Pressable overlay confirm, never Alert.alert (AT-64). */}
      <ConfirmSheet
        visible={pendingAmount !== null}
        icon={HeartHandshake}
        title="Confirm your donation"
        body={
          pendingAmount !== null
            ? `You are donating ${formatINR(pendingAmount)} to ${item ? item.title : profile.headline}.`
            : ''
        }
        confirmLabel="Donate now"
        onConfirm={() => void confirmDonate()}
        onCancel={() => setPendingAmount(null)}
      />

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}
