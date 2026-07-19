import { useCoachSessions } from '@atlitos/api';
import { canTransition, SESSION_TRANSITIONS } from '@atlitos/types';
import type { ApiError, Session } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, CheckCircle2, TriangleAlert, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/organisms/_shared';
import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { SlotPicker } from '@/components/molecules/SlotPicker';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { SESSION_FREQUENCY_LABEL, SESSION_STATUS_PILL } from '@/lib/session-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * AT-47, PRD-02 3.6. "Mirrors the Courts booking detail pattern exactly"
 * per the PRD: status pill, status appropriate actions, no client-only
 * status write anywhere (`session_transition`/`complete-session` are the
 * sole writers, `SESSION_TRANSITIONS` from @atlitos/types only gates which
 * action even renders, per that map's own doc comment). No Rate action ever
 * (FR-18, coach never rates). Mark Complete calls `complete-session`, never
 * the bare RPC (PHASE-3-STATUS.md Track B handoff, binding on this track),
 * so `TOO_EARLY` is a real possibility this screen must show, not hide.
 * Cancel requires a reason (`REASON_REQUIRED`), unlike the court cancel
 * flow's native confirm only dialog, so this uses an inline reason field
 * instead of `Alert.alert`. Reschedule composes slots from the coach's own
 * availability windows minus busy pairs (no `get_coach_available_slots`
 * RPC exists, see `useCoachSessions.getRescheduleSlotOptions`'s doc
 * comment) and navigates to the RETURNED session id, since reschedule
 * inserts a new row and tombstones this one. States: loading, the lifecycle
 * terminal displays, error.
 */
export default function CoachSessionDetailScreen() {
  const colors = useThemeColors();
  const coachSessions = useCoachSessions(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [completing, setCompleting] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const [reschedOpen, setReschedOpen] = useState(false);
  const [reschedDate, setReschedDate] = useState(todayISO());
  const [reschedSlots, setReschedSlots] = useState<{ from: string; to: string }[]>([]);
  const [reschedSlotsLoading, setReschedSlotsLoading] = useState(false);
  const [reschedSelected, setReschedSelected] = useState<{ from: string; to: string } | undefined>(undefined);
  const [reschedSubmitting, setReschedSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await coachSessions.getSession(id);
      if (!result) {
        setError({ code: 'NOT_FOUND', message: 'This session could not be found.', status: 404 });
        setState('error');
        return;
      }
      setSession(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!reschedOpen || !session) return;
    setReschedSlotsLoading(true);
    setReschedSelected(undefined);
    coachSessions
      .getRescheduleSlotOptions(session.coachId, session.sessionTypeId, reschedDate)
      .then(setReschedSlots)
      .catch(() => setReschedSlots([]))
      .finally(() => setReschedSlotsLoading(false));
  }, [reschedOpen, reschedDate, session?.coachId, session?.sessionTypeId]);

  async function handleComplete() {
    if (!session) return;
    setCompleting(true);
    setActionError(null);
    try {
      const updated = await coachSessions.completeSession(session.id);
      setSession(updated);
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setCompleting(false);
    }
  }

  function confirmCancel() {
    if (!cancelReason.trim()) return;
    Alert.alert('Cancel this session', 'The athlete will be notified and this slot will be released.', [
      { text: 'Keep session', style: 'cancel' },
      { text: 'Cancel session', style: 'destructive', onPress: () => void handleCancel() },
    ]);
  }

  async function handleCancel() {
    if (!session) return;
    setCancelling(true);
    setActionError(null);
    try {
      const updated = await coachSessions.cancelSession(session.id, cancelReason.trim());
      setSession(updated);
      setCancelOpen(false);
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setCancelling(false);
    }
  }

  async function handleConfirmReschedule() {
    if (!session || !reschedSelected) return;
    setReschedSubmitting(true);
    setActionError(null);
    try {
      const updated = await coachSessions.rescheduleSession(session.id, reschedDate, reschedSelected.from);
      setReschedOpen(false);
      // Reschedule returns a NEW session id; navigate to it, never assume
      // the id this screen loaded stays valid.
      router.replace({ pathname: '/(tabs)/trainings/session/[id]', params: { id: updated.id } });
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setReschedSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="card" height={140} />
          <Skeleton shape="card" height={100} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !session) {
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

  const canComplete = canTransition(SESSION_TRANSITIONS, session.status, 'completed');
  const canCancel = canTransition(SESSION_TRANSITIONS, session.status, 'cancelled');
  const canReschedule = canTransition(SESSION_TRANSITIONS, session.status, 'rescheduled');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Session" onPressBack={() => router.back()} />

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
          <View className="flex-row items-center justify-between">
            <Text style={[textStyle('h3'), { color: colors.text }]}>{session.playerName ?? 'Athlete'}</Text>
            <StatusPill status={SESSION_STATUS_PILL[session.status]} />
          </View>
          {session.sessionTypeName ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{session.sessionTypeName}</Text>
          ) : null}
          <Text style={[textStyle('body'), { color: colors.text }]}>
            {session.date}, {session.slot.from} to {session.slot.to}
          </Text>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            {SESSION_FREQUENCY_LABEL[session.frequency]}
          </Text>
          {session.focusArea ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Focus: {session.focusArea}</Text>
          ) : null}
          {session.location ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{session.location}</Text>
          ) : null}
          {session.cancellationReason ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              Reason: {session.cancellationReason}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.lg,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={[textStyle('label'), { color: colors.textSecondary }]}>You earn</Text>
          <PriceText amount={session.total - session.platformFee} size="lg" />
        </View>

        {actionError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{actionError}</Text> : null}

        {canComplete || canCancel || canReschedule ? (
          <View style={{ gap: spacing.sm }}>
            {canComplete ? (
              <Button loading={completing} onPress={() => void handleComplete()}>
                <CheckCircle2 size={16} strokeWidth={1.75} color={colors.inkOnAccent} />
                <Text style={{ color: colors.inkOnAccent }}>Mark complete</Text>
              </Button>
            ) : null}
            {canReschedule ? (
              <Button
                variant="secondary"
                onPress={() => {
                  setCancelOpen(false);
                  setReschedOpen((open) => !open);
                }}
              >
                <CalendarClock size={16} strokeWidth={1.75} color={colors.text} />
                <Text style={{ color: colors.text }}>{reschedOpen ? 'Close reschedule' : 'Reschedule'}</Text>
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                variant="ghost"
                tone="danger"
                onPress={() => {
                  setReschedOpen(false);
                  setCancelOpen((open) => !open);
                }}
              >
                <XCircle size={16} strokeWidth={1.75} color={colors.danger} />
                <Text style={{ color: colors.danger }}>{cancelOpen ? 'Close cancel' : 'Cancel session'}</Text>
              </Button>
            ) : null}
          </View>
        ) : null}

        {cancelOpen ? (
          <View style={{ gap: spacing.md }}>
            <TextField
              label="Reason for cancelling"
              placeholder="Let the athlete know why"
              multiline
              value={cancelReason}
              onChangeText={setCancelReason}
            />
            <Button
              variant="destructive"
              disabled={!cancelReason.trim()}
              loading={cancelling}
              onPress={confirmCancel}
            >
              <Text style={{ color: colors.textInverse }}>Confirm cancel</Text>
            </Button>
          </View>
        ) : null}

        {reschedOpen ? (
          <View style={{ gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a new date</Text>
            <CalendarPicker value={reschedDate} onChange={setReschedDate} />

            <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a new time</Text>
            {reschedSlotsLoading ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} shape="tile" width={92} height={44} />
                ))}
              </View>
            ) : reschedSlots.length === 0 ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                No open slots on this date within your availability. Try another date.
              </Text>
            ) : (
              <SlotPicker slots={reschedSlots} value={reschedSelected} onChange={setReschedSelected} />
            )}

            <Button disabled={!reschedSelected} loading={reschedSubmitting} onPress={() => void handleConfirmReschedule()}>
              <Text style={{ color: colors.inkOnAccent }}>Confirm reschedule</Text>
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
