import type {
  AvailabilityWindow,
  CoachStatus,
  Session,
  SessionStatus,
  SessionTypeOption,
  Transaction,
  TransactionKind,
} from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapEdgeFunctionError, mapPostgrestError } from "./errors";

/**
 * Coach-only hooks (Track C, AT-45 through AT-51). Deliberately a separate
 * file from `hooks.ts`'s `useCoaches`/`useSessions` stubs: those two are the
 * shared, still unimplemented athlete-facing discovery/booking domains
 * (Track D), and this file must not race an edit into the same functions.
 * Every call here is scoped to the caller's own coach identity; per
 * docs/phases/PHASE-3-STATUS.md's durable lesson 1 ("permissive-OR RLS is
 * not scoping"), `sessions`/`session_types`/`coach_availability_windows` are
 * all readable by both parties or the public, so every query below carries
 * its own explicit `coach_id = auth.uid()` filter rather than trusting RLS
 * to scope it.
 *
 * State machine actions go through `session_transition` (accept, decline,
 * cancel, reschedule) per API-MAPPING.md "sessions", except `complete`,
 * which per that doc's binding note and PHASE-3-STATUS.md's Track B handoff
 * must call the `complete-session` edge function so the earnings ledger
 * accrual is written; calling the bare RPC directly would silently skip it.
 */

// ---------------------------------------------------------------------------
// shared row shapes and mappers
// ---------------------------------------------------------------------------

interface SessionQueryRow {
  id: string;
  coach_id: string;
  player_id: string;
  session_type_id: string;
  frequency: Session["frequency"];
  date: string;
  slot_start: string;
  slot_end: string;
  focus_area: string | null;
  location: string | null;
  status: SessionStatus;
  price: number;
  platform_fee: number;
  total: number;
  payment_intent_id: string | null;
  rating: number | null;
  remarks: string | null;
  decline_reason: string | null;
  cancellation_reason: string | null;
  players: { name: string } | null;
  session_types: { name: string } | null;
}

/** Page sizes for the coach surfaces.
 *
 * Every read below used to be unbounded. That is not a "slow query" on this
 * project, it is a silent truncation: PostgREST applies a server side row cap
 * to every select (0 of 751 `WITH pgrst_source` statements carry `LIMIT ALL`,
 * 670 carry a parameterised `LIMIT`, docs/qa/verify/SCALE-CLIENT.md), so an
 * unbounded read returns the first N rows with a 200 OK and no signal
 * anywhere. These numbers are chosen below any plausible cap so the cutoff is
 * one this file owns and a reviewer can see.
 *
 * A coach's session history is the one that actually grows without limit: at
 * 5 sessions a day for a year it is 1,250 rows, and `getAnalytics` was reading
 * all of them with a `session_types` embed to compute a monthly chart. */
const COACH_SESSION_PAGE_SIZE = 100;
/** The analytics aggregate reads more rows than a list because it is summing
 * them, not rendering them. Still bounded: the honest fix is a server side
 * aggregate RPC so no session rows cross the wire at all, recorded in
 * SCALE-CLIENT.md P2 and deliberately not attempted here. */
const COACH_ANALYTICS_PAGE_SIZE = 500;
const COACH_TRAINEE_VIDEO_PAGE_SIZE = 50;
/** A coach's own catalog rows. Small in practice and coach-authored, but
 * nothing in the schema stops a coach creating thousands, so they are bounded
 * rather than trusted. */
const SESSION_TYPE_PAGE_SIZE = 100;
const AVAILABILITY_WINDOW_PAGE_SIZE = 100;

const SESSION_SELECT =
  "id, coach_id, player_id, session_type_id, frequency, date, slot_start, slot_end, " +
  "focus_area, location, status, price, platform_fee, total, payment_intent_id, rating, remarks, " +
  "decline_reason, cancellation_reason, " +
  "players:users!sessions_player_id_fkey ( name ), session_types ( name )";

function mapSessionRow(row: SessionQueryRow): Session {
  return {
    id: row.id,
    coachId: row.coach_id,
    playerId: row.player_id,
    sessionTypeId: row.session_type_id,
    frequency: row.frequency,
    date: row.date,
    slot: { from: row.slot_start.slice(0, 5), to: row.slot_end.slice(0, 5) },
    focusArea: row.focus_area ?? "",
    location: row.location ?? "",
    status: row.status,
    price: row.price,
    platformFee: row.platform_fee,
    total: row.total,
    paymentIntentId: row.payment_intent_id ?? undefined,
    rating: row.rating ?? undefined,
    remarks: row.remarks ?? undefined,
    declineReason: row.decline_reason ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
    playerName: row.players?.name,
    sessionTypeName: row.session_types?.name,
  };
}

/** Bare `sessions` row shape `session_transition` returns (no joins). A
 * caller that needs the hydrated player/session type name re-fetches via
 * `getSession` after a transition, same "RPC returns the bare row" pattern
 * `court_booking_transition` already established (hooks.ts). */
interface SessionRpcRow {
  id: string;
  coach_id: string;
  player_id: string;
  session_type_id: string;
  frequency: Session["frequency"];
  date: string;
  slot_start: string;
  slot_end: string;
  focus_area: string | null;
  location: string | null;
  status: SessionStatus;
  price: number;
  platform_fee: number;
  total: number;
  payment_intent_id: string | null;
  rating: number | null;
  remarks: string | null;
  decline_reason: string | null;
  cancellation_reason: string | null;
}

