import { useShop, toApiError, type OrderDetail } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/ui/star-rating';
import { Text } from '@/components/ui/text';
import { formatOrderDate } from '@/lib/order-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type FeedbackParams = { id: string };

type LoadState = 'loading' | 'form' | 'readOnly' | 'blocked' | 'error';

/**
 * Order Feedback, `/shop/order/[id]/feedback`. AT-79, PRD-07 FR-26 / AC-E3,
 * AC-E4; screen spec PRD-07 section 3 item 9.
 *
 * Both halves of FR-26 are enforced in the database, not here: 0032's insert
 * policy requires the order to be `delivered`, and `order_feedback`'s
 * `UNIQUE(order_id)` makes it a one time action. This screen renders the
 * consequences rather than the rules, so a stale client cannot talk its way
 * past either: a not yet delivered order shows the blocked state, and an
 * order that already has feedback shows the read only view.
 */
export default function OrderFeedbackScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const params = useLocalSearchParams<FeedbackParams>();

  const [state, setState] = useState<LoadState>('loading');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [rating, setRating] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const row = await shop.getOrder(params.id);
      if (!row) {
        setState('error');
        setError({ code: 'NOT_FOUND', message: 'This order is not on your account.', status: 404 });
        return;
      }
      setOrder(row);
      if (row.feedback) {
        setRating(row.feedback.rating);
        setRemarks(row.feedback.remarks ?? '');
        setState('readOnly');
      } else if (row.status !== 'delivered') {
        setState('blocked');
      } else {
        setState('form');
      }
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit() {
    if (rating < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      await shop.submitOrderFeedback(params.id, rating, remarks);
      // Re-read rather than assuming: the read only view should render the row
      // the database actually stored.
      await load();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Order feedback" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="55%" height={22} />
          <Skeleton shape="line" width="40%" />
          <Skeleton shape="card" height={120} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load this order</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => router.replace('/shop/orders')}>
            <Text style={{ color: colors.text }}>My orders</Text>
          </Button>
        </View>
      ) : state === 'blocked' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Feedback opens once your order arrives
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Track this order and come back after it is delivered.
          </Text>
          <Button variant="secondary" onPress={() => router.back()}>
            <Text style={{ color: colors.text }}>Back to order</Text>
          </Button>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={{ gap: spacing.xs }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>
              {state === 'readOnly' ? 'Thanks for the feedback' : 'How did this order go?'}
            </Text>
            {order ? (
              <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>{order.orderNumber}</Text>
            ) : null}
          </View>

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
            <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Your rating</Text>
            {state === 'readOnly' ? (
              <StarRating mode="display" value={rating} size={24} />
            ) : (
              <StarRating mode="input" value={rating} size={28} onChange={setRating} />
            )}

            {state === 'readOnly' ? (
              remarks ? (
                <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{remarks}</Text>
              ) : null
            ) : (
              <Input
                type="multiline"
                label="Anything else"
                value={remarks}
                onChangeText={setRemarks}
                placeholder="Tell us what worked and what did not"
              />
            )}

            {state === 'readOnly' && order?.feedback ? (
              <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                Submitted on {formatOrderDate(order.feedback.createdAt)}
              </Text>
            ) : null}
          </View>

          {error ? (
            <View className="flex-row items-center gap-xs">
              <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
              <Text className="flex-1 font-sans text-sm text-danger">
                {error.message || 'Could not submit your feedback. Please try again.'}
              </Text>
            </View>
          ) : null}

          {state === 'form' ? (
            <Button loading={submitting} disabled={rating < 1} onPress={() => void handleSubmit()}>
              <Text style={{ color: colors.inkOnAccent }}>Submit feedback</Text>
            </Button>
          ) : (
            <Button variant="secondary" onPress={() => router.back()}>
              <Text style={{ color: colors.text }}>Back to order</Text>
            </Button>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
