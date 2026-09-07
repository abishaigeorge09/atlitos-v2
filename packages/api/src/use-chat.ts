import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChatMessage, ChatThread, ChatThreadMember } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";

/**
 * chat. AT-55, PRD-01 FR-58/FR-59/FR-60, PRD-02 FR-30/FR-31, group threads
 * AT-?? (COACH-TRAININGS-GAP.md screen 17, 0078_group_chat_and_notes.sql).
 *
 * PostgREST reads/inserts against chat_threads/chat_messages (RLS-scoped to
 * the caller's own threads, 0022_chat.sql, extended to group threads via
 * chat_thread_members + is_chat_thread_member in 0078) + RPC
 * (`session_links_pair` backs the thread INSERT policy server side, so
 * `openCoachingThread` never has to be trusted; `session_exists_between`
 * backs this hook's own `canMessage` check) + Realtime (chat_messages is in
 * the supabase_realtime publication, RLS gates delivery per subscriber, see
 * 0022_chat.sql's header comment for the exact subscription shape this hook
 * implements below; 0078 only extends the SELECT policy Realtime evaluates,
 * the subscription shape itself is unchanged for group threads).
 *
 * A group thread has no row in chat_thread_members for a lapsed member
 * (0078's sync trigger unseats them the instant a membership lapses), so
 * `is_chat_thread_member` and every query below already resolve group
 * membership as "currently seated", never "has ever joined".
 *
 * `ChatThread.unreadCount` always resolves to 0 here: the chat schema has no
 * read-receipt column yet (no `read_at` on either table), so there is
 * nothing to hydrate it from. The field stays on the domain type for a
 * future phase to fill in; this hook does not invent a client-side guess for
 * it.
 */

interface ChatThreadRow {
  id: string;
  participant_a: string | null;
  participant_b: string | null;
  context_type: string;
  context_id: string;
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
  sender_profile: { id: string; name: string } | null;
}

interface GroupInfo {
  name: string;
  memberCount: number;
}

interface MessagePreview {
  text: string;
  senderName?: string;
}

// `users` is embedded twice (participant_a and participant_b both reference
// it), so PostgREST needs the column-name hint to disambiguate which FK each
// embed follows; `chat_threads_participant_a_fkey`/`_b_fkey`
// (database.types.ts) are the underlying constraint names, the column hint
// is the more readable, equally valid way to select between them.
const THREAD_SELECT =
  "id, participant_a, participant_b, context_type, context_id, last_message_at, created_at, " +
  "participant_a_profile:users!participant_a ( id, name, avatar_url ), " +
  "participant_b_profile:users!participant_b ( id, name, avatar_url )";

// The sender embed resolves a name for every message row (group and 1:1
// alike); only group threads actually render it (mapMessageRow always
// carries it, the thread screen decides whether to show it, per the 1:1
// "stays as-is" requirement).
const MESSAGE_SELECT =
  "id, thread_id, sender_id, text, created_at, sender_profile:users!sender_id ( id, name )";

function otherParticipant(row: ChatThreadRow, meId: string) {
  return row.participant_a === meId ? row.participant_b_profile : row.participant_a_profile;
}

function mapThreadRow(
  row: ChatThreadRow,
  meId: string,
  preview: MessagePreview,
  groupInfo?: GroupInfo,
): ChatThread {
  if (row.context_type === "group") {
    // BUG-11. `groupInfo` is absent whenever `training_groups` is unreadable
    // for this caller, which happens for every thread whose group the caller
    // is a chat member of but not a MEMBER of (RLS on training_groups scopes
    // to membership). Observed live: 10 group threads, 1 readable name.
    //
    // The old fallback was the bare word "Group", so those threads were all
    // titled identically and could not be told apart in the list. "Group chat"
    // at least reads as a description rather than a name; the row already
    // renders a member count underneath.
    //
    // The ROOT CAUSE is server side: a chat member arguably should be able to
    // read the name of the group whose thread they are in. Fixing that means
    // widening a SELECT policy on training_groups, which is a security change
    // and not something to do unilaterally for a cosmetic label. Raised as a
    // separate decision rather than smuggled in here.
    return {
      id: row.id,
      participantId: "",
      participantName: groupInfo?.name ?? "Group chat",
      participantAvatarUrl: undefined,
      lastMessage: preview.text,
      lastMessageAt: row.last_message_at ?? row.created_at,
      unreadCount: 0,
      isGroup: true,
      groupName: groupInfo?.name ?? "Group chat",
      memberCount: groupInfo?.memberCount ?? 0,
      lastSenderName: preview.senderName,
    };
  }

  const other = otherParticipant(row, meId);
  return {
    id: row.id,
    participantId: other?.id ?? "",
    participantName: other?.name ?? "Atlitos user",
    participantAvatarUrl: other?.avatar_url ?? undefined,
    lastMessage: preview.text,
    lastMessageAt: row.last_message_at ?? row.created_at,
    unreadCount: 0,
    isGroup: false,
  };
}

function mapMessageRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    senderName: row.sender_profile?.name,
    text: row.text,
    createdAt: row.created_at,
  };
}

/** Group name + live seat count for every group row in `rows`, batched into
 * two queries regardless of how many group threads are visible. training_
 * groups is a permissive-OR table (public browse of active groups, RLS.md);
 * this scopes to the exact context_ids the caller's own threads named, never
 * an unscoped browse. chat_thread_members has no such public policy (0078:
 * member-only select), so that half needs no extra scoping beyond RLS. */
async function fetchGroupInfo(
  client: AtlitosClient,
  rows: ChatThreadRow[],
): Promise<Map<string, GroupInfo>> {
  const groupRows = rows.filter((row) => row.context_type === "group");
  const result = new Map<string, GroupInfo>();
  if (groupRows.length === 0) return result;

  const groupIds = groupRows.map((row) => row.context_id);
  const { data: groups, error: groupsError } = await client
    .from("training_groups")
    .select("id, name")
    .in("id", groupIds)
    .returns<{ id: string; name: string }[]>();
  if (groupsError) throw mapPostgrestError(groupsError);
  const nameByGroupId = new Map((groups ?? []).map((g) => [g.id, g.name]));

  const threadIds = groupRows.map((row) => row.id);
  const { data: members, error: membersError } = await client
    .from("chat_thread_members")
    .select("thread_id")
    .in("thread_id", threadIds)
    .returns<{ thread_id: string }[]>();
  if (membersError) throw mapPostgrestError(membersError);

  const countByThreadId = new Map<string, number>();
  for (const member of members ?? []) {
    countByThreadId.set(member.thread_id, (countByThreadId.get(member.thread_id) ?? 0) + 1);
  }

  for (const row of groupRows) {
    result.set(row.id, {
      name: nameByGroupId.get(row.context_id) ?? "Group",
      memberCount: countByThreadId.get(row.id) ?? 0,
    });
  }
  return result;
}

/** One row of `chat_thread_previews` (0094). Declared here because the RPC is
 * not in the generated `Database` type on this branch, the same escape hatch
 * hooks.ts documents in its TYPING NOTE. */
interface ThreadPreviewRow {
  thread_id: string;
  text: string;
  created_at: string;
  sender_name: string | null;
}

