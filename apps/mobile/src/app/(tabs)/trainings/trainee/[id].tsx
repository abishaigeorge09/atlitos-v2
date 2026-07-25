import {
  useGroups,
  type TraineeNote,
  type TraineePaymentEntry,
  type TraineeProfileInfo,
  type TraineeSessionEntry,
  type TraineeSessionsSplit,
} from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import {
  CalendarX2,
  MessageCircle,
  Plus,
  Receipt,
  StickyNote,
  TriangleAlert,
  VideoOff,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill, type Status as StatusPillStatus } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { SESSION_STATUS_PILL } from '@/lib/session-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type ProfileTab = 'overview' | 'sessions' | 'payments' | 'notes' | 'video';
type SessionsFilter = 'upcoming' | 'all';

const TABS: Array<{ key: ProfileTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'payments', label: 'Payments' },
  { key: 'notes', label: 'Notes' },
  { key: 'video', label: 'Video Analytics' },
];

const MEMBERSHIP_STATUS_PILL: Record<string, StatusPillStatus> = {
  pending: 'pending',
  active: 'confirmed',
  lapsed: 'expired',
};

function paymentStatusPill(entry: TraineePaymentEntry): StatusPillStatus {
  if (entry.kind === 'session') {
    return SESSION_STATUS_PILL[entry.status as keyof typeof SESSION_STATUS_PILL] ?? 'pending';
  }
  return MEMBERSHIP_STATUS_PILL[entry.status] ?? 'pending';
}

/**
 * AT-48, PRD-02 3.5, FR-21, Figma 1047:13934. 5-tab trainee profile:
 * Overview (public profile identity plus real Total Sessions / Attendance
 * Rate reads), Sessions (upcoming vs all, Track A's listTraineeSessions
 * split), Payments (read-only, no Due state, payment always precedes
 * `requested` so a session or membership row existing at all means it was
 * paid), Notes (coach-private, Track A's coach_trainee_notes table), Video
 * Analytics (no per-trainee video table exists yet, so this renders only
 * the designed empty state, see the seam comment on that tab below).
 *
 * Tabs are a local segmented control matching TrainingsSubNav's accent
 * underline pattern, not new nav, the shell's route-level nav already owns
 * the outer Stats/Trainees/Earnings/Chat/Analytics tabs.
 *
 * Player attribute card intentionally shows only fields the schema has
 * (name, handle, bio via `public_profiles`): `users` carries no role,
 * batting style, bowling style, skill level, playing frequency, or gender
 * columns for players (only `coach_profiles` carries sport specific fields,
 * and only for coaches), so the Figma design's cricket specific attribute
 * rows are not buildable without a schema change and are out of scope here.
 *
 * States: loading skeleton, error with retry, populated (each tab handles
 * its own empty state inline since an athlete can validly have zero
 * sessions, payments, or notes even while the trainee relationship itself
 * is real).
 */
