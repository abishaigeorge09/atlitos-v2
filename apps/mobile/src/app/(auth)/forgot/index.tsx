import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Forgot password, step 1: identifier entry. PRD-01 3.1 "Forgot password /
 * OTP / Reset password ... 6-box OTP, resend timer". This screen only
 * requests the code (`requestOtp`); the box and resend timer live on
 * (auth)/forgot/otp.
 */
export default function ForgotPasswordScreen() {
  const colors = useThemeColors();
  const auth = useAuth(supabase);

  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await auth.requestOtp(identifier.trim());
      router.push({ pathname: '/(auth)/forgot/otp', params: { identifier: identifier.trim() } });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center' }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[textStyle('h1'), { color: colors.text }]}>Reset your password</Text>
          <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
            Enter the email or phone on your account and we will send a code.
          </Text>
        </View>

        <Input
          label="Email or phone"
          required
          autoCapitalize="none"
          value={identifier}
          onChangeText={setIdentifier}
          error={error?.message}
          editable={!submitting}
        />

        <Button loading={submitting} disabled={!identifier} onPress={() => void handleSubmit()}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Send code</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
