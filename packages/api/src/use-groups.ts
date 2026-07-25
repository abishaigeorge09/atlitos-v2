import type { ApiError, PaymentDomain, SessionStatus, Sport } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapEdgeFunctionError, mapPostgrestError } from "./errors";

/**
 * `@atlitos/api`'s training groups domain (Track A of the Groups phase).
 * Backed by migrations 0076 to 0081 and the join-group /
 * renew-group-membership edge functions. Money model (founder ratified):
 * monthly subscription per group, manual renewal through the same one-time
 * payment rails sessions use, no autopay, no pro-rata refunds, capacity
 * guarded inside the join RPC.
 *
 * FINANCIAL INVARIANT: nothing in this file inserts or updates
 * group_memberships, payment_intents, ledger_entries, or any status field.
 * Joins and renewals go through the edge functions (which re-price server
 * side and refuse a stale client total with PRICE_MISMATCH); activation
 * happens only on the capture path; attendance and session state move only
 * through SECURITY DEFINER RPCs.
 *
 * RLS IS NOT SCOPING (CLAUDE.md): training_groups has a PUBLIC browse
 * policy for active groups of verified coaches, so it is a permissive-OR
 * table exactly like venues. Every read below carries its own explicit
 * owner or entity filter; none relies on RLS to narrow a result.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GroupMembershipStatus = "pending" | "active" | "lapsed";
export type AttendanceStatus = "present" | "absent";

export interface TrainingGroup {
  id: string;
  coachId: string;
  name: string;
  sport: Sport;
  skillLevel?: string;
  capacity: number;
  /** Rupees, same unit as sessions.price. */
  monthlyFee: number;
  attendancePolicy?: string;
  active: boolean;
  createdAt: string;
  /** Hydrated from get_group_member_counts where requested. */
  activeMembers?: number;
}

export interface GroupMembership {
  id: string;
  groupId: string;
  playerId: string;
  status: GroupMembershipStatus;
  periodStart?: string;
  periodEnd?: string;
  price: number;
  platformFee: number;
  total: number;
  paymentIntentId?: string;
  createdAt: string;
  /** Hydrated group, on reads that join it. */
  group?: TrainingGroup;
}

export interface GroupMember {
  playerId: string;
  name: string;
  avatarUrl?: string;
  membership: GroupMembership;
  /** present / (present + absent) across this group's marked participant
   * rows; undefined until at least one session has marked attendance. */
  attendanceRate?: number;
}

export interface GroupDetail {
  group: TrainingGroup;
  members: GroupMember[];
  /** Whole-group attendance rate over every marked participant row. */
  attendanceRate?: number;
}

/** A group session row. player_id/session_type_id are null on group rows
 * (0076), so this is deliberately NOT the 1:1 `Session` shape. */
export interface GroupSession {
  id: string;
  groupId: string;
  coachId: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  focusArea?: string;
  location?: string;
  status: SessionStatus;
}

export interface SessionParticipant {
  sessionId: string;
  playerId: string;
  attendanceStatus?: AttendanceStatus;
  markedAt?: string;
  /** Hydrated from public_profiles. */
  name?: string;
  avatarUrl?: string;
}

export interface TraineeNote {
  id: string;
  coachId: string;
  playerId: string;
  body: string;
  createdAt: string;
}

/** Player Profile Overview tab identity (Figma 1047:13934). Sourced from
 * `public_profiles` only: `users` has no role/batting style/bowling style/
 * skill level/playing frequency/gender columns for players (only
 * `coach_profiles` carries sport specific fields, and only for coaches), so
 * the design's cricket specific attribute rows are not buildable without a
 * schema change and are intentionally not represented here. */
export interface TraineeProfileInfo {
  name: string;
  avatarUrl?: string;
  handle?: string;
  bio?: string;
}

export interface JoinGroupResult {
  membershipId: string;
  groupId: string;
  status: GroupMembershipStatus;
  razorpayOrderId: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  bill: { price: number; platformFee: number; total: number };
}

export interface VerifyMembershipPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyMembershipPaymentResult {
  membershipId: string;
  status: GroupMembershipStatus | string;
  outcome: "captured" | "already_processed";
}

