import { useChat } from '@atlitos/api';
import type { ApiError, ChatMessage, ChatThread, ChatThreadMember } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, CloudOff, MessageCircle, Send, TriangleAlert, Users, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupMembersSheet } from '@/components/organisms/chat/GroupMembersSheet';
import { EmptyState } from '@/components/organisms/EmptyState';
import { ModerationSheet, type ModerationTarget } from '@/components/organisms/moderation/ModerationSheet';
import { AppBar } from '@/components/ui/app-bar';
import { useNavBarInset } from '@/components/ui/bottom-nav';
import { useKeyboardShown } from '@/lib/use-keyboard-shown';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import {
  CONTENT_BLOCKED_MESSAGE,
  ensureContentTerms,
  isContentBlocked,
  isContentTermsRequired,
  reconfirmContentTerms,
} from '@/store/content-terms-store';
import { useSessionStore } from '@/store/session-store';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type RealtimeStatus = 'connected' | 'reconnecting' | 'disconnected';

/** A manual reload that failed after Realtime closed. Rendered inline above
 * the composer, never through `error`, which only the full screen error
 * state reads. Send failures use `sendError` under the composer. */
interface InlineError {
  error: ApiError;
}

/** A message row before the server has confirmed it, so the sender sees
 * their own text land immediately (AT-32/AT-59: instant Realtime push is
 * unproven, never assumed). `pending` clears once `sendMessage` resolves and
 * the row is reconciled with its real id; it also clears if the matching
 * Realtime INSERT event arrives first, whichever happens first wins. */
interface DisplayMessage extends ChatMessage {
  pending?: boolean;
}

/**
 * One open chat thread (AT-55, PRD-01 FR-58/FR-59, PRD-02 FR-30/FR-31),
 * 1:1 or group (COACH-TRAININGS-GAP.md screen 17,
 * 0078_group_chat_and_notes.sql). Sends and receives over Supabase Realtime
 * with no manual refresh: an optimistic message is appended locally on
 * send, then reconciled with the server row once `sendMessage` resolves;
 * the Realtime INSERT for that same row is de-duplicated against the id
 * already reconciled in, so a message never appears twice for the sender.
 * States: loading, populated, error, plus a connection pill for
 * disconnected/reconnecting Realtime.
 *
 * Group threads only: the AppBar title is the group's name, a tappable
 * "N members" row under it opens the members sheet (roster from
 * `chat_thread_members` via the thread's group), and every bubble carries
 * its sender's name. A 1:1 thread renders exactly as before: no sender
 * names, no members row.
 */

