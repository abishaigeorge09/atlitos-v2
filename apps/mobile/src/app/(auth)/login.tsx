import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
    router.replace('/(auth)/splash');
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: spacing.xs }}>
          <Text style={[textStyle('h1'), { color: colors.text }]}>Log in</Text>
          <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
            Pick up your training, bookings and orders where you left off.
          </Text>
        </View>

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
          {mode === 'password' ? (
            <Button
              loading={submitting}
              disabled={!identifier || !password}
              onPress={() => void handlePasswordLogin()}
            >
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Log in</Text>
            </Button>
          ) : otpSent ? (
            <Button loading={submitting} disabled={otp.length < 6} onPress={() => void handleVerifyCode()}>
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Verify and continue</Text>
            </Button>
          ) : (
            <Button loading={submitting} disabled={!identifier} onPress={() => void handleSendCode()}>
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Send code</Text>
            </Button>
          )}

          <Link href="/(auth)/forgot" asChild>
            <Button variant="text" size="sm">
              <Text style={[textStyle('caption'), { color: colors.accent }]}>Forgot password</Text>
            </Button>
          </Link>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs }}>
          <Text style={[textStyle('body'), { color: colors.textSecondary }]}>New to Atlitos.</Text>
          <Link href="/(auth)/register" style={[textStyle('body'), { color: colors.accent }]}>
            Create account
          </Link>
        </View>

        <Button variant="text" loading={guestSubmitting} onPress={() => void handleContinueAsGuest()}>
          <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Continue as guest</Text>
        </Button>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
