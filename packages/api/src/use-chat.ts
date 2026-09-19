import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, ChatThread, ChatThreadMember } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";
import { getBlockedUserIds } from "./hooks";

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
 *
 * Phase 4 (CT-C, `0097_report_block.sql`): `listThreads` drops a 1:1 thread
 * whose other participant is on the caller's own `blocked_users` list (own-
 * row RLS cannot subtract rows, so this is an explicit client-layer filter,
 * same shape as the clutch feed/comments filter in `hooks.ts`; one-way, the
 * blocked party's own inbox is unaffected). `listMessages` drops any message
 * from a blocked sender and renders a removed placeholder (never the real
 * text) for a message `resolve_report`'s chat arm has soft-deleted
 * (`removed_at` set). The live Broadcast listener in `subscribeToUserChannel`
 * does NOT re-check either list: a message from a sender blocked mid-session
 * still lands until the next `listMessages`/`listThreads` reload, documented
 * here rather than silently promised and not delivered (the Broadcast
 * payload carries no sender-block context to check against without an extra
 * round trip per inbound message, out of proportion to a launch-week gap
 * that a screen reload already closes).
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
  // CT-C (0097): non-null once an admin/moderator has taken the message down
  // via resolve_report's chat arm. Never surfaced as the real text, see
  // mapMessageRow below.
  removed_at: string | null;
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
  "id, thread_id, sender_id, text, created_at, removed_at, sender_profile:public_profiles!sender_id ( id, name )";

// CT-C (0097): a removed message never surfaces its real text to any client,
// admin preview aside (that goes through admin_get_reported_entity, Track
// C's admin surface, not this file). Copy follows house style: no em-dashes,
// no hyphens.
const REMOVED_MESSAGE_TEXT = "This message was removed.";

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
    // CT-C: a soft-deleted (resolve_report chat arm) row never surfaces its
    // real text; the placeholder renders in its place, same bubble shape.
    text: row.removed_at ? REMOVED_MESSAGE_TEXT : row.text,
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

/** Page sizes for the chat surfaces.
 *
 * These exist because PostgREST applies a SILENT server side row cap to every
 * select on this project (docs/qa/verify/SCALE-CLIENT.md: 0 of 751
 * `WITH pgrst_source` statements carry `LIMIT ALL`, 670 carry a parameterised
 * `LIMIT`). An unbounded read is therefore not slow, it is truncated with a
 * 200 OK and nothing anywhere in the stack says so. Every number below is
 * deliberately well under any plausible cap so that the code, not an unread
 * server setting, decides where a list stops. */
const THREAD_PAGE_SIZE = 100;
/** Newest messages loaded when a thread screen opens.
 *
 * Note the DIRECTION change that goes with this bound. `listMessages` used to
 * read `created_at ASC` with no limit, so under the server cap it returned
 * the OLDEST N messages of a long thread and the recent conversation was
 * unreachable, permanently, with no error (SCALE-CLIENT.md P0-2a). It now
 * reads newest first, bounds to this page size, and reverses in JavaScript so
 * callers still receive oldest-first. Older pages need a `created_at` cursor,
 * which is a screen change and is deliberately NOT done in this pass. */
const MESSAGE_PAGE_SIZE = 50;
const THREAD_MEMBERS_PAGE_SIZE = 200;
/** Candidate messages per thread for the inbox preview fallback path, see
 * `fetchPreviewCandidates`. Three rather than one because the preview skips
 * moderator-removed rows and messages from blocked senders. */
