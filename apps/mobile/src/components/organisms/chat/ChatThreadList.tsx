import { useChat } from '@atlitos/api';
import type { ApiError, ChatThread } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { CloudOff, MessageCircle, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

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

export interface ChatThreadListProps {
  /** Where a tapped thread opens. The standalone /chat surface pushes its
   * own [id] sibling; the Trainings Chat tab pushes the conversation above
   * the Trainings module so back returns to the tab with the shell intact. */
  onOpenThread: (threadId: string) => void;
  /** Optional heading row. The standalone /chat surface passes "Messages";
   * the Trainings Chat tab passes none because the Trainings shell already
   * owns the module header. The realtime pill renders either beside the
   * title or as its own compact row. */
  title?: string;
}

/**
 * Chat thread list organism, the shared surface both roles land on (AT-55,
 * PRD-01 FR-58 to FR-60, PRD-02 FR-30/FR-31), extracted from the /chat
 * route so the Trainings module can embed it inline as its Chat tab
 * content instead of redirecting. Most recent message first
 * (`last_message_at`, trigger maintained), preview + relative timestamp per
 * row. Subscribes to every new message across the caller's own threads
 * (RLS scoped, no filter needed) to bump a row's preview and re-sort live,
 * per FR-31, no manual refresh. States: loading (skeleton rows), empty,
 * populated, error (retry), plus a realtime connection pill so a broken
 * socket doesn't read as "chat is empty". Guest taps are gated per FR-3,
 * before any thread ever loads.
 */
export function ChatThreadList({ onOpenThread, title }: ChatThreadListProps) {
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
              ? // `message.senderName` never arrives on a Realtime payload
                // (postgres_changes ships the raw table row, no PostgREST
                // embed), so a group row's sender prefix is cleared here
                // rather than left showing the PREVIOUS message's sender
                // against the new text; the next full load/refresh
                // (listThreads, which does join the name) restores it.
                { ...thread, lastMessage: message.text, lastMessageAt: message.createdAt, lastSenderName: message.senderName }
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
      // removeChannel, not just unsubscribe: a lingering named channel on
      // the singleton client crashes the next mount's `.on()` call.
      void supabase.removeChannel(channel);
    };
  }, [isGuest]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  const realtimePill =
    !isGuest && realtimeStatus !== 'connected' ? (
      <View className="flex-row items-center gap-xs self-start rounded-pill bg-warning-tint px-sm py-xs">
        <CloudOff size={14} strokeWidth={1.75} color={colors.warning} />
        <Text className="font-sans-semibold text-xs text-warning">
          {realtimeStatus === 'reconnecting' ? 'Reconnecting' : 'Disconnected'}
        </Text>
      </View>
    ) : null;

  return (
    <View style={{ flex: 1, padding: spacing.lg, gap: spacing.sm }}>
      {title ? (
        <View className="flex-row items-center justify-between">
          <Text style={[textStyle('h1'), { color: colors.text }]}>{title}</Text>
          {realtimePill}
        </View>
      ) : (
        realtimePill
      )}

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
          renderItem={({ item }) => <ThreadRow thread={item} onPress={() => onOpenThread(item.id)} />}
        />
      )}

      <LoginGateModal visible={gateVisible} onClose={() => setGateVisible(false)} />
    </View>
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
  // Group rows prefix the preview with the sender's name ("Rohan: Okay,
  // let's..."), per COACH-TRAININGS-GAP.md screen 17. A 1:1 preview never
  // carries a sender name, so it renders exactly as before.
  const preview = thread.lastMessage
    ? thread.isGroup && thread.lastSenderName
      ? `${thread.lastSenderName}: ${thread.lastMessage}`
      : thread.lastMessage
    : 'Start the conversation.';

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
          {preview}
        </Text>
        {thread.isGroup ? (
          <Text className="font-mono text-xs text-text-tertiary">
            {thread.memberCount ?? 0} {thread.memberCount === 1 ? 'member' : 'members'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
