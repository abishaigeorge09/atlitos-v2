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
 *
 * Phase 3 (P1-2, CT-4): live delivery no longer subscribes to raw row
 * changes on `chat_messages`. That shape made the server re-evaluate RLS for every
 * subscriber on every inserted row, the 1000-concurrent meltdown class
 * (PHASE-3-STATUS.md). Delivery now rides a Postgres trigger's
 * `realtime.send()` to a PRIVATE per-user Broadcast topic,
 * `chat:user:{member_user_id}`, event `message_new`, one send per thread
 * member (sender included) on every insert. `realtime.messages` RLS allows a
 * socket to subscribe only its own `chat:user:{auth.uid()}` topic (Track A);
 * this file never subscribes another user's topic and never widens that.
 * `subscribeToUserChannel` below is the ONE channel per signed-in user the
 * contract calls for; the inbox and thread screens both consume it (thread
 * screen filters by `threadId` client side) rather than each opening its own
 * socket, so a device with the inbox mounted behind an open thread still
 * holds exactly one `chat:user:*` connection.
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

// Names/avatars resolve through `public_profiles`, NOT the `users` base
// table (BUG-016). `users` SELECT is own-row-or-admin (`users_select_merged`,
// 0063), so embedding `users` returns NULL for every participant/sender that
// is not the caller: a non-admin saw "Atlitos user" in a 1:1 header and no
// sender name on group bubbles. `public_profiles` is the definer projection
// (id, name, avatar_url, ...) of every user, readable by `authenticated`
// (0001, RLS.md), so it resolves names cross-user without loosening the
// `users` RLS. The relation is still embedded twice here (participant_a and
// participant_b both FK the same view), so PostgREST needs the column-name
// hint to disambiguate which FK each embed follows; same shape hooks.ts
// already uses for clips (`public_profiles!owner_id`).
const THREAD_SELECT =
  "id, participant_a, participant_b, context_type, context_id, last_message_at, created_at, " +
  "participant_a_profile:public_profiles!participant_a ( id, name, avatar_url ), " +
  "participant_b_profile:public_profiles!participant_b ( id, name, avatar_url )";

// The sender embed resolves a name for every message row (group and 1:1
// alike); only group threads actually render it (mapMessageRow always
// carries it, the thread screen decides whether to show it, per the 1:1
// "stays as-is" requirement). Resolved via `public_profiles` for the same
// cross-user reason as THREAD_SELECT (BUG-016).
const MESSAGE_SELECT =
  "id, thread_id, sender_id, text, created_at, sender_profile:public_profiles!sender_id ( id, name )";

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
    return {
      id: row.id,
      participantId: "",
      participantName: groupInfo?.name ?? "Group",
      participantAvatarUrl: undefined,
      lastMessage: preview.text,
      lastMessageAt: row.last_message_at ?? row.created_at,
      unreadCount: 0,
      isGroup: true,
      groupName: groupInfo?.name ?? "Group",
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

// ---------------------------------------------------------------------------
// CT-4 Broadcast delivery: ONE private channel per signed-in user,
// `chat:user:{userId}`, event `message_new`. Multiple mounted consumers on
// the same device (the inbox behind an open thread) share one underlying
// Realtime channel via this small ref-counted registry instead of each
// opening its own socket, per the contract's "Track D subscribes ONE
// channel" line. Keyed by topic string rather than by client instance:
// the app holds a single Supabase client singleton in practice, and keying
// by topic means a second `useChat(client)` call (a fresh hook instance from
// a re-render) still finds and reuses the same live channel rather than
// opening a duplicate.
// ---------------------------------------------------------------------------

/** Raw payload keys are the trigger's column values as text/ISO strings
 * (CT-4): `thread_id`, `message_id`, `sender_id`, `body`, `created_at`. No
 * `sender_profile` embed rides a Broadcast payload (there is no PostgREST
 * embed over a realtime.send() payload), so a name is never available here;
 * callers resolve it from their own roster/session state, same as the prior
 * raw row-change shape already required (see the thread screen's
 * CH-02 comment). */
interface ChatBroadcastPayload {
  thread_id: string;
  message_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

type ChatBroadcastListener = (message: ChatMessage) => void;
type ChatStatusListener = (status: string) => void;

interface ChatUserChannelEntry {
  channel: RealtimeChannel;
  listeners: Set<ChatBroadcastListener>;
  statusListeners: Set<ChatStatusListener>;
  refCount: number;
  lastStatus: string;
}

const chatUserChannels = new Map<string, ChatUserChannelEntry>();

function mapBroadcastPayload(raw: ChatBroadcastPayload): ChatMessage {
  return {
    id: raw.message_id,
    threadId: raw.thread_id,
    senderId: raw.sender_id,
    senderName: undefined,
    text: raw.body,
    createdAt: raw.created_at,
  };
}

function getOrCreateChatUserChannel(client: AtlitosClient, userId: string): ChatUserChannelEntry {
  const topic = `chat:user:${userId}`;
  const existing = chatUserChannels.get(topic);
  if (existing) return existing;

  const entry: ChatUserChannelEntry = {
    channel: undefined as unknown as RealtimeChannel, // assigned immediately below
    listeners: new Set(),
    statusListeners: new Set(),
    refCount: 0,
    lastStatus: "connecting",
  };

  // `private: true` is required: this topic carries no row-level filter
  // to fall back on, the whole authorization boundary is the
  // `realtime.messages` RLS policy Track A owns (CT-4), which only evaluates
  // for private channels.
  entry.channel = client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "message_new" }, (payload) => {
      const message = mapBroadcastPayload(payload.payload as ChatBroadcastPayload);
      for (const listener of entry.listeners) listener(message);
    })
    .subscribe((status) => {
      entry.lastStatus = status;
      for (const statusListener of entry.statusListeners) statusListener(status);
    });

  chatUserChannels.set(topic, entry);
  return entry;
}

