import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { OTPInput } from '@/components/ui/otp-input';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const RESEND_SECONDS = 30;

/**
 * Forgot password, step 2: 6 box OTP entry with a resend timer (PRD-01
 * 3.1). Verifying establishes the session `resetPassword` (step 3) runs
 * against, per API-MAPPING.md "auth" verifyOtp/resetPassword. States:
 * populated, error (OTP invalid/expired, rate limited), submitting.
 */
export default function ForgotPasswordOtpScreen() {
  const colors = useThemeColors();
  const auth = useAuth(supabase);
  const { identifier } = useLocalSearchParams<{ identifier: string }>();

  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  async function handleVerify() {
    setError(null);
    setSubmitting(true);
    try {
      await auth.verifyOtp(identifier, otp);
      router.replace('/(auth)/forgot/reset');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setResending(true);
    try {
      await auth.requestOtp(identifier);
      setSecondsLeft(RESEND_SECONDS);
      setOtp('');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setResending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center' }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[textStyle('h1'), { color: colors.text }]}>Enter the code</Text>
          <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
            We sent a 6 digit code to {identifier}.
          </Text>
        </View>

        <OTPInput value={otp} onChange={setOtp} error={Boolean(error)} autoFocus />

        {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error.message}</Text> : null}

        <Button loading={submitting} disabled={otp.length < 6} onPress={() => void handleVerify()}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Verify code</Text>
        </Button>

        <Button
          variant="text"
          loading={resending}
          disabled={secondsLeft > 0}
          onPress={() => void handleResend()}
        >
          <Text style={[textStyle('label'), { color: secondsLeft > 0 ? colors.textTertiary : colors.accent }]}>
            {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
          </Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