export default function CoachTraineeDetailScreen() {
  const colors = useThemeColors();
  const groups = useGroups(supabase);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<ScreenState>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<ProfileTab>('overview');
  const [sessionsFilter, setSessionsFilter] = useState<SessionsFilter>('upcoming');

  const [profile, setProfile] = useState<TraineeProfileInfo | null>(null);
  const [sessions, setSessions] = useState<TraineeSessionsSplit>({ upcoming: [], past: [] });
  const [payments, setPayments] = useState<TraineePaymentEntry[]>([]);
  const [notes, setNotes] = useState<TraineeNote[]>([]);

  const [composerOpen, setComposerOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [profileInfo, sessionsSplit, paymentEntries, noteEntries] = await Promise.all([
        groups.getTraineeProfile(id),
        groups.listTraineeSessions(id),
        groups.listTraineePayments(id),
        groups.listMyTraineeNotes(id),
      ]);
      setProfile(profileInfo);
      setSessions(sessionsSplit);
      setPayments(paymentEntries);
      setNotes(noteEntries);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSessions = sessions.upcoming.length + sessions.past.length;

  // Founder accepted definition (COACH-TRAININGS-GAP.md #5): true attendance
  // needs a marked participant row, which 1:1 sessions do not have. Until
  // that ships, completed / (completed + cancelled or rescheduled) among
  // past sessions is the agreed stand in; declined sessions never happened
  // (the coach turned the request down) so they are excluded entirely.
  const attendanceRate = useMemo(() => {
    const completed = sessions.past.filter((s) => s.status === 'completed' || s.status === 'rated').length;
    const missed = sessions.past.filter((s) => s.status === 'cancelled' || s.status === 'rescheduled').length;
    const denominator = completed + missed;
    return denominator > 0 ? Math.round((completed / denominator) * 100) : undefined;
  }, [sessions.past]);

  const visibleSessions: TraineeSessionEntry[] = useMemo(() => {
    if (sessionsFilter === 'upcoming') return sessions.upcoming;
    return [...sessions.upcoming, ...sessions.past];
  }, [sessions, sessionsFilter]);

  async function handleSaveNote() {
    const body = noteDraft.trim();
    if (!body) {
      setNoteError('Write something before saving.');
      return;
    }
    setSavingNote(true);
    setNoteError(undefined);
    try {
      const created = await groups.addTraineeNote(id, body);
      setNotes((current) => [created, ...current]);
      setNoteDraft('');
      setComposerOpen(false);
    } catch (err) {
      setNoteError((err as ApiError).message ?? 'Could not save the note. Try again.');
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await groups.deleteTraineeNote(noteId);
      setNotes((current) => current.filter((n) => n.id !== noteId));
    } catch {
      // Best effort: leave the note in place so the coach can retry the
      // long press or tap again, no silent data loss on a failed delete.
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title={profile?.name ?? 'Trainee'} onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="circle" width={56} height={56} />
          <Skeleton shape="card" height={100} />
          <Skeleton shape="card" height={100} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load trainee</Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.lg,
            }}
          >
            <Avatar name={profile?.name} uri={profile?.avatarUrl} size={56} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>{profile?.name ?? 'Athlete'}</Text>
              <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                {totalSessions} {totalSessions === 1 ? 'session' : 'sessions'} together
              </Text>
            </View>
            <Button variant="secondary" size="sm" onPress={() => router.navigate('/trainings/chat')}>
              <MessageCircle size={16} strokeWidth={1.75} color={colors.text} />
              <Text style={{ color: colors.text }}>Message</Text>
            </Button>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border }}
            contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: spacing.lg }}
          >
            {TABS.map((t) => {
              const isActive = t.key === tab;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }}
                >
                  <Text
                    style={[
                      textStyle('callout'),
                      { color: isActive ? colors.accent : colors.textTertiary, fontWeight: '600' },
                    ]}
                  >
                    {t.label}
                  </Text>
                  <View
                    style={{
                      marginTop: spacing.xs,
                      height: 2,
                      width: '100%',
                      borderRadius: radii.pill,
                      backgroundColor: isActive ? colors.accent : 'transparent',
                    }}
                  />
                </Pressable>
              );
            })}
          </ScrollView>

          {tab === 'overview' ? (
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
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
                {profile?.handle ? (
                  <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>@{profile.handle}</Text>
                ) : null}
                <Text style={[textStyle('callout'), { color: profile?.bio ? colors.text : colors.textTertiary }]}>
                  {profile?.bio ?? 'No bio yet.'}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <StatTile label="Total sessions" value={totalSessions} />
                <StatTile label="Attendance rate" value={attendanceRate !== undefined ? `${attendanceRate}%` : '—'} />
              </View>
            </ScrollView>
          ) : null}

          {tab === 'sessions' ? (
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md }}>
                {(['upcoming', 'all'] as SessionsFilter[]).map((f) => {
                  const isActive = f === sessionsFilter;
                  return (
                    <Pressable
                      key={f}
                      onPress={() => setSessionsFilter(f)}
                      style={{
                        height: 32,
                        borderRadius: radii.pill,
                        paddingHorizontal: spacing.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isActive ? colors.accentTint : colors.surfaceMuted,
                      }}
                    >
                      <Text
                        style={[
                          textStyle('caption'),
                          { color: isActive ? colors.accent : colors.textSecondary, fontWeight: '600' },
                        ]}
                      >
                        {f === 'upcoming' ? 'Upcoming' : 'All'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {visibleSessions.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg }}>
                  <CalendarX2 size={48} color={colors.textTertiary} strokeWidth={1.75} />
                  <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No sessions found</Text>
                </View>
              ) : (
                <FlatList
                  data={visibleSessions}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.md }}
                  renderItem={({ item }) => (
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
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[textStyle('h3'), { color: colors.text }]}>1 on 1 session</Text>
                        <StatusPill status={SESSION_STATUS_PILL[item.status]} />
                      </View>
                      <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                        {item.date}, {item.slotStart} to {item.slotEnd}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.xs }}>
                        {item.focusArea ? (
                          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{item.focusArea}</Text>
                        ) : (
                          <View />
                        )}
                        <PriceText amount={item.total} size="sm" />
                      </View>
                    </View>
                  )}
                />
              )}
            </View>
          ) : null}

          {tab === 'payments' ? (
            payments.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg }}>
                <Receipt size={48} color={colors.textTertiary} strokeWidth={1.75} />
                <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No payments found</Text>
              </View>
            ) : (
              <FlatList
                data={payments}
                keyExtractor={(item) => `${item.kind}-${item.id}`}
                contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
                renderItem={({ item }) => (
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={[textStyle('h3'), { color: colors.text }]}>{item.label}</Text>
                      <StatusPill status={paymentStatusPill(item)} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.xs }}>
                      <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{item.date}</Text>
                      <PriceText amount={item.amount} size="sm" />
                    </View>
                  </View>
                )}
              />
            )
          ) : null}

          {tab === 'notes' ? (
            <View style={{ flex: 1 }}>
              {notes.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg }}>
                  <StickyNote size={48} color={colors.textTertiary} strokeWidth={1.75} />
                  <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No notes yet</Text>
                  <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                    Notes about this trainee are private to you.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={notes}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable
                      onLongPress={() => void handleDeleteNote(item.id)}
                      style={{
                        borderRadius: radii.xl,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                        padding: spacing.lg,
                        gap: spacing.xs,
                      }}
                    >
                      <Text style={[textStyle('callout'), { color: colors.text }]}>{item.body}</Text>
                      <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{item.createdAt.slice(0, 10)}</Text>
                    </Pressable>
                  )}
                />
              )}

              <View style={{ padding: spacing.lg, paddingTop: 0 }}>
                <Button
                  variant="primary"
                  onPress={() => {
                    setNoteDraft('');
                    setNoteError(undefined);
                    setComposerOpen(true);
                  }}
                >
                  <Plus size={18} strokeWidth={1.75} color={colors.inkOnAccent} />
                  <Text style={{ color: colors.inkOnAccent }}>Add note</Text>
                </Button>
              </View>
            </View>
          ) : null}

          {tab === 'video' ? (
            // Seam: no per-trainee video table exists yet (COACH-TRAININGS-GAP.md
            // item 8, needs a storage bucket plus a coach_trainee_videos link
            // table). When that ships, swap this block for the real list
            // component, keeping the same tab shell and empty state as the
            // zero-videos case.
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg }}>
              <VideoOff size={48} color={colors.textTertiary} strokeWidth={1.75} />
              <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>No videos found</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                Trainee video review is coming soon.
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {composerOpen ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.bg,
          }}
        >
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: spacing.lg,
              }}
            >
              <Pressable
                onPress={() => setComposerOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <X size={24} strokeWidth={1.75} color={colors.text} />
              </Pressable>
              <Text style={[textStyle('h3'), { color: colors.text }]}>Add note</Text>
              <View style={{ width: 24 }} />
            </View>

            <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg }}>
              <Input
                type="multiline"
                autoFocus
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Write a note about this trainee."
                error={noteError}
                containerClassName="flex-1"
                className="flex-1"
              />
              <Button variant="primary" onPress={() => void handleSaveNote()} loading={savingNote}>
                <Text style={{ color: colors.inkOnAccent }}>Save note</Text>
              </Button>
            </View>
          </SafeAreaView>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