function releaseChatUserChannel(client: AtlitosClient, userId: string) {
  const topic = `chat:user:${userId}`;
  const entry = chatUserChannels.get(topic);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    void client.removeChannel(entry.channel);
    chatUserChannels.delete(topic);
  }
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

      const [{ data: recentMessages, error: msgError }, groupInfoByThread] = await Promise.all([
        client
          .from("chat_messages")
          .select("thread_id, text, created_at, sender_profile:public_profiles!sender_id ( name )")
          .in(
            "thread_id",
            rows.map((row) => row.id),
          )
          .order("created_at", { ascending: false })
          .returns<{ thread_id: string; text: string; created_at: string; sender_profile: { name: string } | null }[]>(),
        fetchGroupInfo(client, rows),
      ]);
      if (msgError) throw mapPostgrestError(msgError);

      const previewByThread = new Map<string, MessagePreview>();
      for (const message of recentMessages ?? []) {
        if (!previewByThread.has(message.thread_id)) {
          previewByThread.set(message.thread_id, {
            text: message.text,
            senderName: message.sender_profile?.name,
          });
        }
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
     * public_profiles for the cross-user name/avatar, BUG-016: the `users`
     * base table is own-row-or-admin so joining it listed only the caller),
     * for the group conversation screen's members sheet. RLS
     * (`chat_thread_members_select_member`, 0078) already scopes this to
     * threads the caller is seated in; a 1:1 thread has no
     * chat_thread_members rows at all, so this resolves to an empty list
     * for it rather than erroring, which is the correct shape (the caller
     * only invokes this for `thread.isGroup`). Sorted by name for a stable,
     * readable roster. */
    async listThreadMembers(threadId: string): Promise<ChatThreadMember[]> {
      const { data, error } = await client
        .from("chat_thread_members")
        .select("user_id, profile:public_profiles!user_id ( id, name, avatar_url )")
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

    /** CT-4: subscribes the caller's ONE private Broadcast channel,
     * `chat:user:{userId}`, event `message_new`. Every new message in every
     * thread the caller is seated in arrives here (the trigger fans out to
     * every member, sender included); the thread screen passes its own
     * `threadId` to filter to just this conversation, the inbox passes none
     * and handles every event to bump whichever row changed. `userId` must
     * be the CALLER's own id (never another member's): `realtime.messages`
     * RLS refuses a subscribe to any other `chat:user:*` topic (Track A),
     * so passing someone else's id here fails the subscribe rather than
     * silently reading their mail, but callers should not rely on the
     * refusal, they should never construct another user's topic in the
     * first place.
     *
     * Multiple call sites for the SAME userId (inbox mounted behind an open
     * thread) share one underlying channel via the ref-counted registry
     * above, satisfying the contract's "ONE channel" line rather than one
     * socket per screen. Returns an unsubscribe function; call it on
     * unmount instead of `client.removeChannel` directly, the shared
     * channel is only actually removed once its last subscriber releases
     * it. */
    subscribeToUserChannel(
      userId: string,
      threadId: string | undefined,
      onMessage: (message: ChatMessage) => void,
      onStatusChange?: (status: string) => void,
    ): () => void {
      const entry = getOrCreateChatUserChannel(client, userId);

      const listener: ChatBroadcastListener = (message) => {
        if (threadId && message.threadId !== threadId) return;
        onMessage(message);
      };
      entry.listeners.add(listener);
      entry.refCount += 1;

      if (onStatusChange) {
        entry.statusListeners.add(onStatusChange);
        // A listener attaching after the channel already connected (the
        // inbox is already subscribed when a thread screen opens) still
        // needs to see the current status immediately, not just the next
        // change.
        onStatusChange(entry.lastStatus);
      }

      return () => {
        entry.listeners.delete(listener);
        if (onStatusChange) entry.statusListeners.delete(onStatusChange);
        releaseChatUserChannel(client, userId);
      };
    },
  };
}

export type UseChatResult = ReturnType<typeof useChat>;
