import { duration, easing, spacing, spring } from '@atlitos/theme';
import type { ApiError } from '@atlitos/types';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import splashMark from '../../../assets/images/splash-icon.png';

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
 *     `useAuth`); if it STILL fails (e.g. anonymous sign-ins disabled, or
 *     the anon mint rate limit, on the Supabase project) this screen
 *     degrades gracefully via `enterGuestUnminted` (P0-4, Phase 3 LAUNCH)
 *     and routes into `/(tabs)` anyway rather than raising a full-screen
 *     login wall. Public browse works with the anon key, and any
 *     authenticated tap already raises the LoginGateModal, so a first-time
 *     user always lands in the app; there is no guest-to-login wall on
 *     launch. Status sits at `guest_unminted` while a slower background
 *     remint (session-store.ts) keeps retrying; success upgrades the
 *     session to a real `guest` automatically, no reinstall or app restart
 *     needed. Pure client degradation: no RLS policy or storage bucket is
 *     widened to make this work, whatever renders is exactly what the
 *     `anon` role already reads.
 *
 * Track D hardening carried over, and CORRECTED (SCALE-INGRESS.md Gap B):
 *   - Track D made a signed-in session whose profile fetch FAILED stop on a
 *     full screen "We could not load your profile" wall with a Try again
 *     button and no route into the app. The half it got right is that such a
 *     session must not be treated as fully onboarded. The half it got wrong is
 *     the wall, and the wall is the more expensive half at launch scale: it
 *     inverted the priority exactly backwards, degrading GUESTS gracefully
 *     into the app while stopping RETURNING, PAYING users at the front door.
 *
 *     `getMe()` is five network calls (one GoTrue /auth/v1/user, then four
 *     PostgREST reads) and throws on three of them. At 10,000 returning users
 *     that is 10,000 GoTrue plus 40,000 PostgREST requests just to render this
 *     screen, so a 1% transient failure rate is 100 people who cannot open the
 *     app at all, and the 5% you would expect off a saturated 20 connection
 *     pool is 500.
 *
 *     A signed-in user now enters `/(tabs)` on whatever is cached, exactly as
 *     a guest does. `needsOnboarding()` already returns false while `me` is
 *     null, so nothing reads the missing profile as "onboarding incomplete"
 *     and no wizard is forced. The session store retries `getMe` in the
 *     background with a bounded backoff, and `SessionDegradedBanner` (rendered
 *     by the tabs layout) carries the non-blocking notice and the manual
 *     retry. Nothing is silently swallowed; it is just no longer a door.
 *
 * Visual: `SplashMark` renders the same asset the native splash draws, at
 * the same width, so the native to JS handoff has no visible jump. All
 * routing logic below is unchanged.
 */
export default function SplashScreen() {
  const colors = useThemeColors();
  const status = useSessionStore((state) => state.status);
  const hydrated = useSessionStore((state) => state.hydrated);
  const meLoading = useSessionStore((state) => state.meLoading);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);
  const enterGuestUnminted = useSessionStore((state) => state.enterGuestUnminted);

  // Guards against firing continueAsGuest more than once while its promise
  // is still in flight (status stays 'signed_out' until onAuthStateChange
  // resolves it). On persistent failure the catch below degrades to /(tabs)
  // rather than looping, so no unbounded retry here either.
  const guestAttempted = useRef(false);


  useEffect(() => {
    if (!hydrated) return;

    if (status === 'guest' || status === 'guest_unminted') {
      guestAttempted.current = false;
      router.replace('/(tabs)');
      return;
    }

    if (status === 'signed_in') {
      guestAttempted.current = false;
      // Wait for the FIRST profile attempt to settle, so the common case
      // still lands on a fully hydrated Home. But settle means settle:
      // failure routes into the app too (see the Gap B note above), it does
      // not park the user here. The store keeps retrying behind them and
      // SessionDegradedBanner explains the state.
      if (meLoading) return;
      router.replace('/(tabs)');
      return;
    }

    if (status === 'signed_out' && !guestAttempted.current) {
      guestAttempted.current = true;
      continueAsGuest().catch((error: unknown) => {
        // P0-4: persistent guest bootstrap failure (continueAsGuest already
        // retried with backoff). Degrade gracefully instead of a login wall:
        // flip to "guest_unminted" (Home renders on whatever the anon role
        // can already read, zero RLS/bucket change) and let the effect's
        // guest/guest_unminted branch above route into the app. A slower
        // background remint (session-store) keeps retrying; success upgrades
        // the session to a real "guest" automatically, no reinstall needed.
        //
        // The error code is forwarded so the background loop can tell a
        // rate limit apart from an outage: a RATE_LIMITED refusal waits out
        // GoTrue's 120 s per-IP bucket refill instead of retrying in 2 s,
        // which cannot win and starves every other user on the same IP.
        enterGuestUnminted((error as ApiError | undefined)?.code);
      });
    }
  }, [status, hydrated, meLoading, continueAsGuest, enterGuestUnminted]);

  const showSpinner = !hydrated || (status === 'signed_in' && meLoading) || status === 'signed_out';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <SplashMark />
        <Text style={[textStyle('body'), styles.tagline, { color: colors.textSecondary }]}>
          Train, play and follow the game, all in one place.
        </Text>

        {showSpinner ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
      </View>
    </SafeAreaView>
  );
}

/**
 * The mark that carries the launch.
 *
 * The native splash (expo-splash-screen, app.json) draws
 * `assets/images/splash-icon.png` at `imageWidth: 120` centred on the same
 * `#141414` this screen paints. This renders the SAME asset at the SAME
 * width in the SAME place, so when the native layer hides there is no jump
 * to cut through: the mark is already sitting exactly where it was. It then
 * settles into place with a spring, which is the only motion the user sees.
 *
 * Previously this spot held a text wordmark, so launch went logo -> text,
 * a visible swap of two different things.
 */
function SplashMark() {
  // Matches app.json's expo-splash-screen `imageWidth`. If that changes,
  // change this with it or the handoff visibly jumps.
  const NATIVE_SPLASH_IMAGE_WIDTH = 220;
  // splash-icon.png is the cropped lockup, 1024x606.
  const SPLASH_MARK_ASPECT = 1024 / 606;
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    // Overshoot then settle. Starts at 1 (the native splash's size) so the
    // first frame is identical to what was already on screen.
    scale.value = withSequence(
      withTiming(1.08, { duration: duration.base, easing: Easing.bezier(...easing.decelerate) }),
      withSpring(1, spring.standard),
    );
    opacity.value = withTiming(1, { duration: duration.fast });
  }, [opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.Image
      source={splashMark}
      accessibilityLabel="Atlitos"
      resizeMode="contain"
      style={[
        { width: NATIVE_SPLASH_IMAGE_WIDTH, aspectRatio: SPLASH_MARK_ASPECT },
        animatedStyle,
      ]}
    />
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
  tagline: { textAlign: 'center', maxWidth: 300 },
  spinner: { marginTop: spacing.lg },
});