export function useChat(client: AtlitosClient) {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) throw mapPostgrestError(error);
    if (!data.user) throw mapPostgrestError({ message: "UNAUTHENTICATED: No signed in user." });
    return data.user.id;
  }

  // Memoized on [client] for a STABLE identity across renders (BUG-001).
  // `currentUserId` above closes over `client` only, and the memo recomputes
  // whenever `client` changes, so the captured helper is always the current one.
  return useMemo(() => ({
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

      const [{ data: recentMessages, error: msgError }, groupInfoByThread] = await Promise.all([
        // SCALING (0094). This used to select EVERY message in EVERY thread and
        // keep the first per thread client side, which is O(total messages) on
        // every open of the chat list. The RPC does `distinct on (thread_id)`
        // against the existing (thread_id, created_at) index and returns one
        // row per thread.
        (client as unknown as SupabaseClient).rpc("chat_thread_previews", {
          p_thread_ids: rows.map((row) => row.id),
        }),
        fetchGroupInfo(client, rows),
      ]);
      if (msgError) throw mapPostgrestError(msgError);

      // The RPC already returns exactly one row per thread, so this is a
      // straight index rather than the previous first-wins fold.
      const previewByThread = new Map<string, MessagePreview>();
      for (const message of (recentMessages ?? []) as ThreadPreviewRow[]) {
        previewByThread.set(message.thread_id, {
          text: message.text,
          senderName: message.sender_name ?? undefined,
        });
      }

      return rows.map((row) =>
        mapThreadRow(
          row,
          meId,
          previewByThread.get(row.id) ?? { text: "" },
          groupInfoByThread.get(row.id),
        ),
      );
    },

    /** One thread's header info (the group name + member count, or the
     * other 1:1 participant), for the thread screen's AppBar. Returns null
     * if the thread does not exist or the caller is not a participant, the
     * two cases RLS makes indistinguishable (same `maybeSingle` shape as
     * `getBooking`/`getCourt` elsewhere in this package). */
    async getThread(threadId: string): Promise<ChatThread | null> {
      const meId = await currentUserId();
      const { data, error } = await client
        .from("chat_threads")
        .select(THREAD_SELECT)
        .eq("id", threadId)
        .maybeSingle<ChatThreadRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;

      const groupInfoByThread = await fetchGroupInfo(client, [data]);
      return mapThreadRow(data, meId, { text: "" }, groupInfoByThread.get(data.id));
    },

    /** Full message history for one thread, oldest first. RLS
     * (`chat_messages_select_participant`, extended to
     * `chat_messages_select_group_member` for group threads in 0078)
     * already scopes this to threads the caller participates in. */
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

    /** A group thread's seated roster (chat_thread_members joined to
     * users), for the group conversation screen's members sheet. RLS
     * (`chat_thread_members_select_member`, 0078) already scopes this to
     * threads the caller is seated in; a 1:1 thread has no
     * chat_thread_members rows at all, so this resolves to an empty list
     * for it rather than erroring, which is the correct shape (the caller
     * only invokes this for `thread.isGroup`). Sorted by name for a stable,
     * readable roster. */
    async listThreadMembers(threadId: string): Promise<ChatThreadMember[]> {
      const { data, error } = await client
        .from("chat_thread_members")
        .select("user_id, profile:users!user_id ( id, name, avatar_url )")
        .eq("thread_id", threadId)
        .returns<{ user_id: string; profile: { id: string; name: string; avatar_url: string | null } | null }[]>();
      if (error) throw mapPostgrestError(error);

      return (data ?? [])
        .filter((row): row is typeof row & { profile: NonNullable<(typeof row)["profile"]> } => row.profile !== null)
        .map((row) => ({
          id: row.profile.id,
          name: row.profile.name,
          avatarUrl: row.profile.avatar_url ?? undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
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
     * The caller removes the channel on unmount (removeChannel, not just
     * unsubscribe, so the named channel does not linger on the client). */
    subscribeToThread(
      threadId: string,
      onInsert: (message: ChatMessage) => void,
      onStatusChange?: (status: string) => void,
    ): RealtimeChannel {
      // A channel object survives on the client under its name even after
      // `.unsubscribe()`, and calling `.on("postgres_changes", ...)` on a
      // channel that has already been subscribed once throws ("cannot add
      // postgres_changes callbacks after subscribe()"). Reopening the same
      // thread, or remounting the list, must therefore drop any stale
      // instance before building a fresh one.
      const staleThread = client
        .getChannels()
        .find((channel) => channel.topic === `realtime:chat:${threadId}`);
      if (staleThread) void client.removeChannel(staleThread);
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
      // Same stale channel guard as subscribeToThread above.
      const staleInbox = client
        .getChannels()
        .find((channel) => channel.topic === "realtime:chat:inbox");
      if (staleInbox) void client.removeChannel(staleInbox);
      return client
        .channel("chat:inbox")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages" },
          (payload) => onInsert(mapMessageRow(payload.new as ChatMessageRow)),
        )
        .subscribe((status) => onStatusChange?.(status));
    },
  }), [client]);
}

export type UseChatResult = ReturnType<typeof useChat>;
