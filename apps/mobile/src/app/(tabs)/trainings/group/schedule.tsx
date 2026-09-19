import { useGroups, type TrainingGroup } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { TriangleAlert, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/organisms/_shared';
import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DURATION_PRESETS = [60, 90, 120];

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return '23:59';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * PRD-02 groups. The coach schedules a session for one of their groups.
 *
 * `create_group_session` (0079:335) was built, tested, and never called from
 * anywhere in the app, which is why the group profile's Sessions tab read
 * "No sessions scheduled for this group yet" with no way to schedule one.
 * This screen is that call site, and it is what makes the already complete
 * group session detail, Start Session and attendance screens
 * (`group-session/[id].tsx`) reachable at all: nothing else in the product
 * inserts a row with a `group_id`.
 *
 * No slot picker here, unlike a 1:1 reschedule. A group session is not
 * booked against the coach's published availability windows: those exist so
 * ATHLETES can find open 1:1 slots, and the RPC does not consult them. The
 * coach names the time directly, and the only real constraint is the
 * database's own `sessions_coach_date_slot_unique`, surfaced as `SLOT_TAKEN`
 * when the coach is already booked at that time by anything, group or 1:1.
 *
 * Money: none. Group session rows are inserted at price 0 with no payment
 * intent, because the fare moved once at membership capture (0076 header
 * note 5). Participants are seeded server side from the ACTIVE members at
 * scheduling time; a member who joins later is not backfilled in v1, which
 * the copy says out loud rather than surprising the coach.
 */
export default function GroupScheduleSessionScreen() {
  const colors = useThemeColors();
  const groups = useGroups(supabase);
  const { groupId } = useLocalSearchParams<{ groupId: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [group, setGroup] = useState<TrainingGroup | null>(null);
  const [activeMembers, setActiveMembers] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);

  const [date, setDate] = useState(todayISO());
  const [slotStart, setSlotStart] = useState('07:00');
  const [slotEnd, setSlotEnd] = useState('08:00');
  const [focusArea, setFocusArea] = useState('');
  const [location, setLocation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const detail = await groups.getGroup(groupId);
      // RLS is not scoping: training_groups has a public browse policy, so
      // a guessed id would otherwise render another coach's group here.
      const { data: authData } = await supabase.auth.getUser();
      if (!detail || !authData.user || detail.group.coachId !== authData.user.id) {
        setError({ code: 'NOT_FOUND', message: 'This group could not be found.', status: 404 });
        setState('error');
        return;
      }
      setGroup(detail.group);
      setActiveMembers(detail.group.activeMembers ?? detail.members.length);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
    // Deps are the route param only, deliberately: `groups` is rebuilt every
    // render. No eslint disable comment, because the shared config does not
    // register the react-hooks plugin and naming that rule errors.
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit() {
    if (!TIME_RE.test(slotStart) || !TIME_RE.test(slotEnd)) {
      setFormError('Enter times as HH:MM, for example 07:00.');
      return;
    }
    if (slotEnd <= slotStart) {
      setFormError('The end time must be after the start time.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await groups.createGroupSession({
        groupId,
        date,
        slotStart,
        slotEnd,
        focusArea: focusArea.trim() || undefined,
        location: location.trim() || undefined,
      });
      // replace: backing out of the new session lands on the group, not on
      // a spent form.
      router.replace({ pathname: '/(tabs)/trainings/group-session/[id]', params: { id: created.id } });
    } catch (err) {
      setFormError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="50%" />
          <Skeleton shape="card" height={220} />
          <Skeleton shape="card" height={96} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !group) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.message ?? 'This group could not be found.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Schedule session" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.lg,
          }}
        >
          <Users size={24} color={colors.accent} strokeWidth={1.75} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>{group.name}</Text>
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              {activeMembers} {activeMembers === 1 ? 'active member' : 'active members'} will be added to this session
            </Text>
          </View>
        </View>

        {!group.active ? (
          <Text style={[textStyle('callout'), { color: colors.warning }]}>
            This group is inactive. Reactivate it before scheduling a session.
          </Text>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('h3'), { color: colors.text }]}>Date</Text>
          <CalendarPicker value={date} onChange={setDate} />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('h3'), { color: colors.text }]}>Time</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Starts"
                value={slotStart}
                placeholder="07:00"
                onChangeText={(value) => setSlotStart(value)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Ends" value={slotEnd} placeholder="08:00" onChangeText={(value) => setSlotEnd(value)} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {DURATION_PRESETS.map((minutes) => (
              <Pressable
                key={minutes}
                accessibilityRole="button"
                accessibilityLabel={`Set the session to ${minutes} minutes`}
                onPress={() => {
                  if (TIME_RE.test(slotStart)) setSlotEnd(addMinutes(slotStart, minutes));
                }}
                style={{
                  borderRadius: radii.pill,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceMuted,
                }}
              >
                <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>{minutes} min</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <TextField
          label="Focus area"
          placeholder="Fielding drills"
          value={focusArea}
          onChangeText={setFocusArea}
        />

        <TextField
          label="Location"
          placeholder="Main ground, net 2"
          value={location}
          onChangeText={setLocation}
        />

        {formError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{formError}</Text> : null}

        <Button disabled={!group.active} loading={submitting} onPress={() => void handleSubmit()}>
          <Text style={{ color: colors.inkOnAccent }}>Schedule session</Text>
        </Button>

        <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
          Members who join after this is scheduled are not added automatically. Schedule again or reschedule to include
          them.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
