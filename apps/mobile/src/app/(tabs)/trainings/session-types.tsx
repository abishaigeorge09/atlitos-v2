import { isOnlineSessionTypeName, useCoachSessionTypes } from '@atlitos/api';
import type { ApiError, SessionTypeOption } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Clock, EyeOff, Plus, TriangleAlert, Wifi } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/organisms/_shared';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { PriceText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

interface FormDraft {
  name: string;
  durationMinutes: string;
  price: string;
  isOnline: boolean;
}

const EMPTY_DRAFT: FormDraft = { name: '', durationMinutes: '60', price: '', isOnline: false };

const DURATION_PRESETS = [30, 45, 60, 90];

function draftIssue(draft: FormDraft): string | null {
  if (!draft.name.trim()) return 'Give this session type a name.';
  const duration = Number(draft.durationMinutes);
  if (!Number.isInteger(duration) || duration <= 0) return 'Duration must be a whole number of minutes above zero.';
  const price = Number(draft.price);
  if (!Number.isFinite(price) || price <= 0) return 'Price must be above zero.';
  return null;
}

/**
 * PRD-02 FR-4, the coach's session types and pricing.
 *
 * This screen is the reason a coach is bookable at all. `sessions`
 * .session_type_id is NOT NULL (0018_coaching.sql), and the athlete's
 * booking screen only lists types where `active` is true, so a coach with
 * zero rows here cannot receive a single request no matter how complete
 * their profile or availability is. The onboarding wizard collects these at
 * step 4 but only ever wrote them into `verification_requests.payload`,
 * which nothing reads; 0088 backfills the coaches stranded by that, and this
 * screen is how every coach owns them from here on.
 *
 * Writes go straight to the table under `session_types_write_own`
 * (0019_coaching_rls.sql:67), no RPC. That is not a financial invariant
 * exception: a session type price is a list price, never a money row, and
 * the real charge is recomputed and re-validated server side at booking
 * (`PRICE_MISMATCH`). Nothing on this screen debits, credits, or transitions
 * anything.
 *
 * Online is a NAMING CONVENTION, deliberately, and this screen is its only
 * writer. See `applyOnlineSessionTypeName` in packages/api for why there is
 * no `is_online` column and what has to happen before one exists. The
 * toggle here is what makes the convention deliberate rather than accidental:
 * the coach picks a mode and the stored name is derived from it.
 *
 * No delete: a type is deactivated, never removed, because historical
 * sessions point at it by FK and read its name back.
 *
 * States: loading, populated (with a zero rows call to action that says
 * plainly what it unblocks), error.
 */
