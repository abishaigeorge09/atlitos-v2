import {
  useGroups,
  type AttendanceStatus,
  type GroupSession,
  type SessionParticipant,
  type TrainingGroup,
} from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Play, StickyNote, TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { SESSION_STATUS_PILL } from '@/lib/session-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

function slotDurationLabel(from: string, to: string): string {
  const [fh = 0, fm = 0] = from.split(':').map(Number);
  const [th = 0, tm = 0] = to.split(':').map(Number);
  const minutes = th * 60 + tm - (fh * 60 + fm);
  if (minutes <= 0) return '';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} minutes`;
}

/**
 * Group session detail (Figma nodes 1047:15925 pre session, 1047:16031
 * attendance, 1047:15978 in session), pushed above the fixed Trainings
 * shell. The state machine is the 0077 group door and nothing else:
 * Start Session calls `session_transition('start')` (accepted ->
 * in_progress), Mark Attendance calls the `mark_attendance` RPC with the
 * per member presence toggles (coach only, session must be in_progress,
 * no money effect ever, the ratified fares model's "no show has no money
 * effect"), End Session calls `session_transition('complete')`, the
 * client complete door 0077 allows ONLY for group rows because they
 * carry no money. No status field is ever written directly. Add Notes
 * links each member into the trainee profile, where coach notes live.
 */
export default function GroupSessionDetailScreen() {
  const colors = useThemeColors();
  const groups = useGroups(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [session, setSession] = useState<GroupSession | null>(null);
  const [group, setGroup] = useState<TrainingGroup | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [starting, setStarting] = useState(false);
  const [marking, setMarking] = useState(false);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setState('loading');
    setError(null);
    try {
      const [detail, participantRows] = await Promise.all([
        groups.getGroupSession(id),
        groups.sessionParticipants(id),
      ]);
      if (!detail) {
        setError({ code: 'NOT_FOUND', message: 'This session could not be found.', status: 404 });
        setState('error');
        return;
      }
      setSession(detail.session);
      setGroup(detail.group);
      setParticipants(participantRows);
      // Seed the toggles from already marked rows so reopening the screen
      // mid session shows what was recorded, not a blank slate.
      const seeded: Record<string, AttendanceStatus> = {};
      for (const row of participantRows) {
        if (row.attendanceStatus) seeded[row.playerId] = row.attendanceStatus;
      }
      setMarks(seeded);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleStart() {
    if (!session) return;
    setStarting(true);
    setActionError(null);
    try {
      const updated = await groups.startGroupSession(session.id);
      setSession(updated);
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setStarting(false);
    }
  }

  async function handleMarkAttendance() {
    if (!session) return;
    setMarking(true);
    setActionError(null);
    try {
      await groups.markAttendance(session.id, marks);
      const refreshed = await groups.sessionParticipants(session.id);
      setParticipants(refreshed);
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setMarking(false);
    }
  }

  async function handleEnd() {
    if (!session) return;
    setEnding(true);
    setActionError(null);
    try {
      const updated = await groups.completeGroupSession(session.id);
      setSession(updated);
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setEnding(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="card" height={140} />
          <Skeleton shape="card" height={200} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !session || !group) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.message ?? 'This session could not be found.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const duration = slotDurationLabel(session.slotStart, session.slotEnd);
  const isPre = session.status === 'accepted';
  const isRunning = session.status === 'in_progress';
  const isCompleted = session.status === 'completed' || session.status === 'rated';
  const markedCount = participants.filter((p) => p.attendanceStatus).length;
  const presentCount = participants.filter((p) => p.attendanceStatus === 'present').length;
  function toggleRow(playerId: string, status: AttendanceStatus) {
    setMarks((current) => ({ ...current, [playerId]: status }));
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Group session" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}>
        <View
          style={{
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>{group.name}</Text>
            <StatusPill status={SESSION_STATUS_PILL[session.status]} />
          </View>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Group session</Text>
          <Text style={[textStyle('body'), { color: colors.text }]}>
            {session.date}, {session.slotStart} to {session.slotEnd}
          </Text>
          {duration ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Session duration: {duration}</Text>
          ) : null}
          {session.focusArea ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Focus: {session.focusArea}</Text>
          ) : null}
          {session.location ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{session.location}</Text>
          ) : null}
        </View>

        {actionError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{actionError}</Text> : null}

        {isPre ? (
          <Button loading={starting} onPress={() => void handleStart()}>
            <Play size={16} strokeWidth={1.75} color={colors.inkOnAccent} />
            <Text style={{ color: colors.inkOnAccent }}>Start session</Text>
          </Button>
        ) : null}

        {isRunning || isCompleted ? (
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Users size={20} color={colors.textSecondary} strokeWidth={1.75} />
              <Text style={[textStyle('h3'), { color: colors.text }]}>Attendance</Text>
            </View>
            {markedCount > 0 ? (
              <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                {presentCount} of {participants.length} present
              </Text>
            ) : null}

            {participants.length === 0 ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                No members were enrolled when this session was scheduled.
              </Text>
            ) : (
              participants.map((participant) => {
                const chosen = marks[participant.playerId];
                return (
                  <View
                    key={participant.playerId}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      borderRadius: radii.xl,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                      padding: spacing.md,
                    }}
                  >
                    <Avatar uri={participant.avatarUrl} name={participant.name ?? 'Player'} size={40} />
                    <Text style={[textStyle('body'), { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {participant.name ?? 'Player'}
                    </Text>
                    {isRunning ? (
                      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                        {(['present', 'absent'] as const).map((option) => {
                          const selected = chosen === option;
                          const tint = option === 'present' ? colors.successTint : colors.dangerTint;
                          const tone = option === 'present' ? colors.success : colors.danger;
                          return (
                            <Pressable
                              key={option}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              hitSlop={8}
                              onPress={() => toggleRow(participant.playerId, option)}
                              style={{
                                borderRadius: radii.pill,
                                paddingHorizontal: spacing.md,
                                paddingVertical: spacing.xs,
                                borderWidth: 1,
                                borderColor: selected ? tone : colors.border,
                                backgroundColor: selected ? tint : colors.surfaceMuted,
                              }}
                            >
                              <Text style={[textStyle('label'), { color: selected ? tone : colors.textSecondary }]}>
                                {option === 'present' ? 'Present' : 'Absent'}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <View
                        style={{
                          borderRadius: radii.pill,
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.xs,
                          backgroundColor:
                            participant.attendanceStatus === 'present'
                              ? colors.successTint
                              : participant.attendanceStatus === 'absent'
                                ? colors.dangerTint
                                : colors.surfaceMuted,
                        }}
                      >
                        <Text
                          style={[
                            textStyle('label'),
                            {
                              color:
                                participant.attendanceStatus === 'present'
                                  ? colors.success
                                  : participant.attendanceStatus === 'absent'
                                    ? colors.danger
                                    : colors.textSecondary,
                            },
                          ]}
                        >
                          {participant.attendanceStatus === 'present'
                            ? 'Present'
                            : participant.attendanceStatus === 'absent'
                              ? 'Absent'
                              : 'Not marked'}
                        </Text>
                      </View>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add notes for ${participant.name ?? 'player'}`}
                      hitSlop={8}
                      onPress={() =>
                        router.push({
                          pathname: '/(tabs)/trainings/trainee/[id]',
                          params: { id: participant.playerId },
                        })
                      }
                    >
                      <StickyNote size={20} color={colors.textTertiary} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                );
              })
            )}

            {isRunning && participants.length > 0 ? (
              <Button
                variant="secondary"
                disabled={Object.keys(marks).length === 0}
                loading={marking}
                onPress={() => void handleMarkAttendance()}
              >
                <Text style={{ color: colors.text }}>Mark attendance</Text>
              </Button>
            ) : null}

            {isRunning ? (
              <Button loading={ending} onPress={() => void handleEnd()}>
                <CheckCircle2 size={16} strokeWidth={1.75} color={colors.inkOnAccent} />
                <Text style={{ color: colors.inkOnAccent }}>End session</Text>
              </Button>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
