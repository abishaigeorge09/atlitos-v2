import { computeAvailableSessionSlots, useChat, useCoaching } from '@atlitos/api';
import { canTransition, SESSION_TRANSITIONS } from '@atlitos/types';
import type { ApiError, Session } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, MessageCircle, TriangleAlert, XCircle } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillSummary } from '@/components/molecules/BillSummary';
import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { SlotPicker } from '@/components/molecules/SlotPicker';
import { RateReviewForm } from '@/components/organisms/RateReviewForm';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
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

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Session detail. PRD-01 FR-25/FR-26 (AT-54): cancel to `cancelled`,
 * reschedule to `rescheduled` (a NEW session id, per API-MAPPING.md, this
 * screen replaces itself onto the returned id rather than assuming its own
 * stays valid), rate via `RateReviewForm` once `completed`, all three
 * driven entirely by `session_transition`/`rate_session` (never a
 * client-side status write) and `SESSION_TRANSITIONS`/`canTransition`
 * (`@atlitos/types`) gating which action can even render.
 *
 * KNOWN PRD GAP (documented, not fixed here): `SESSION_TRANSITIONS.requested`
 * only allows `accepted`/`declined`, there is no `requested -> cancelled`
 * edge (PRD-02 FR-19 does not specify one). An athlete who has booked but
 * not yet been accepted has no way to back out of a session from this app;
 * this screen shows an explanatory note instead of a cancel button for that
 * state rather than inventing a transition the RPC would reject with
 * `INVALID_TRANSITION`.
 */