const PREVIEW_CANDIDATES_PER_THREAD = 3;
/** Ceiling on the fallback preview candidate read, see `fetchPreviewCandidates`.
 *
 * p6 audit correction: the previous value here was a bare 500, justified as
 * "comfortably under any plausible cap", an unmeasurable quantity on this
 * project (see BLOCK_LIST_MAX). The call site already computes
 * `Math.min(threadIds.length * PREVIEW_CANDIDATES_PER_THREAD, PREVIEW_FALLBACK_MAX_ROWS)`,
 * and `threadIds` is itself bounded by `THREAD_PAGE_SIZE`, so the true worst
 * case row count this fallback can ever ask for is exactly
 * `THREAD_PAGE_SIZE * PREVIEW_CANDIDATES_PER_THREAD`. Deriving it from those
 * two constants instead of a separate literal means this ceiling can never
 * silently drift out of sync with either of them, and it structurally can
 * never bind (the `Math.min` above is then always the first argument), which
 * is the correct behaviour: this constant exists as a documented worst case,
 * not as an active truncation point. */
const PREVIEW_FALLBACK_MAX_ROWS = THREAD_PAGE_SIZE * PREVIEW_CANDIDATES_PER_THREAD;

/** The one row per thread the inbox needs to render a preview line.
 *
 * Two paths, and which one runs depends on whether `0107` has been applied.
 *
 * PREFERRED: the `chat_thread_previews` RPC, which is a single
 * `distinct on (thread_id) ... order by thread_id, created_at desc` walk of
 * the existing `idx_chat_messages_thread_id (thread_id, created_at)` index.
 * It returns exactly one row per thread, which is the correct shape.
 *
 * FALLBACK: the original `.in(...)` query, now with an explicit bound. This
 * runs whenever the RPC is absent, and it IS absent on production today: the
 * applied migration ceiling on `syzzfgaudpifwvbpycyi` is `0097`, verified
 * against `supabase_migrations.schema_migrations`, while `0107` is the file
 * that defines this function. Writing the client to call an unapplied RPC
 * with no fallback would have broken the Chat tab outright, so it does both.
 *
 * Be precise about what the fallback is and is not. It is a BOUND, not a fix.
 * It orders globally by `created_at desc`, so a thread that has been quiet
 * longer than the newest `limit` messages across all of the caller's threads
 * still renders a blank preview, which is the same truncation shape the
 * unread server cap already produces today. What changes is that the cutoff
 * is now a number this file owns and a reviewer can see. The row count is
 * what actually moves: a 55 thread coach at 300 messages per thread went from
 * 16,500 rows and a measured 4.33 MB (262.3 bytes per row, SCALE-CLIENT.md
 * P0-1) to at most 165 rows and roughly 43 KB, a 100x cut. The remaining
 * blank-preview case only disappears when 0107 is applied. */
/** The NORMALIZED preview candidate both paths return.
 *
 * The two paths do not agree on the wire shape and must not be handed to the
 * caller raw. PostgREST's embedded resource arrives nested as
 * `sender_profile: { name }`, while a `returns table (...)` RPC can only return
 * flat columns, so `chat_thread_previews` yields `sender_name`. Returning the
 * union and letting the consumer read `sender_profile?.name` would have made
 * every sender name silently undefined on the RPC path, which is the kind of
 * defect that only appears after the migration is applied and then looks like
 * a regression in something else. Both paths normalize here instead. */
type PreviewCandidate = {
  threadId: string;
  senderId: string;
  text: string;
  removedAt: string | null;
  senderName: string | undefined;
};

/** The RPC's flat row shape (`0107`). */
type PreviewRpcRow = {
  thread_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  removed_at: string | null;
  sender_name: string | null;
};

/** The fallback's nested PostgREST row shape. */
type PreviewCandidateRow = {
  thread_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  removed_at: string | null;
  sender_profile: { name: string } | null;
};

const PREVIEW_SELECT =
  "thread_id, sender_id, text, created_at, removed_at, sender_profile:public_profiles!sender_id ( name )";

