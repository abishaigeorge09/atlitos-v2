import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { friendlyAuthMessage } from '@/lib/auth-copy';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Splash. PRD-01 3.1: "loading only (auto-route)... Routes by session:
 * authenticated to Home, guest-continued to Home, neither to Login". This
 * screen resolves in one step: while `hydrated` is false, show only the
 * wordmark/tagline (the "loading" state the PRD table lists). Once
 * hydrated, EVERY status routes straight to `/(tabs)`:
 *   - `guest`/`signed_in` were already there before this change.
 *   - `signed_out` (first-ever open, or after a real sign out) now
 *     silently starts a guest session and routes to `/(tabs)` too, with
 *     zero login prompt in the way. There is no first-run choice screen
 *     any more; Login, Register and onboarding are never forced at launch,
 *     only offered later exactly where they are relevant:
 *       - Login/Register: the guest gate (`LoginGateModal`) any gated tap
 *         raises (book a court, like a clip, open a wallet, etc).
 *       - Onboarding (role select): Home's "Finish setting up" nudge card,
 *         shown to a signed-in user who has not set a city yet
 *         (`apps/mobile/src/app/(tabs)/index.tsx` `showFinishSetup`), plus
 *         Account and any role-specific action ("become a coach").
 *     `continueAsGuest` failing outright (e.g. anonymous sign-ins disabled
 *     on the Supabase project) is the one case this screen still shows UI
 *     for, since a guest with no working path into the app has nowhere
 *     else to go.
 *
 * Track D hardening carried over:
 *   - A signed-in session whose profile fetch FAILED (meError, me null) no
 *     longer routes to tabs as if fully onboarded; it shows a retry state
 *     wired to `refreshMe` instead (defect 3).
 */
export default function SplashScreen() {
  const colors = useThemeColors();
  const [guestError, setGuestError] = useState<string | null>(null);
  const status = useSessionStore((state) => state.status);
  const hydrated = useSessionStore((state) => state.hydrated);
  const me = useSessionStore((state) => state.me);
  const meLoading = useSessionStore((state) => state.meLoading);
  const meError = useSessionStore((state) => state.meError);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);
  const refreshMe = useSessionStore((state) => state.refreshMe);

  // Guards against firing continueAsGuest more than once while its promise
  // is still in flight (status stays 'signed_out' until onAuthStateChange
  // resolves it), and against retrying forever after a hard failure without
  // the "Try again" tap below.
  const guestAttempted = useRef(false);

  useEffect(() => {
    if (!hydrated) return;

    if (status === 'guest') {
      guestAttempted.current = false;
      router.replace('/(tabs)');
      return;
    }

    if (status === 'signed_in') {
      guestAttempted.current = false;
      if (meLoading) return; // wait for profile to resolve before deciding
      if (!me && meError) return; // profile fetch failed: retry state below, never route as fake-onboarded
      router.replace('/(tabs)');
      return;
    }

    if (status === 'signed_out' && !guestAttempted.current) {
      guestAttempted.current = true;
      setGuestError(null);
      continueAsGuest().catch((e: unknown) => {
        // Surfaces infra failures (e.g. anonymous sign ins disabled on the
        // Supabase project) instead of a silent, stuck spinner.
        guestAttempted.current = false;
        setGuestError(friendlyAuthMessage(e));
      });
    }
  }, [status, hydrated, me, meLoading, meError, continueAsGuest]);

  const showMeRetry = hydrated && status === 'signed_in' && !meLoading && !me && meError != null;
  const showGuestRetry = hydrated && status === 'signed_out' && guestError != null;
  const showSpinner =
    (!hydrated || (status === 'signed_in' && meLoading) || (status === 'signed_out' && !guestError)) &&
    !showMeRetry;

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

        {showGuestRetry ? (
          <View style={styles.actions}>
            <Text style={[textStyle('caption'), { color: colors.danger, textAlign: 'center' }]}>{guestError}</Text>
            <Button
              onPress={() => {
                guestAttempted.current = true;
                setGuestError(null);
                continueAsGuest().catch((e: unknown) => {
                  guestAttempted.current = false;
                  setGuestError(friendlyAuthMessage(e));
                });
              }}
            >
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Try again</Text>
            </Button>
            <Button variant="text" onPress={() => router.push('/(auth)/login')}>
              <Text style={[textStyle('label'), { color: colors.accent }]}>Log in instead</Text>
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
