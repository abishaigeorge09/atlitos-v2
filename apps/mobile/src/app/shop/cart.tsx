import { useShop, toApiError, type CartLine } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Minus, Plus, RefreshCw, ShoppingBag, Trash2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * Cart, `/shop/cart`. AT-76, PRD-07 FR-8 to FR-12; screen spec PRD-07 section
 * 3 item 3.
 *
 * FR-8: lines are persisted `cart_items` rows, not local state, so the cart
 * survives an app restart. The read carries an explicit `user_id` filter in
 * `getCart` even though RLS already scopes the table, because it is joined
 * against three publicly browsable tables and RLS is permissive OR
 * (CLAUDE.md).
 *
 * FR-9: the stepper calls `update_cart_item`, which revalidates AVAILABLE
 * stock server side and caps the line rather than silently rounding up. The
 * capped notice is shown, not swallowed.
 *
 * FR-11: the subtotal is summed from the live prices the availability view
 * returned at read time, never from anything the client cached when the line
 * was added.
 *
 * FR-12 / AC-C2: any line asking for more than is available blocks Proceed To
 * Buy until the shopper reduces it or removes it. The block is derived from
 * live availability on every read, so a line that went out of stock in another
 * shopper's checkout surfaces here without this screen being told.
 *
 * FR-10's remove uses AT-84's `ConfirmSheet`, never `Alert.alert`, which AT-64
 * established is inert on react-native-web.
 */
