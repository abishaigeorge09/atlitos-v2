import { useShop } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type SuccessParams = {
  orderId: string;
  orderNumber?: string;
};

/**
 * Order Success, `/shop/order-success`. AT-79, PRD-07 FR-23 / AC-E1; screen
 * spec PRD-07 section 3 item 6. Single state, populated only.
 *
 * FR-23 says this "is not reachable by direct navigation without a completed
 * order". The order id only ever comes from `verify-payment`'s response, and
 * the order row it names was created by the finalize handler under service
 * role, so a bare `/shop/order-success` with no id has no order behind it and
 * redirects to My Orders rather than rendering a confirmation for nothing.
 */
export default function OrderSuccessScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const params = useLocalSearchParams<SuccessParams>();
  const [orderNumber, setOrderNumber] = useState(params.orderNumber ?? '');

  // `verify-payment` returns the order id but not its shopper facing number,
  // so fetch that when it was not handed over. AC-E1 wants the order
  // identified on this screen, and "#ATL00001" is what a shopper reads aloud
  // to support, not a uuid.
  useEffect(() => {
    if (!params.orderId || orderNumber) return;
    shop
      .getOrder(params.orderId)
      .then((order) => {
        if (order) setOrderNumber(order.orderNumber);
      })
      .catch(() => {
        // The order exists (this screen is only reachable with a real id);
        // failing to read its number is not worth blocking the confirmation.
      });
  }, [params.orderId, orderNumber]);

  if (!params.orderId) {
    return <Redirect href="/shop/orders" />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.xl,
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
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
          <Text style={[textStyle('h1'), { color: colors.text, textAlign: 'center' }]}>
            Order successfully placed
          </Text>
          {orderNumber ? (
            <Text style={[textStyle('numericLg'), { color: colors.text }]}>{orderNumber}</Text>
          ) : null}
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            Your gear is on its way. Track it any time from My Orders.
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Button
            onPress={() =>
              router.replace({ pathname: '/shop/order/[id]', params: { id: params.orderId } })
            }
          >
            <Text style={{ color: colors.inkOnAccent }}>Track my order</Text>
          </Button>
          <Button variant="secondary" onPress={() => router.replace('/shop/category/all')}>
            <Text style={{ color: colors.text }}>Explore more</Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