// Server text is shown only for errors the member can act on; INTERNAL and
// empty messages can carry raw backend text, so they get a generic line.
function chatErrorDetail(error: { code?: string; message?: string }): string {
  if (!error.message || error.code === 'INTERNAL') return 'Please try again.';
  return error.message;
}
export default function ChatThreadScreen() {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const keyboardShown = useKeyboardShown();
  const chat = useChat(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSessionStore((state) => state.me);

  const [state, setState] = useState<ScreenState>('loading');
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Why the last send was refused, shown under the composer. Kept apart from
  // `error`, which only renders in the full screen load failure state.
  const [sendError, setSendError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connected');
  const [members, setMembers] = useState<ChatThreadMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersSheetVisible, setMembersSheetVisible] = useState(false);
  const [moderationTarget, setModerationTarget] = useState<ModerationTarget | null>(null);
  const [inlineError, setInlineError] = useState<InlineError | null>(null);
  const [reloading, setReloading] = useState(false);
  // Bumped by a manual reload so the Realtime subscription effect tears down
  // and subscribes again instead of staying on a CLOSED channel.
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);
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

  // Group roster: loaded once the thread resolves as a group, and reused
  // both by the members sheet and to backfill sender names on Realtime
  // inbound messages (whose raw payload carries no joined name, see below).
  useEffect(() => {
    if (!thread?.isGroup) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    chat
      .listThreadMembers(id)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch(() => {
        // Roster is a nice to have on top of the conversation itself; a
        // failed fetch here is not surfaced as a screen-level error.
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, thread?.isGroup]);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.id, member.name);
    if (me) map.set(me.id, me.name);
    return map;
  }, [members, me]);

  // Live inbound messages for this thread only, via the caller's own
  // `chat:user:{uid}` private Broadcast channel (CT-4), filtered to this
  // `id` inside subscribeToUserChannel so events for the caller's OTHER
  // threads never touch this screen's state. A message this same client
  // just sent is de-duplicated by id against the optimistic row `handleSend`
  // already reconciled in below, so the echo of your own send never doubles
  // up.
  useEffect(() => {
    if (!me) return;

    const unsubscribe = chat.subscribeToUserChannel(
      me.id,
      id,
      (message) => {
        setMessages((previous) => {
          if (previous.some((existing) => existing.id === message.id)) return previous;
          // Broadcast ships the raw column values, no PostgREST embed, so a
          // group message never arrives with `senderName` already set. We
          // deliberately do NOT freeze a name in here from the roster: if
          // `listThreadMembers` has not resolved yet when this event lands,
          // that lookup is empty and the name would be stored `undefined`
          // forever. The display name is resolved at render time from the
          // live roster Map instead, so it fills in the moment the roster
          // loads (CH-02).
          return [...previous, message];
        });
      },
      (status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeStatus('reconnecting');
        else if (status === 'CLOSED') setRealtimeStatus('disconnected');
      },
    );

    return unsubscribe;
  }, [id, me?.id, subscriptionEpoch]);

  // Manual resync for a Realtime channel that has CLOSED: refetch the
  // thread's messages and resubscribe. Unsent optimistic rows are kept so an
  // in flight send is not wiped by the refetch.
  async function reloadMessages() {
    if (reloading) return;
    setReloading(true);
    setInlineError(null);
    setSubscriptionEpoch((previous) => previous + 1);
    try {
      const fresh = await chat.listMessages(id);
      // Rows that landed while the fetch was in flight (a send that resolved,
      // or a Realtime push) may postdate the snapshot, so keep anything newer
      // than the last fetched row as well as every unsent optimistic row.
      const newestFetched = fresh.length > 0 ? fresh[fresh.length - 1].createdAt : '';
      setMessages((previous) => [
        ...fresh,
        ...previous.filter(
          (existing) =>
            !fresh.some((row) => row.id === existing.id) &&
            (existing.pending || existing.createdAt > newestFetched),
        ),
      ]);
    } catch (err) {
      setInlineError({ error: err as ApiError });
    } finally {
      setReloading(false);
    }
  }

  async function handleSend(afterReconfirm = false) {
    const text = draft.trim();
    if (!text || sending || !me) return;
    // 0138: agree to the content rules once before the first message.
    if (!afterReconfirm && !(await ensureContentTerms())) return;
    setSendError(null);

    const optimisticId = `optimistic:${Date.now()}`;
    const optimisticMessage: DisplayMessage = {
      id: optimisticId,
      threadId: id,
      senderId: me.id,
      senderName: thread?.isGroup ? me.name : undefined,
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
      setSending(false);
      // 0138: the server says the person has not agreed yet (a stale cached
      // profile, or a second device). Reopen the rules sheet and, on agree,
      // send the same message once more.
      if (!afterReconfirm && isContentTermsRequired(err)) {
        if (await reconfirmContentTerms()) await handleSend(true);
        else setSendError('Agree to the content rules to send messages.');
        return;
      }
      setSendError(
        isContentBlocked(err) ? CONTENT_BLOCKED_MESSAGE : 'Could not send that. Check your connection and try again.',
      );
    } finally {
      setSending(false);
    }
  }

  const headerTitle = thread?.isGroup ? thread.groupName ?? 'Group' : thread?.participantName ?? 'Chat';

  // CT-C: report/block a message. Never offered on the caller's own bubble
  // (a message reports/blocks its AUTHOR, not the reader). The sender name
  // resolves from the roster for a group thread or the 1:1 header title.
  function openMessageModeration(message: DisplayMessage) {
    if (!me || message.senderId === me.id || message.pending) return;
    setModerationTarget({
      type: 'chat_message',
      entityId: message.id,
      userId: message.senderId,
      userName: message.senderName ?? memberNameById.get(message.senderId) ?? headerTitle,
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title={headerTitle} onPressBack={() => router.back()} />

      {thread?.isGroup ? (
        <Pressable
          onPress={() => setMembersSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={`${thread.memberCount ?? 0} members, view group members`}
          className="min-h-11 flex-row items-center justify-between px-lg pb-sm active:opacity-70"
        >
          <View className="flex-row items-center gap-xs">
            <Users size={14} strokeWidth={1.75} color={colors.textSecondary} />
            <Text className="font-mono text-xs text-text-secondary">
              {thread.memberCount ?? 0} {thread.memberCount === 1 ? 'member' : 'members'}
            </Text>
          </View>
          <ChevronRight size={16} strokeWidth={1.75} color={colors.textTertiary} />
        </Pressable>
      ) : null}

      {realtimeStatus !== 'connected' && state === 'populated' ? (
        <View className="flex-row items-center gap-xs bg-warning-tint px-lg py-xs">
          <CloudOff size={14} strokeWidth={1.75} color={colors.warning} />
          <Text className="flex-1 font-sans-semibold text-xs text-warning">
            {realtimeStatus === 'reconnecting' ? 'Reconnecting, messages may be delayed' : 'Disconnected. Reload to see new messages.'}
          </Text>
          {realtimeStatus === 'disconnected' ? (
            <Pressable
              onPress={() => void reloadMessages()}
              disabled={reloading}
              accessibilityRole="button"
              accessibilityLabel="Reload messages"
              className="min-h-11 justify-center px-sm active:opacity-70 disabled:opacity-40"
            >
              <Text className="font-sans-semibold text-xs text-warning">{reloading ? 'Reloading' : 'Reload'}</Text>
            </Pressable>
          ) : null}
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
              body={`Send the first message to ${headerTitle}.`}
            />
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => item.id}
              // Re-render rows when the roster resolves so a message that
              // arrived before `listThreadMembers` returned picks up its
              // sender name (CH-02).
              extraData={memberNameById}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => (
                <MessageBubble
                  message={item}
                  isMine={item.senderId === me?.id}
                  showSenderName={Boolean(thread?.isGroup)}
                  senderName={item.senderName ?? memberNameById.get(item.senderId)}
                  onLongPress={() => openMessageModeration(item)}
                />
              )}
            />
          )}

          {inlineError ? (
            <View className="flex-row items-center gap-sm bg-danger-tint px-lg py-xs">
              <TriangleAlert size={14} strokeWidth={1.75} color={colors.danger} />
              <Text className="flex-1 font-sans-semibold text-xs text-danger">
                {`Could not reload messages. ${chatErrorDetail(inlineError.error)}`}
              </Text>
              <Pressable
                onPress={() => void reloadMessages()}
                disabled={reloading}
                accessibilityRole="button"
                accessibilityLabel="Retry reloading messages"
                className="min-h-11 justify-center px-sm active:opacity-70 disabled:opacity-40"
              >
                <Text className="font-sans-semibold text-xs text-danger">Retry</Text>
              </Pressable>
              <Pressable
                onPress={() => setInlineError(null)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                className="min-h-11 min-w-11 items-center justify-center active:opacity-70"
              >
                <X size={16} strokeWidth={1.75} color={colors.danger} />
              </Pressable>
            </View>
          ) : null}

          {/* Pinned composer. It cannot scroll out from under the floating nav,
              so it pads for the bar while the keyboard is down; with the
              keyboard up the bar is behind the keys and the padding would
              only open a gap. */}
          <View
            className="gap-xs border-t border-border bg-bg px-lg py-md"
            style={{ paddingBottom: keyboardShown ? spacing.md : navInset + spacing.md }}
          >
            <View className="flex-row items-end gap-sm">
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
            {sendError ? (
              <Text accessibilityLiveRegion="polite" className="font-sans text-xs text-danger">
                {sendError}
              </Text>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      )}

      {thread?.isGroup ? (
        <GroupMembersSheet
          visible={membersSheetVisible}
          groupName={headerTitle}
          members={members}
          loading={membersLoading}
          onClose={() => setMembersSheetVisible(false)}
        />
      ) : null}

      <ModerationSheet
        visible={moderationTarget !== null}
        target={moderationTarget}
        onClose={() => setModerationTarget(null)}
        onBlocked={() => void load()}
      />
    </SafeAreaView>
  );
}

function MessageBubble({
  message,
  isMine,
  showSenderName,
  senderName,
  onLongPress,
}: {
  message: DisplayMessage;
  isMine: boolean;
  showSenderName: boolean;
  senderName?: string;
  onLongPress: () => void;
}) {
  const colors = useThemeColors();
  const time = new Date(message.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  return (
    <View className={isMine ? 'items-end' : 'items-start'}>
      {showSenderName && senderName ? (
        <Text className="font-sans-semibold text-xs text-text-tertiary" style={{ marginBottom: 2 }}>
          {senderName}
        </Text>
      ) : null}
      <Pressable
        // CT-C: long-press on someone ELSE's bubble opens report/block.
        // Never on the caller's own message (a report/block targets an
        // author, not the reader), enforced again in openMessageModeration.
        onLongPress={isMine ? undefined : onLongPress}
        accessibilityRole={isMine ? undefined : 'button'}
        accessibilityLabel={isMine ? undefined : `Report or block ${senderName ?? 'this message'}`}
        className="max-w-[80%] gap-xs rounded-lg px-md py-sm"
        style={{ backgroundColor: isMine ? colors.accent : colors.surfaceMuted, opacity: message.pending ? 0.6 : 1 }}
      >
        <Text style={{ color: isMine ? colors.inkOnAccent : colors.text }}>{message.text}</Text>
      </Pressable>
      <Text className="font-mono text-xs text-text-tertiary" style={{ marginTop: 2 }}>
        {time}
      </Text>
    </View>
  );
}
