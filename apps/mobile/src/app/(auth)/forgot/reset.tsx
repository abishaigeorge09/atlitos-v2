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
 * Forgot password, step 3: set a new password on the session `verifyOtp`
 * established (API-MAPPING.md "auth" resetPassword). States: populated,
 * error (validation, submission failure), submitting.
 */
export default function ResetPasswordScreen() {
  const colors = useThemeColors();
  const auth = useAuth(supabase);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (password.length < 8) {
      setError('Use at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      await auth.resetPassword(password);
      router.replace('/(auth)/splash');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center' }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[textStyle('h1'), { color: colors.text }]}>Set a new password</Text>
          <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
            Choose a password you have not used before.
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          <Input
            type="password"
            label="New password"
            required
            value={password}
            onChangeText={setPassword}
            editable={!submitting}
          />
          <Input
            type="password"
            label="Confirm password"
            required
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            editable={!submitting}
          />
          {error ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{error}</Text> : null}
        </View>

        <Button loading={submitting} onPress={() => void handleSubmit()}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Save password</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