export default function CoachSessionTypesScreen() {
  const colors = useThemeColors();
  const sessionTypes = useCoachSessionTypes(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [types, setTypes] = useState<SessionTypeOption[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await sessionTypes.listMyTypes();
      setTypes(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
    // Intentionally no deps: `sessionTypes` is a fresh object every render
    // and this must run once. No disable comment, because the shared eslint
    // config does not register the react-hooks plugin, so naming that rule
    // is itself a lint error (see the repo wide occurrences).
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setComposerOpen(true);
  }

  function openEdit(type: SessionTypeOption) {
    setEditingId(type.id);
    setDraft({
      name: type.name,
      durationMinutes: String(type.durationMinutes),
      price: String(type.price),
      isOnline: isOnlineSessionTypeName(type.name),
    });
    setFormError(null);
    setComposerOpen(true);
  }

  async function handleSubmit() {
    const issue = draftIssue(draft);
    if (issue) {
      setFormError(issue);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      if (editingId) {
        const updated = await sessionTypes.updateType({
          typeId: editingId,
          name: draft.name,
          durationMinutes: Number(draft.durationMinutes),
          price: Number(draft.price),
          isOnline: draft.isOnline,
        });
        setTypes((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await sessionTypes.createType({
          name: draft.name,
          durationMinutes: Number(draft.durationMinutes),
          price: Number(draft.price),
          isOnline: draft.isOnline,
        });
        setTypes((prev) => [created, ...prev]);
      }
      setComposerOpen(false);
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setFormError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(type: SessionTypeOption) {
    setTogglingId(type.id);
    setError(null);
    try {
      const updated = await sessionTypes.setTypeActive(type.id, !type.active);
      setTypes((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setTogglingId(null);
    }
  }

  const activeCount = types.filter((type) => type.active).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Session types" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="card" height={88} />
          <Skeleton shape="card" height={88} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Could not load your session types
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
            Athletes book one of these. You need at least one active type before anyone can send you a request.
          </Text>

          {activeCount === 0 ? (
            <View
              style={{
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.warning,
                backgroundColor: colors.warningTint,
                padding: spacing.lg,
                gap: spacing.sm,
              }}
            >
              <Text style={[textStyle('h3'), { color: colors.text }]}>You are not bookable yet</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                Add a session type with a duration and a price. Until you do, your profile shows no options to book.
              </Text>
            </View>
          ) : null}

          {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error.message}</Text> : null}

          {types.map((type) => (
            <Pressable
              key={type.id}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${type.name}`}
              onPress={() => openEdit(type)}
              style={{
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
                gap: spacing.sm,
                opacity: type.active ? 1 : 0.6,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[textStyle('h3'), { color: colors.text, flex: 1 }]}>{type.name}</Text>
                <PriceText amount={type.price} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <Clock size={14} strokeWidth={1.75} color={colors.textTertiary} />
                  <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>
                    {type.durationMinutes} min
                  </Text>
                </View>
                {isOnlineSessionTypeName(type.name) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Wifi size={14} strokeWidth={1.75} color={colors.textTertiary} />
                    <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Online</Text>
                  </View>
                ) : null}
                {!type.active ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <EyeOff size={14} strokeWidth={1.75} color={colors.textTertiary} />
                    <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Hidden</Text>
                  </View>
                ) : null}
              </View>
              <Button
                variant="text"
                size="sm"
                tone={type.active ? 'danger' : 'default'}
                loading={togglingId === type.id}
                onPress={() => void handleToggleActive(type)}
              >
                <Text style={{ color: type.active ? colors.danger : colors.accent }}>
                  {type.active ? 'Hide from athletes' : 'Show to athletes'}
                </Text>
              </Button>
            </Pressable>
          ))}

          {composerOpen ? (
            <View
              style={{
                gap: spacing.md,
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                backgroundColor: colors.card,
                padding: spacing.lg,
              }}
            >
              <Text style={[textStyle('h3'), { color: colors.text }]}>
                {editingId ? 'Edit session type' : 'New session type'}
              </Text>

              <TextField
                label="Name"
                placeholder="Batting fundamentals"
                value={draft.name}
                onChangeText={(name) => setDraft((prev) => ({ ...prev, name }))}
              />

              <View style={{ gap: spacing.xs }}>
                <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Duration in minutes</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {DURATION_PRESETS.map((minutes) => {
                    const selected = Number(draft.durationMinutes) === minutes;
                    return (
                      <Pressable
                        key={minutes}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setDraft((prev) => ({ ...prev, durationMinutes: String(minutes) }))}
                        style={{
                          borderRadius: radii.pill,
                          paddingHorizontal: spacing.lg,
                          paddingVertical: spacing.sm,
                          borderWidth: 1,
                          borderColor: selected ? colors.accent : colors.border,
                          backgroundColor: selected ? colors.accentTint : colors.surfaceMuted,
                        }}
                      >
                        <Text
                          style={[
                            textStyle('numericSm'),
                            { color: selected ? colors.accent : colors.textSecondary },
                          ]}
                        >
                          {minutes}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextField
                  value={draft.durationMinutes}
                  keyboardType="number-pad"
                  placeholder="60"
                  onChangeText={(durationMinutes) => setDraft((prev) => ({ ...prev, durationMinutes }))}
                />
              </View>

              <TextField
                label="Price per session in rupees"
                placeholder="800"
                keyboardType="decimal-pad"
                value={draft.price}
                onChangeText={(price) => setDraft((prev) => ({ ...prev, price }))}
              />

              <View style={{ gap: spacing.xs }}>
                <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Mode</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {([false, true] as const).map((online) => {
                    const selected = draft.isOnline === online;
                    return (
                      <Pressable
                        key={String(online)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setDraft((prev) => ({ ...prev, isOnline: online }))}
                        style={{
                          borderRadius: radii.pill,
                          paddingHorizontal: spacing.lg,
                          paddingVertical: spacing.sm,
                          borderWidth: 1,
                          borderColor: selected ? colors.accent : colors.border,
                          backgroundColor: selected ? colors.accentTint : colors.surfaceMuted,
                        }}
                      >
                        <Text style={[textStyle('label'), { color: selected ? colors.accent : colors.textSecondary }]}>
                          {online ? 'Online' : 'In person'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                  Online types are shown to athletes filtering for online coaching.
                </Text>
              </View>

              {formError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{formError}</Text> : null}

              <Button loading={submitting} onPress={() => void handleSubmit()}>
                <Text style={{ color: colors.inkOnAccent }}>{editingId ? 'Save changes' : 'Add session type'}</Text>
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  setComposerOpen(false);
                  setEditingId(null);
                  setFormError(null);
                }}
              >
                <Text style={{ color: colors.text }}>Cancel</Text>
              </Button>
            </View>
          ) : (
            <Button onPress={openCreate}>
              <Plus size={18} strokeWidth={1.75} color={colors.inkOnAccent} />
              <Text style={{ color: colors.inkOnAccent }}>New session type</Text>
            </Button>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
