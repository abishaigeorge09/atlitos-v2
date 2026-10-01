import {
  computeAvailableSessionSlots,
  isMembershipRenewable,
  isMembershipUnpaid,
  useCoaching,
  useGroups,
  type GroupMembership,
  type TrainingGroup,
} from '@atlitos/api';
import type { ApiError, AvailabilityWindow, CoachProfile, SessionFrequency, SessionTypeOption, TimeSlot } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Clock, MapPin, Sparkles, TriangleAlert, Users, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { SlotPicker } from '@/components/molecules/SlotPicker';
import { LoginGateModal } from '@/components/organisms/LoginGateModal';
import { TextField } from '@/components/organisms/_shared';
import { Avatar } from '@/components/ui/avatar';
import { AppBar } from '@/components/ui/app-bar';
import { useNavBarInset } from '@/components/ui/bottom-nav';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/ui/star-rating';
import { Text } from '@/components/ui/text';
import { usePendingAuthAction } from '@/hooks/use-pending-auth-action';
import { SESSION_FREQUENCY_LABEL } from '@/lib/session-display';
import { COACH_IN_APP_PAYMENT_ENABLED } from '@/lib/feature-flags';
import { SPORT_ICON, SPORT_LABEL, SPORT_TINT } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type SlotsState = 'loading' | 'empty' | 'populated' | 'error';
type GroupsState = 'loading' | 'populated' | 'error';

const FREQUENCIES: SessionFrequency[] = ['one_time', 'weekly', 'monthly'];

/** Profile hero band height, and how far the identity card rides up over it. */
const HERO_HEIGHT = 140;
const HERO_OVERLAP = 72;

/** `coach_availability_windows.day_of_week` is 0 for Sunday. Listed Monday
 * first, the way a training week is read. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The coach's training days from their weekly windows, or a plain line when
 * they have not set any yet (the slot picker below will then be empty too). */
function trainingDaysLabel(windows: AvailabilityWindow[]): string {
  const days = new Set(windows.map((window) => window.dayOfWeek));
  if (days.size === 0) return 'Training days not set yet';
  if (days.size === 7) return 'Every day';
  return WEEKDAY_ORDER.filter((day) => days.has(day))
    .map((day) => WEEKDAY_LABEL[day])
    .join(', ');
}

/** `coaching_style` is stored as a lowercase slug such as `technical` or
 * `match_play`; shown as "Technical", "Match play". */