export default function SessionDetailScreen() {
  const colors = useThemeColors();
  const coaching = useCoaching(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [reschedOpen, setReschedOpen] = useState(false);
  const [reschedDate, setReschedDate] = useState(todayISO());
  const [reschedSlots, setReschedSlots] = useState<{ from: string; to: string }[]>([]);
  const [reschedSlotsLoading, setReschedSlotsLoading] = useState(false);
  const [reschedSelected, setReschedSelected] = useState<{ from: string; to: string } | undefined>(undefined);
  const [reschedSubmitting, setReschedSubmitting] = useState(false);

  const [rateSubmitting, setRateSubmitting] = useState(false);
  const [rateSubmitted, setRateSubmitted] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await coaching.getSession(id);
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

    // Reschedule's slot picker needs the same window+duration engine the
    // profile/booking screen uses (FR-22's "the only input the custom slot
    // engine uses"), so this re-fetches the coach's availability windows
    // and the specific session type's duration rather than assuming a
    // fixed hour, then narrows by the same get_coach_busy_slots preview.
    (async () => {
      const coach = await coaching.getCoach(session.coachId);
      const type = coach?.sessionTypes.find((t) => t.id === session.sessionTypeId);
      if (!coach || !type) {
        setReschedSlots([]);
        return;
      }
      const busy = await coaching.getCoachBusySlots(session.coachId, reschedDate, addDaysISO(reschedDate, 14));
      setReschedSlots(computeAvailableSessionSlots(coach.availability, type.durationMinutes, reschedDate, busy));
    })()
      .catch(() => setReschedSlots([]))
      .finally(() => setReschedSlotsLoading(false));
  }, [reschedOpen, reschedDate, session?.coachId, session?.sessionTypeId]);

  function confirmCancel() {
    if (!session) return;
    Alert.alert(
      'Cancel this session',
      'Are you sure you want to cancel? This time will be released for other athletes.',
      [
        { text: 'Keep session', style: 'cancel' },
        { text: 'Cancel session', style: 'destructive', onPress: () => void handleCancel() },
      ],
    );
  }

  async function handleCancel() {
    if (!session) return;
    setCancelling(true);
    setActionError(null);
    try {
      await coaching.transitionSession({ sessionId: session.id, action: 'cancel', reason: 'Cancelled by athlete' });
      await load();
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setCancelling(false);
    }
  }

  const chat = useChat(supabase);
  const [openingThread, setOpeningThread] = useState(false);

  async function handleMessageCoach() {
    if (!session) return;
    setOpeningThread(true);
    try {
      const threadId = await chat.openCoachingThread(session.coachId, session.id);
      router.push({ pathname: '/(tabs)/chat/[id]', params: { id: threadId } });
    } catch (err) {
      Alert.alert('Could not open chat', (err as ApiError).message ?? 'Please try again.');
    } finally {
      setOpeningThread(false);
    }
  }

  async function handleConfirmReschedule() {
    if (!session || !reschedSelected) return;
    setReschedSubmitting(true);
    setActionError(null);
    try {
      const updated = await coaching.transitionSession({
        sessionId: session.id,
        action: 'reschedule',
        newDate: reschedDate,
        newSlotStart: reschedSelected.from,
      });
      setReschedOpen(false);
      router.replace({ pathname: '/(tabs)/coaching/booking/[id]', params: { id: updated.id } });
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setReschedSubmitting(false);
    }
  }

  async function handleRate(rating: number, remarks: string) {
    if (!session) return;
    setRateSubmitting(true);
    setActionError(null);
    try {
      await coaching.rateSession(session.id, rating, remarks || undefined);
      setRateSubmitted(true);
      await load();
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setRateSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={160} />
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

  const canCancel = canTransition(SESSION_TRANSITIONS, session.status, 'cancelled');
  const canReschedule = canTransition(SESSION_TRANSITIONS, session.status, 'rescheduled');
  const canRate = canTransition(SESSION_TRANSITIONS, session.status, 'rated');

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
            <Text style={[textStyle('h3'), { color: colors.text }]}>{session.sessionTypeName ?? 'Session'}</Text>
            <StatusPill status={SESSION_STATUS_PILL[session.status]} />
          </View>
          {session.coachName ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>with {session.coachName}</Text>
          ) : null}
          <Text style={[textStyle('body'), { color: colors.text }]}>
            {session.date}, {session.slot.from} to {session.slot.to}
          </Text>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            {SESSION_FREQUENCY_LABEL[session.frequency]}
          </Text>
          {session.focusArea ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Focus: {session.focusArea}</Text>
          ) : null}
          {session.status === 'declined' ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              This coach could not take this session{session.declineReason ? `: ${session.declineReason}` : '.'}
            </Text>
          ) : null}
          {session.status === 'cancelled' ? (
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              This session was cancelled{session.cancellationReason ? `: ${session.cancellationReason}` : '.'}
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
          }}
        >
          <BillSummary rows={[{ label: 'Session fee', amount: session.price }]} total={session.total} />
        </View>

        {actionError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{actionError}</Text> : null}

        {session.status === 'requested' ? (
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
            Waiting for the coach to accept. You can't cancel until then.
          </Text>
        ) : null}

        {/* Chat lives at Track E's shared route, reachable by both roles.
            openCoachingThread gets or creates the thread; the server re-checks
            session_links_pair, so this never trusts the client's word for it. */}
        <Button
          variant="secondary"
          loading={openingThread}
          onPress={() => void handleMessageCoach()}
        >
          <MessageCircle size={16} strokeWidth={1.75} color={colors.text} />
          <Text style={{ color: colors.text }}>Message coach</Text>
        </Button>

        {canCancel || canReschedule ? (
          <View style={{ gap: spacing.sm }}>
            {canReschedule ? (
              <Button variant="secondary" onPress={() => setReschedOpen((open) => !open)}>
                <CalendarClock size={16} strokeWidth={1.75} color={colors.text} />
                <Text style={{ color: colors.text }}>{reschedOpen ? 'Close reschedule' : 'Reschedule'}</Text>
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="ghost" tone="danger" loading={cancelling} onPress={confirmCancel}>
                <XCircle size={16} strokeWidth={1.75} color={colors.danger} />
                <Text style={{ color: colors.danger }}>Cancel session</Text>
              </Button>
            ) : null}
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
                No open slots on this date. Try another date.
              </Text>
            ) : (
              <SlotPicker slots={reschedSlots} value={reschedSelected} onChange={setReschedSelected} />
            )}

            <Button disabled={!reschedSelected} loading={reschedSubmitting} onPress={() => void handleConfirmReschedule()}>
              <Text style={{ color: colors.inkOnAccent }}>Confirm reschedule</Text>
            </Button>
          </View>
        ) : null}

        {canRate ? (
          <View
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <RateReviewForm
              entityName={session.coachName ?? 'Coach'}
              entitySubtitle={session.sessionTypeName ?? ''}
              bookingId={session.id}
              submitted={rateSubmitted}
              onSubmit={(rating, remarks) => {
                if (rateSubmitting) return;
                void handleRate(rating, remarks);
              }}
            />
          </View>
        ) : session.rating ? (
          <View
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.lg,
              gap: spacing.xs,
            }}
          >
            <Text style={[textStyle('h3'), { color: colors.text }]}>Your review</Text>
            <Text style={[textStyle('numericBase'), { color: colors.text }]}>{session.rating.toFixed(1)}/5</Text>
            {session.remarks ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{session.remarks}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