/** One row of a trainee's payments tab. payment_intents is readable only by
 * its owner, so the coach-side payments view derives from the rows the
 * coach CAN read: their own sessions with this player (payment precedes
 * `requested`, so every non-declined, non-cancelled session was paid) and
 * this player's memberships in the coach's groups. */
export interface TraineePaymentEntry {
  id: string;
  kind: Extract<PaymentDomain, "session" | "membership">;
  date: string;
  amount: number;
  status: string;
  label: string;
}

export interface TraineeSessionsSplit {
  upcoming: TraineeSessionEntry[];
  past: TraineeSessionEntry[];
}

export interface TraineeSessionEntry {
  id: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  status: SessionStatus;
  focusArea?: string;
  location?: string;
  total: number;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface GroupRow {
  id: string;
  coach_id: string;
  name: string;
  sport: Sport;
  skill_level: string | null;
  capacity: number;
  monthly_fee: number;
  attendance_policy: string | null;
  active: boolean;
  created_at: string;
}

interface MembershipRow {
  id: string;
  group_id: string;
  player_id: string;
  status: GroupMembershipStatus;
  period_start: string | null;
  period_end: string | null;
  price: number;
  platform_fee: number;
  total: number;
  payment_intent_id: string | null;
  created_at: string;
}

interface GroupSessionRow {
  id: string;
  group_id: string;
  coach_id: string;
  date: string;
  slot_start: string;
  slot_end: string;
  focus_area: string | null;
  location: string | null;
  status: SessionStatus;
}

interface ParticipantRow {
  session_id: string;
  player_id: string;
  attendance_status: AttendanceStatus | null;
  marked_at: string | null;
}

interface PublicProfileRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
}

interface NoteRow {
  id: string;
  coach_id: string;
  player_id: string;
  body: string;
  created_at: string;
}

interface TraineeProfileRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
  handle: string | null;
  bio: string | null;
}

interface TraineeSessionRow {
  id: string;
  date: string;
  slot_start: string;
  slot_end: string;
  status: SessionStatus;
  focus_area: string | null;
  location: string | null;
  price: number;
  total: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapGroup(row: GroupRow, counts?: Map<string, number>): TrainingGroup {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    sport: row.sport,
    skillLevel: row.skill_level ?? undefined,
    capacity: row.capacity,
    monthlyFee: Number(row.monthly_fee),
    attendancePolicy: row.attendance_policy ?? undefined,
    active: row.active,
    createdAt: row.created_at,
    activeMembers: counts?.get(row.id),
  };
}

function mapMembership(row: MembershipRow, group?: TrainingGroup): GroupMembership {
  return {
    id: row.id,
    groupId: row.group_id,
    playerId: row.player_id,
    status: row.status,
    periodStart: row.period_start ?? undefined,
    periodEnd: row.period_end ?? undefined,
    price: Number(row.price),
    platformFee: Number(row.platform_fee),
    total: Number(row.total),
    paymentIntentId: row.payment_intent_id ?? undefined,
    createdAt: row.created_at,
    group,
  };
}

function mapGroupSession(row: GroupSessionRow): GroupSession {
  return {
    id: row.id,
    groupId: row.group_id,
    coachId: row.coach_id,
    date: row.date,
    slotStart: row.slot_start.slice(0, 5),
    slotEnd: row.slot_end.slice(0, 5),
    focusArea: row.focus_area ?? undefined,
    location: row.location ?? undefined,
    status: row.status,
  };
}

async function fetchMemberCounts(
  client: AtlitosClient,
  groupIds: string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const { data, error } = await client.rpc("get_group_member_counts", {
    p_group_ids: groupIds,
  });
  if (error) throw mapPostgrestError(error);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { group_id: string; active_members: number }[]) {
    counts.set(row.group_id, row.active_members);
  }
  return counts;
}

async function fetchProfiles(
  client: AtlitosClient,
  userIds: string[],
): Promise<Map<string, PublicProfileRow>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await client
    .from("public_profiles")
    .select("id, name, avatar_url")
    .in("id", userIds)
    .returns<PublicProfileRow[]>();
  if (error) throw mapPostgrestError(error);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

