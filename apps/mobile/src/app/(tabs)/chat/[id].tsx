import { useChat } from '@atlitos/api';
import type { ApiError, ChatMessage, ChatThread } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CloudOff, MessageCircle, Send, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type RealtimeStatus = 'connected' | 'reconnecting' | 'disconnected';

/** A message row before the server has confirmed it, so the sender sees
 * their own text land immediately (AT-32/AT-59: instant Realtime push is
 * unproven, never assumed). `pending` clears once `sendMessage` resolves and
 * the row is reconciled with its real id; it also clears if the matching
 * Realtime INSERT event arrives first, whichever happens first wins. */
interface DisplayMessage extends ChatMessage {
  pending?: boolean;
}

/**
 * One open chat thread (AT-55, PRD-01 FR-58/FR-59, PRD-02 FR-30/FR-31).
 * Sends and receives over Supabase Realtime with no manual refresh: an
 * optimistic message is appended locally on send, then reconciled with the
 * server row once `sendMessage` resolves; the Realtime INSERT for that same
 * row is de-duplicated against the id already reconciled in, so a message
 * never appears twice for the sender. States: loading, populated, error,
 * plus a connection pill for disconnected/reconnecting Realtime.
 */
export default function ChatThreadScreen() {
  const colors = useThemeColors();
  const chat = useChat(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSessionStore((state) => state.me);

  const [state, setState] = useState<ScreenState>('loading');
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connected');
  const listRef = useRef<FlatList<DisplayMessage>>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [threadResult, messagesResult] = await Promise.all([chat.getThread(id), chat.listMessages(id)]);
      if (!threadResult) {
        setError({ code: 'NOT_FOUND', message: 'This conversation could not be found.', status: 404 });
        setState('error');
        return;
      }
      setThread(threadResult);
      setMessages(messagesResult);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live inbound messages for this thread only. A message this same client
  // just sent is de-duplicated by id against the optimistic row `handleSend`
  // already reconciled in below, so the Realtime echo of your own send
  // never doubles up.
  useEffect(() => {
    const channel = chat.subscribeToThread(
      id,
      (message) => {
        setMessages((previous) => {
          if (previous.some((existing) => existing.id === message.id)) return previous;
          return [...previous, message];
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
  }, [id]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending || !me) return;

    const optimisticId = `optimistic:${Date.now()}`;
    const optimisticMessage: DisplayMessage = {
      id: optimisticId,
      threadId: id,
      senderId: me.id,
      text,
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setMessages((previous) => [...previous, optimisticMessage]);
    setDraft('');
    setSending(true);

    try {
      const sent = await chat.sendMessage(id, text);
      // Reconcile: swap the optimistic row for the server row. If the
      // Realtime INSERT for `sent.id` already arrived while this awaited,
      // that listener's de-dup check above will have skipped it (no row
      // with that id existed yet), so this is the one place the real id
      // enters the list.
      setMessages((previous) =>
        previous.some((existing) => existing.id === sent.id)
          ? previous.filter((existing) => existing.id !== optimisticId)
          : previous.map((existing) => (existing.id === optimisticId ? sent : existing)),
      );
    } catch (err) {
      // Send failed: drop the optimistic row and restore the draft so the
      // athlete or coach can retry rather than silently lose the message.
      setMessages((previous) => previous.filter((existing) => existing.id !== optimisticId));
      setDraft(text);
      setError(err as ApiError);
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <AppBar variant="backTitle" title={thread?.participantName ?? 'Chat'} onPressBack={() => router.back()} />

      {realtimeStatus !== 'connected' && state === 'populated' ? (
        <View className="flex-row items-center gap-xs bg-warning-tint px-lg py-xs">
          <CloudOff size={14} strokeWidth={1.75} color={colors.warning} />
          <Text className="font-sans-semibold text-xs text-warning">
            {realtimeStatus === 'reconnecting' ? 'Reconnecting, messages may be delayed' : 'Disconnected, pull down to reload'}
          </Text>
        </View>
      ) : null}

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} shape="line" width="70%" />
          ))}
        </View>
      ) : state === 'error' ? (
        <EmptyState
          icon={TriangleAlert}
          title="Conversation could not load"
          body={error?.message ?? 'Something went wrong. Please try again.'}
          ctaLabel="Retry"
          onCtaPress={() => void load()}
        />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        >
          {messages.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="Say hello"
              body={`Send the first message to ${thread?.participantName ?? 'this conversation'}.`}
            />
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => <MessageBubble message={item} isMine={item.senderId === me?.id} />}
            />
          )}

          <View className="flex-row items-end gap-sm border-t border-border bg-bg px-lg py-md">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={colors.textTertiary}
              multiline
              accessibilityLabel="Message input"
              className="min-h-11 max-h-24 flex-1 rounded-sm border border-border bg-surface-muted px-md py-sm font-sans text-base text-text"
            />
            <Pressable
              onPress={() => void handleSend()}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              className="h-11 w-11 items-center justify-center rounded-pill bg-accent active:bg-accent-pressed disabled:opacity-40"
            >
              <Send size={20} strokeWidth={1.75} color={colors.inkOnAccent} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function MessageBubble({ message, isMine }: { message: DisplayMessage; isMine: boolean }) {
  const colors = useThemeColors();
  const time = new Date(message.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  return (
    <View className={isMine ? 'items-end' : 'items-start'}>
      <View
        className="max-w-[80%] gap-xs rounded-lg px-md py-sm"
        style={{ backgroundColor: isMine ? colors.accent : colors.surfaceMuted, opacity: message.pending ? 0.6 : 1 }}
      >
        <Text style={{ color: isMine ? colors.inkOnAccent : colors.text }}>{message.text}</Text>
      </View>
      <Text className="font-mono text-xs text-text-tertiary" style={{ marginTop: 2 }}>
        {time}
      </Text>
    </View>
  );
}
