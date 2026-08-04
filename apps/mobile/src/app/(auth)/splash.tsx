import { spacing, spring } from '@atlitos/theme';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthCta, AuthScene } from '@/components/organisms/auth/AuthScene';
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
 *     `continueAsGuest` retries a few times with backoff (packages/api
 *     `useAuth`); if it STILL fails (e.g. anonymous sign-ins disabled on the
 *     Supabase project) this screen degrades gracefully and routes into
 *     `/(tabs)` anyway rather than raising a full-screen login wall. Public
 *     browse works with the anon key, and any authenticated tap already
 *     raises the LoginGateModal, so a first-time user always lands in the
 *     app; there is no guest-to-login wall on launch.
 *
 * Track D hardening carried over:
 *   - A signed-in session whose profile fetch FAILED (meError, me null) no
 *     longer routes to tabs as if fully onboarded; it shows a retry state
 *     wired to `refreshMe` instead (defect 3).
 *
 * Visual: the wordmark and tagline spring in over the shared AuthScene
 * aurora, so even the loading moment feels alive. All routing logic below is
 * unchanged.
 */
export default function SplashScreen() {
  const colors = useThemeColors();
  const status = useSessionStore((state) => state.status);
  const hydrated = useSessionStore((state) => state.hydrated);
  const me = useSessionStore((state) => state.me);
  const meLoading = useSessionStore((state) => state.meLoading);
  const meError = useSessionStore((state) => state.meError);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);
  const refreshMe = useSessionStore((state) => state.refreshMe);

  // Guards against firing continueAsGuest more than once while its promise
  // is still in flight (status stays 'signed_out' until onAuthStateChange
  // resolves it). On persistent failure the catch below degrades to /(tabs)
  // rather than looping, so no unbounded retry here either.
  const guestAttempted = useRef(false);

  // Wordmark spring entrance.
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0.8);
  const opacity = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    opacity.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    scale.value = withSpring(1, spring.standard);
  }, [reduced, opacity, scale]);

  const taglineOpacity = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    taglineOpacity.value = withDelay(220, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [reduced, taglineOpacity]);

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));

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
      continueAsGuest().catch(() => {
        // Persistent guest bootstrap failure (continueAsGuest already retried
        // with backoff). Degrade gracefully instead of a login wall: route
        // into the app anyway. Public browse works with the anon key, and any
        // authenticated tap raises the LoginGateModal, so a first-time user is
        // never stranded on launch.
        router.replace('/(tabs)');
      });
    }
  }, [status, hydrated, me, meLoading, meError, continueAsGuest]);

  const showMeRetry = hydrated && status === 'signed_in' && !meLoading && !me && meError != null;
  const showSpinner =
    (!hydrated || (status === 'signed_in' && meLoading) || status === 'signed_out') && !showMeRetry;

  return (
    <AuthScene>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Animated.View style={wordmarkStyle}>
            <Text style={[textStyle('overline'), styles.eyebrow, { color: colors.accent }]}>Your game, one app</Text>
            <Text style={[textStyle('display'), styles.wordmark, { color: colors.text }]}>Atlitos</Text>
          </Animated.View>
          <Animated.Text style={[textStyle('body'), styles.tagline, taglineStyle, { color: colors.textSecondary }]}>
            Train, play and follow the game, all in one place.
          </Animated.Text>

          {showSpinner ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}

          {showMeRetry ? (
            <View style={styles.actions}>
              <Text style={[textStyle('caption'), styles.centered, { color: colors.danger }]}>
                We could not load your profile. Check your connection and try again.
              </Text>
              <AuthCta label="Try again" onPress={() => void refreshMe()} />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </AuthScene>
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
  eyebrow: { textAlign: 'center', marginBottom: spacing.sm },
  wordmark: { textAlign: 'center', fontSize: 56, lineHeight: 60 },
  tagline: { textAlign: 'center', maxWidth: 300 },
  centered: { textAlign: 'center' },
  spinner: { marginTop: spacing.lg },
  actions: { width: '100%', maxWidth: 320, gap: spacing.sm, marginTop: spacing.lg },
});
