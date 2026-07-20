import { useShop, toApiError, type OrderDetail } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MapPin, MessageSquarePlus, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillSummary } from '@/components/molecules/BillSummary';
import { OrderTimeline } from '@/components/molecules/OrderTimeline';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/ui/star-rating';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { COMMERCE_BILL_LABELS, commerceBillRows } from '@/lib/commerce-bill';
import { ORDER_STATUS_EVENT, ORDER_STATUS_PILL, formatOrderDate } from '@/lib/order-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type OrderParams = { id: string };

type LoadState = 'loading' | 'populated' | 'notFound' | 'error';

/**
 * Order Detail / Tracking, `/shop/order/[id]`. AT-79, PRD-07 FR-24, FR-25,
 * FR-26; screen spec PRD-07 section 3 item 7.
 *
 * FR-24 / AC-E2: the `OrderTimeline` renders `order_timeline` rows exactly as
 * admin actions produced them, with each entry's date and location. This
 * screen NEVER writes a lifecycle transition; `order_transition` is a service
 * role RPC and `admin-order-advance` is its only caller.
 *
 * FR-25: the `BillSummary` recap reads the `orders` row's STORED money
 * columns and the `order_items` snapshot columns, never a recomputation
 * against current prices. A later admin price edit cannot rewrite what a
 * shopper was charged. The roundup row appears here only when the order
 * actually carried one, which is the same suppression rule checkout applies,
 * for the same reason: a zero row would describe a donation that did not
 * happen.
 *
 * FR-26 / AC-E3, AC-E4: Write Feedback appears only from `delivered`, and once
 * feedback exists this shows the read only view instead.
 */
export default function OrderDetailScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const params = useLocalSearchParams<OrderParams>();

  const [state, setState] = useState<LoadState>('loading');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const row = await shop.getOrder(params.id);
      if (!row) {
        setState('notFound');
        return;
      }
      setOrder(row);
      setState('populated');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [params.id]);

  // Reloads on focus so returning from the feedback screen shows the read only
  // view without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Order" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="40%" height={24} />
          <Skeleton shape="card" height={160} />
          <Skeleton shape="card" height={140} />
          <Skeleton shape="card" height={180} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'notFound' || state === 'error' || !order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="backTitle" title="Order" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {state === 'notFound' ? 'Order not found' : "Couldn't load this order"}
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {state === 'notFound'
              ? 'This order is not on your account. Check My Orders for the full list.'
              : error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => (state === 'notFound' ? router.replace('/shop/orders') : void load())}>
            {state === 'notFound' ? null : <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />}
            <Text style={{ color: colors.text }}>{state === 'notFound' ? 'My orders' : 'Retry'}</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const timelineEvents = order.timeline.map((entry) => ({
    date: formatOrderDate(entry.createdAt),
    event: entry.note?.trim() || ORDER_STATUS_EVENT[entry.status],
    location: entry.location ?? '',
  }));

  const canWriteFeedback = order.status === 'delivered' && order.feedback === null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Order" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('numericLg'), { color: colors.text }]}>{order.orderNumber}</Text>
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
            Placed on {formatOrderDate(order.createdAt)}
          </Text>
          <StatusPill status={ORDER_STATUS_PILL[order.status]} />
        </View>

        {/* FR-24's tracking. Read only: admin drives every entry here. */}
        {timelineEvents.length > 0 ? (
          <View
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Tracking</Text>
            <OrderTimeline events={timelineEvents} />
          </View>
        ) : null}

        {/* Snapshot lines. Title, variant label and unit price are frozen at
         * order time (FR-25). */}
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
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Items</Text>
          {order.items.map((item) => (
            <View key={item.id} className="flex-row items-center justify-between gap-md">
              <View style={{ flex: 1 }}>
                <Text style={[textStyle('callout'), { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{item.variantLabel}</Text>
              </View>
              <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>x{item.qty}</Text>
              <Text style={[textStyle('numericBase'), { color: colors.text }]}>
                {formatINR(item.unitPrice * item.qty)}
              </Text>
            </View>
          ))}
        </View>

        {/* The address AS SHIPPED, from the order's own ship_to_* snapshot.
         * Never the addresses join: that row is editable and deletable, and
         * a past order must not change where it says it went (FR-30). */}
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
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Shipping to</Text>
            <View className="flex-row items-start gap-sm">
              <MapPin size={18} strokeWidth={1.75} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[textStyle('callout'), { color: colors.text }]}>
                  {order.shipTo.line1}
                  {order.shipTo.line2 ? `, ${order.shipTo.line2}` : ''}
                </Text>
                <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                  {order.shipTo.city}, {order.shipTo.state}
                </Text>
                <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>{order.shipTo.pincode}</Text>
              </View>
            </View>
          </View>

        {/* FR-25's recap, through the shared BillSummary. Read only, so the
         * donation row is passed with no toggle handler of consequence; it is
         * suppressed entirely when the order carried no roundup, matching the
         * checkout rule. */}
        <View
          style={{
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Payment summary</Text>
          <BillSummary
            rows={
              order.bill.donationRoundup > 0
                ? [
                    ...commerceBillRows(order.bill),
                    { label: COMMERCE_BILL_LABELS.donation, amount: order.bill.donationRoundup },
                  ]
                : commerceBillRows(order.bill)
            }
            total={order.bill.total}
          />
        </View>

        {/* FR-26 / AC-E3, AC-E4. */}
        {order.feedback ? (
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
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Your feedback</Text>
            <StarRating mode="display" value={order.feedback.rating} />
            {order.feedback.remarks ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{order.feedback.remarks}</Text>
            ) : null}
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              Submitted on {formatOrderDate(order.feedback.createdAt)}
            </Text>
          </View>
        ) : canWriteFeedback ? (
          <Button
            variant="secondary"
            onPress={() => router.push({ pathname: '/shop/order/[id]/feedback', params: { id: order.id } })}
          >
            <MessageSquarePlus size={18} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Write feedback</Text>
          </Button>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
