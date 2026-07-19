import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChatMessage, ChatThread } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";

/**
 * chat. AT-55, PRD-01 FR-58/FR-59/FR-60, PRD-02 FR-30/FR-31.
 *
 * PostgREST reads/inserts against chat_threads/chat_messages (RLS-scoped to
 * the caller's own threads, 0022_chat.sql) + RPC (`session_links_pair` backs
 * the thread INSERT policy server side, so `openCoachingThread` never has to
 * be trusted; `session_exists_between` backs this hook's own `canMessage`
 * check) + Realtime (chat_messages is in the supabase_realtime publication,
 * RLS gates delivery per subscriber, see 0022_chat.sql's header comment for
 * the exact subscription shape this hook implements below).
 *
 * `ChatThread.unreadCount` always resolves to 0 here: the chat schema has no
 * read-receipt column yet (no `read_at` on either table), so there is
 * nothing to hydrate it from. The field stays on the domain type for a
 * future phase to fill in; this hook does not invent a client-side guess for
 * it.
 */

interface ChatThreadRow {
  id: string;
  participant_a: string;
  participant_b: string;
  last_message_at: string | null;
  created_at: string;
  participant_a_profile: { id: string; name: string; avatar_url: string | null } | null;
  participant_b_profile: { id: string; name: string; avatar_url: string | null } | null;
}

interface ChatMessageRow {
  id: string;
  thread_id: string;
  sender_id: string;
  text: string;
  created_at: string;
}

// `users` is embedded twice (participant_a and participant_b both reference
// it), so PostgREST needs the column-name hint to disambiguate which FK each
// embed follows; `chat_threads_participant_a_fkey`/`_b_fkey`
// (database.types.ts) are the underlying constraint names, the column hint
// is the more readable, equally valid way to select between them.
const THREAD_SELECT =
  "id, participant_a, participant_b, last_message_at, created_at, " +
  "participant_a_profile:users!participant_a ( id, name, avatar_url ), " +
  "participant_b_profile:users!participant_b ( id, name, avatar_url )";

const MESSAGE_SELECT = "id, thread_id, sender_id, text, created_at";

function otherParticipant(row: ChatThreadRow, meId: string) {
  return row.participant_a === meId ? row.participant_b_profile : row.participant_a_profile;
}

function mapThreadRow(row: ChatThreadRow, meId: string, lastMessage: string): ChatThread {
  const other = otherParticipant(row, meId);
  return {
    id: row.id,
    participantId: other?.id ?? "",
    participantName: other?.name ?? "Atlitos user",
    participantAvatarUrl: other?.avatar_url ?? undefined,
    lastMessage,
    lastMessageAt: row.last_message_at ?? row.created_at,
    unreadCount: 0,
  };
}

function mapMessageRow(row: ChatMessageRow): ChatMessage {
  return { id: row.id, threadId: row.thread_id, senderId: row.sender_id, text: row.text, createdAt: row.created_at };
}

