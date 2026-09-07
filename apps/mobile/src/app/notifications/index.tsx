import { useNotifications } from '@atlitos/api';
import type { AppNotification, ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { type Href, router } from 'expo-router';
import { BellOff, Settings2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { AppBar } from '@/components/ui/app-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { notificationDisplay } from '@/lib/notification-display';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * Notifications, `/notifications`. AT-147, the in-app notification surface
 * consumed as a given across PRD-01/02/04/07. Lists the caller's OWN
 * notifications newest first (owner-scoped in `useNotifications.list`: an
 * explicit `.eq("user_id", me)` on top of RLS, per CLAUDE.md "RLS is not
 * scoping"), each with its type icon, unread accent, and relative time. A row
 * tap marks that notification read (scoped so a user can never mark another
 * user's row) and follows its deep link. A header action marks all read and
 * opens preferences.
 *
 * A user sees ONLY their own notifications. Guest taps are gated (FR-3) before
 * any read runs; a signed out user has none to show.
 *
 * Each row is a SINGLE Pressable (tap marks read + deep links); there is no
 * nested Pressable, so no overlay dance is needed. Mark all read is the one
 * bulk action and lives in the header, not per row.
 */
export default function NotificationsScreen() {
  const colors = useThemeColors();
  const notifications = useNotifications(supabase);
  const isSignedIn = useSessionStore((state) => state.status === 'signed_in');
  const requiresAuthGate = !isSignedIn;
  const meId = useSessionStore((state) => state.me?.id);

  const [gateVisible, setGateVisible] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isSignedIn) {
        setItems([]);
        setState('empty');
        return;
      }
      if (!options?.silent) setState('loading');
      setError(null);
      try {
        const rows = await notifications.list();
        setItems(rows);
        setState(rows.length === 0 ? 'empty' : 'populated');
      } catch (err) {
        setError(err as ApiError);
        setState('error');
      }
    },
    [isSignedIn],
  );

  useEffect(() => {
    if (requiresAuthGate) {
      setGateVisible(true);
      setState('empty');
      return;
    }
    void load();
  }, [requiresAuthGate, load]);

  // Live: a new notification for this user prepends without a manual refresh.
  // RLS scopes the stream to the caller's own rows; the user_id filter is
  // about volume, not authorization.
  useEffect(() => {
    if (!isSignedIn || !meId) return;
    const channel = notifications.subscribe((incoming) => {
      setItems((previous) => [incoming, ...previous]);
      setState('populated');
    }, meId);
    return () => {
      // removeChannel, not just unsubscribe. `notifications:self` is a NAMED
      // channel on the singleton client, so unsubscribe leaves it registered
      // and the next open of this screen re-subscribes onto a dead channel.
      // chat/[id].tsx already documents this exact failure; this caller was
      // missed.
      void supabase.removeChannel(channel);
    };
  }, [isSignedIn, meId]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  async function openNotification(item: AppNotification) {
    // Optimistically flip to read, then persist. markRead is owner-scoped and
    // idempotent, so a failure just leaves it unread to retry on next tap.
    if (!item.readAt) {
      setItems((previous) =>
        previous.map((row) =>
          row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row,
        ),
      );
      try {
        await notifications.markRead(item.id);
      } catch {
        // Non fatal; the row stays visible, re-syncs on next load.
      }
    }
    router.push(item.deepLink as Href);
  }

  async function handleMarkAllRead() {
    const now = new Date().toISOString();
    setItems((previous) => previous.map((row) => (row.readAt ? row : { ...row, readAt: now })));
    try {
      await notifications.markAllRead();
    } catch {
      void load({ silent: true });
    }
  }

  const hasUnread = items.some((item) => !item.readAt);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Notifications" onPressBack={() => router.back()} />

      <View style={{ flex: 1, paddingHorizontal: spacing.lg }}>
        <View
          className="flex-row items-center justify-between"
          style={{ paddingVertical: spacing.sm }}
        >
          <Pressable
            onPress={handleMarkAllRead}
            disabled={!hasUnread}
            accessibilityRole="button"
            className="min-h-11 justify-center"
          >
            <Text
              className={hasUnread ? 'font-sans-semibold text-sm text-accent' : 'text-sm text-text-tertiary'}
            >
              Mark all read
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/notifications/preferences')}
            accessibilityRole="button"
            accessibilityLabel="Notification preferences"
            className="h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted"
          >
            <Settings2 size={22} strokeWidth={1.75} color={colors.text} />
          </Pressable>
        </View>

        {requiresAuthGate ? (
          <EmptyState
            icon={BellOff}
            title="Sign in to see your notifications"
            body="Bookings, orders, messages and updates land here once you are signed in."
            ctaLabel="Sign in"
            onCtaPress={() => setGateVisible(true)}
          />
        ) : state === 'loading' ? (
          <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
            {[0, 1, 2, 3, 4].map((key) => (
              <View key={key} className="flex-row items-center gap-md">
                <Skeleton shape="circle" />
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Skeleton shape="line" width="55%" />
                  <Skeleton shape="line" width="85%" />
                </View>
              </View>
            ))}
          </View>
        ) : state === 'error' ? (
          <EmptyState
            icon={TriangleAlert}
            title="Notifications could not load"
            body={error?.message ?? 'Something went wrong. Please try again.'}
            ctaLabel="Retry"
            onCtaPress={() => void load()}
          />
        ) : state === 'empty' ? (
          <EmptyState
            icon={BellOff}
            title="You are all caught up"
            body="New bookings, orders, messages and updates will show up here."
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            contentContainerStyle={{ paddingTop: spacing.xs, paddingBottom: spacing['3xl'] }}
            renderItem={({ item }) => (
              <NotificationRow notification={item} onPress={() => void openNotification(item)} />
            )}
          />
        )}
      </View>

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </SafeAreaView>
  );
}

function relativeTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const isSameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(isSameYear ? {} : { year: 'numeric' }),
  });
}

function NotificationRow({
  notification,
  onPress,
}: {
  notification: AppNotification;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const { icon: Icon } = notificationDisplay(notification.type);
  const unread = !notification.readAt;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`min-h-11 flex-row items-start gap-md rounded-lg p-sm active:bg-surface-muted ${
        unread ? 'bg-accent-tint' : ''
      }`}
    >
      <View
        className={`h-10 w-10 items-center justify-center rounded-pill ${
          unread ? 'bg-accent' : 'bg-surface-muted'
        }`}
      >
        <Icon
          size={20}
          strokeWidth={1.75}
          color={unread ? colors.inkOnAccent : colors.textSecondary}
        />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <View className="flex-row items-center justify-between gap-sm">
          <Text
            className={`flex-1 text-base ${unread ? 'font-sans-semibold text-text' : 'font-sans-medium text-text'}`}
            numberOfLines={1}
          >
            {notification.title}
          </Text>
          <Text className="font-mono text-xs text-text-tertiary">
            {relativeTimestamp(notification.createdAt)}
          </Text>
        </View>
        <Text className="text-sm text-text-secondary" numberOfLines={2}>
          {notification.body}
        </Text>
      </View>
    </Pressable>
  );
}
