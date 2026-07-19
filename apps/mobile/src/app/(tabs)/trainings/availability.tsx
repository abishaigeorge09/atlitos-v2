import { useCoachAvailability, type AvailabilityWindowItem } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CalendarClock, Plus, Trash2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/organisms/_shared';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * AT-49, PRD-02 3.7 header ("Availability and the slot engine" section of
 * PRD-02), FR-22 and FR-23. The only input to the coaching slot engine
 * (`get_coach_busy_slots` composed with these on the client, see
 * `useCoachSessions.getRescheduleSlotOptions`'s doc comment); there is no
 * separate blocked date UI in v1, matching FR-22's "no separate block a
 * date UI beyond declining or cancelling individual requests". FR-23:
 * edits take effect for future slot generation only and never touch an
 * already accepted session, since this screen never writes to `sessions`.
 * FR-5's overlap rule is enforced by the database's own exclusion
 * constraint; a client side day plus time range check narrows it early
 * with a specific message before the row insert even runs. States:
 * loading, populated (grouped by day, empty state is simply zero rows
 * under every day with an add affordance always visible), error.
 */
export default function CoachAvailabilityScreen() {
  const colors = useThemeColors();
  const availability = useCoachAvailability(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [windows, setWindows] = useState<AvailabilityWindowItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [fromInput, setFromInput] = useState('06:00');
  const [toInput, setToInput] = useState('08:00');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await availability.listWindows();
      setWindows(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function windowsOverlap(dayOfWeek: number, from: string, to: string): boolean {
    return windows.some((window) => window.dayOfWeek === dayOfWeek && from < window.to && window.from < to);
  }

  async function handleAdd(dayOfWeek: number) {
    setFormError(null);
    if (!TIME_RE.test(fromInput) || !TIME_RE.test(toInput)) {
      setFormError('Enter times as HH:MM, for example 06:00.');
      return;
    }
    if (toInput <= fromInput) {
      setFormError('The end time must be after the start time.');
      return;
    }
    if (windowsOverlap(dayOfWeek, fromInput, toInput)) {
      setFormError('This overlaps another window on the same day.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await availability.createWindow({ dayOfWeek, from: fromInput, to: toInput });
      setWindows((prev) => [...prev, created]);
      setAddingDay(null);
      setFromInput('06:00');
      setToInput('08:00');
    } catch (err) {
      setFormError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(windowId: string) {
    setDeletingId(windowId);
    try {
      await availability.deleteWindow(windowId);
      setWindows((prev) => prev.filter((window) => window.id !== windowId));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Availability" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton shape="line" width="50%" />
          <Skeleton shape="card" height={64} />
          <Skeleton shape="card" height={64} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Could not load your availability
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}>
          <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
            Athletes can only book within these windows. Changes apply to future bookings only.
          </Text>

          {DAY_LABELS.map((label, dayOfWeek) => {
            const dayWindows = windows.filter((window) => window.dayOfWeek === dayOfWeek);
            const isAdding = addingDay === dayOfWeek;

            return (
              <View key={label} style={{ gap: spacing.sm }}>
                <View className="flex-row items-center justify-between">
                  <Text style={[textStyle('h3'), { color: colors.text }]}>{label}</Text>
                  <Button
                    variant="text"
                    size="sm"
                    onPress={() => {
                      setFormError(null);
                      setAddingDay(isAdding ? null : dayOfWeek);
                    }}
                  >
                    <Plus size={16} strokeWidth={1.75} color={colors.accent} />
                    <Text style={{ color: colors.accent }}>Add window</Text>
                  </Button>
                </View>

                {dayWindows.length === 0 ? (
                  <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>No windows set</Text>
                ) : (
                  dayWindows.map((window) => (
                    <View
                      key={window.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      }}
                    >
                      <View className="flex-row items-center gap-xs">
                        <CalendarClock size={16} strokeWidth={1.75} color={colors.textTertiary} />
                        <Text style={[textStyle('numericBase'), { color: colors.text }]}>
                          {window.from} to {window.to}
                        </Text>
                      </View>
                      <Button
                        variant="text"
                        size="sm"
                        loading={deletingId === window.id}
                        onPress={() => void handleDelete(window.id)}
                      >
                        <Trash2 size={16} strokeWidth={1.75} color={colors.danger} />
                      </Button>
                    </View>
                  ))
                )}

                {isAdding ? (
                  <View
                    style={{
                      gap: spacing.sm,
                      borderRadius: radii.md,
                      borderWidth: 1,
                      borderColor: colors.borderStrong,
                      padding: spacing.md,
                    }}
                  >
                    <View className="flex-row gap-sm">
                      <View style={{ flex: 1 }}>
                        <TextField label="From" value={fromInput} onChangeText={setFromInput} placeholder="06:00" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <TextField label="To" value={toInput} onChangeText={setToInput} placeholder="08:00" />
                      </View>
                    </View>
                    {formError ? (
                      <Text style={[textStyle('caption'), { color: colors.danger }]}>{formError}</Text>
                    ) : null}
                    <Button size="sm" loading={submitting} onPress={() => void handleAdd(dayOfWeek)}>
                      <Text style={{ color: colors.inkOnAccent }}>Save {DAY_SHORT[dayOfWeek]} window</Text>
                    </Button>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
