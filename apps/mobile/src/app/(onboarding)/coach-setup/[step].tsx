import { useProfile } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { SPORTS, type Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, CircleCheck, FileText, Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Stepper } from '@/components/ui/stepper';
import { friendlyAuthMessage } from '@/lib/auth-copy';
import { clearOnboardingDeferred } from '@/lib/onboarding-deferred';
import { uploadAvatar, uploadCoachCertificate } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import {
  useOnboardingDraft,
  type AvailabilityWindowDraft,
  type SessionTypeDraft,
} from '@/store/onboarding-draft';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const STEP_LABELS = ['Sport', 'Photo', 'Experience', 'Certificates', 'Pricing', 'Availability', 'About'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SPORT_LABEL: Record<Sport, string> = {
  football: 'Football',
  cricket: 'Cricket',
  badminton: 'Badminton',
  tennis: 'Tennis',
};

const MIN_SESSION_PRICE = 10;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Track D defect 9: the wizard validates rows where they are edited, not by
 * silently filtering them out at submit. A row that would be dropped shows
 * why, inline, and blocks Next. */
function sessionTypeIssue(sessionType: SessionTypeDraft): string | null {
  // book-session refuses a price at or under the flat platform fee (10.00,
  // 0010), so a cheaper type could never be booked.
  if (!sessionType.name.trim() || !(Number(sessionType.price) > MIN_SESSION_PRICE)) {
    return 'Give this session a name and a price above 10 rupees.';
  }
  return null;
}

function availabilityIssue(
  window: AvailabilityWindowDraft,
  index: number,
  all: AvailabilityWindowDraft[],
): string | null {
  if (!HHMM_RE.test(window.from) || !HHMM_RE.test(window.to)) {
    return 'Use 24 hour times like 06:30 for From and To.';
  }
  if (window.from >= window.to) {
    return 'From must be earlier than To.';
  }
  // The live table refuses overlapping windows on a day (exclusion
  // constraint), and approval copies these rows in, so an overlap here made
  // the coach impossible to approve. Flag the later row of the pair.
  const clash = all.some(
    (other, i) =>
      i < index && other.dayOfWeek === window.dayOfWeek && window.from < other.to && other.from < window.to,
  );
  if (clash) return 'This overlaps another window on the same day.';
  return null;
}

/**
 * Coach setup wizard. PRD-02 3.1: sport, profile photo, experience,
 * coaching style, certificates (multiple), session types and pricing,
 * availability windows, state, city, bio. FR-3/FR-4/FR-5: at least one
 * certificate, one priced session type, and one availability window are
 * required before submit is allowed. Submitting shows "Submitted for
 * review", not a success screen (FR-6, FR-7).
 */
export default function CoachSetupStepScreen() {
  const colors = useThemeColors();
  const profile = useProfile(supabase);
  const session = useSessionStore((state) => state.session);
  const refreshMe = useSessionStore((state) => state.refreshMe);

  const { step } = useLocalSearchParams<{ step: string }>();
  const stepIndex = Number(step) || 0;

  const draft = useOnboardingDraft((state) => state.coach);
  const setDraft = useOnboardingDraft((state) => state.setCoach);
  const resetDraft = useOnboardingDraft((state) => state.resetCoach);

  const [photoUploading, setPhotoUploading] = useState(false);
  const [certUploading, setCertUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const isLast = stepIndex === STEP_LABELS.length - 1;
  // Defect 9: Certificates needs at least one REAL upload (a row whose
  // storagePath exists, not just a picked-but-failed file); Pricing and
  // Availability need every row valid, not just a non-empty array.
  const canGoNext =
    stepIndex === 0
      ? draft.sport !== null
      : stepIndex === 3
        ? draft.certificates.some((cert) => cert.storagePath)
        : stepIndex === 4
          ? draft.sessionTypes.length > 0 && draft.sessionTypes.every((s) => sessionTypeIssue(s) === null)
          : stepIndex === 5
            ? draft.availabilityWindows.length > 0 &&
              draft.availabilityWindows.every((w, i, all) => availabilityIssue(w, i, all) === null)
            : stepIndex === 6
              ? draft.city.trim().length > 0
              : true;

  function goNext() {
    if (!canGoNext) return;
    if (isLast) {
      void handleFinish();
      return;
    }
    router.push({ pathname: '/(onboarding)/coach-setup/[step]', params: { step: String(stepIndex + 1) } });
  }

  async function handlePickPhoto() {
    // The system photo picker (PHPicker) needs no library permission, so none
    // is requested (launch runbook 3.6). Only the picked file is shared.
    if (!session) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    setPhotoUploading(true);
    setError(null);
    try {
      const url = await uploadAvatar(session.user.id, result.assets[0].uri);
      setDraft({ avatarUrl: url });
    } catch {
      setError('Could not upload photo right now, you can add one later from your profile.');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handlePickCertificates() {
    // The system photo picker (PHPicker) needs no library permission, so none
    // is requested (launch runbook 3.6). Only the picked file is shared.
    if (!session) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    setCertUploading(true);
    setError(null);
    const uploaded = [...draft.certificates];
    for (const asset of result.assets) {
      const name = asset.fileName ?? `Certificate ${uploaded.length + 1}`;
      try {
        // TODO: surfaces if the `coach-certificates` Storage bucket is
        // missing in this environment (supabase/migrations/0006_storage_buckets.sql
        // not applied); the certificate is kept in the draft with
        // storagePath null and uploadError set, so the step still shows it
        // was picked, submit blocks on a real storage path per FR-3.
        const storagePath = await uploadCoachCertificate(session.user.id, asset.uri, name);
        uploaded.push({ name, localUri: asset.uri, storagePath, uploadError: null });
      } catch {
        uploaded.push({
          name,
          localUri: asset.uri,
          storagePath: null,
          uploadError: 'Upload failed, remove and try again.',
        });
      }
    }
    setDraft({ certificates: uploaded });
    setCertUploading(false);
  }

  function removeCertificate(index: number) {
    setDraft({ certificates: draft.certificates.filter((_, i) => i !== index) });
  }

  function addSessionType() {
    const next: SessionTypeDraft[] = [...draft.sessionTypes, { name: '', durationMinutes: '60', price: '' }];
    setDraft({ sessionTypes: next });
  }

  function updateSessionType(index: number, patch: Partial<SessionTypeDraft>) {
    const next = draft.sessionTypes.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setDraft({ sessionTypes: next });
  }

  function removeSessionType(index: number) {
    setDraft({ sessionTypes: draft.sessionTypes.filter((_, i) => i !== index) });
  }

  function addAvailabilityWindow() {
    // Start each new row on the day after the last one, so tapping Add twice
    // never creates two identical Monday windows.
    const last = draft.availabilityWindows[draft.availabilityWindows.length - 1];
    const dayOfWeek = last ? (last.dayOfWeek + 1) % 7 : 1;
    const next: AvailabilityWindowDraft[] = [
      ...draft.availabilityWindows,
      { dayOfWeek, from: '06:00', to: '08:00' },
    ];
    setDraft({ availabilityWindows: next });
  }

  function updateAvailabilityWindow(index: number, patch: Partial<AvailabilityWindowDraft>) {
    const next = draft.availabilityWindows.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setDraft({ availabilityWindows: next });
  }

  function removeAvailabilityWindow(index: number) {
    setDraft({ availabilityWindows: draft.availabilityWindows.filter((_, i) => i !== index) });
  }

  async function handleFinish() {
    if (!draft.sport) return;

    // Defect 9: submit refuses invalid rows out loud instead of silently
    // filtering them away. The per-step gates normally prevent reaching here
    // with bad rows; these guards cover deep links straight to the last step.
    if (!draft.certificates.some((c) => c.storagePath)) {
      setError('Add at least one certificate that uploaded successfully before you submit.');
      return;
    }
    if (draft.certificates.some((c) => !c.storagePath)) {
      setError('A certificate upload failed. Remove it or add it again before you submit.');
      return;
    }
    if (draft.sessionTypes.length === 0 || draft.sessionTypes.some((s) => sessionTypeIssue(s) !== null)) {
      setError('Every session type needs a name and a price above zero.');
      return;
    }
    if (
      draft.availabilityWindows.length === 0 ||
      draft.availabilityWindows.some((w, i, all) => availabilityIssue(w, i, all) !== null)
    ) {
      setError('Check your availability times before you submit.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await profile.submitCoachVerification({
        sport: draft.sport,
        experienceYears: Number(draft.experienceYears) || 0,
        coachingStyle: draft.coachingStyle.trim() || undefined,
        bio: draft.bio.trim() || undefined,
        city: draft.city.trim(),
        state: draft.state.trim(),
        certificates: draft.certificates.map((c) => ({ name: c.name, storagePath: c.storagePath })),
        sessionTypes: draft.sessionTypes.map((s) => ({
          name: s.name.trim(),
          durationMinutes: Number(s.durationMinutes) || 60,
          price: Number(s.price),
        })),
        availabilityWindows: draft.availabilityWindows.map((w) => ({
          dayOfWeek: w.dayOfWeek,
          from: w.from,
          to: w.to,
        })),
      });
      await refreshMe();
      // Setup is complete; the explore-first deferral (if any) is done.
      void clearOnboardingDeferred();
      setSubmitted(true);
    } catch (err) {
      setError(friendlyAuthMessage(err as ApiError));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg, alignItems: 'center', justifyContent: 'center' }}>
          <CircleCheck size={64} color={colors.success} strokeWidth={1.5} />
          <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}>Submitted for review.</Text>
          <Text style={[textStyle('body'), { color: colors.textSecondary, textAlign: 'center' }]}>
            An admin will review your profile. You will be notified once you are verified and discoverable to
            players.
          </Text>
          <Button
            onPress={() => {
              resetDraft();
              router.replace('/(tabs)');
            }}
          >
            <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Go to home</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <Stepper steps={STEP_LABELS} current={stepIndex} />

        <View style={{ flex: 1, gap: spacing.lg }}>
          {stepIndex === 0 ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>What do you coach?</Text>
              <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                One sport per coach profile. This cannot change once you submit.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {SPORTS.map((sport) => (
                  <Chip
                    key={sport}
                    label={SPORT_LABEL[sport]}
                    variant="select"
                    selected={draft.sport === sport}
                    onPress={() => setDraft({ sport })}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {stepIndex === 1 ? (
            <View style={{ gap: spacing.md, alignItems: 'center' }}>
              <Text style={[textStyle('h2'), { color: colors.text, alignSelf: 'flex-start' }]}>Add a photo.</Text>
              {/* BUG-064: an empty circle with no icon, label or hint; nothing
                  said it was tappable, and VoiceOver announced only "button". */}
              <Pressable
                onPress={() => void handlePickPhoto()}
                accessibilityRole="button"
                accessibilityLabel={draft.avatarUrl ? 'Change photo' : 'Add a photo'}
                style={{ position: 'relative' }}
              >
                <Avatar uri={draft.avatarUrl ?? undefined} size={80} />
                {draft.avatarUrl ? null : (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Camera size={28} color={colors.accent} strokeWidth={1.75} />
                  </View>
                )}
              </Pressable>
              {photoUploading ? (
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>Uploading.</Text>
              ) : (
                <Text style={[textStyle('caption'), { color: colors.textSecondary, textAlign: 'center' }]}>
                  {draft.avatarUrl
                    ? 'Tap your photo to change it.'
                    : 'A clear photo of your face helps athletes choose you. You can add one later.'}
                </Text>
              )}
            </View>
          ) : null}

          {stepIndex === 2 ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>Your experience.</Text>
              <Input
                label="Years coaching"
                required
                type="pincode"
                value={draft.experienceYears}
                onChangeText={(experienceYears) => setDraft({ experienceYears })}
              />
              <Input
                label="Coaching style"
                type="multiline"
                value={draft.coachingStyle}
                onChangeText={(coachingStyle) => setDraft({ coachingStyle })}
                placeholder="Technical drills, match simulation, fitness focus..."
              />
            </View>
          ) : null}

          {stepIndex === 3 ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>Upload certificates.</Text>
              <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                At least one is required, coaching licenses or certifications.
              </Text>
              {draft.certificates.map((cert, index) => (
                <View
                  key={`${cert.name}-${index}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: cert.uploadError ? colors.danger : colors.border,
                    backgroundColor: colors.card,
                  }}
                >
                  <FileText size={20} color={colors.textSecondary} strokeWidth={1.75} />
                  <View style={{ flex: 1 }}>
                    <Text style={[textStyle('label'), { color: colors.text }]} numberOfLines={1}>
                      {cert.name}
                    </Text>
                    {cert.uploadError ? (
                      <Text style={[textStyle('caption'), { color: colors.danger }]}>{cert.uploadError}</Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => removeCertificate(index)} accessibilityRole="button" accessibilityLabel={`Remove ${cert.name}`} hitSlop={8}>
                    <Trash2 size={18} color={colors.textTertiary} strokeWidth={1.75} />
                  </Pressable>
                </View>
              ))}
              <Button variant="secondary" loading={certUploading} onPress={() => void handlePickCertificates()}>
                <Plus size={18} color={colors.text} strokeWidth={1.75} />
                <Text style={[textStyle('label'), { color: colors.text }]}>Add certificate</Text>
              </Button>
            </View>
          ) : null}

          {stepIndex === 4 ? (
            <View style={{ gap: spacing.md }}>
              <View style={{ gap: spacing.xs }}>
                <Text style={[textStyle('h2'), { color: colors.text }]}>Session types and pricing.</Text>
                <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                  Athletes will pay the price you set. You will receive it after our platform fee is deducted.
                </Text>
              </View>
              {draft.sessionTypes.map((sessionType, index) => {
                const issue = sessionTypeIssue(sessionType);
                const touched = sessionType.name !== '' || sessionType.price !== '';
                return (
                <View
                  key={index}
                  style={{
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: issue && touched ? colors.danger : colors.border,
                    backgroundColor: colors.card,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Session {index + 1}</Text>
                    <Pressable onPress={() => removeSessionType(index)} accessibilityRole="button" accessibilityLabel={`Remove session ${index + 1}`} hitSlop={8}>
                      <Trash2 size={18} color={colors.textTertiary} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                  <Input
                    label="Name"
                    placeholder="One on one"
                    value={sessionType.name}
                    onChangeText={(name) => updateSessionType(index, { name })}
                  />
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Input
                      containerClassName="flex-1"
                      label="Duration (min)"
                      type="pincode"
                      value={sessionType.durationMinutes}
                      onChangeText={(durationMinutes) => updateSessionType(index, { durationMinutes })}
                    />
                    <Input
                      containerClassName="flex-1"
                      label="Session fee (INR)"
                      type="pincode"
                      value={sessionType.price}
                      onChangeText={(price) => updateSessionType(index, { price })}
                    />
                  </View>
                  {issue && touched ? (
                    <Text style={[textStyle('caption'), { color: colors.danger }]}>{issue}</Text>
                  ) : null}
                </View>
                );
              })}
              <Button variant="secondary" onPress={addSessionType}>
                <Plus size={18} color={colors.text} strokeWidth={1.75} />
                <Text style={[textStyle('label'), { color: colors.text }]}>Add session type</Text>
              </Button>
            </View>
          ) : null}

          {stepIndex === 5 ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>Weekly availability.</Text>
              {draft.availabilityWindows.map((window, index) => {
                const issue = availabilityIssue(window, index, draft.availabilityWindows);
                return (
                <View
                  key={index}
                  style={{
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: issue ? colors.danger : colors.border,
                    backgroundColor: colors.card,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Window {index + 1}</Text>
                    <Pressable onPress={() => removeAvailabilityWindow(index)} accessibilityRole="button" accessibilityLabel={`Remove window ${index + 1}`} hitSlop={8}>
                      <Trash2 size={18} color={colors.textTertiary} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {DAY_LABELS.map((label, day) => (
                      <Chip
                        key={label}
                        label={label}
                        variant="select"
                        selected={window.dayOfWeek === day}
                        onPress={() => updateAvailabilityWindow(index, { dayOfWeek: day })}
                      />
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Input
                      containerClassName="flex-1"
                      label="From (HH:MM)"
                      value={window.from}
                      onChangeText={(from) => updateAvailabilityWindow(index, { from })}
                    />
                    <Input
                      containerClassName="flex-1"
                      label="To (HH:MM)"
                      value={window.to}
                      onChangeText={(to) => updateAvailabilityWindow(index, { to })}
                    />
                  </View>
                  {issue ? (
                    <Text style={[textStyle('caption'), { color: colors.danger }]}>{issue}</Text>
                  ) : null}
                </View>
                );
              })}
              <Button variant="secondary" onPress={addAvailabilityWindow}>
                <Plus size={18} color={colors.text} strokeWidth={1.75} />
                <Text style={[textStyle('label'), { color: colors.text }]}>Add availability window</Text>
              </Button>
            </View>
          ) : null}

          {stepIndex === 6 ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>About you.</Text>
              <Input label="City" required value={draft.city} onChangeText={(city) => setDraft({ city })} />
              <Input label="State" value={draft.state} onChangeText={(state) => setDraft({ state })} />
              <Input
                label="Bio"
                type="multiline"
                value={draft.bio}
                onChangeText={(bio) => setDraft({ bio })}
                placeholder="Tell players about your coaching background."
              />
            </View>
          ) : null}

          {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button variant="secondary" onPress={() => router.back()} style={{ flex: 1 }}>
            <Text style={[textStyle('label'), { color: colors.text }]}>Back</Text>
          </Button>
          <Button loading={submitting} disabled={!canGoNext} onPress={goNext} style={{ flex: 1 }}>
            <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>{isLast ? 'Submit' : 'Next'}</Text>
          </Button>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
