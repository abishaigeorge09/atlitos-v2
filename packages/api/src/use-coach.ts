import { useMemo } from "react";
import type {
  AvailabilityWindow,
  CoachStatus,
  Session,
  SessionStatus,
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
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
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
  }), [client]);
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
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
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
        .returns<SessionQueryRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapSessionRow);
    },

    /** Upcoming: `accepted` or `rescheduled` (FR-19's "rescheduled behaves
     * like accepted going forward"), soonest first. 1:1 rows only: group
     * sessions (0076, NULL player_id) are also `accepted` on insert and
     * would otherwise leak into this 1:1 shaped read; the groups domain
     * reads them through `useGroups.groupSessions`. */
    async listUpcoming(): Promise<Session[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("sessions")
        .select(SESSION_SELECT)
        .eq("coach_id", userId)
        .not("player_id", "is", null)
        .in("status", ["accepted", "rescheduled"])
        .order("date", { ascending: true })
        .order("slot_start", { ascending: true })
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
            .not("status", "in", "(declined,cancelled)"),
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
            .eq("day_of_week", dayOfWeek),
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
  }), [client]);
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

/** The gap doc's online representation: a session type whose name contains
 * "online" (no dedicated flag column exists on session_types). */
export function isOnlineSessionTypeName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().includes("online");
}

export function useCoachTrainees(client: AtlitosClient) {
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
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
        .order("date", { ascending: false });
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
        const hasUpcoming = row.status === "accepted" || row.status === "rescheduled";
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
        .returns<SessionQueryRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapSessionRow);
    },
  }), [client]);
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
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
    /** All of this coach's review videos for one trainee, newest first. */
    async listForTrainee(playerId: string): Promise<CoachTraineeVideo[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_trainee_videos")
        .select(COACH_TRAINEE_VIDEO_SELECT)
        .eq("coach_id", userId)
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
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
  }), [client]);
}

export type UseCoachTraineeVideosResult = ReturnType<typeof useCoachTraineeVideos>;

/** Athlete side: read only list of a trainee's own review videos, reachable
 * from their profile (least invasive spot per the Track F brief; there is no
 * existing athlete "trainings" detail screen to hang a tab off of). */
export function useMyTraineeVideos(client: AtlitosClient) {
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
    async list(): Promise<CoachTraineeVideo[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_trainee_videos")
        .select(COACH_TRAINEE_VIDEO_SELECT)
        .eq("player_id", userId)
        .order("created_at", { ascending: false })
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
  }), [client]);
}

export type UseMyTraineeVideosResult = ReturnType<typeof useMyTraineeVideos>;

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
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
    async listWindows(): Promise<AvailabilityWindowItem[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_availability_windows")
        .select("id, day_of_week, start_time, end_time, effective_from")
        .eq("coach_id", userId)
        .order("day_of_week", { ascending: true })
        .order("start_time", { ascending: true })
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
  }), [client]);
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
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
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
  }), [client]);
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
  // Memoized on [client] for a STABLE identity across renders. Without this
  // every render hands consumers a new object, so any effect or callback that
  // honestly lists it as a dependency re-runs forever (BUG-001).
  return useMemo(() => ({
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
          .in("status", ["completed", "rated"]),
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
  }), [client]);
}

export type UseCoachAnalyticsResult = ReturnType<typeof useCoachAnalytics>;