export default function CartScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');

  const [state, setState] = useState<LoadState>('loading');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busyVariantId, setBusyVariantId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [pendingRemoval, setPendingRemoval] = useState<CartLine | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    if (!isSignedIn) {
      setState('empty');
      return;
    }
    setState('loading');
    setError(null);
    try {
      const rows = await shop.getCart();
      setLines(rows);
      setState(rows.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleQuantityChange(line: CartLine, nextQty: number) {
    if (nextQty < 1) return;
    setBusyVariantId(line.variantId);
    setError(null);
    try {
      const result = await shop.updateCartItem(line.variantId, nextQty);
      setNotices((current) => ({
        ...current,
        [line.variantId]: result.capped
          ? `Only ${result.availableStock} left, so this line is set to ${result.qty}.`
          : '',
      }));
      await load();
    } catch (err) {
      const apiError = toApiError(err);
      setNotices((current) => ({
        ...current,
        [line.variantId]:
          apiError.code === 'OUT_OF_STOCK'
            ? 'This one just sold out. Remove it to continue.'
            : apiError.message,
      }));
    } finally {
      setBusyVariantId(null);
    }
  }

  async function handleConfirmRemoval() {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      await shop.removeCartItem(pendingRemoval.cartItemId);
      setNotices((current) => {
        const next = { ...current };
        delete next[pendingRemoval.variantId];
        return next;
      });
      setPendingRemoval(null);
      await load();
    } catch (err) {
      setError(toApiError(err));
      setPendingRemoval(null);
    } finally {
      setRemoving(false);
    }
  }

  // FR-11: summed from live prices returned by this read, not client cache.
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  // FR-12: one blocked line blocks the whole checkout.
  const blockedLines = lines.filter((line) => line.exceedsStock);
  const canProceed = lines.length > 0 && blockedLines.length === 0;

  if (!isSignedIn) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Your cart" onPressBack={() => router.back()} />
        <EmptyState
          icon={ShoppingBag}
          title="Sign in to see your cart"
          body="Your cart follows your account, so it is waiting for you on every device."
          ctaLabel="Browse gear"
          onCtaPress={() => router.push('/shop/category/all')}
        />
        <LoginGateModal visible={false} onClose={() => undefined} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Your cart" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
        </View>
      ) : state === 'error' ? (
        <View
          style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}
        >
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load your cart</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' ? (
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          body="Find gear built for your game and it will show up right here."
          ctaLabel="Browse gear"
          onCtaPress={() => router.push('/shop/category/all')}
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            {lines.map((line) => (
              <CartLineRow
                key={line.cartItemId}
                line={line}
                notice={notices[line.variantId]}
                busy={busyVariantId === line.variantId}
                onQuantityChange={(qty) => void handleQuantityChange(line, qty)}
                onRemove={() => setPendingRemoval(line)}
              />
            ))}

            {blockedLines.length > 0 ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  borderRadius: radii.md,
                  backgroundColor: colors.dangerTint,
                  padding: spacing.md,
                }}
              >
                <TriangleAlert size={18} strokeWidth={1.75} color={colors.danger} />
                <Text style={[textStyle('callout'), { color: colors.danger, flex: 1 }]}>
                  Some gear is no longer available in the quantity you picked. Reduce or remove those lines to
                  continue.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={{
              padding: spacing.lg,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              gap: spacing.md,
            }}
          >
            {/* The cart's running subtotal, not a bill. The full breakdown is
             * `BillSummary` on checkout, which is where the delivery, GST and
             * roundup terms first exist. */}
            <View className="flex-row items-center justify-between">
              <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Subtotal</Text>
              <Text style={[textStyle('numericLg'), { color: colors.text }]}>{formatINR(subtotal)}</Text>
            </View>
            <Button disabled={!canProceed} onPress={() => router.push('/shop/checkout')}>
              <Text style={{ color: colors.inkOnAccent }}>Proceed to buy</Text>
            </Button>
          </View>
        </>
      )}

      {/* FR-10's destructive confirm. Not Alert.alert: AT-64 established that
       * is a silent no-op on react-native-web. */}
      <ConfirmSheet
        visible={pendingRemoval !== null}
        icon={Trash2}
        destructive
        loading={removing}
        title="Remove this from your cart?"
        body={
          pendingRemoval
            ? `${pendingRemoval.title} will be taken out of your cart. You can add it back any time.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Keep it"
        onConfirm={() => void handleConfirmRemoval()}
        onCancel={() => setPendingRemoval(null)}
      />
    </SafeAreaView>
  );
}

function CartLineRow({
  line,
  notice,
  busy,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  notice?: string;
  busy: boolean;
  onQuantityChange: (qty: number) => void;
  onRemove: () => void;
}) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: line.exceedsStock ? colors.danger : colors.border,
        backgroundColor: colors.card,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        {line.imageUrl ? (
          <Image
            source={{ uri: line.imageUrl }}
            style={{ height: 72, width: 72, borderRadius: radii.md }}
            resizeMode="cover"
          />
        ) : (
          <View
            accessibilityLabel="Product photo coming soon"
            style={{
              height: 72,
              width: 72,
              borderRadius: radii.md,
              backgroundColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShoppingBag size={24} strokeWidth={1.75} color={colors.textTertiary} />
          </View>
        )}

        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={[textStyle('label'), { color: colors.text }]} numberOfLines={2}>
            {line.title}
          </Text>
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{line.variantLabel}</Text>
          <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(line.unitPrice)}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove from cart"
          hitSlop={8}
          onPress={onRemove}
          style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Trash2 size={18} strokeWidth={1.75} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-md">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reduce quantity"
            disabled={busy || line.qty <= 1}
            onPress={() => onQuantityChange(line.qty - 1)}
            className="h-11 w-11 items-center justify-center rounded-sm border border-border-strong active:bg-surface-muted"
            style={{ opacity: busy || line.qty <= 1 ? 0.5 : 1 }}
          >
            <Minus size={16} strokeWidth={1.75} color={colors.text} />
          </Pressable>
          <Text style={[textStyle('numericBase'), { color: colors.text, minWidth: 24, textAlign: 'center' }]}>
            {line.qty}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase quantity"
            disabled={busy || line.qty >= line.availableStock}
            onPress={() => onQuantityChange(line.qty + 1)}
            className="h-11 w-11 items-center justify-center rounded-sm border border-border-strong active:bg-surface-muted"
            style={{ opacity: busy || line.qty >= line.availableStock ? 0.5 : 1 }}
          >
            <Plus size={16} strokeWidth={1.75} color={colors.text} />
          </Pressable>
        </View>

        <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(line.lineTotal)}</Text>
      </View>

      {/* FR-9 and FR-12's inline notice, per line. `exceedsStock` is derived
       * from live availability on this read, so it appears even when this
       * screen made no request that caused it. */}
      {line.exceedsStock ? (
        <Text style={[textStyle('caption'), { color: colors.danger }]}>
          {line.availableStock === 0
            ? 'Out of stock now. Remove it to continue.'
            : `Only ${line.availableStock} left. Reduce this line to continue.`}
        </Text>
      ) : notice ? (
        <Text style={[textStyle('caption'), { color: colors.warning }]}>{notice}</Text>
      ) : null}
    </View>
  );
}
