import { useProfile } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { SPORTS, type Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Stepper } from '@/components/ui/stepper';
import { friendlyAuthMessage } from '@/lib/auth-copy';
import { clearOnboardingDeferred } from '@/lib/onboarding-deferred';
import { supabase } from '@/lib/supabase';
import { uploadAvatar } from '@/lib/storage';
import { useOnboardingDraft } from '@/store/onboarding-draft';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const STEP_LABELS = ['Sports', 'Photo', 'Location'];

const SPORT_LABEL: Record<Sport, string> = {
  football: 'Football',
  cricket: 'Cricket',
  badminton: 'Badminton',
  tennis: 'Tennis',
};

/**
 * Player setup wizard. PRD-01 FR-8: at least one sport and a city required
 * before it can be completed; completing it lands on Home in player mode.
 * Each step is its own route (`/(onboarding)/player-setup/[step]`), answers
 * persist in `useOnboardingDraft` across step navigation. States: populated,
 * error (validation per step), submitting (final step only, this is the
 * only step that calls the network).
 */
export default function PlayerSetupStepScreen() {
  const colors = useThemeColors();
  const profile = useProfile(supabase);
  const refreshMe = useSessionStore((state) => state.refreshMe);
  const session = useSessionStore((state) => state.session);

  const { step } = useLocalSearchParams<{ step: string }>();
  const stepIndex = Number(step) || 0;

  const draft = useOnboardingDraft((state) => state.player);
  const setDraft = useOnboardingDraft((state) => state.setPlayer);
  const resetDraft = useOnboardingDraft((state) => state.resetPlayer);

  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLast = stepIndex === STEP_LABELS.length - 1;
  const canGoNext =
    stepIndex === 0 ? draft.sports.length > 0 : stepIndex === 2 ? draft.city.trim().length > 0 : true;

  function toggleSport(sport: Sport) {
    const next = draft.sports.includes(sport)
      ? draft.sports.filter((s) => s !== sport)
      : [...draft.sports, sport];
    setDraft({ sports: next });
  }

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library access was not granted.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    if (!session) {
      setError('Session expired, log in again to add a photo.');
      return;
    }

    setPhotoUploading(true);
    setError(null);
    try {
      const url = await uploadAvatar(session.user.id, result.assets[0].uri);
      setDraft({ avatarUrl: url });
    } catch {
      // TODO: surfaces if the `avatars` Storage bucket is missing in this
      // environment (supabase/migrations/0006_storage_buckets.sql not
      // applied). Player setup still proceeds without a photo.
      setError('Could not upload photo right now, you can add one later from your profile.');
    } finally {
      setPhotoUploading(false);
    }
  }

  function goNext() {
    if (!canGoNext) return;
    if (isLast) {
      void handleFinish();
      return;
    }
    router.push({ pathname: '/(onboarding)/player-setup/[step]', params: { step: String(stepIndex + 1) } });
  }

  function goBack() {
    if (stepIndex === 0) {
      router.back();
      return;
    }
    router.back();
  }

  async function handleFinish() {
    setSubmitting(true);
    setError(null);
    try {
      await profile.completePlayerSetup({
        sports: draft.sports,
        avatarUrl: draft.avatarUrl,
        city: draft.city.trim(),
        state: draft.state.trim(),
      });
      await refreshMe();
      resetDraft();
      // Setup is complete; the explore-first deferral (if any) has served
      // its purpose, so future launches route normally.
      void clearOnboardingDeferred();
      router.replace('/(tabs)');
    } catch (err) {
      setError(friendlyAuthMessage(err as ApiError));
    } finally {
      setSubmitting(false);
    }
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
              <Text style={[textStyle('h2'), { color: colors.text }]}>What do you play.</Text>
              <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                Pick at least one sport to personalize your feed and coach search.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {SPORTS.map((sport) => {
                  const isPrimary = draft.sports[0] === sport;
                  return (
                    <View key={sport} style={{ alignItems: 'center', gap: spacing.xs }}>
                      <Chip
                        label={SPORT_LABEL[sport]}
                        variant="select"
                        selected={draft.sports.includes(sport)}
                        onPress={() => toggleSport(sport)}
                      />
                      {isPrimary ? (
                        <Text style={[textStyle('caption'), { color: colors.accent }]}>Primary</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                Your first pick becomes your primary sport for Learn.
              </Text>
            </View>
          ) : null}

          {stepIndex === 1 ? (
            <View style={{ gap: spacing.md, alignItems: 'center' }}>
              <Text style={[textStyle('h2'), { color: colors.text, alignSelf: 'flex-start' }]}>Add a photo.</Text>
              <Text style={[textStyle('body'), { color: colors.textSecondary, alignSelf: 'flex-start' }]}>
                Optional, you can add or change this anytime from your profile.
              </Text>
              <Pressable
                onPress={() => void handlePickPhoto()}
                accessibilityRole="button"
                style={{ position: 'relative' }}
              >
                <Avatar uri={draft.avatarUrl ?? undefined} size={80} />
                <View
                  style={{
                    position: 'absolute',
                    bottom: -4,
                    right: -4,
                    height: 28,
                    width: 28,
                    borderRadius: radii.pill,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {photoUploading ? (
                    <ActivityIndicator size="small" color={colors.inkOnAccent} />
                  ) : (
                    <Camera size={14} color={colors.inkOnAccent} strokeWidth={2} />
                  )}
                </View>
              </Pressable>
            </View>
          ) : null}

          {stepIndex === 2 ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('h2'), { color: colors.text }]}>Where are you based.</Text>
              <Input label="City" required value={draft.city} onChangeText={(city) => setDraft({ city })} />
              <Input label="State" value={draft.state} onChangeText={(state) => setDraft({ state })} />
            </View>
          ) : null}

          {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button variant="secondary" onPress={goBack} style={{ flex: 1 }}>
            <Text style={[textStyle('label'), { color: colors.text }]}>Back</Text>
          </Button>
          <Button loading={submitting} disabled={!canGoNext} onPress={goNext} style={{ flex: 1 }}>
            <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>{isLast ? 'Finish' : 'Next'}</Text>
          </Button>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
