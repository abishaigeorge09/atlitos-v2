import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { friendlyAuthMessage } from '@/lib/auth-copy';
import { getOnboardingDeferred } from '@/lib/onboarding-deferred';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Splash. PRD-01 3.1: "loading only (auto-route)... Routes by session:
 * authenticated to Home, guest-continued to Home, neither to Login". This
 * screen resolves that in two steps:
 *   1. While `hydrated` is false, show only the wordmark/tagline (the
 *      "loading" state the PRD table lists, no forced login screen yet).
 *   2. Once hydrated: `signed_in`/`guest` auto-route to (tabs) or
 *      (onboarding) as appropriate; `signed_out` stays here and offers
 *      "Continue as guest" front and center (PRD-01 FR-1: a first open with
 *      no session must not force login or registration) alongside a Log in
 *      link for returning users.
 *
 * Track D hardening:
 *   - A signed-in session whose profile fetch FAILED (meError, me null) no
 *     longer routes to tabs as if fully onboarded; it shows a retry state
 *     wired to `refreshMe` instead (defect 3).
 *   - Onboarding is only FORCED once: after the user chooses "Explore the
 *     app first" on role select, the `onboarding_deferred` flag routes them
 *     straight to tabs on later launches; Home's finish-setup card is the
 *     ongoing nudge (defect 2).
 */
export default function SplashScreen() {
  const colors = useThemeColors();
  const [guestError, setGuestError] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<boolean | null>(null);
  const status = useSessionStore((state) => state.status);
  const hydrated = useSessionStore((state) => state.hydrated);
  const me = useSessionStore((state) => state.me);
  const meLoading = useSessionStore((state) => state.meLoading);
  const meError = useSessionStore((state) => state.meError);
  const needsOnboarding = useSessionStore((state) => state.needsOnboarding);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);
  const refreshMe = useSessionStore((state) => state.refreshMe);

  useEffect(() => {
    let active = true;
    getOnboardingDeferred().then((value) => {
      if (active) setDeferred(value);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || deferred === null) return;

    if (status === 'guest') {
      router.replace('/(tabs)');
      return;
    }

    if (status === 'signed_in') {
      if (meLoading) return; // wait for profile to resolve before deciding
      if (!me && meError) return; // profile fetch failed: retry state below, never route as fake-onboarded
      router.replace(needsOnboarding() && !deferred ? '/(onboarding)/role-select' : '/(tabs)');
    }
  }, [status, hydrated, me, meLoading, meError, needsOnboarding, deferred]);

  const showGuestSplash = hydrated && status === 'signed_out';
  const showMeRetry = hydrated && status === 'signed_in' && !meLoading && !me && meError != null;
  const showSpinner = (!hydrated || (status === 'signed_in' && meLoading)) && !showMeRetry;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <Text style={[textStyle('display'), styles.wordmark, { color: colors.text }]}>Atlitos</Text>
        <Text style={[textStyle('body'), styles.tagline, { color: colors.textSecondary }]}>
          Train, play and follow the game, all in one place.
        </Text>

        {showSpinner ? (
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        ) : null}

        {showMeRetry ? (
          <View style={styles.actions}>
            <Text style={[textStyle('caption'), { color: colors.danger, textAlign: 'center' }]}>
              We could not load your profile. Check your connection and try again.
            </Text>
            <Button onPress={() => void refreshMe()}>
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Try again</Text>
            </Button>
          </View>
        ) : null}

        {showGuestSplash ? (
          <View style={styles.actions}>
            <Button
              onPress={() => {
                setGuestError(null);
                continueAsGuest().catch((e: unknown) => {
                  // Surfaces infra failures (e.g. anonymous sign ins disabled
                  // on the Supabase project) instead of a silent no op.
                  setGuestError(friendlyAuthMessage(e));
                });
              }}
            >
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Continue as guest</Text>
            </Button>
            {guestError ? (
              <Text style={[textStyle('caption'), { color: colors.danger, textAlign: 'center' }]}>{guestError}</Text>
            ) : null}
            <Button variant="text" onPress={() => router.push('/(auth)/login')}>
              <Text style={[textStyle('label'), { color: colors.accent }]}>Log in</Text>
            </Button>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  wordmark: { textAlign: 'center' },
  tagline: { textAlign: 'center', maxWidth: 300 },
  spinner: { marginTop: spacing.lg },
  actions: { width: '100%', maxWidth: 320, gap: spacing.sm, marginTop: spacing.lg },
});