async function requireUserId(client: AtlitosClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error) throw mapPostgrestError(error);
  if (!data.user) {
    throw { code: "UNAUTHENTICATED", message: "Sign in to continue." } as ApiError;
  }
  return data.user.id;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGroups(client: AtlitosClient) {
  return {
    /** Coach home: my groups, any active state, with live member counts.
     * Explicitly scoped to coach_id = me; the public browse policy would
     * otherwise leak every verified coach's groups into an unscoped read. */
    async listMyGroups(): Promise<TrainingGroup[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("training_groups")
        .select("*")
        .eq("coach_id", userId)
        .order("created_at", { ascending: false })
        .returns<GroupRow[]>();
      if (error) throw mapPostgrestError(error);
      const rows = data ?? [];
      const counts = await fetchMemberCounts(client, rows.map((r) => r.id));
      return rows.map((r) => mapGroup(r, counts));
    },

    /** Athlete discovery: a coach's ACTIVE groups (the coach profile's
     * Groups rail). Anon-safe; the seats-taken count comes from the
     * definer RPC so no membership identity is exposed. */
    async listGroupsForCoach(coachId: string): Promise<TrainingGroup[]> {
      const { data, error } = await client
        .from("training_groups")
        .select("*")
        .eq("coach_id", coachId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .returns<GroupRow[]>();
      if (error) throw mapPostgrestError(error);
      const rows = data ?? [];
      const counts = await fetchMemberCounts(client, rows.map((r) => r.id));
      return rows.map((r) => mapGroup(r, counts));
    },

    /** Group detail. Members resolve through group_memberships joined with
     * public_profiles, and attendance rate is present / (present + absent)
     * across the group's marked participant rows. Membership rows are
     * RLS-visible in full only to the group's coach (and each member sees
     * their own), so the members list is complete on coach screens and
     * self-only on athlete screens, which is the intended exposure. */
    async getGroup(groupId: string): Promise<GroupDetail | null> {
      const { data: groupRow, error: groupError } = await client
        .from("training_groups")
        .select("*")
        .eq("id", groupId)
        .maybeSingle<GroupRow>();
      if (groupError) throw mapPostgrestError(groupError);
      if (!groupRow) return null;

      const counts = await fetchMemberCounts(client, [groupId]);

      const { data: membershipRows, error: membershipError } = await client
        .from("group_memberships")
        .select("*")
        .eq("group_id", groupId)
        .neq("status", "lapsed")
        .order("created_at", { ascending: true })
        .returns<MembershipRow[]>();
      if (membershipError) throw mapPostgrestError(membershipError);
      const memberships = membershipRows ?? [];

      // Attendance: participant rows of this group's sessions. Two scoped
      // reads (session ids for the group, then participants for those ids).
      const { data: sessionRows, error: sessionsError } = await client
        .from("sessions")
        .select("id")
        .eq("group_id", groupId)
        .returns<{ id: string }[]>();
      if (sessionsError) throw mapPostgrestError(sessionsError);
      const sessionIds = (sessionRows ?? []).map((s) => s.id);

      let participants: ParticipantRow[] = [];
      if (sessionIds.length > 0) {
        const { data: participantRows, error: participantsError } = await client
          .from("session_participants")
          .select("*")
          .in("session_id", sessionIds)
          .returns<ParticipantRow[]>();
        if (participantsError) throw mapPostgrestError(participantsError);
        participants = participantRows ?? [];
      }

      const marked = participants.filter((p) => p.attendance_status !== null);
      const rateFor = (rows: ParticipantRow[]): number | undefined => {
        const m = rows.filter((p) => p.attendance_status !== null);
        if (m.length === 0) return undefined;
        return m.filter((p) => p.attendance_status === "present").length / m.length;
      };

      const profiles = await fetchProfiles(client, memberships.map((m) => m.player_id));
      const group = mapGroup(groupRow, counts);

      const members: GroupMember[] = memberships.map((m) => {
        const profile = profiles.get(m.player_id);
        return {
          playerId: m.player_id,
          name: profile?.name ?? "Player",
          avatarUrl: profile?.avatar_url ?? undefined,
          membership: mapMembership(m),
          attendanceRate: rateFor(participants.filter((p) => p.player_id === m.player_id)),
        };
      });

      return {
        group,
        members,
        attendanceRate: marked.length > 0
          ? marked.filter((p) => p.attendance_status === "present").length / marked.length
          : undefined,
      };
    },

    /** Join a group: the join-group edge function creates the pending
     * membership (capacity guarded in the RPC, GROUP_FULL / ALREADY_MEMBER
     * before Razorpay is called), re-prices server side (PRICE_MISMATCH on
     * a stale total), and returns a Razorpay order for the checkout sheet,
     * exactly like bookSession. Activation happens only on capture. */
    async joinGroup(groupId: string, expectedTotal: number): Promise<JoinGroupResult> {
      const { data, error } = await client.functions.invoke("join-group", {
        body: { group_id: groupId, expected_total: expectedTotal },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        membership_id: string;
        group_id: string;
        status: GroupMembershipStatus;
        razorpay_order_id: string;
        key_id: string;
        amount: number;
        currency: string;
        bill: { price: number; platform_fee: number; total: number };
      };
      return {
        membershipId: body.membership_id,
        groupId: body.group_id,
        status: body.status,
        razorpayOrderId: body.razorpay_order_id,
        keyId: body.key_id,
        amountPaise: body.amount,
        currency: body.currency,
        bill: { price: body.bill.price, platformFee: body.bill.platform_fee, total: body.bill.total },
      };
    },

    /** Manual renewal, same rails, same membership row: a new intent and a
     * new order; capture extends period_end by one month from
     * max(period_end, today). */
    async renewMembership(membershipId: string, expectedTotal: number): Promise<JoinGroupResult> {
      const { data, error } = await client.functions.invoke("renew-group-membership", {
        body: { membership_id: membershipId, expected_total: expectedTotal },
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = data as {
        membership_id: string;
        group_id: string;
        status: GroupMembershipStatus;
        razorpay_order_id: string;
        key_id: string;
        amount: number;
        currency: string;
        bill: { price: number; platform_fee: number; total: number };
      };
      return {
        membershipId: body.membership_id,
        groupId: body.group_id,
        status: body.status,
        razorpayOrderId: body.razorpay_order_id,
        keyId: body.key_id,
        amountPaise: body.amount,
        currency: body.currency,
        bill: { price: body.bill.price, platformFee: body.bill.platform_fee, total: body.bill.total },
      };
    },

    /** The shared verify-payment fallback for membership charges, the same
     * function bookSession's flow calls; the finalize gate activates the
     * membership and writes the carve-out ledger group server side. */
    async verifyMembershipPayment(
      input: VerifyMembershipPaymentInput,
    ): Promise<VerifyMembershipPaymentResult> {
      const { data, error } = await client.functions.invoke("verify-payment", {
        body: {
          razorpay_order_id: input.razorpayOrderId,
          razorpay_payment_id: input.razorpayPaymentId,
          razorpay_signature: input.razorpaySignature,
        },
      });
      if (error) throw await mapEdgeFunctionError(error);
      const body = data as {
        membership_id: string | null;
        status: string;
        outcome: "captured" | "already_processed";
      };
      return {
        membershipId: body.membership_id ?? "",
        status: body.status as GroupMembershipStatus,
        outcome: body.outcome,
      };
    },

    /** Athlete side: my memberships across groups, hydrated with their
     * groups. Explicitly player_id = me. */
    async myMemberships(): Promise<GroupMembership[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("group_memberships")
        .select("*")
        .eq("player_id", userId)
        .order("created_at", { ascending: false })
        .returns<MembershipRow[]>();
      if (error) throw mapPostgrestError(error);
      const rows = data ?? [];

      const groupIds = [...new Set(rows.map((r) => r.group_id))];
      let groups = new Map<string, TrainingGroup>();
      if (groupIds.length > 0) {
        const { data: groupRows, error: groupError } = await client
          .from("training_groups")
          .select("*")
          .in("id", groupIds)
          .returns<GroupRow[]>();
        if (groupError) throw mapPostgrestError(groupError);
        groups = new Map((groupRows ?? []).map((g) => [g.id, mapGroup(g)]));
      }
      return rows.map((r) => mapMembership(r, groups.get(r.group_id)));
    },

    /** A group's sessions, newest first. Group-scoped filter; RLS further
     * limits rows to the coach and the session's participants. */
    async groupSessions(groupId: string): Promise<GroupSession[]> {
      const { data, error } = await client
        .from("sessions")
        .select("id, group_id, coach_id, date, slot_start, slot_end, focus_area, location, status")
        .eq("group_id", groupId)
        .order("date", { ascending: false })
        .order("slot_start", { ascending: false })
        .returns<GroupSessionRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapGroupSession);
    },

    /** One group session by id, hydrated with its group. Explicitly scoped
     * to my own coach rows AND group rows only (`group_id` not null):
     * sessions is a permissive-OR table across coach and player policies,
     * and a 1:1 session id passed here must return null, not a
     * half-shaped group session. */
    async getGroupSession(
      sessionId: string,
    ): Promise<{ session: GroupSession; group: TrainingGroup } | null> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("sessions")
        .select(
          "id, group_id, coach_id, date, slot_start, slot_end, focus_area, location, status, " +
            "training_groups ( id, coach_id, name, sport, skill_level, capacity, monthly_fee, attendance_policy, active, created_at )",
        )
        .eq("id", sessionId)
        .eq("coach_id", userId)
        .not("group_id", "is", null)
        .maybeSingle<GroupSessionRow & { training_groups: GroupRow | null }>();
      if (error) throw mapPostgrestError(error);
      if (!data || !data.training_groups) return null;
      return { session: mapGroupSession(data), group: mapGroup(data.training_groups) };
    },

    /** Participants of one group session with profile hydration. The coach
     * sees the full roster; a member sees their own row. */
    async sessionParticipants(sessionId: string): Promise<SessionParticipant[]> {
      const { data, error } = await client
        .from("session_participants")
        .select("*")
        .eq("session_id", sessionId)
        .returns<ParticipantRow[]>();
      if (error) throw mapPostgrestError(error);
      const rows = data ?? [];
      const profiles = await fetchProfiles(client, rows.map((r) => r.player_id));
      return rows.map((r) => ({
        sessionId: r.session_id,
        playerId: r.player_id,
        attendanceStatus: r.attendance_status ?? undefined,
        markedAt: r.marked_at ?? undefined,
        name: profiles.get(r.player_id)?.name ?? undefined,
        avatarUrl: profiles.get(r.player_id)?.avatar_url ?? undefined,
      }));
    },

    /** Coach creates a group (create_training_group RPC, 0080). */
    async createGroup(input: {
      name: string;
      sport: Sport;
      capacity: number;
      monthlyFee: number;
      skillLevel?: string;
      attendancePolicy?: string;
    }): Promise<TrainingGroup> {
      const { data, error } = await client.rpc("create_training_group", {
        p_name: input.name,
        p_sport: input.sport,
        p_capacity: input.capacity,
        p_monthly_fee: input.monthlyFee,
        p_skill_level: input.skillLevel ?? undefined,
        p_attendance_policy: input.attendancePolicy ?? undefined,
      });
      if (error) throw mapPostgrestError(error);
      return mapGroup(data as unknown as GroupRow);
    },

    /** Coach edits a group (update_training_group RPC, 0080). Omitted
     * fields stay unchanged; capacity cannot drop below live members. */
    async updateGroup(input: {
      groupId: string;
      name?: string;
      skillLevel?: string;
      capacity?: number;
      monthlyFee?: number;
      attendancePolicy?: string;
      active?: boolean;
    }): Promise<TrainingGroup> {
      const { data, error } = await client.rpc("update_training_group", {
        p_group_id: input.groupId,
        p_name: input.name ?? undefined,
        p_skill_level: input.skillLevel ?? undefined,
        p_capacity: input.capacity ?? undefined,
        p_monthly_fee: input.monthlyFee ?? undefined,
        p_attendance_policy: input.attendancePolicy ?? undefined,
        p_active: input.active ?? undefined,
      });
      if (error) throw mapPostgrestError(error);
      return mapGroup(data as unknown as GroupRow);
    },

    /** Coach schedules a group session (create_group_session RPC):
     * inserted `accepted`, zero money columns, participants seeded from
     * the active members at scheduling time. SLOT_TAKEN on a clash with
     * any of the coach's other sessions. */
    async createGroupSession(input: {
      groupId: string;
      date: string;
      slotStart: string;
      slotEnd: string;
      focusArea?: string;
      location?: string;
    }): Promise<GroupSession> {
      const { data, error } = await client.rpc("create_group_session", {
        p_group_id: input.groupId,
        p_date: input.date,
        p_slot_start: input.slotStart,
        p_slot_end: input.slotEnd,
        p_focus_area: input.focusArea ?? undefined,
        p_location: input.location ?? undefined,
      });
      if (error) throw mapPostgrestError(error);
      return mapGroupSession(data as unknown as GroupSessionRow);
    },

    /** Start Session: accepted -> in_progress, coach only (0077). */
    async startGroupSession(sessionId: string): Promise<GroupSession> {
      const { data, error } = await client.rpc("session_transition", {
        p_session_id: sessionId,
        p_action: "start",
      });
      if (error) throw mapPostgrestError(error);
      return mapGroupSession(data as unknown as GroupSessionRow);
    },

    /** End Session for a GROUP session: in_progress (or accepted) ->
     * completed through the client door, which 0077 allows only for group
     * rows because they carry no money; a 1:1 session must still complete
     * through the complete-session edge function. */
    async completeGroupSession(sessionId: string): Promise<GroupSession> {
      const { data, error } = await client.rpc("session_transition", {
        p_session_id: sessionId,
        p_action: "complete",
      });
      if (error) throw mapPostgrestError(error);
      return mapGroupSession(data as unknown as GroupSessionRow);
    },

    /** Coach marks attendance while the session is in_progress
     * (INVALID_TRANSITION otherwise); every marked player must be an
     * active member (NOT_A_MEMBER otherwise). No money effect ever. */
    async markAttendance(
      sessionId: string,
      marks: Record<string, AttendanceStatus>,
    ): Promise<SessionParticipant[]> {
      const { data, error } = await client.rpc("mark_attendance", {
        p_session_id: sessionId,
        p_marks: marks,
      });
      if (error) throw mapPostgrestError(error);
      return ((data ?? []) as ParticipantRow[]).map((r) => ({
        sessionId: r.session_id,
        playerId: r.player_id,
        attendanceStatus: r.attendance_status ?? undefined,
        markedAt: r.marked_at ?? undefined,
      }));
    },

    /** The group chat thread id (created by trigger with the group, one per
     * group). Readable by the coach and active members only. */
    async getGroupThreadId(groupId: string): Promise<string | null> {
      const { data, error } = await client
        .from("chat_threads")
        .select("id")
        .eq("context_type", "group")
        .eq("context_id", groupId)
        .maybeSingle<{ id: string }>();
      if (error) throw mapPostgrestError(error);
      return data?.id ?? null;
    },

    // -----------------------------------------------------------------
    // Coach trainee notes (coach-private, player has no read in v1)
    // -----------------------------------------------------------------

    /** My notes about one trainee, newest first. coach_id = me explicitly
     * even though RLS also enforces it. */
    async listMyTraineeNotes(playerId: string): Promise<TraineeNote[]> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_trainee_notes")
        .select("*")
        .eq("coach_id", userId)
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .returns<NoteRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map((r) => ({
        id: r.id,
        coachId: r.coach_id,
        playerId: r.player_id,
        body: r.body,
        createdAt: r.created_at,
      }));
    },

    /** Add a note. The INSERT policy also requires a real coaching
     * relationship (sessions ever, or a live membership in one of my
     * groups), so this fails FORBIDDEN for a stranger's id. */
    async addTraineeNote(playerId: string, body: string): Promise<TraineeNote> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("coach_trainee_notes")
        .insert({ coach_id: userId, player_id: playerId, body })
        .select("*")
        .single<NoteRow>();
      if (error) throw mapPostgrestError(error);
      return {
        id: data.id,
        coachId: data.coach_id,
        playerId: data.player_id,
        body: data.body,
        createdAt: data.created_at,
      };
    },

    /** Delete my note. Notes are never edited, only deleted and rewritten
     * (0078: no UPDATE policy or grant exists). */
    async deleteTraineeNote(noteId: string): Promise<void> {
      const userId = await requireUserId(client);
      const { error } = await client
        .from("coach_trainee_notes")
        .delete()
        .eq("id", noteId)
        .eq("coach_id", userId);
      if (error) throw mapPostgrestError(error);
    },

    // -----------------------------------------------------------------
    // Trainee profile reads (Track C's tabs)
    // -----------------------------------------------------------------

    /** Player Profile Overview tab identity, `public_profiles` only (the
     * cross-user safe read surface, unlike the base `users` table which is
     * own-row/admin only). Returns null for a bad id rather than throwing,
     * the same "no such row" shape `maybeSingle` gives everywhere else. */
    async getTraineeProfile(playerId: string): Promise<TraineeProfileInfo | null> {
      const { data, error } = await client
        .from("public_profiles")
        .select("id, name, avatar_url, handle, bio")
        .eq("id", playerId)
        .maybeSingle<TraineeProfileRow>();
      if (error) throw mapPostgrestError(error);
      if (!data) return null;
      return {
        name: data.name ?? "Athlete",
        avatarUrl: data.avatar_url ?? undefined,
        handle: data.handle ?? undefined,
        bio: data.bio ?? undefined,
      };
    },

    /** Per-trainee sessions split (upcoming vs all past), coach side.
     * Explicitly coach_id = me AND player_id = trainee: sessions is
     * permissive-OR across the two parties (RLS.md). */
    async listTraineeSessions(playerId: string): Promise<TraineeSessionsSplit> {
      const userId = await requireUserId(client);
      const { data, error } = await client
        .from("sessions")
        .select("id, date, slot_start, slot_end, status, focus_area, location, price, total, created_at")
        .eq("coach_id", userId)
        .eq("player_id", playerId)
        .order("date", { ascending: false })
        .order("slot_start", { ascending: false })
        .returns<TraineeSessionRow[]>();
      if (error) throw mapPostgrestError(error);

      const today = new Date().toISOString().slice(0, 10);
      const entries = (data ?? []).map((r): TraineeSessionEntry => ({
        id: r.id,
        date: r.date,
        slotStart: r.slot_start.slice(0, 5),
        slotEnd: r.slot_end.slice(0, 5),
        status: r.status,
        focusArea: r.focus_area ?? undefined,
        location: r.location ?? undefined,
        total: Number(r.total),
      }));
      const isUpcoming = (e: TraineeSessionEntry) =>
        e.date >= today && ["requested", "accepted", "in_progress"].includes(e.status);
      return {
        upcoming: entries.filter(isUpcoming).reverse(),
        past: entries.filter((e) => !isUpcoming(e)),
      };
    },

    /** Per-trainee payments, coach side, derived from rows the coach can
     * read (see TraineePaymentEntry). Declined and cancelled sessions are
     * excluded: their money was refunded or never captured for keeping. */
    async listTraineePayments(playerId: string): Promise<TraineePaymentEntry[]> {
      const userId = await requireUserId(client);

      const { data: sessionRows, error: sessionError } = await client
        .from("sessions")
        .select("id, date, slot_start, slot_end, status, focus_area, location, price, total, created_at")
        .eq("coach_id", userId)
        .eq("player_id", playerId)
        .not("status", "in", "(declined,cancelled)")
        .returns<TraineeSessionRow[]>();
      if (sessionError) throw mapPostgrestError(sessionError);

      const { data: membershipRows, error: membershipError } = await client
        .from("group_memberships")
        .select("*, training_groups!inner(id, name, coach_id)")
        .eq("player_id", playerId)
        .eq("training_groups.coach_id", userId)
        .neq("status", "pending")
        .returns<(MembershipRow & { training_groups: { id: string; name: string; coach_id: string } })[]>();
      if (membershipError) throw mapPostgrestError(membershipError);

      const entries: TraineePaymentEntry[] = [
        ...(sessionRows ?? []).map((r): TraineePaymentEntry => ({
          id: r.id,
          kind: "session",
          date: r.date,
          amount: Number(r.total),
          status: r.status,
          label: "Training session",
        })),
        ...(membershipRows ?? []).map((r): TraineePaymentEntry => ({
          id: r.id,
          kind: "membership",
          date: r.period_start ?? r.created_at.slice(0, 10),
          amount: Number(r.total),
          status: r.status,
          label: `${r.training_groups.name} monthly fee`,
        })),
      ];
      return entries.sort((a, b) => (a.date < b.date ? 1 : -1));
    },
  };
}