export function useChat(client: AtlitosClient) {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) throw mapPostgrestError(error);
    if (!data.user) throw mapPostgrestError({ message: "UNAUTHENTICATED: No signed in user." });
    return data.user.id;
  }

  return {
    /** Thread list, most recent message first (PRD-02 FR-31).
     * `last_message_at` is trigger-maintained (0022_chat.sql), so ordering
     * by it needs no client-side re-sort of a bare `created_at`. The latest
     * message preview per thread is a second, batched query: chat_threads
     * has no denormalized preview column, and a per-thread round trip does
     * not scale, so this fetches every candidate message for the visible
     * threads once and keeps the first (most recent) row per thread_id. */
    async listThreads(): Promise<ChatThread[]> {
      const meId = await currentUserId();

      const { data, error } = await client
        .from("chat_threads")
        .select(THREAD_SELECT)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .returns<ChatThreadRow[]>();
      if (error) throw mapPostgrestError(error);

      const rows = data ?? [];
      if (rows.length === 0) return [];

      const { data: recentMessages, error: msgError } = await client
        .from("chat_messages")
        .select("thread_id, text, created_at")
        .in(
          "thread_id",
          rows.map((row) => row.id),
        )
        .order("created_at", { ascending: false });
      if (msgError) throw mapPostgrestError(msgError);

      const previewByThread = new Map<string, string>();
      for (const message of recentMessages ?? []) {
        if (!previewByThread.has(message.thread_id)) previewByThread.set(message.thread_id, message.text);
      }

      return rows.map((row) => mapThreadRow(row, meId, previewByThread.get(row.id) ?? ""));
    },

    /** One thread's header info (the other participant), for the thread
     * screen's AppBar. Returns null if the thread does not exist or the
     * caller is not a participant, the two cases RLS makes
     * indistinguishable (same `maybeSingle` shape as `getBooking`/
     * `getCourt` elsewhere in this package). */
    async getThread(threadId: string): Promise<ChatThread | null> {
      const meId = await currentUserId();
      const { data, error } = await client
        .from("chat_threads")
        .select(THREAD_SELECT)
        .eq("id", threadId)
        .maybeSingle<ChatThreadRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;

      return mapThreadRow(data, meId, "");
    },

    /** Full message history for one thread, oldest first. RLS
     * (`chat_messages_select_participant`) already scopes this to threads
     * the caller participates in. */
    async listMessages(threadId: string): Promise<ChatMessage[]> {
      const { data, error } = await client
        .from("chat_messages")
        .select(MESSAGE_SELECT)
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .returns<ChatMessageRow[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? []).map(mapMessageRow);
    },

    /** Sends one message. The thread screen does the optimistic append
     * before awaiting this (AT-32/AT-59: instant Realtime push has never
     * actually been proven, so the sender must see their own message
     * immediately rather than wait for the round trip), then reconciles the
     * optimistic row with the id this returns; see the thread screen for
     * the matching `reconcile` step and the de-dup against the later
     * Realtime INSERT event for this same row. */
    async sendMessage(threadId: string, text: string): Promise<ChatMessage> {
      const meId = await currentUserId();
      const trimmed = text.trim();
      const { data, error } = await client
        .from("chat_messages")
        .insert({ thread_id: threadId, sender_id: meId, text: trimmed })
        .select(MESSAGE_SELECT)
        .single<ChatMessageRow>();
      if (error) throw mapPostgrestError(error);

      return mapMessageRow(data);
    },

    /** PRD-02 FR-30 / PRD-01 FR-58 gate: has a session ever existed between
     * the caller and `otherUserId`, in any status. Callers in the coach and
     * session screens (owned by other tracks, not this file) use this to
     * decide whether a Message affordance should render at all; it never
     * renders UI itself. */
    async canMessage(otherUserId: string): Promise<boolean> {
      const meId = await currentUserId();
      const { data, error } = await client.rpc("session_exists_between", {
        p_user_a: meId,
        p_user_b: otherUserId,
      });
      if (error) throw mapPostgrestError(error);
      return Boolean(data);
    },

    /** Gets the existing coaching thread between the caller and
     * `otherUserId` for `sessionId`, or creates it. The
     * `chat_threads_insert_participant` policy (0022_chat.sql) re-checks
     * `session_links_pair` server side on every insert regardless of what
     * `canMessage` already told the UI, so this never trusts a prior client
     * read as the real gate. Participants are sorted here to satisfy the
     * table's `participant_a < participant_b` canonical-order check; the
     * `unique (participant_a, participant_b, context_type, context_id)`
     * constraint is what makes calling this twice for the same pair/session
     * safe, the second call just finds the row the first one created. */
    async openCoachingThread(otherUserId: string, sessionId: string): Promise<string> {
      const meId = await currentUserId();
      const participantA = meId < otherUserId ? meId : otherUserId;
      const participantB = meId < otherUserId ? otherUserId : meId;

      const { data: existing, error: existingError } = await client
        .from("chat_threads")
        .select("id")
        .eq("participant_a", participantA)
        .eq("participant_b", participantB)
        .eq("context_type", "coaching")
        .eq("context_id", sessionId)
        .maybeSingle();
      if (existingError) throw mapPostgrestError(existingError);
      if (existing) return existing.id;

      const { data: created, error: createError } = await client
        .from("chat_threads")
        .insert({
          participant_a: participantA,
          participant_b: participantB,
          context_type: "coaching",
          context_id: sessionId,
        })
        .select("id")
        .single();
      if (createError) throw mapPostgrestError(createError);
      return created.id;
    },

    /** Subscribes to every new message in one thread (thread screen). RLS
     * (`chat_messages_select_participant`) is what Realtime evaluates per
     * subscriber before delivering a row (0022_chat.sql header); the
     * `thread_id=eq.` filter here is only about volume, not authorization.
     * The caller unsubscribes on unmount via the returned channel's own
     * `.unsubscribe()` in a cleanup effect. */
    subscribeToThread(
      threadId: string,
      onInsert: (message: ChatMessage) => void,
      onStatusChange?: (status: string) => void,
    ): RealtimeChannel {
      return client
        .channel(`chat:${threadId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
          (payload) => onInsert(mapMessageRow(payload.new as ChatMessageRow)),
        )
        .subscribe((status) => onStatusChange?.(status));
    },

    /** Subscribes to every new message across every thread the caller is
     * in (thread list screen, PRD-02 FR-31's "the thread list updates live
     * too"). No `filter`: RLS already scopes the unfiltered stream to this
     * user's own threads (0022_chat.sql header: "an unfiltered subscription
     * is safe here and is the intended shape"). The caller uses each
     * event's `threadId` to bump that row's preview and re-sort, rather
     * than refetching the whole list. */
    subscribeToInbox(
      onInsert: (message: ChatMessage) => void,
      onStatusChange?: (status: string) => void,
    ): RealtimeChannel {
      return client
        .channel("chat:inbox")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages" },
          (payload) => onInsert(mapMessageRow(payload.new as ChatMessageRow)),
        )
        .subscribe((status) => onStatusChange?.(status));
    },
  };
}

export type UseChatResult = ReturnType<typeof useChat>;