function sentenceCase(value: string): string {
  const words = value.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function firstName(name: string | undefined): string {
  return name?.trim().split(/\s+/)[0] || 'the coach';
}

/** One titled card in the profile's read section. */
function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        marginHorizontal: spacing.lg,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <Text style={[textStyle('overline'), { color: colors.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

/** An icon and a line (or lines) of detail inside a ProfileSection. */
function DetailRow({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row gap-md">
      <Icon size={20} strokeWidth={1.75} color={colors.textSecondary} />
      <Text style={[textStyle('callout'), { flex: 1, color: colors.text }]}>{text}</Text>
    </View>
  );
}

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
 * Coach profile + booking start. PRD-01 FR-21/FR-22 (AT-52/AT-53): rating,
 * experience, specialization, tiered session types, and an availability
 * preview sourced from `get_coach_busy_slots` (never a static fixture).
 * Booking happens in this same screen in the FR-22 mandated order, session
 * type and frequency first (each gates the next with a disabled section
 * rather than a separate wizard screen, same "one screen, progressive
 * disclosure" shape Courts uses for date+slot); Continue to pay only
 * enables once all four are chosen, then hands off to `book/pay`, which is
 * the actual mutating step (`book-session`). Guest-open per FR-2; Continue
 * to pay gates. States: loading, populated, error (not found); the slot
 * section carries its own loading/empty/populated/error quartet since it
 * refetches on every date change, matching the Courts detail screen.
 */
export default function CoachProfileScreen() {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const coaching = useCoaching(supabase);
  const groups = useGroups(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();
  const status = useSessionStore((state) => state.status);
  const requiresAuthGate = status !== 'signed_in';
  const isSignedIn = status === 'signed_in';

  const [state, setState] = useState<ScreenState>('loading');
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [gateVisible, setGateVisible] = useState(false);
  // F8 (P5 fix pass, PRD-01 FR-4): both gated actions here only navigate to
  // a confirm/pay screen, they never complete a charge or a state-machine
  // transition themselves (the actual booking RPC/payment happens on the
  // next screen, which re-verifies the price server side), so replaying the
  // navigation after login is safe and is exactly FR-4's "return to their
  // in-progress screen". Never extend this to a screen that itself commits
  // money (CLAUDE.md's financial invariant).
  const { requireAuth, clearPendingAction } = usePendingAuthAction(requiresAuthGate);

  const [groupsState, setGroupsState] = useState<GroupsState>('loading');
  const [coachGroups, setCoachGroups] = useState<TrainingGroup[]>([]);
  const [myMemberships, setMyMemberships] = useState<GroupMembership[]>([]);

  const [sessionType, setSessionType] = useState<SessionTypeOption | undefined>(undefined);
  const [frequency, setFrequency] = useState<SessionFrequency | undefined>(undefined);
  const [date, setDate] = useState(todayISO());
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | undefined>(undefined);
  const [focusArea, setFocusArea] = useState('');
  const [location, setLocation] = useState('');

  const [busySlots, setBusySlots] = useState<{ date: string; slotStart: string }[]>([]);
  const [slotsState, setSlotsState] = useState<SlotsState>('populated');

  const loadCoach = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await coaching.getCoach(id);
      if (!result) {
        setError({ code: 'NOT_FOUND', message: 'This coach could not be found.', status: 404 });
        setState('error');
        return;
      }
      setCoach(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void loadCoach();
  }, [loadCoach]);

  // Groups section: this coach's active groups (public discovery read,
  // explicitly coach scoped even though the browse policy is also public,
  // RLS IS NOT SCOPING) plus, when signed in, the athlete's own memberships
  // to know which groups already show Joined instead of a Join button. The
  // membership read fails closed to "no memberships known" on error rather
  // than blocking the groups list itself.
  useEffect(() => {
    setGroupsState('loading');
    groups
      .listGroupsForCoach(id)
      .then((result) => {
        setCoachGroups(result);
        setGroupsState('populated');
      })
      .catch(() => setGroupsState('error'));
  }, [id]);

  useEffect(() => {
    if (!isSignedIn) return;
    groups
      .myMemberships()
      .then(setMyMemberships)
      .catch(() => setMyMemberships([]));
  }, [isSignedIn, id]);

  useEffect(() => {
    if (!sessionType) return;
    setSlotsState('loading');
    setSelectedSlot(undefined);
    // A 14 day window is enough to cover the busy slots a single date's
    // slot generation needs; get_coach_busy_slots is cheap and hides the
    // underlying session rows, this is a read-only preview regardless
    // (book-session re-checks authoritatively, see use-coaching.ts).
    coaching
      .getCoachBusySlots(id, date, addDaysISO(date, 14))
      .then((slots) => {
        setBusySlots(slots);
        setSlotsState('populated');
      })
      .catch(() => setSlotsState('error'));
  }, [id, date, sessionType?.id]);

  const availableSlots = useMemo(() => {
    if (!coach || !sessionType) return [];
    return computeAvailableSessionSlots(coach.availability, sessionType.durationMinutes, date, busySlots);
  }, [coach, sessionType, date, busySlots]);

  function handleJoinGroup(group: TrainingGroup) {
    requireAuth(() => {
      router.push({
        pathname: '/(tabs)/coaching/group/join',
        params: {
          groupId: group.id,
          groupName: group.name,
          coachName: coach?.user?.name ?? 'this coach',
          monthlyFee: String(group.monthlyFee),
          attendancePolicy: group.attendancePolicy ?? '',
        },
      });
    }, () => setGateVisible(true));
  }

  function handleContinue() {
    if (!coach || !sessionType || !frequency || !selectedSlot) return;
    requireAuth(() => {
      router.push({
        pathname: '/(tabs)/coaching/book/pay',
        params: {
          coachId: coach.userId,
          coachName: coach.user?.name ?? 'Coach',
          sessionTypeId: sessionType.id,
          sessionTypeName: sessionType.name,
          durationMinutes: String(sessionType.durationMinutes),
          frequency,
          date,
          slotFrom: selectedSlot.from,
          slotTo: selectedSlot.to,
          expectedTotal: String(sessionType.price),
          focusArea,
          location,
        },
      });
    }, () => setGateVisible(true));
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="circle" />
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="line" width="40%" />
          <Skeleton shape="card" height={160} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !coach) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            {error?.message ?? 'This coach could not be found.'}
          </Text>
          <Button variant="secondary" onPress={() => void loadCoach()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const canBook = !!(sessionType && frequency && selectedSlot);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="back" onPressBack={() => router.back()} />

      <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing['4xl'], gap: spacing.lg }}>
        {/* Hero band in the coach's sport tint, with the identity card
            overlapping its lower edge (reference layout, 2026-10-01). */}
        <View>
          <View
            style={{
              height: HERO_HEIGHT,
              marginHorizontal: spacing.lg,
              borderRadius: radii.xl,
              backgroundColor: colors[SPORT_TINT[coach.sport].bg],
              alignItems: 'flex-end',
              justifyContent: 'flex-start',
              padding: spacing.lg,
            }}
          >
            {(() => {
              const HeroIcon = SPORT_ICON[coach.sport];
              return <HeroIcon size={40} strokeWidth={1.5} color={colors[SPORT_TINT[coach.sport].ink]} />;
            })()}
          </View>

          <View
            style={{
              marginTop: -HERO_OVERLAP,
              marginHorizontal: spacing['2xl'],
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.lg,
              alignItems: 'center',
              gap: spacing.xs,
            }}
          >
            <Avatar uri={coach.user?.avatarUrl} name={coach.user?.name} size={80} verifiedBadge />
            <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center', paddingTop: spacing.xs }]}>
              {coach.user?.name ?? 'Coach'}
            </Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {SPORT_LABEL[coach.sport]} coach, {coach.experienceYears} yrs experience
            </Text>
            <StarRating mode="display" value={coach.rating} count={coach.ratingCount} />

            {coach.specialization.length > 0 ? (
              <View
                style={{
                  alignSelf: 'stretch',
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  marginTop: spacing.sm,
                  paddingTop: spacing.md,
                }}
              >
                <View className="flex-row flex-wrap justify-center gap-xs">
                  {coach.specialization.map((tag) => (
                    <Chip key={tag} label={tag} variant="category" />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </View>

        <ProfileSection title="About the sessions">
          <DetailRow icon={CalendarDays} text={trainingDaysLabel(coach.availability)} />
          {coach.sessionTypes.length > 0 ? (
            <DetailRow
              icon={Clock}
              text={coach.sessionTypes.map((type) => `${type.name}, ${type.durationMinutes} min`).join('\n')}
            />
          ) : null}
          {coach.user?.city ? <DetailRow icon={MapPin} text={coach.user.city} /> : null}
          {coach.coachingStyle ? <DetailRow icon={Sparkles} text={`Style: ${sentenceCase(coach.coachingStyle)}`} /> : null}
        </ProfileSection>

        {coach.bio ? (
          <ProfileSection title={`About ${firstName(coach.user?.name)}`}>
            <Text style={[textStyle('body'), { color: colors.text }]}>{coach.bio}</Text>
          </ProfileSection>
        ) : null}

        {/* Groups are paid monthly memberships with no unpaid path yet, so they
            are hidden while in-app coach payments are off. */}
        {COACH_IN_APP_PAYMENT_ENABLED && groupsState === 'populated' && coachGroups.length > 0 ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Groups</Text>
            <View style={{ gap: spacing.sm }}>
              {coachGroups.map((group) => {
                const spotsLeft = group.capacity - (group.activeMembers ?? 0);
                const membership = myMemberships.find((m) => m.groupId === group.id);
                const isMember = membership?.status === 'active' || membership?.status === 'pending';
                const canRenew = !!membership && isMembershipUnpaid(membership.status) && isMembershipRenewable(membership.status);

                return (
                  <View
                    key={group.id}
                    style={{
                      borderRadius: radii.lg,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                      padding: spacing.lg,
                      gap: spacing.sm,
                    }}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 flex-row items-center gap-xs">
                        <Users size={16} strokeWidth={1.75} color={colors.textTertiary} />
                        <Text style={[textStyle('label'), { color: colors.text }]} numberOfLines={1}>
                          {group.name}
                        </Text>
                      </View>
                      <Text style={[textStyle('numericBase'), { color: colors.text }]}>
                        {formatINR(group.monthlyFee)}/mo
                      </Text>
                    </View>

                    <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                      {spotsLeft > 0 ? `${spotsLeft} of ${group.capacity} spots left` : 'Group is full'}
                    </Text>

                    {group.attendancePolicy ? (
                      <Text style={[textStyle('caption'), { color: colors.textTertiary }]} numberOfLines={2}>
                        {group.attendancePolicy}
                      </Text>
                    ) : null}

                    {isMember ? (
                      <Button variant="secondary" size="sm" disabled>
                        <Text style={{ color: colors.textSecondary }}>
                          {membership?.status === 'pending' ? 'Payment pending' : 'Joined'}
                        </Text>
                      </Button>
                    ) : canRenew && membership ? (
                      <Button
                        size="sm"
                        onPress={() =>
                          router.push({
                            pathname: '/(tabs)/coaching/group/renew',
                            params: {
                              membershipId: membership.id,
                              groupName: group.name,
                              monthlyFee: String(group.monthlyFee),
                            },
                          })
                        }
                      >
                        <Text style={{ color: colors.inkOnAccent }}>Renew membership</Text>
                      </Button>
                    ) : (
                      <Button size="sm" disabled={spotsLeft <= 0} onPress={() => handleJoinGroup(group)}>
                        <Text style={{ color: colors.inkOnAccent }}>{spotsLeft <= 0 ? 'Full' : 'Join, month 1'}</Text>
                      </Button>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <View style={{ gap: spacing.xs }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Fees and sessions</Text>
            <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>Pick one to book.</Text>
          </View>
          {coach.sessionTypes.length === 0 ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              This coach has not published session types yet.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {coach.sessionTypes.map((type) => (
                <Pressable
                  key={type.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sessionType?.id === type.id }}
                  onPress={() => setSessionType(type)}
                  style={{
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: sessionType?.id === type.id ? colors.accent : colors.border,
                    backgroundColor: sessionType?.id === type.id ? colors.accentTint : colors.card,
                    padding: spacing.lg,
                  }}
                >
                  <View className="flex-row items-center justify-between">
                    <View style={{ gap: spacing.xs }}>
                      <Text style={[textStyle('label'), { color: colors.text }]}>{type.name}</Text>
                      <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                        {type.durationMinutes} min
                      </Text>
                    </View>
                    <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(type.price)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {sessionType ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Frequency</Text>
            <View className="flex-row flex-wrap gap-sm">
              {FREQUENCIES.map((freq) => (
                <Chip
                  key={freq}
                  label={SESSION_FREQUENCY_LABEL[freq]}
                  variant="select"
                  selected={frequency === freq}
                  onPress={() => setFrequency(freq)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {sessionType && frequency ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a date</Text>
            <CalendarPicker value={date} onChange={setDate} />
          </View>
        ) : null}

        {sessionType && frequency ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Pick a time</Text>

            {slotsState === 'loading' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} shape="tile" width={92} height={44} />
                ))}
              </View>
            ) : slotsState === 'error' ? (
              <Text style={[textStyle('callout'), { color: colors.danger }]}>
                Couldn't load availability for this date. Try another date or check back.
              </Text>
            ) : availableSlots.length === 0 ? (
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                No open slots on this date. Try another date.
              </Text>
            ) : (
              <SlotPicker slots={availableSlots} value={selectedSlot} onChange={setSelectedSlot} />
            )}
          </View>
        ) : null}

        {sessionType && frequency && selectedSlot ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text }]}>Details</Text>
            <TextField
              label="Focus area, optional"
              placeholder="What do you want to work on"
              value={focusArea}
              onChangeText={setFocusArea}
            />
            <TextField
              label="Location, optional"
              placeholder="Where you would like to train"
              value={location}
              onChangeText={setLocation}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: navInset + spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
        <Button disabled={!canBook} onPress={handleContinue}>
          <Text style={{ color: colors.inkOnAccent }}>
            {!canBook
              ? 'Choose a type, date, and time'
              : COACH_IN_APP_PAYMENT_ENABLED
                ? `Continue, ${formatINR(sessionType!.price)}`
                : 'Request appointment'}
          </Text>
        </Button>
      </View>

      <LoginGateModal
        visible={gateVisible}
        onClose={() => setGateVisible(false)}
        onDismiss={clearPendingAction}
      />
    </SafeAreaView>
  );
}