/** True when PostgREST could not find the function in its schema cache, which
 * is exactly the "migration not applied yet" case and nothing else. `PGRST202`
 * is the schema-cache miss; `42883` is Postgres's own undefined_function, kept
 * for the case where the call reaches the database and is refused there. Any
 * other error is a real failure and must not be swallowed into a fallback. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

async function fetchPreviewCandidates(
  client: AtlitosClient,
  threadIds: string[],
): Promise<PreviewCandidate[]> {
  // Widen the schema generic for this one call. `chat_thread_previews` is
  // defined by `0107`, which is not applied, so it is not in the generated
  // `Database` type and the typed `rpc` overload rejects the name. Same escape
  // hatch `use-empower.ts` documents for the empower relations, and it is
  // deliberately scoped to this single call rather than the whole file: the
  // result is immediately re-narrowed to PreviewCandidateRow[], and the
  // fallback below stays on the typed client.
  const { data, error } = await (client as unknown as SupabaseClient).rpc("chat_thread_previews", {
    p_thread_ids: threadIds,
  });
  if (!error) {
    return ((data ?? []) as PreviewRpcRow[]).map((row) => ({
      threadId: row.thread_id,
      senderId: row.sender_id,
      text: row.text,
      removedAt: row.removed_at,
      senderName: row.sender_name ?? undefined,
    }));
  }
  if (!isMissingFunction(error)) throw mapPostgrestError(error);

  const { data: rows, error: rowsError } = await client
    .from("chat_messages")
    .select(PREVIEW_SELECT)
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false })
    .limit(Math.min(threadIds.length * PREVIEW_CANDIDATES_PER_THREAD, PREVIEW_FALLBACK_MAX_ROWS))
    .returns<PreviewCandidateRow[]>();
  if (rowsError) throw mapPostgrestError(rowsError);
  return (rows ?? []).map((row) => ({
    threadId: row.thread_id,
    senderId: row.sender_id,
    text: row.text,
    removedAt: row.removed_at,
    senderName: row.sender_profile?.name,
  }));
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
    // Unbounded and safe: `.in("id", ...)` on a primary key is one row per id,
    // and groupIds comes from the caller's own THREAD_PAGE_SIZE bounded thread
    // page.
    .in("id", groupIds)
    .returns<{ id: string; name: string }[]>();
  if (groupsError) throw mapPostgrestError(groupsError);
  const nameByGroupId = new Map((groups ?? []).map((g) => [g.id, g.name]));

  const threadIds = groupRows.map((row) => row.id);
  // LEFT UNBOUNDED, DELIBERATELY, and it is the weakest read in this file.
  //
  // This is not input-bounded the way the `training_groups` read above is:
  // `.in("thread_id", ...)` on a NON unique column returns one row per SEAT,
  // so the count is (group threads in the page) x (members per group), and
  // `training_groups.capacity` is a coach-set field with no schema ceiling. A
  // coach in 15 large academy groups of 200 pulls 3,000 rows to render 15
  // member counts.
  //
  // It is not bounded because a `.limit()` here would silently produce a WRONG
  // COUNT rather than a short list, and a wrong member count is a defect this
  // project has already chased once (CURRENT-STATE.md, "There is no
  // member-count bug", where a miscount cost a full investigation). A number
  // that is quietly too low is worse than a number that is expensive.
  //
  // The correct fix is a server side aggregate, one row per thread with a
  // count, in the same migration family as `chat_thread_previews`. It is not
  // in `0107` because that file is already carrying three objects and this one
  // needs its own plan check. Recorded rather than half-fixed.
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
     * by it needs no client-side re-sort of a bare `created_at`.
     *
     * The preview per thread comes from `fetchPreviewCandidates`, which reads
     * one row per thread through the `chat_thread_previews` RPC and falls
     * back to a BOUNDED batch read when that function is not applied yet. The
     * docblock here used to reason, correctly, that a per-thread round trip
     * does not scale, and then implement the opposite trade: it fetched EVERY
     * message in EVERY thread the caller belongs to in order to keep one row
     * per thread. Measured, that was 16,500 rows and 4.33 MB for a 55 thread
     * coach to render 55 single line previews, a 300x waste factor
     * (SCALE-CLIENT.md P0-1). Both the round trip count and the payload are
     * bounded now; see `fetchPreviewCandidates` for exactly which half of that
     * depends on 0107 being applied.
     *
     * CT-C (0097): a 1:1 thread whose other participant is on the caller's
     * own `blocked_users` list is dropped from the returned list entirely
     * (own-row RLS cannot subtract rows, explicit client-layer filter, same
     * shape as hooks.ts's clutch feed/comments filter); group threads are
     * never dropped this way (blocking one member of a group does not hide
     * the whole conversation). The preview candidates also exclude a
     * moderator-removed message's real text and any message from a blocked
     * sender, so neither ever leaks into the inbox row even before the
     * thread screen itself is opened. */
    async listThreads(): Promise<ChatThread[]> {
      const meId = await currentUserId();

      const { data, error } = await client
        .from("chat_threads")
        .select(THREAD_SELECT)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(THREAD_PAGE_SIZE)
        .returns<ChatThreadRow[]>();
      if (error) throw mapPostgrestError(error);

      const rows = data ?? [];
      if (rows.length === 0) return [];

      const [recentMessages, groupInfoByThread, blocked] = await Promise.all([
        fetchPreviewCandidates(
          client,
          rows.map((row) => row.id),
        ),
        fetchGroupInfo(client, rows),
        getBlockedUserIds(client),
      ]);

      const previewByThread = new Map<string, MessagePreview>();
      for (const message of recentMessages) {
        if (message.removedAt || blocked.has(message.senderId)) continue;
        if (!previewByThread.has(message.threadId)) {
          previewByThread.set(message.threadId, {
            text: message.text,
            senderName: message.senderName,
          });
        }
      }

      const visibleRows = rows.filter((row) => {
        if (row.context_type === "group") return true;
        const other = otherParticipant(row, meId);
        return !other || !blocked.has(other.id);
      });

      return visibleRows.map((row) =>
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

    /** The most recent `MESSAGE_PAGE_SIZE` messages for one thread, returned
     * oldest first so the caller's render order is unchanged.
     *
     * This was "full message history for one thread, oldest first" with no
     * limit, which is worse than it sounds. Under the silent PostgREST row
     * cap an ascending unbounded read returns the OLDEST N rows, so a long
     * thread opened to messages from months ago with no way to reach today
     * and no error to explain it, and the message the user had just sent
     * vanished on the next open (SCALE-CLIENT.md P0-2a). Reading newest first
     * and reversing puts the truncation at the end the user does not care
     * about. Older pages need a `created_at` cursor and a load-older
     * affordance on the thread screen, which is UI work and is NOT in this
     * change; today a thread longer than the page size simply starts at the
     * 50th most recent message.
     *
     * RLS
     * (`chat_messages_select_participant`, extended to
     * `chat_messages_select_group_member` for group threads in 0078)
     * already scopes this to threads the caller participates in.
     *
     * CT-C (0097): messages from a sender on the caller's own
     * `blocked_users` list are dropped entirely (never rendered, not even as
     * a placeholder, distinct from a moderator-removed row which DOES render
     * a placeholder via mapMessageRow); a message the caller sent themselves
     * is never in that set, block is one-way and `blocker_id <> blocked_id`
     * at the schema level. */
    async listMessages(threadId: string): Promise<ChatMessage[]> {
      const [{ data, error }, blocked] = await Promise.all([
        client
          .from("chat_messages")
          .select(MESSAGE_SELECT)
          .eq("thread_id", threadId)
          .order("created_at", { ascending: false })
          .limit(MESSAGE_PAGE_SIZE)
          .returns<ChatMessageRow[]>(),
        getBlockedUserIds(client),
      ]);
      if (error) throw mapPostgrestError(error);

      return (data ?? [])
        .slice()
        .reverse()
        .filter((row) => !blocked.has(row.sender_id))
        .map(mapMessageRow);
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
        .limit(THREAD_MEMBERS_PAGE_SIZE)
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
