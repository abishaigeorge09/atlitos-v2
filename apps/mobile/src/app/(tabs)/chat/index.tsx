import { useChat } from '@atlitos/api';
import type { ApiError, ChatThread } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CloudOff, MessageCircle, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { EmptyState } from '@/components/organisms/EmptyState';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';
type RealtimeStatus = 'connected' | 'reconnecting' | 'disconnected';

/**
 * Chat thread list, the shared organism both roles land on (AT-55, PRD-01
 * FR-58 to FR-60, PRD-02 FR-30/FR-31). Reachable by path from either role's
 * own entry point (coach: /trainings/chat; athlete: from a coach or session
 * screen), never a bottom nav tab itself. Most recent message first
 * (`last_message_at`, trigger maintained), preview + relative timestamp per
 * row. Subscribes to every new message across the caller's own threads
 * (RLS scoped, no filter needed) to bump a row's preview and re-sort live,
 * per FR-31, no manual refresh. States: loading (skeleton rows), empty (no
 * threads yet), populated, error (fetch failed, retry), plus a realtime
 * connection pill that reflects connected, reconnecting, or disconnected so
 * a broken socket doesn't read as "chat is empty" or "chat is silent
 * forever". Guest taps are gated per FR-3, before any thread ever loads.
 */
export default function ChatIndexScreen() {
  const colors = useThemeColors();
  const chat = useChat(supabase);
  const isGuest = useSessionStore((state) => state.status === 'guest');
  const [gateVisible, setGateVisible] = useState(false);

  const [state, setState] = useState<LoadState>('loading');
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connected');

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const result = await chat.listThreads();
      setThreads(result);
      setState(result.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (isGuest) {
      setGateVisible(true);
      setState('empty');
      return;
    }
    void load();
  }, [isGuest, load]);

  // Inbox subscription: bumps the affected thread's preview and re-sorts
  // most-recent-first on every new message, rather than refetching the
  // whole list per event. Unsubscribed on unmount so a screen the user has
  // navigated away from never keeps a socket open.
  useEffect(() => {
    if (isGuest) return;

    const channel = chat.subscribeToInbox(
      (message) => {
        setThreads((previous) => {
          const next = previous.map((thread) =>
            thread.id === message.threadId
              ? { ...thread, lastMessage: message.text, lastMessageAt: message.createdAt }
              : thread,
          );
          return [...next].sort(
            (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
          );
        });
      },
      (status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeStatus('reconnecting');
        else if (status === 'CLOSED') setRealtimeStatus('disconnected');
      },
    );

    return () => {
      channel.unsubscribe();
    };
  }, [isGuest]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  function openThread(thread: ChatThread) {
    router.push({ pathname: '/(tabs)/chat/[id]', params: { id: thread.id } });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <View className="flex-row items-center justify-between">
          <Text style={[textStyle('h1'), { color: colors.text }]}>Messages</Text>
          {!isGuest && realtimeStatus !== 'connected' ? (
            <View className="flex-row items-center gap-xs rounded-pill bg-warning-tint px-sm py-xs">
              <CloudOff size={14} strokeWidth={1.75} color={colors.warning} />
              <Text className="font-sans-semibold text-xs text-warning">
                {realtimeStatus === 'reconnecting' ? 'Reconnecting' : 'Disconnected'}
              </Text>
            </View>
          ) : null}
        </View>

        {isGuest ? (
          <EmptyState
            icon={MessageCircle}
            title="Sign in to see your messages"
            body="Chat opens once you have a session with a coach or player."
            ctaLabel="Sign in"
            onCtaPress={() => setGateVisible(true)}
          />
        ) : state === 'loading' ? (
          <View style={{ gap: spacing.md }}>
            {[0, 1, 2, 3].map((key) => (
              <View key={key} className="flex-row items-center gap-md">
                <Skeleton shape="circle" />
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Skeleton shape="line" width="60%" />
                  <Skeleton shape="line" width="90%" />
                </View>
              </View>
            ))}
          </View>
        ) : state === 'error' ? (
          <EmptyState
            icon={TriangleAlert}
            title="Messages could not load"
            body={error?.message ?? 'Something went wrong. Please try again.'}
            ctaLabel="Retry"
            onCtaPress={() => void load()}
          />
        ) : state === 'empty' ? (
          <EmptyState
            icon={MessageCircle}
            title="No messages yet"
            body="Once you have a session with a coach or player, your conversation shows up here."
          />
        ) : (
          <FlatList
            data={threads}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
            ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
            contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
            renderItem={({ item }) => <ThreadRow thread={item} onPress={() => openThread(item)} />}
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
  const isSameDay = date.toDateString() === now.toDateString();
  if (isSameDay) {
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function ThreadRow({ thread, onPress }: { thread: ChatThread; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-11 flex-row items-center gap-md rounded-lg active:bg-surface-muted"
    >
      <Avatar uri={thread.participantAvatarUrl} name={thread.participantName} size={56} />
      <View style={{ flex: 1, gap: 2 }}>
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-base text-text" numberOfLines={1}>
            {thread.participantName}
          </Text>
          <Text className="font-mono text-xs text-text-tertiary">{relativeTimestamp(thread.lastMessageAt)}</Text>
        </View>
        <Text className="text-sm text-text-secondary" numberOfLines={1}>
          {thread.lastMessage || 'Start the conversation.'}
        </Text>
      </View>
    </Pressable>
  );
}
