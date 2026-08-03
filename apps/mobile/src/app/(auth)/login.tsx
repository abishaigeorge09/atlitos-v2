import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthCta, AuthGlassCard, AuthReveal, AuthScene } from '@/components/organisms/auth/AuthScene';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { OTPInput } from '@/components/ui/otp-input';
import { Button } from '@/components/ui/button';
import { friendlyAuthMessage } from '@/lib/auth-copy';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/store/session-store';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoginMode = 'password' | 'otp';

/**
 * Login. PRD-01 3.1: "Email/phone + password, forgot-password link,
 * register link, 'Continue as guest' link", plus an email OTP option per
 * PRD-01's auth surface (mirrors the forgot-password OTP flow, FR-9). States:
 * populated, error (invalid credentials), submitting.
 *
 * Visual: a translucent glass form card floats over the shared AuthScene
 * aurora, its rows staggering in on mount. Every auth handler, the
 * afterAuth() deferred-login return path, and the guest path are unchanged.
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
  const [submitting, setSubmitting] = useState(false);
  const [guestSubmitting, setGuestSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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

  async function handlePasswordLogin() {
    setError(null);
    setSubmitting(true);
    try {
      await auth.login(identifier.trim(), password);
      afterAuth();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendCode() {
    setError(null);
    setSubmitting(true);
    try {
      await auth.requestOtp(identifier.trim());
      setOtpSent(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode() {
    setError(null);
    setSubmitting(true);
    try {
      await auth.verifyOtp(identifier.trim(), otp);
      afterAuth();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContinueAsGuest() {
    setError(null);
    setGuestSubmitting(true);
    try {
      await continueAsGuest();
      afterAuth();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setGuestSubmitting(false);
    }
  }

  const canSubmit =
    mode === 'password' ? Boolean(identifier && password) : otpSent ? otp.length >= 6 : Boolean(identifier);

  function onSubmit() {
    if (mode === 'password') {
      void handlePasswordLogin();
    } else if (otpSent) {
      void handleVerifyCode();
    } else {
      void handleSendCode();
    }
  }

  const ctaLabel = mode === 'password' ? 'Log in' : otpSent ? 'Verify and continue' : 'Send code';

  return (
    <AuthScene>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: 'center' }}
            keyboardShouldPersistTaps="handled"
          >
            <AuthReveal index={0}>
              <View style={{ gap: spacing.xs }}>
                <Text style={[textStyle('overline'), { color: colors.accent }]}>Welcome back</Text>
                <Text style={[textStyle('h1'), { color: colors.text }]}>Log in</Text>
                <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                  Pick up your training, bookings and orders where you left off.
                </Text>
              </View>
            </AuthReveal>

            <AuthReveal index={1}>
              <AuthGlassCard style={{ gap: spacing.lg }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Chip
                    label="Password"
                    variant="select"
                    selected={mode === 'password'}
                    onPress={() => {
                      setMode('password');
                      setError(null);
                    }}
                  />
                  <Chip
                    label="Email or phone code"
                    variant="select"
                    selected={mode === 'otp'}
                    onPress={() => {
                      setMode('otp');
                      setError(null);
                    }}
                  />
                </View>

                <View style={{ gap: spacing.md }}>
                  <Input
                    label="Email or phone"
                    required
                    autoCapitalize="none"
                    value={identifier}
                    onChangeText={setIdentifier}
                    editable={!submitting}
                  />

                  {mode === 'password' ? (
                    <Input
                      type="password"
                      label="Password"
                      required
                      value={password}
                      onChangeText={setPassword}
                      editable={!submitting}
                    />
                  ) : otpSent ? (
                    <View style={{ gap: spacing.sm }}>
                      <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Enter the 6 digit code</Text>
                      <OTPInput value={otp} onChange={setOtp} error={Boolean(error)} autoFocus />
                      <Button variant="text" size="sm" onPress={() => void handleSendCode()} disabled={submitting}>
                        <Text style={[textStyle('caption'), { color: colors.accent }]}>Resend code</Text>
                      </Button>
                    </View>
                  ) : null}

                  {error ? (
                    <Text style={[textStyle('caption'), { color: colors.danger }]}>{friendlyAuthMessage(error)}</Text>
                  ) : null}
                </View>

                <View style={{ gap: spacing.sm }}>
                  <AuthCta label={ctaLabel} loading={submitting} disabled={!canSubmit} onPress={onSubmit} />

                  <Link href="/(auth)/forgot" asChild>
                    <Button variant="text" size="sm">
                      <Text style={[textStyle('caption'), { color: colors.accent }]}>Forgot password</Text>
                    </Button>
                  </Link>
                </View>
              </AuthGlassCard>
            </AuthReveal>

            <AuthReveal index={2}>
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs }}>
                  <Text style={[textStyle('body'), { color: colors.textSecondary }]}>New to Atlitos.</Text>
                  <Link href="/(auth)/register" style={[textStyle('body'), { color: colors.accent }]}>
                    Create account
                  </Link>
                </View>

                <Button variant="text" loading={guestSubmitting} onPress={() => void handleContinueAsGuest()}>
                  <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Continue as guest</Text>
                </Button>
              </View>
            </AuthReveal>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AuthScene>
  );
}
