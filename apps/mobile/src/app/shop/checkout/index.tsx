import {
  useShop,
  toApiError,
  isOrderUnfulfillableError,
  type AddressRecord,
  type CartLine,
  type CommerceFeeConfig,
  type OrderUnfulfillableError,
  type VerifyOrderPaymentInput,
} from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MapPin, PackageX, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillSummary } from '@/components/molecules/BillSummary';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import {
  COMMERCE_BILL_LABELS,
  commerceBillRows,
  deriveCommerceBill,
  shouldShowRoundupRow,
} from '@/lib/commerce-bill';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { DONATIONS_ENABLED } from '@/lib/feature-flags';

type LoadState = 'loading' | 'ready' | 'error';
// `form` is the bill and pay button. `confirming` and `unfulfillable` are only
// reached after Razorpay captured a payment, and neither offers a way back to
// `form`, because paying again from there would be a second charge.
type CheckoutPhase = 'form' | 'confirming' | 'unfulfillable';

// Verify attempts (the first plus retries) before telling the shopper to look
// in My Orders instead.
const MAX_CONFIRM_ATTEMPTS = 3;

// Codes whose server message is authored copy fit for a shopper. Everything
// else, INTERNAL above all, can carry raw Postgres or storage text, so it gets
// a fixed line instead of being echoed.
const SHOPPER_SAFE_CODES: ReadonlyArray<ApiError['code']> = ['NO_ADDRESS', 'PINCODE_INVALID', 'RATE_LIMITED'];
const GENERIC_ERROR_COPY = 'Something went wrong. Please try again.';

function checkoutErrorCopy(error: ApiError): string {
  if (error.code === 'INVALID_SIGNATURE') return 'Payment could not be verified. Please try again.';
  if (error.code === 'PAYMENT_FAILED') return 'Payment was not completed.';
  if (SHOPPER_SAFE_CODES.includes(error.code) && error.message) return error.message;
  return GENERIC_ERROR_COPY;
}

const RAZORPAY_KEY_ID = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';

/**
 * Checkout, `/shop/checkout`. AT-77, PRD-07 FR-13, FR-14, FR-16, FR-17, FR-19,
 * FR-20; screen spec PRD-07 section 3 item 4.
 *
 * FR-13's bill goes through the SHARED `BillSummary`, the same component every
 * money surface in this app renders. Commerce is the third pricing shape
 * (PHASE-4-STATUS.md D1) and it is additive with NO platform fee row: do not
 * copy the courts shape. The rows and their order live in
 * `lib/commerce-bill.ts` so they cannot drift from the derivation.
 *
 * FR-16 plus the founder's 2026-07-20 decision: the roundup is DERIVED, not a
 * flat config figure. It is the distance from the post delivery, post GST
 * total up to the next multiple of `commerce.donation_roundup_multiple`, so it
 * moves as the cart moves. When the total already lands on a multiple the
 * roundup is zero and the row is SUPPRESSED entirely rather than rendered as a
 * zero, and the payload carries zero so the server writes no donation ledger
 * leg (a zero amount leg would break the balanced group assertion).
 *
 * FR-14 / AC-D1: Continue is disabled with no selected address, and the empty
 * case routes to the address screen.
 *
 * FR-17: Continue calls the `checkout` edge function with the full computed
 * bill. This screen never writes an `orders`, `order_items`,
 * `payment_intents` or `stock_reservations` row; the server does all of it.
 * The Razorpay handoff reuses the SAME shared `openRazorpayCheckout` wrapper
 * P3 verified natively (PHASE-4-STATUS.md D5), with no second invocation and
 * no `Platform.OS` branch.
 *
 * FR-19 / AC-D4: PRICE_MISMATCH reloads live prices, re-renders the corrected
 * `BillSummary` and requires an explicit re-confirmation. No charge occurred.
 * FR-20 / AC-D5: OUT_OF_STOCK routes back to cart, where the offending lines
 * are flagged from live availability. No charge occurred.
 */