function mapSessionRpcRow(row: SessionRpcRow): Session {
  return {
    id: row.id,
    coachId: row.coach_id,
    playerId: row.player_id,
    sessionTypeId: row.session_type_id,
    frequency: row.frequency,
    date: row.date,
    slot: { from: row.slot_start.slice(0, 5), to: row.slot_end.slice(0, 5) },
    focusArea: row.focus_area ?? "",
    location: row.location ?? "",
    status: row.status,
    price: row.price,
    platformFee: row.platform_fee,
    total: row.total,
    paymentIntentId: row.payment_intent_id ?? undefined,
    rating: row.rating ?? undefined,
    remarks: row.remarks ?? undefined,
    declineReason: row.decline_reason ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
  };
}

async function requireUserId(client: AtlitosClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error) throw mapPostgrestError({ message: error.message });
  if (!data.user) throw mapPostgrestError({ message: "UNAUTHENTICATED: no session" });
  return data.user.id;
}

// ---------------------------------------------------------------------------
// verification status. FR-1, FR-7 to FR-11.
// ---------------------------------------------------------------------------

export interface CoachVerificationStatus {
  coachStatus: CoachStatus | null;
  rejectionReason: string | null;
  requestId: string | null;
  submittedAt: string | null;
}

export function useCoachVerification(client: AtlitosClient) {
  return {
    /** Reads `coach_profiles.status` plus the latest
     * `verification_requests` row (`applicant_type = 'coach'`) for the
     * rejection reason FR-9 requires. `coachStatus: null` means this user
     * has never started the wizard at all (no `coach_profiles` row). */
    async getStatus(): Promise<CoachVerificationStatus> {
      const userId = await requireUserId(client);

      const [{ data: coachRow, error: coachError }, { data: requestRow, error: requestError }] = await Promise.all([
        client.from("coach_profiles").select("status").eq("user_id", userId).maybeSingle(),
        client
          .from("verification_requests")
          .select("id, status, rejection_reason, created_at")
          .eq("applicant_type", "coach")
          .eq("applicant_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (coachError) throw mapPostgrestError(coachError);
      if (requestError) throw mapPostgrestError(requestError);

      return {
        coachStatus: (coachRow?.status as CoachStatus | undefined) ?? null,
        rejectionReason: requestRow?.rejection_reason ?? null,
        requestId: requestRow?.id ?? null,
        submittedAt: requestRow?.created_at ?? null,
      };
    },
  };
}

export type UseCoachVerificationResult = ReturnType<typeof useCoachVerification>;

// ---------------------------------------------------------------------------
// stats dashboard + session requests. FR-12 to FR-19.
// ---------------------------------------------------------------------------

export interface CoachStatsSummary {
  playersCoached: number;
  avgRating: number;
  ratingCount: number;
  /** Completed or rated sessions, all time (Figma "Total Sessions"). */
  totalSessions: number;
  sessionsThisMonth: number;
  earningsThisMonth: number;
  /** `get_coach_wallet_balance().lifetime_earned`, the same figure the
   * Earnings screen labels lifetime, so the two cannot drift (Figma
   * "Total Earnings"). */
  lifetimeEarnings: number;
}

function startOfCurrentMonthISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function useCoachSessions(client: AtlitosClient) {
  return {
    /** FR-12: sessions in `requested`, soonest first, explicitly scoped to
     * `coach_id = auth.uid()` (RLS here is a ceiling, not a filter, see the
     * file header). */
    async listRequests(): Promise<Session[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("coach_id", userId)
        .eq("status", "requested")
        .order("date", { ascending: true })
        .order("slot_start", { ascending: true })
        .limit(COACH_SESSION_PAGE_SIZE)
        .returns<SessionQueryRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapSessionRow);
    },

    /** Upcoming: `accepted`, `in_progress` or `rescheduled` (FR-19's
     * "rescheduled behaves like accepted going forward"), soonest first.
     * 1:1 rows only: group sessions (0076, NULL player_id) are also
     * `accepted` on insert and would otherwise leak into this 1:1 shaped
     * read; the groups domain reads them through
     * `useGroups.groupSessions`.
     *
     * `in_progress` (0077) has to be here now that the coach can actually
     * reach that state from `session/[id].tsx`: the session the coach just
     * started is the one they are standing in, and it would otherwise fall
     * off their own dashboard the moment they tapped Start, leaving no
     * route back to the screen that completes it. */
    async listUpcoming(): Promise<Session[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("coach_id", userId)
        .not("player_id", "is", null)
        .in("status", ["accepted", "in_progress", "rescheduled"])
        .order("date", { ascending: true })
        .order("slot_start", { ascending: true })
        .limit(COACH_SESSION_PAGE_SIZE)
        .returns<SessionQueryRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapSessionRow);
    },

    /** Stats dashboard tiles (PRD-02 3.3). `playersCoached` is the distinct
     * trainee count derived from `sessions`, not `coach_profiles
     * .players_coached_count`: that column has no writer anywhere in the
     * schema yet (0001_identity.sql's own comment calls it "a future ratings
     * pipeline" field), so it would always read 0. `avgRating`/`ratingCount`
     * do come from `coach_profiles` (`rate_session` keeps those columns
     * correct, per API-MAPPING.md). `earningsThisMonth` reuses
     * `get_coach_wallet_balance()`'s `this_month`, the same figure the
     * Earnings screen shows, so the two numbers cannot drift apart. */
    async getStats(): Promise<CoachStatsSummary> {
      const userId = await requireUserId(client);

      const [{ data: coachRow, error: coachError }, { data: sessionRows, error: sessionError }, { data: walletRow, error: walletError }] =
        await Promise.all([
          client.from("coach_profiles").select("rating, rating_count").eq("user_id", userId).maybeSingle(),
          client
            .from("sessions")
            .select("player_id, date, status")
            .eq("coach_id", userId)
            .not("status", "in", "(declined,cancelled)")
            .limit(COACH_ANALYTICS_PAGE_SIZE),
          client.rpc("get_coach_wallet_balance"),
        ]);

      if (coachError) throw mapPostgrestError(coachError);
      if (sessionError) throw mapPostgrestError(sessionError);
      if (walletError) throw mapPostgrestError(walletError);

      // 0076: group session rows live in the same table with a NULL
      // player_id, so they count toward session totals but never toward the
      // distinct trainee count.
      const rows = (sessionRows ?? []) as { player_id: string | null; date: string; status: SessionStatus }[];
      const playersCoached = new Set(rows.map((row) => row.player_id).filter((id): id is string => id !== null)).size;
      const monthStart = startOfCurrentMonthISO();
      const held = rows.filter((row) => row.status === "completed" || row.status === "rated");
      const sessionsThisMonth = held.filter((row) => row.date >= monthStart).length;

      const wallet = (walletRow as { this_month: number; lifetime_earned: number }[] | null)?.[0];

      return {
        playersCoached,
        avgRating: coachRow?.rating ?? 0,
        ratingCount: coachRow?.rating_count ?? 0,
        totalSessions: held.length,
        sessionsThisMonth,
        earningsThisMonth: wallet?.this_month ?? 0,
        lifetimeEarnings: wallet?.lifetime_earned ?? 0,
      };
    },

    /** Session detail (FR-13 to FR-19). Scoped to the caller's own session
     * as coach; returns null rather than someone else's session leaking
     * through the permissive-OR policy. */
    async getSession(sessionId: string): Promise<Session | null> {
      const userId = await requireUserId(client);
      // 1:1 rows only, same reasoning as listUpcoming: a group session id
      // must return null here (its detail lives on the group session
      // screen), never a Session with a runtime null playerId.
      const { data, error } = await client
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("id", sessionId)
        .eq("coach_id", userId)
        .not("player_id", "is", null)
        .maybeSingle<SessionQueryRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;
      return mapSessionRow(data);
    },

    /** FR-13. `requested` to `accepted`, coach only. */
    async acceptSession(sessionId: string): Promise<Session> {
      const { data, error } = await client.rpc("session_transition", {
        p_session_id: sessionId,
        p_action: "accept",
      });
      if (error) throw mapPostgrestError(error);
      return mapSessionRpcRow(data as unknown as SessionRpcRow);
    },

    /** 0077. `accepted` to `in_progress`, coach only, NO time gate by
     * design (0077 decision 1: the product trusts the coach on when their
     * own session begins). Moves no money: the 1:1 earnings accrual is
     * still written by `complete-session` alone, and `completeSession`
     * below is unchanged, so starting a session cannot skip it. Refused
     * from every state but `accepted`, so a cancelled or completed session
     * can never be revived through this door. */
    async startSession(sessionId: string): Promise<Session> {
      const { data, error } = await client.rpc("session_transition", {
        p_session_id: sessionId,
        p_action: "start",
      });
      if (error) throw mapPostgrestError(error);
      return mapSessionRpcRow(data as unknown as SessionRpcRow);
    },

    /** FR-14, FR-35 (CO-04). MUST call `decline-session-refund`, never
     * `session_transition(id, 'decline')` directly: declining an already
     * captured request carries an automatic full refund, and only the edge
     * function writes it. As of 0085 the bare RPC refuses `decline` with
     * `USE_EDGE_FUNCTION` rather than declining without ever refunding the
     * athlete. Same shape as `completeSession` and `cancelSession`
     * (`requested`): the money half lives in the edge function. */
    async declineSession(sessionId: string, reason?: string): Promise<Session> {
      const { data, error } = await client.functions.invoke("decline-session-refund", {
        body: { session_id: sessionId, reason: reason ?? undefined },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as { session_id: string; status: SessionStatus };
      const updated = await client
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("id", body.session_id)
        .maybeSingle<SessionQueryRow>();
      if (updated.error) throw mapPostgrestError(updated.error);
      if (!updated.data) {
        throw mapPostgrestError({ message: "NOT_FOUND: declined session could not be reloaded" });
      }
      return mapSessionRow(updated.data);
    },

    /** FR-16. `accepted` to `cancelled`; reason is required
     * (`REASON_REQUIRED`) and the RPC rejects a cancel once the session has
     * already started (`SESSION_STARTED`). */
    async cancelSession(sessionId: string, reason: string): Promise<Session> {
      const { data, error } = await client.rpc("session_transition", {
        p_session_id: sessionId,
        p_action: "cancel",
        p_reason: reason,
      });
      if (error) throw mapPostgrestError(error);
      return mapSessionRpcRow(data as unknown as SessionRpcRow);
    },

    /** FR-17. Reschedule inserts a NEW session row in `accepted` and
     * tombstones the original to `rescheduled` (API-MAPPING.md "sessions",
     * two behaviours section); the RETURNED row's id is the one to navigate
     * to, never the id this call was made with. `SLOT_TAKEN` on conflict. */
    async rescheduleSession(sessionId: string, newDate: string, newSlotStart: string): Promise<Session> {
      const { data, error } = await client.rpc("session_transition", {
        p_session_id: sessionId,
        p_action: "reschedule",
        p_new_date: newDate,
        p_new_slot_start: newSlotStart,
      });
      if (error) throw mapPostgrestError(error);
      return mapSessionRpcRow(data as unknown as SessionRpcRow);
    },

    /** FR-15, FR-25. MUST call `complete-session`, never
     * `session_transition(id, 'complete')` directly: only the edge function
     * writes the earnings ledger accrual (PHASE-3-STATUS.md Track B handoff
     * note 1, binding on this track). Server enforced `TOO_EARLY` if the
     * scheduled end time has not passed. */
    async completeSession(sessionId: string): Promise<Session> {
      const { data, error } = await client.functions.invoke("complete-session", {
        body: { session_id: sessionId },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as { session_id: string; status: SessionStatus };
      const updated = await client
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("id", body.session_id)
        .maybeSingle<SessionQueryRow>();
      if (updated.error) throw mapPostgrestError(updated.error);
      if (!updated.data) {
        throw mapPostgrestError({ message: "NOT_FOUND: completed session could not be reloaded" });
      }
      return mapSessionRow(updated.data);
    },

    /** Reschedule slot picker feed (FR-17, FR-22). No
     * `get_coach_available_slots` RPC exists (0020_coach_busy_slots.sql's
     * header comment: "the client composes the bookable list from windows
     * minus these pairs"), so this composes it here: the coach's own
     * `coach_availability_windows` for the target date's weekday, stepped by
     * the session type's duration, minus whatever `get_coach_busy_slots`
     * reports occupied. Read only, the RPC re-checks the unique index
     * authoritatively at reschedule time regardless of what this returns. */
    async getRescheduleSlotOptions(
      coachId: string,
      sessionTypeId: string,
      date: string,
    ): Promise<{ from: string; to: string }[]> {
      const dayOfWeek = new Date(`${date}T00:00:00`).getDay();

      const [{ data: windowRows, error: windowError }, { data: typeRow, error: typeError }, { data: busyRows, error: busyError }] =
        await Promise.all([
          client
            .from("coach_availability_windows")
            .select("start_time, end_time")
            .eq("coach_id", coachId)
            .eq("day_of_week", dayOfWeek)
            .limit(AVAILABILITY_WINDOW_PAGE_SIZE),
          client.from("session_types").select("duration_minutes").eq("id", sessionTypeId).maybeSingle(),
          client.rpc("get_coach_busy_slots", { p_coach_id: coachId, p_from: date, p_to: date }),
        ]);

      if (windowError) throw mapPostgrestError(windowError);
      if (typeError) throw mapPostgrestError(typeError);
      if (busyError) throw mapPostgrestError(busyError);

      const durationMinutes = (typeRow as { duration_minutes: number } | null)?.duration_minutes ?? 60;
      const busyStarts = new Set(
        ((busyRows ?? []) as { date: string; slot_start: string }[]).map((row) => row.slot_start.slice(0, 5)),
      );

      const slots: { from: string; to: string }[] = [];
      for (const window of (windowRows ?? []) as { start_time: string; end_time: string }[]) {
        // Defaults satisfy noUncheckedIndexedAccess; a malformed time string
        // yields a zero-length window that the loop below simply skips.
        const [startH = 0, startM = 0] = window.start_time.slice(0, 5).split(":").map(Number);
        const [endH = 0, endM = 0] = window.end_time.slice(0, 5).split(":").map(Number);
        let cursor = startH * 60 + startM;
        const end = endH * 60 + endM;

        while (cursor + durationMinutes <= end) {
          const from = `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
          const toMinutes = cursor + durationMinutes;
          const to = `${String(Math.floor(toMinutes / 60)).padStart(2, "0")}:${String(toMinutes % 60).padStart(2, "0")}`;
          if (!busyStarts.has(from)) slots.push({ from, to });
          cursor += durationMinutes;
        }
      }

      return slots;
    },
  };
}

export type UseCoachSessionsResult = ReturnType<typeof useCoachSessions>;

// ---------------------------------------------------------------------------
// trainees / roster. FR-20, FR-21.
// ---------------------------------------------------------------------------

export interface TraineeSummary {
  playerId: string;
  name: string;
  avatarUrl: string | null;
  sessionCount: number;
  lastSessionDate: string;
  hasUpcoming: boolean;
  /** At least one session whose session type reads as online
   * (`session_types.name` contains "online", the gap doc's chosen
   * representation); feeds the Trainees Online filter chip. */
  hasOnline: boolean;
  /** At least one session with a non online session type; feeds the
   * 1 on 1 filter chip (a trainee can be both). */
  hasInPerson: boolean;
}

/**
 * ONLINE SESSION TYPES ARE A NAMING CONVENTION, DELIBERATELY.
 *
 * `session_types` has no `is_online` column and the product has no video
 * call concept at all: no room provisioning, no join link, no provider.
 * Adding a boolean today would be a schema field with nothing behind it,
 * and every consumer would still have to fall back to the name for the rows
 * written before it existed. So the convention stands, and it is now
 * explicit on both ends rather than incidental:
 *
 *   read  side: `isOnlineSessionTypeName` (here, the single reader).
 *   write side: `applyOnlineSessionTypeName` (here, the single writer),
 *               called by the coach session types editor so the mode the
 *               coach picks is what the name encodes, always.
 *
 * When a real online session ships (link, provider, join screen), add
 * `session_types.is_online`, backfill it from this same predicate, and
 * delete both functions together. Until then, do not read the name for
 * online-ness anywhere except through `isOnlineSessionTypeName`.
 */
export function isOnlineSessionTypeName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().includes("online");
}

/** Write side of the convention above: returns the name a session type must
 * carry to read as `isOnline`. Idempotent, and never rewrites a name the
 * coach already worded themselves. */
export function applyOnlineSessionTypeName(name: string, isOnline: boolean): string {
  const trimmed = name.trim();
  if (isOnline) {
    return isOnlineSessionTypeName(trimmed) ? trimmed : `Online ${trimmed}`;
  }
  if (!isOnlineSessionTypeName(trimmed)) return trimmed;
  return trimmed.replace(/online/gi, "").replace(/\s+/g, " ").trim();
}

export function useCoachTrainees(client: AtlitosClient) {
  return {
    /** FR-20: every athlete with at least one session against this coach,
     * any status, deduplicated. */
    async listTrainees(): Promise<TraineeSummary[]> {
      const userId = await requireUserId(client);
      // `.not("player_id", "is", null)`: group session rows (0076) share
      // this table with a NULL player_id and must never surface as a
      // phantom trainee.
      const { data, error } = await client
        .from("sessions")
        .select("player_id, date, status, users!sessions_player_id_fkey ( name, avatar_url ), session_types ( name )")
        .eq("coach_id", userId)
        .not("player_id", "is", null)
        .order("date", { ascending: false })
        .limit(COACH_ANALYTICS_PAGE_SIZE);
      if (error) throw mapPostgrestError(error);

      const rows = (data ?? []) as {
        player_id: string;
        date: string;
        status: SessionStatus;
        users: { name: string; avatar_url: string | null } | null;
        session_types: { name: string } | null;
      }[];

      const byPlayer = new Map<string, TraineeSummary>();
      for (const row of rows) {
        const existing = byPlayer.get(row.player_id);
        // Same list as listUpcoming, `in_progress` included: a trainee whose
        // session is running right now is the most active trainee there is,
        // and must not read as "No upcoming" on the Trainees tab.
        const hasUpcoming =
          row.status === "accepted" || row.status === "in_progress" || row.status === "rescheduled";
        const online = isOnlineSessionTypeName(row.session_types?.name);
        if (!existing) {
          byPlayer.set(row.player_id, {
            playerId: row.player_id,
            name: row.users?.name ?? "Athlete",
            avatarUrl: row.users?.avatar_url ?? null,
            sessionCount: 1,
            lastSessionDate: row.date,
            hasUpcoming,
            hasOnline: online,
            hasInPerson: !online,
          });
        } else {
          existing.sessionCount += 1;
          existing.hasUpcoming = existing.hasUpcoming || hasUpcoming;
          existing.hasOnline = existing.hasOnline || online;
          existing.hasInPerson = existing.hasInPerson || !online;
        }
      }
      return Array.from(byPlayer.values());
    },

    /** FR-21: full session history with one athlete, newest first. */
    async getTraineeSessions(playerId: string): Promise<Session[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("coach_id", userId)
        .eq("player_id", playerId)
        .order("date", { ascending: false })
        .order("slot_start", { ascending: false })
        .limit(COACH_SESSION_PAGE_SIZE)
        .returns<SessionQueryRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapSessionRow);
    },
  };
}

export type UseCoachTraineesResult = ReturnType<typeof useCoachTrainees>;

// ---------------------------------------------------------------------------
// trainee video review (Track F). Player Profile "Video Analytics" tab,
// design node 1047:16588, docs/design/COACH-TRAININGS-GAP.md gap #8/#18.
// Table `coach_trainee_videos` (0082) stores only a PATH into the private
// `clips` bucket; playback is always a fresh short lived signed URL from the
// get-coach-trainee-video-url edge function, mirroring Clutch's clip-access
// pattern, never a stored/cached URL.
// ---------------------------------------------------------------------------

export interface CoachTraineeVideo {
  id: string;
  coachId: string;
  playerId: string;
  caption: string | null;
  createdAt: string;
}

export interface CoachTraineeVideoUploadTicket {
  videoId: string;
  uploadUrl: string;
  token: string;
  path: string;
  bucket: string;
}

export interface CoachTraineeVideoPlayback {
  videoId: string;
  url: string;
  expiresIn: number;
}

interface CoachTraineeVideoRow {
  id: string;
  coach_id: string;
  player_id: string;
  caption: string | null;
  created_at: string;
}

const COACH_TRAINEE_VIDEO_SELECT = "id, coach_id, player_id, caption, created_at";

function mapCoachTraineeVideoRow(row: CoachTraineeVideoRow): CoachTraineeVideo {
  return {
    id: row.id,
    coachId: row.coach_id,
    playerId: row.player_id,
    caption: row.caption,
    createdAt: row.created_at,
  };
}

/** Coach side: upload, list, and delete review videos for one trainee.
 * Every read below carries an explicit `coach_id = auth.uid()` filter
 * (never left to RLS alone, RLS.md's "not scoping" rule), even though the
 * table's own owner-scoped policy already enforces it. */
export function useCoachTraineeVideos(client: AtlitosClient) {
  return {
    /** All of this coach's review videos for one trainee, newest first. */
    async listForTrainee(playerId: string): Promise<CoachTraineeVideo[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_trainee_videos")
        .select(COACH_TRAINEE_VIDEO_SELECT)
        .eq("coach_id", userId)
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(COACH_TRAINEE_VIDEO_PAGE_SIZE)
        .returns<CoachTraineeVideoRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapCoachTraineeVideoRow);
    },

    /** Step 1: coach-trainee-video-upload-url edge function. Verifies the
     * player is actually this coach's trainee, creates the row, and mints a
     * signed upload URL for the private clips bucket. The client then PUTs
     * the video file to `uploadUrl` (or `uploadToSignedUrl(path, token,
     * file)`); the row is never written from the client directly. */
    async requestUploadUrl(playerId: string, caption?: string): Promise<CoachTraineeVideoUploadTicket> {
      const { data, error } = await client.functions.invoke("coach-trainee-video-upload-url", {
        body: { player_id: playerId, caption },
      });
      if (error) throw await mapEdgeFunctionError(error);
      return data as CoachTraineeVideoUploadTicket;
    },

    /** get-coach-trainee-video-url edge function. Short lived (300s) signed
     * playback URL; call fresh per view, never store or hardcode it. */
    async getPlaybackUrl(videoId: string): Promise<CoachTraineeVideoPlayback> {
      const { data, error } = await client.functions.invoke("get-coach-trainee-video-url", {
        body: { video_id: videoId },
      });
      if (error) throw await mapEdgeFunctionError(error);
      return data as CoachTraineeVideoPlayback;
    },

    /** Own-row delete, explicit coach_id filter on top of the table's owner
     * policy. */
    async deleteVideo(videoId: string): Promise<void> {
      const userId = await requireUserId(client);
      const { error } = await client
        .from("coach_trainee_videos")
        .delete()
        .eq("id", videoId)
        .eq("coach_id", userId);
      if (error) throw mapPostgrestError(error);
    },
  };
}

export type UseCoachTraineeVideosResult = ReturnType<typeof useCoachTraineeVideos>;

/** Athlete side: read only list of a trainee's own review videos, reachable
 * from their profile (least invasive spot per the Track F brief; there is no
 * existing athlete "trainings" detail screen to hang a tab off of). */
export function useMyTraineeVideos(client: AtlitosClient) {
  return {
    async list(): Promise<CoachTraineeVideo[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_trainee_videos")
        .select(COACH_TRAINEE_VIDEO_SELECT)
        .eq("player_id", userId)
        .order("created_at", { ascending: false })
        .limit(COACH_TRAINEE_VIDEO_PAGE_SIZE)
        .returns<CoachTraineeVideoRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapCoachTraineeVideoRow);
    },

    async getPlaybackUrl(videoId: string): Promise<CoachTraineeVideoPlayback> {
      const { data, error } = await client.functions.invoke("get-coach-trainee-video-url", {
        body: { video_id: videoId },
      });
      if (error) throw await mapEdgeFunctionError(error);
      return data as CoachTraineeVideoPlayback;
    },
  };
}

export type UseMyTraineeVideosResult = ReturnType<typeof useMyTraineeVideos>;

// ---------------------------------------------------------------------------
// session types and pricing. PRD-02 FR-4.
// ---------------------------------------------------------------------------

interface SessionTypeRow {
  id: string;
  coach_id: string;
  name: string;
  duration_minutes: number;
  price: number;
  active: boolean;
}

function mapSessionTypeRow(row: SessionTypeRow): SessionTypeOption {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    price: row.price,
    active: row.active,
  };
}

const SESSION_TYPE_SELECT = "id, coach_id, name, duration_minutes, price, active";

/**
 * FR-4. A coach with zero `session_types` rows is unbookable, full stop:
 * `sessions.session_type_id` is NOT NULL (0018_coaching.sql) and the athlete
 * booking screen only ever lists `active` types, so this is the first thing
 * a verified coach has to own.
 *
 * These are plain table writes, not RPCs, and that is correct under the
 * financial invariant: `session_types.price` is a LIST price, not a money
 * row and not a status field. Nothing here debits, credits, or transitions
 * anything. The real charge is computed and re-validated server side at
 * booking time (`PRICE_MISMATCH`), so a coach editing their own list price
 * is the same trust level as a coach editing `training_groups.monthly_fee`,
 * which 0080's own header note makes explicitly.
 *
 * The write path is `session_types_write_own` (0019_coaching_rls.sql:67):
 * `has_role('coach') and coach_id = auth.uid()`, insert/update/delete in one
 * policy pair. Every query below still carries its own `coach_id` filter;
 * RLS is a floor, not scoping.
 *
 * Deliberately NO delete. A session type is deactivated, never removed:
 * historical `sessions` rows point at it by FK and their detail screens read
 * the name back. `deactivate` is the destructive-looking action a coach gets.
 */
export function useCoachSessionTypes(client: AtlitosClient) {
  return {
    /** Every one of this coach's session types, active first, then by name. */
    async listMyTypes(): Promise<SessionTypeOption[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("session_types")
        .select(SESSION_TYPE_SELECT)
        .eq("coach_id", userId)
        .order("active", { ascending: false })
        .order("name", { ascending: true })
        .limit(SESSION_TYPE_PAGE_SIZE)
        .returns<SessionTypeRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapSessionTypeRow);
    },

    /** `coach_id` is set from the caller's own session, never from an
     * argument: a client-supplied coach id here would be an ownership hole
     * even with the policy's `with check` catching it. */
    async createType(input: {
      name: string;
      durationMinutes: number;
      price: number;
      isOnline?: boolean;
    }): Promise<SessionTypeOption> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("session_types")
        .insert({
          coach_id: userId,
          name: applyOnlineSessionTypeName(input.name, input.isOnline ?? false),
          duration_minutes: input.durationMinutes,
          price: input.price,
          active: true,
        })
        .select(SESSION_TYPE_SELECT)
        .single<SessionTypeRow>();
      if (error) throw mapPostgrestError(error);
      return mapSessionTypeRow(data);
    },

    /** Omitted fields stay unchanged. Editing the price of a type never
     * touches an already booked session: `sessions` stores its own price,
     * platform_fee and total at booking time (0018), so this is forward
     * looking only, the same way availability edits are (FR-23). */
    async updateType(input: {
      typeId: string;
      name?: string;
      durationMinutes?: number;
      price?: number;
      active?: boolean;
      isOnline?: boolean;
    }): Promise<SessionTypeOption> {
      const userId = await requireUserId(client);
      const patch: {
        name?: string;
        duration_minutes?: number;
        price?: number;
        active?: boolean;
      } = {};
      if (input.name !== undefined) {
        patch.name =
          input.isOnline === undefined
            ? input.name.trim()
            : applyOnlineSessionTypeName(input.name, input.isOnline);
      }
      if (input.durationMinutes !== undefined) patch.duration_minutes = input.durationMinutes;
      if (input.price !== undefined) patch.price = input.price;
      if (input.active !== undefined) patch.active = input.active;

      const { data, error } = await client
        .from("session_types")
        .update(patch)
        .eq("id", input.typeId)
        .eq("coach_id", userId)
        .select(SESSION_TYPE_SELECT)
        .single<SessionTypeRow>();
      if (error) throw mapPostgrestError(error);
      return mapSessionTypeRow(data);
    },

    /** Hide a type from athletes without breaking the sessions that already
     * reference it. Existing accepted sessions are untouched. */
    async setTypeActive(typeId: string, active: boolean): Promise<SessionTypeOption> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("session_types")
        .update({ active })
        .eq("id", typeId)
        .eq("coach_id", userId)
        .select(SESSION_TYPE_SELECT)
        .single<SessionTypeRow>();
      if (error) throw mapPostgrestError(error);
      return mapSessionTypeRow(data);
    },
  };
}

export type UseCoachSessionTypesResult = ReturnType<typeof useCoachSessionTypes>;

// ---------------------------------------------------------------------------
// availability windows. FR-22, FR-23.
// ---------------------------------------------------------------------------

interface AvailabilityWindowRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
}

export interface AvailabilityWindowItem extends AvailabilityWindow {
  id: string;
}

function mapAvailabilityRow(row: AvailabilityWindowRow): AvailabilityWindowItem {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    from: row.start_time.slice(0, 5),
    to: row.end_time.slice(0, 5),
    effectiveFrom: row.effective_from,
  };
}

export function useCoachAvailability(client: AtlitosClient) {
  return {
    async listWindows(): Promise<AvailabilityWindowItem[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_availability_windows")
        .select("id, day_of_week, start_time, end_time, effective_from")
        .eq("coach_id", userId)
        .order("day_of_week", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(AVAILABILITY_WINDOW_PAGE_SIZE)
        .returns<AvailabilityWindowRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapAvailabilityRow);
    },

    /** FR-23: edits take effect for future slot generation only (the slot
     * engine is a read time computation, per 0018_coaching.sql's header note
     * 2) and never retroactively touch an already `accepted` session, which
     * this never writes to. The database's own overlap exclusion constraint
     * (`coach_availability_windows_no_overlap`) is the authoritative FR-5
     * guard; a `23P01` here means an overlapping window on the same day. */
    async createWindow(input: { dayOfWeek: number; from: string; to: string }): Promise<AvailabilityWindowItem> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_availability_windows")
        .insert({ coach_id: userId, day_of_week: input.dayOfWeek, start_time: input.from, end_time: input.to })
        .select("id, day_of_week, start_time, end_time, effective_from")
        .single<AvailabilityWindowRow>();
      if (error) {
        if (error.code === "23P01") {
          throw mapPostgrestError({ message: "VALIDATION: This window overlaps another window on the same day." });
        }
        throw mapPostgrestError(error);
      }
      return mapAvailabilityRow(data);
    },

    async deleteWindow(windowId: string): Promise<void> {
      const userId = await requireUserId(client);
      const { error } = await client
        .from("coach_availability_windows")
        .delete()
        .eq("id", windowId)
        .eq("coach_id", userId);
      if (error) throw mapPostgrestError(error);
    },
  };
}

export type UseCoachAvailabilityResult = ReturnType<typeof useCoachAvailability>;

// ---------------------------------------------------------------------------
// earnings, payouts, transfers. FR-25 to FR-29.
// ---------------------------------------------------------------------------

export interface CoachWalletBalance {
  balance: number;
  lifetimeEarned: number;
  lifetimeTransferred: number;
  thisMonth: number;
}

export interface PayoutAccountState {
  status: "not_started" | "pending" | "active" | "needs_attention" | "failed";
  payoutAccountId: string | null;
}

export interface TransferResult {
  transferId: string;
  status: string;
  amount: number;
}

// Keyed by the exact payment domain union rather than `string`, so indexing
// it returns TransactionKind and not TransactionKind | undefined.
const TRANSACTION_KIND_MAP: Record<
  "session" | "court" | "commerce" | "donation" | "payout",
  TransactionKind
> = {
  session: "session",
  court: "court",
  commerce: "commerce",
  donation: "donation",
  payout: "payout",
};

export function useCoachEarnings(client: AtlitosClient) {
  return {
    /** FR-26: balance/pending/this month are always derived from
     * `ledger_entries` server side (`get_coach_wallet_balance`), never a
     * denormalized column the client could drift from. `NOT_COACH` (403)
     * surfaces distinctly from "a coach with zero earnings", per that
     * function's own doc comment. */
    async getWalletBalance(): Promise<CoachWalletBalance> {
      const { data, error } = await client.rpc("get_coach_wallet_balance");
      if (error) throw mapPostgrestError(error);
      const row = (data as { balance: number; lifetime_earned: number; lifetime_transferred: number; this_month: number }[])[0];
      return {
        balance: row?.balance ?? 0,
        lifetimeEarned: row?.lifetime_earned ?? 0,
        lifetimeTransferred: row?.lifetime_transferred ?? 0,
        thisMonth: row?.this_month ?? 0,
      };
    },

    /** `get_my_transactions`. `kind` here is `charge|earning|payout` and
     * `direction` is `in|out` from the caller's own point of view
     * (API-MAPPING.md "coachWallet"), remapped onto the shared `Transaction`
     * domain type's `kind: TransactionKind`/`direction: debit|credit` shape
     * so `TransactionRow` renders it unchanged. `p_kind` filters match
     * either a `kind` or a `payment_domain` value; omit for everything. */
    async listTransactions(kind?: string, limit = 50, offset = 0): Promise<Transaction[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client.rpc("get_my_transactions", {
        p_kind: kind ?? undefined,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw mapPostgrestError(error);

      const rows = (data ?? []) as {
        id: string;
        kind: "charge" | "earning" | "payout";
        domain: "session" | "court" | "commerce" | "donation";
        entity_id: string;
        amount: number;
        direction: "in" | "out";
        status: string;
        description: string;
        occurred_at: string;
      }[];

      return rows.map((row) => ({
        id: row.id,
        userId,
        kind: row.kind === "payout" ? "payout" : TRANSACTION_KIND_MAP[row.domain],
        label: row.description,
        amount: row.amount,
        direction: row.direction === "in" ? "credit" : "debit",
        createdAt: row.occurred_at,
        refId: row.entity_id,
      }));
    },

    /** FR-27. `payout_accounts` has no client insert/update grant at all
     * (razorpay-route-onboard's header comment); absence of a row means
     * `not_started`, never a client-side guess at status. */
    async getPayoutAccountStatus(): Promise<PayoutAccountState> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("payout_accounts")
        .select("id, status")
        .eq("owner_type", "coach")
        .eq("owner_id", userId)
        .maybeSingle();
      if (error) throw mapPostgrestError(error);
      if (!data) return { status: "not_started", payoutAccountId: null };
      return { status: data.status as PayoutAccountState["status"], payoutAccountId: data.id };
    },

    /** Starts (or polls) Route KYC hand-off. Idempotent on `(owner_type,
     * owner_id)` per API-MAPPING.md, safe to call again on return from the
     * hosted flow to pick up a status change. Surfaces `503
     * ROUTE_UNAVAILABLE` honestly when Route is not yet enabled on the test
     * merchant account (PHASE-3-STATUS.md "What the founder must do"); the
     * caller must render that as a real blocker, never a fake success. */
    async setupPayoutAccount(): Promise<{ status: PayoutAccountState["status"]; onboardingUrl: string | null }> {
      const { data, error } = await client.functions.invoke("razorpay-route-onboard", {
        body: { owner_type: "coach" },
      });
      if (error) throw await mapEdgeFunctionError(error);
      const body = data as { status: PayoutAccountState["status"]; onboarding_url: string | null };
      return { status: body.status, onboardingUrl: body.onboarding_url ?? null };
    },

    /** FR-28, FR-29. `razorpay-route-transfer` (AT-43, Track B) creates the
     * Route transfer and writes `transfers` plus a balancing debit
     * `ledger_entries` group atomically; the server re-checks the amount
     * against `get_coach_wallet_balance()` itself, this call never trusts a
     * client-side max. No ledger row is written on any failure path
     * (insufficient balance at the moment of check, account not active,
     * Route API error), per FR-29. */
    async initiateTransfer(amount: number): Promise<TransferResult> {
      const { data, error } = await client.functions.invoke("razorpay-route-transfer", {
        body: { amount },
      });
      if (error) throw await mapEdgeFunctionError(error);
      const body = data as { transfer_id: string; status: string; amount: number };
      return { transferId: body.transfer_id, status: body.status, amount: body.amount };
    },
  };
}

export type UseCoachEarningsResult = ReturnType<typeof useCoachEarnings>;

// ---------------------------------------------------------------------------
// analytics. FR-32, FR-33.
// ---------------------------------------------------------------------------

export interface CoachAnalyticsMonth {
  month: string; // "2026-07"
  sessions: number;
  hours: number;
  earnings: number;
  avgRating: number | null;
}

export interface CoachAnalytics {
  totalCompleted: number;
  months: CoachAnalyticsMonth[];
}

const INSUFFICIENT_DATA_THRESHOLD = 3;

export function useCoachAnalytics(client: AtlitosClient) {
  return {
    /** FR-32: computed entirely from existing `sessions` (completed/rated),
     * joined to `session_types` for duration, plus `get_my_transactions`
     * (`kind='earning'`) for the earnings trend, no new tracked metric. FR-33:
     * fewer than 3 completed sessions total returns `totalCompleted` below
     * the threshold, so the screen renders the insufficient data state
     * instead of a one or two point chart. */
    async getAnalytics(): Promise<CoachAnalytics> {
      const userId = await requireUserId(client);

      const [{ data: sessionRows, error: sessionError }, { data: earningRows, error: earningError }] = await Promise.all([
        client
          .from("sessions")
          .select("date, rating, session_types ( duration_minutes )")
          .eq("coach_id", userId)
          .in("status", ["completed", "rated"])
          .limit(COACH_ANALYTICS_PAGE_SIZE),
        client.rpc("get_my_transactions", { p_kind: "earning", p_limit: 200, p_offset: 0 }),
      ]);

      if (sessionError) throw mapPostgrestError(sessionError);
      if (earningError) throw mapPostgrestError(earningError);

      const sessions = (sessionRows ?? []) as {
        date: string;
        rating: number | null;
        session_types: { duration_minutes: number } | null;
      }[];
      const earnings = (earningRows ?? []) as { amount: number; occurred_at: string }[];

      const monthMap = new Map<string, CoachAnalyticsMonth>();
      function bucket(month: string): CoachAnalyticsMonth {
        let entry = monthMap.get(month);
        if (!entry) {
          entry = { month, sessions: 0, hours: 0, earnings: 0, avgRating: null };
          monthMap.set(month, entry);
        }
        return entry;
      }

      const ratingSums = new Map<string, { sum: number; count: number }>();
      for (const session of sessions) {
        const month = session.date.slice(0, 7);
        const entry = bucket(month);
        entry.sessions += 1;
        entry.hours += (session.session_types?.duration_minutes ?? 0) / 60;
        if (session.rating != null) {
          const agg = ratingSums.get(month) ?? { sum: 0, count: 0 };
          agg.sum += session.rating;
          agg.count += 1;
          ratingSums.set(month, agg);
        }
      }
      for (const earning of earnings) {
        const month = earning.occurred_at.slice(0, 7);
        bucket(month).earnings += earning.amount;
      }
      for (const [month, agg] of ratingSums) {
        bucket(month).avgRating = agg.sum / agg.count;
      }

      const months = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

      return { totalCompleted: sessions.length, months };
    },

    insufficientDataThreshold: INSUFFICIENT_DATA_THRESHOLD,
  };
}

export type UseCoachAnalyticsResult = ReturnType<typeof useCoachAnalytics>;
