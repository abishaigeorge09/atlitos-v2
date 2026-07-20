import { useShop, toApiError, type OrderListItem } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { ChevronRight, PackageSearch, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { ORDER_STATUS_PILL, formatOrderDate } from '@/lib/order-display';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * My Orders, `/shop/orders`. AT-79, PRD-07 FR-27 / AC-F1, AC-F2; screen spec
 * PRD-07 section 3 item 8.
 *
 * Every lifecycle state, newest first, one status chip each. The read carries
 * an explicit `user_id` filter in `listMyOrders` regardless of RLS, per
 * CLAUDE.md's permissive OR rule. AC-F2: zero orders shows the empty state
 * with a Browse Gear CTA, never a blank screen.
 */
export default function MyOrdersScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');

  const [state, setState] = useState<LoadState>('loading');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isSignedIn) {
        setState('empty');
        return;
      }
      if (!options?.silent) setState('loading');
      setError(null);
      try {
        const rows = await shop.listMyOrders();
        setOrders(rows);
        setState(rows.length === 0 ? 'empty' : 'populated');
      } catch (err) {
        setError(toApiError(err));
        setState('error');
      }
    },
    [isSignedIn],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="My orders" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={92} />
          <Skeleton shape="card" height={92} />
          <Skeleton shape="card" height={92} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Couldn't load your orders</Text>
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
          icon={PackageSearch}
          title="No orders yet"
          body="Gear you buy shows up here, with live tracking from placed to delivered."
          ctaLabel="Browse gear"
          onCtaPress={() => router.push('/shop/category/all')}
        />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/shop/order/[id]', params: { id: item.id } })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
              }}
            >
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[textStyle('numericBase'), { color: colors.text }]}>{item.orderNumber}</Text>
                <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                  {formatOrderDate(item.createdAt)}
                </Text>
                <StatusPill status={ORDER_STATUS_PILL[item.status]} />
              </View>
              <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(item.total)}</Text>
                <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>
                  {item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}
                </Text>
              </View>
              <ChevronRight size={20} strokeWidth={1.75} color={colors.textTertiary} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