export default function CheckoutScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const me = useSessionStore((state) => state.me);
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');

  const [state, setState] = useState<LoadState>('loading');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [config, setConfig] = useState<CommerceFeeConfig | null>(null);
  const [roundupOptedIn, setRoundupOptedIn] = useState(false); // FR-13: unchecked by default.
  const [error, setError] = useState<ApiError | null>(null);
  const [paying, setPaying] = useState(false);
  const [needsReconfirm, setNeedsReconfirm] = useState(false);
  // Set once Razorpay hands back a captured payment. In memory only: a restart
  // loses it, and the webhook still finalizes the order in that case.
  const paymentTripleRef = useRef<VerifyOrderPaymentInput | null>(null);
  const [phase, setPhase] = useState<CheckoutPhase>('form');
  const [confirming, setConfirming] = useState(false);
  const [confirmAttempts, setConfirmAttempts] = useState(0);
  const [unfulfillable, setUnfulfillable] = useState<OrderUnfulfillableError | null>(null);

  // Once a payment is captured, a system back (Android hardware back, iOS edge
  // swipe) must not pop to the cart, where Proceed to buy opens a fresh
  // checkout that can charge again. Route it the same way the app bar does.
  useEffect(() => {
    if (phase === 'form') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace(phase === 'unfulfillable' ? '/shop/cart' : '/shop/orders');
      return true;
    });
    return () => subscription.remove();
  }, [phase]);

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    setState('loading');
    setError(null);
    try {
      const [cart, addressRows, feeConfig] = await Promise.all([
        shop.getCart(),
        shop.listAddresses(),
        shop.getCommerceFeeConfig(),
      ]);
      setLines(cart);
      setAddresses(addressRows);
      setConfig(feeConfig);
      setSelectedAddressId((current) => {
        if (current && addressRows.some((address) => address.id === current)) return current;
        return addressRows.find((address) => address.isDefault)?.id ?? addressRows[0]?.id ?? null;
      });
      setState('ready');

      // PRD-07 section 3 item 4: an empty cart routes back to cart rather than
      // rendering an empty checkout.
      // Not once a payment is captured: the finalized order empties the cart,
      // and the confirming state must stay on screen.
      if (cart.length === 0 && !paymentTripleRef.current) router.replace('/shop/cart');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [isSignedIn]);

  // Reloads on focus so returning from the address screen picks up a newly
  // saved address without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const bill = config
    ? deriveCommerceBill({ subtotal, config, roundupOptedIn })
    : { subtotal, deliveryCharges: 0, gstAndOthers: 0, donationRoundup: 0, preRoundupTotal: subtotal, total: subtotal };
  const showRoundupRow = shouldShowRoundupRow(bill, roundupOptedIn);
  const selectedAddress = addresses.find((address) => address.id === selectedAddressId) ?? null;
  const blockedLines = lines.filter((line) => line.exceedsStock);
  const canContinue = Boolean(selectedAddress) && lines.length > 0 && blockedLines.length === 0 && config !== null;

  async function handleContinue() {
    if (!selectedAddress || !config) return;
    setPaying(true);
    setError(null);
    try {
      const checkoutResult = await shop.checkout({
        items: lines.map((line) => ({ productVariantId: line.variantId, qty: line.qty })),
        addressId: selectedAddress.id,
        donationRoundupOptedIn: roundupOptedIn,
        bill: {
          subtotal: bill.subtotal,
          deliveryCharges: bill.deliveryCharges,
          gstAndOthers: bill.gstAndOthers,
          donationRoundup: bill.donationRoundup,
          total: bill.total,
        },
      });

      // The same shared wrapper the courts and coaching pay screens use. One
      // checkout invocation for the whole app.
      const razorpayResult = await openRazorpayCheckout({
        keyId: checkoutResult.keyId || RAZORPAY_KEY_ID,
        amountPaise: checkoutResult.amountPaise,
        currency: checkoutResult.currency,
        orderId: checkoutResult.razorpayOrderId,
        name: 'Atlitos',
        description: 'Gear order',
        prefill: { name: me?.name ?? undefined, email: undefined, contact: me?.phone ?? undefined },
      });

      // From here the money is captured. Keep the triple so a failed verify
      // retries confirmation with it and never calls `shop.checkout()` again,
      // which would mint a new Razorpay order and charge the shopper twice.
      paymentTripleRef.current = {
        razorpayOrderId: razorpayResult.razorpayOrderId,
        razorpayPaymentId: razorpayResult.razorpayPaymentId,
        razorpaySignature: razorpayResult.razorpaySignature,
      };
      await confirmPayment();
    } catch (err) {
      // Two shapes land here: a mapped ApiError from the edge functions, or a
      // plain Error from a dismissed Razorpay sheet that never reached the
      // server. `toApiError` normalizes the second rather than casting it into
      // a lie the render below would read `.code` off of.
      const apiError = toApiError(err, 'PAYMENT_FAILED');
      setError(apiError);

      if (apiError.code === 'OUT_OF_STOCK') {
        // FR-20 / AC-D5. No charge occurred. The cart re-derives the flags from
        // live availability, so the offending lines are already marked there.
        router.replace('/shop/cart');
        return;
      }
      if (apiError.code === 'PRICE_MISMATCH') {
        // FR-19 / AC-D4. No charge occurred. Pull live prices and make the
        // shopper confirm the corrected total explicitly.
        setNeedsReconfirm(true);
        await load();
      }
    } finally {
      setPaying(false);
    }
  }

  // FR-21 / FR-23. Runs only with a captured payment's triple. A failure here
  // never falls back into `handleContinue`: the payment is taken, so the only
  // safe moves are to retry this same verify or send the shopper to My Orders,
  // where `razorpay-webhook` finalizes the order independently.
  async function confirmPayment() {
    const triple = paymentTripleRef.current;
    if (!triple) return;
    setConfirming(true);
    try {
      const verified = await shop.verifyOrderPayment(triple);
      // FR-23: Order Success is reached only with a real order id, which only
      // exists because the finalize handler created the row.
      router.replace({
        pathname: '/shop/order-success',
        params: { orderId: verified.orderId, orderNumber: verified.orderNumber ?? '' },
      });
    } catch (err) {
      if (isOrderUnfulfillableError(err)) {
        // The capture landed after the stock hold lapsed and the server
        // refunded it. No order exists, so this is neither success nor a
        // retryable failure.
        setUnfulfillable(err);
        setPhase('unfulfillable');
        return;
      }
      const apiError = toApiError(err, 'PAYMENT_FAILED');
      // A bad signature will not verify on a retry either; go straight to the
      // My Orders fallback rather than offering a button that cannot work.
      setConfirmAttempts((count) =>
        apiError.code === 'INVALID_SIGNATURE' ? MAX_CONFIRM_ATTEMPTS : count + 1,
      );
      setPhase('confirming');
    } finally {
      setConfirming(false);
    }
  }

  if (!isSignedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Checkout" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Sign in to check out</Text>
          <Button variant="secondary" onPress={() => router.push('/(auth)/login')}>
            <Text style={{ color: colors.text }}>Sign in</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'unfulfillable') {
    const refunded = unfulfillable?.refundOutcome === 'refunded';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <Stack.Screen options={{ gestureEnabled: false }} />
        <AppBar variant="backTitle" title="Checkout" onPressBack={() => router.replace('/shop/cart')} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <PackageX size={40} color={colors.warning} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>This item sold out</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {refunded
              ? 'It sold out before your payment went through, so no order was placed. Your payment has been refunded in full.'
              : 'It sold out before your payment went through, so no order was placed. Your payment is being refunded in full.'}
          </Text>
          <Button variant="secondary" onPress={() => router.replace('/shop/cart')}>
            <Text style={{ color: colors.text }}>Back to cart</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'confirming') {
    const exhausted = confirmAttempts >= MAX_CONFIRM_ATTEMPTS;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <Stack.Screen options={{ gestureEnabled: false }} />
        <AppBar variant="backTitle" title="Checkout" onPressBack={() => router.replace('/shop/orders')} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <ShieldCheck size={40} color={colors.success} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Payment received, confirming your order
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {exhausted
              ? 'Your payment is safe. Your order will appear in My Orders shortly. Do not pay again.'
              : 'We could not confirm your order yet. Your payment is safe, so do not pay again.'}
          </Text>
          {exhausted ? (
            <Button onPress={() => router.replace('/shop/orders')}>
              <Text style={{ color: colors.inkOnAccent }}>Go to My Orders</Text>
            </Button>
          ) : (
            <Button loading={confirming} onPress={() => void confirmPayment()}>
              <RefreshCw size={16} strokeWidth={1.75} color={colors.inkOnAccent} />
              <Text style={{ color: colors.inkOnAccent }}>Retry confirmation</Text>
            </Button>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Checkout" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={100} />
          <Skeleton shape="card" height={180} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Checkout" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load checkout</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error ? checkoutErrorCopy(error) : GENERIC_ERROR_COPY}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Checkout" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
        {/* Items */}
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
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Your order</Text>
          {lines.map((line) => (
            <View key={line.cartItemId} className="flex-row items-center justify-between gap-md">
              <View style={{ flex: 1 }}>
                <Text style={[textStyle('callout'), { color: colors.text }]} numberOfLines={1}>
                  {line.title}
                </Text>
                <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                  {line.variantLabel}
                </Text>
              </View>
              <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>x{line.qty}</Text>
              <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(line.lineTotal)}</Text>
            </View>
          ))}
        </View>

        {/* Shipping address. FR-14 / AC-D1. */}
        <View
          style={{
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: selectedAddress ? colors.border : colors.danger,
            backgroundColor: colors.card,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Shipping address</Text>
          {selectedAddress ? (
            <>
              <View className="flex-row items-start gap-sm">
                <MapPin size={18} strokeWidth={1.75} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={[textStyle('callout'), { color: colors.text }]}>
                    {selectedAddress.line1}
                    {selectedAddress.line2 ? `, ${selectedAddress.line2}` : ''}
                  </Text>
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                    {selectedAddress.city}, {selectedAddress.state}
                  </Text>
                  <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>
                    {selectedAddress.pincode}
                  </Text>
                </View>
              </View>
              <Button variant="text" size="sm" onPress={() => router.push('/shop/checkout/address')}>
                <Text style={{ color: colors.accent }}>Change address</Text>
              </Button>
            </>
          ) : (
            <>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                No address found. Add an address to continue.
              </Text>
              <Button variant="secondary" size="sm" onPress={() => router.push('/shop/checkout/address')}>
                <Text style={{ color: colors.text }}>Add address</Text>
              </Button>
            </>
          )}
        </View>

        {/* FR-13's shared BillSummary. The donation row is passed as
         * `donationRow`, and is omitted entirely when the roundup is ticked
         * and derives to zero, per the founder's decision. */}
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
            rows={commerceBillRows(bill)}
            donationRow={
              DONATIONS_ENABLED && showRoundupRow
                ? {
                    label: COMMERCE_BILL_LABELS.donation,
                    amount: bill.donationRoundup,
                    checked: roundupOptedIn,
                    onToggle: () => setRoundupOptedIn((current) => !current),
                  }
                : undefined
            }
            total={bill.total}
          />
        </View>

        {/* The zero roundup case, explained rather than shown as a zero row.
         * Only reachable when the shopper opted in and the total already sits
         * on a multiple, which is exactly when the row disappears. */}
        {roundupOptedIn && !showRoundupRow ? (
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
            Your total is already a round figure, so there is nothing to round up this time.
          </Text>
        ) : null}

        {needsReconfirm ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: colors.warningTint,
              padding: spacing.md,
            }}
          >
            <TriangleAlert size={18} strokeWidth={1.75} color={colors.warning} />
            <Text style={[textStyle('callout'), { color: colors.warning, flex: 1 }]}>
              Prices changed while you were here. Nothing was charged. Check the updated total and confirm again.
            </Text>
          </View>
        ) : null}

        {error && error.code !== 'PRICE_MISMATCH' && error.code !== 'OUT_OF_STOCK' ? (
          <View className="flex-row items-center gap-xs">
            <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
            <Text className="flex-1 font-sans text-sm text-danger">
              {checkoutErrorCopy(error)}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Button loading={paying} disabled={!canContinue} onPress={() => void handleContinue()}>
          <Text style={{ color: colors.inkOnAccent }}>
            {needsReconfirm ? 'Confirm and pay ' : 'Continue to pay '}
            <Text style={[textStyle('numericSm'), { color: colors.inkOnAccent }]}>{formatINR(bill.total)}</Text>
          </Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
