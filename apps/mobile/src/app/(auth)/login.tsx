import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppleSignInButton, GoogleSignInButton } from '@/components/organisms/SocialAuthButtons';
import { Input } from '@/components/ui/input';
import { OTPInput } from '@/components/ui/otp-input';
import { Button } from '@/components/ui/button';
import { friendlyAuthMessage } from '@/lib/auth-copy';
import { signInWithApple, signInWithGoogle } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoginMode = 'password' | 'otp';
/** Which async path owns the UI right now, so only one spinner can run. */
type Pending = null | 'password' | 'otp' | 'google' | 'apple' | 'guest';

/**
 * Login. PRD-01 3.1: "Email/phone + password, forgot-password link,
 * register link, 'Continue as guest' link", plus an email OTP option per
 * PRD-01's auth surface (mirrors the forgot-password OTP flow, FR-9), and
 * Google/Apple sign in.
 *
 * Laid out against the approved login reference: wordmark, headline with the
 * accent carrying the last word, the credential pair, the primary CTA, then
 * the provider buttons, then the register line. Two things sit below the
 * reference's last row because they are required behaviour rather than
 * design: the OTP switch (PRD-01 FR-9) and guest entry (PRD-01 FR-4). They
 * are set at caption weight so they read as utility, not as CTAs.
 *
 * The primary CTA is NOT disabled on empty fields. Dimming #FF4D00 against
 * #141414 produces a muddy brown that reads as a broken control, and the
 * reference draws the button at full strength in every state. Empty input is
 * caught on submit and surfaced inline instead.
 */
export default function LoginScreen() {
  const colors = useThemeColors();
  const auth = useAuth(supabase);
  const continueAsGuest = useSessionStore((state) => state.continueAsGuest);

  const [mode, setMode] = useState<LoginMode>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const busy = pending !== null;

  function afterAuth() {
    // PRD-01 FR-4: a gate raised from a guest's mutating tap pushes this
    // screen ON TOP of the origin screen (LoginGateModal uses router.push,
    // the origin never unmounts). Dismiss back to it so the user resumes
    // exactly where they were, instead of being dropped on Home. Only when
    // login was reached as a cold entry with nothing beneath (no history)
    // do we route to Home.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }

  function fieldError(message: string): ApiError {
    return { code: 'VALIDATION', message, status: 400 };
  }

  /**
   * One wrapper for every sign in path. Keeps a single spinner owner and
   * guarantees `pending` is cleared on every exit, including the throw.
   */
  async function run(
    kind: NonNullable<Pending>,
    action: () => Promise<'signed-in' | 'cancelled' | void>,
  ) {
    setError(null);
    setPending(kind);
    try {
      const outcome = await action();
      // A cancelled provider sheet is a decision, not a failure: no error,
      // no navigation, the user is simply back on this screen.
      if (outcome === 'cancelled') return;
      afterAuth();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setPending(null);
    }
  }

  function submitPrimary() {
    if (!identifier.trim()) {
      setError(fieldError('Enter your email or mobile number.'));
      return;
    }
    if (mode === 'password') {
      if (!password) {
        setError(fieldError('Enter your password.'));
        return;
      }
      void run('password', () => auth.login(identifier.trim(), password).then(() => undefined));
      return;
    }
    if (otpSent) {
      if (otp.length < 6) {
        setError(fieldError('Enter the 6 digit code.'));
        return;
      }
      void run('otp', () => auth.verifyOtp(identifier.trim(), otp).then(() => undefined));
      return;
    }
    void handleSendCode();
  }

  async function handleSendCode() {
    setError(null);
    setPending('otp');
    try {
      await auth.requestOtp(identifier.trim());
      setOtpSent(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setPending(null);
    }
  }

  const primaryLabel =
    mode === 'password' ? 'Login' : otpSent ? 'Verify and continue' : 'Send code';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.xl,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[textStyle('body'), { color: colors.text }]}>ATLITOS</Text>

          <View style={{ gap: spacing.xs, marginTop: spacing.xl }}>
            <Text style={[textStyle('h3'), { color: colors.textSecondary }]}>
              Experience the future of <Text style={{ color: colors.accent }}>Sports</Text>
            </Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              Expert coaching, Smart performance tracking, Premium merch, and more..
            </Text>
          </View>

          <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
            <Input
              label="Email/Mobile Number"
              placeholder="Email/ Mobile Number"
              autoCapitalize="none"
              autoComplete="username"
              value={identifier}
              onChangeText={setIdentifier}
              editable={!busy}
            />

            {mode === 'password' ? (
              <View style={{ gap: spacing.xs }}>
                <Input
                  type="password"
                  label="Password"
                  placeholder="Password"
                  autoComplete="current-password"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                />
                <Link href="/(auth)/forgot" asChild>
                  <Pressable style={{ alignSelf: 'flex-end' }} hitSlop={8}>
                    <Text style={[textStyle('caption'), { color: colors.accent }]}>
                      Forgot Password?
                    </Text>
                  </Pressable>
                </Link>
              </View>
            ) : otpSent ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={[textStyle('label'), { color: colors.textSecondary }]}>
                  Enter the 6 digit code
                </Text>
                <OTPInput value={otp} onChange={setOtp} error={Boolean(error)} autoFocus />
                <Pressable onPress={() => void handleSendCode()} disabled={busy} hitSlop={8}>
                  <Text style={[textStyle('caption'), { color: colors.accent }]}>Resend code</Text>
                </Pressable>
              </View>
            ) : null}

            {error ? (
              <Text style={[textStyle('caption'), { color: colors.danger }]}>
                {friendlyAuthMessage(error)}
              </Text>
            ) : null}
          </View>

          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button loading={pending === 'password' || pending === 'otp'} onPress={submitPrimary}>
              <Text style={[textStyle('button'), { color: colors.inkOnAccent }]}>{primaryLabel}</Text>
            </Button>

            <GoogleSignInButton
              loading={pending === 'google'}
              disabled={busy}
              onPress={() => void run('google', signInWithGoogle)}
            />
            <AppleSignInButton disabled={busy} onPress={() => void run('apple', signInWithApple)} />
          </View>

          <View style={{ marginTop: spacing.lg, gap: spacing.md, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                Don&apos;t have an account?
              </Text>
              <Link href="/(auth)/register" style={[textStyle('body'), { color: colors.accent }]}>
                Register
              </Link>
            </View>

            {/* Required behaviour that the reference does not draw. Caption
                weight keeps them out of the CTA hierarchy. */}
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm }}>
              <Pressable
                disabled={busy}
                hitSlop={8}
                onPress={() => {
                  setMode(mode === 'password' ? 'otp' : 'password');
                  setError(null);
                  setOtpSent(false);
                  setOtp('');
                }}
              >
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                  {mode === 'password' ? 'Use a one time code' : 'Use your password'}
                </Text>
              </Pressable>
              <Pressable
                disabled={busy}
                hitSlop={8}
                onPress={() => void run('guest', () => continueAsGuest().then(() => undefined))}
              >
                <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
                  Continue on this device
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
