import { useGroups, type TrainingGroup } from '@atlitos/api';
import type { ApiError, Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/organisms/_shared';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { SPORT_LABEL } from '@/lib/sport-display';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

const SPORTS: Sport[] = ['football', 'cricket', 'badminton', 'tennis'];
const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'];

interface FormDraft {
  name: string;
  sport: Sport;
  skillLevel: string;
  capacity: string;
  monthlyFee: string;
  attendancePolicy: string;
  active: boolean;
}

const EMPTY_DRAFT: FormDraft = {
  name: '',
  sport: 'cricket',
  skillLevel: '',
  capacity: '12',
  monthlyFee: '',
  attendancePolicy: '',
  active: true,
};

/**
 * The group size ceiling, mirroring `training_groups_capacity_max` (0112).
 * Every member of a group costs one session notification, one device push and
 * one realtime broadcast event per chat message, so an unbounded capacity is
 * an unbounded fan-out. The constraint is the real enforcement; this constant
 * exists so the coach is told before they submit rather than after.
 */
const MAX_GROUP_CAPACITY = 100;

function draftIssue(draft: FormDraft): string | null {
  if (!draft.name.trim()) return 'Give this group a name.';
  const capacity = Number(draft.capacity);
  if (!Number.isInteger(capacity) || capacity <= 0) return 'Capacity must be a whole number above zero.';
  if (capacity > MAX_GROUP_CAPACITY) {
    return `A group can hold up to ${MAX_GROUP_CAPACITY} members. Split a larger squad into two groups.`;
  }
  const fee = Number(draft.monthlyFee);
  if (!Number.isFinite(fee) || fee < 0) return 'Monthly fee cannot be negative.';
  return null;
}

/**
 * PRD-02 groups. Create a training group, or edit one you already own.
 *
 * `create_training_group` and `update_training_group` (0080) have existed
 * and been tested since that migration landed and had ZERO call sites in
 * the app: `training_groups` grants clients no write verb at all, so
 * without this screen a coach could never make a group, which is why the
 * Trainees tab showed "No training groups yet" with no affordance beside it.
 *
 * One screen for both modes, keyed on the optional `id` param, because the
 * fields are identical apart from sport (immutable after creation: the RPC
 * takes no sport argument, and changing a group's sport under its existing
 * members would be a different group) and Active (create always starts
 * active). Static `edit` beats the sibling `[id]` dynamic route, so
 * `/trainings/group/edit` is create and `/trainings/group/edit?id=...` is
 * edit.
 *
 * Ownership is asserted explicitly on load, not left to RLS:
 * `training_groups` has a public browse policy, so `getGroup` will happily
 * return another verified coach's group for a guessed id. The RPC refuses
 * the write either way, but the form must never show a stranger's fee.
 *
 * `monthly_fee` is a list price, not a money row: every charge derived from
 * it is re-validated server side at join and renew time, which is the same
 * reasoning 0080's own header records.
 */
export default function GroupEditScreen() {
  const colors = useThemeColors();
  const groups = useGroups(supabase);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const [state, setState] = useState<ScreenState>(isEdit ? 'loading' : 'populated');
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<ApiError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setState('loading');
    setError(null);
    try {
      const detail = await groups.getGroup(id);
      const { data: authData } = await supabase.auth.getUser();
      if (!detail || !authData.user || detail.group.coachId !== authData.user.id) {
        setError({ code: 'NOT_FOUND', message: 'This group could not be found.', status: 404 });
        setState('error');
        return;
      }
      const group: TrainingGroup = detail.group;
      setDraft({
        name: group.name,
        sport: group.sport,
        skillLevel: group.skillLevel ?? '',
        capacity: String(group.capacity),
        monthlyFee: String(group.monthlyFee),
        attendancePolicy: group.attendancePolicy ?? '',
        active: group.active,
      });
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
    // Deps are the route param only, deliberately: `groups` is rebuilt every
    // render. No eslint disable comment, because the shared config does not
    // register the react-hooks plugin and naming that rule errors.
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit() {
    const issue = draftIssue(draft);
    if (issue) {
      setFormError(issue);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      if (isEdit && id) {
        await groups.updateGroup({
          groupId: id,
          name: draft.name.trim(),
          skillLevel: draft.skillLevel.trim() || undefined,
          capacity: Number(draft.capacity),
          monthlyFee: Number(draft.monthlyFee),
          attendancePolicy: draft.attendancePolicy.trim() || undefined,
          active: draft.active,
        });
        router.back();
        return;
      }
      const created = await groups.createGroup({
        name: draft.name.trim(),
        sport: draft.sport,
        capacity: Number(draft.capacity),
        monthlyFee: Number(draft.monthlyFee),
        skillLevel: draft.skillLevel.trim() || undefined,
        attendancePolicy: draft.attendancePolicy.trim() || undefined,
      });
      // replace, not push: backing out of a freshly created group must
      // return to the Trainees tab, never to an empty create form.
      router.replace({ pathname: '/(tabs)/trainings/group/[id]', params: { id: created.id } });
    } catch (err) {
      setFormError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  function ChipRow({
    label,
    options,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    options: { key: string; label: string }[];
    value: string;
    onChange: (key: string) => void;
    disabled?: boolean;
  }) {
    return (
      <View style={{ gap: spacing.xs }}>
        <Text style={[textStyle('label'), { color: colors.textSecondary }]}>{label}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {options.map((option) => {
            const selected = value === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !!disabled }}
                disabled={disabled}
                onPress={() => onChange(option.key)}
                style={{
                  borderRadius: radii.pill,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accentTint : colors.surfaceMuted,
                  opacity: disabled && !selected ? 0.5 : 1,
                }}
              >
                <Text style={[textStyle('label'), { color: selected ? colors.accent : colors.textSecondary }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <AppBar variant="back" onPressBack={() => router.back()} />
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="line" width="50%" />
          <Skeleton shape="card" height={120} />
          <Skeleton shape="card" height={120} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'error') {
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
      <AppBar
        variant="backTitle"
        title={isEdit ? 'Edit group' : 'New group'}
        onPressBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['4xl'] }}>
        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
          A group trains together on a monthly fee. Athletes join from your coach profile.
        </Text>

        <TextField
          label="Group name"
          placeholder="Under 16 morning squad"
          value={draft.name}
          onChangeText={(name) => setDraft((prev) => ({ ...prev, name }))}
        />

        <ChipRow
          label={isEdit ? 'Sport, fixed after creation' : 'Sport'}
          options={SPORTS.map((sport) => ({ key: sport, label: SPORT_LABEL[sport] }))}
          value={draft.sport}
          disabled={isEdit}
          onChange={(sport) => setDraft((prev) => ({ ...prev, sport: sport as Sport }))}
        />

        <ChipRow
          label="Skill level"
          options={SKILL_LEVELS.map((level) => ({
            key: level,
            label: level.charAt(0).toUpperCase() + level.slice(1),
          }))}
          value={draft.skillLevel}
          onChange={(skillLevel) =>
            setDraft((prev) => ({
              ...prev,
              // Deselect is create only. `update_training_group` coalesces a
              // null or blank argument to "leave unchanged", so it cannot
              // clear skill_level or attendance_policy back to null. Letting
              // the chip deselect in edit mode would show the coach a change
              // that silently does not happen.
              skillLevel: prev.skillLevel === skillLevel && !isEdit ? '' : skillLevel,
            }))
          }
        />

        <TextField
          label="Capacity"
          placeholder="12"
          keyboardType="number-pad"
          value={draft.capacity}
          onChangeText={(capacity) => setDraft((prev) => ({ ...prev, capacity }))}
        />
        <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
          Up to {MAX_GROUP_CAPACITY} members per group, so everyone gets their session alerts at
          once.
        </Text>

        <TextField
          label="Monthly fee in rupees"
          placeholder="2500"
          keyboardType="decimal-pad"
          value={draft.monthlyFee}
          onChangeText={(monthlyFee) => setDraft((prev) => ({ ...prev, monthlyFee }))}
        />

        <TextField
          label="Attendance policy"
          placeholder="Tell members what happens when they miss a session"
          multiline
          value={draft.attendancePolicy}
          onChangeText={(attendancePolicy) => setDraft((prev) => ({ ...prev, attendancePolicy }))}
        />

        {isEdit ? (
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            Skill level and attendance policy can be changed but not emptied once set.
          </Text>
        ) : null}

        {isEdit ? (
          <ChipRow
            label="Status"
            options={[
              { key: 'active', label: 'Active' },
              { key: 'inactive', label: 'Inactive' },
            ]}
            value={draft.active ? 'active' : 'inactive'}
            onChange={(key) => setDraft((prev) => ({ ...prev, active: key === 'active' }))}
          />
        ) : null}

        {isEdit && !draft.active ? (
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            An inactive group stops accepting joins and renewals. Members keep the period they already paid for.
          </Text>
        ) : null}

        {formError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{formError}</Text> : null}

        <Button loading={submitting} onPress={() => void handleSubmit()}>
          <Text style={{ color: colors.inkOnAccent }}>{isEdit ? 'Save changes' : 'Create group'}</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
