import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { Link, router } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthCta, AuthGlassCard, AuthReveal, AuthScene } from '@/components/organisms/auth/AuthScene';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { friendlyAuthMessage } from '@/lib/auth-copy';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
}

/** Accepts an optional +91 prefix plus spaces/dashes and normalizes down to
 * the bare 10 digits validation and the API expect. */
function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, '');
  return stripped.startsWith('+91') ? stripped.slice(3) : stripped;
}

/**
 * Register. PRD-01 FR-6/FR-7: name, email, phone, DOB, password (twice, must
 * match); a duplicate email/phone surfaces a field-level error; success
 * lands straight in Home, never a forced Role select. Onboarding (role
 * select) is offered later, not gated here: Home's "Finish setting up" card
 * nudges a signed-in user with no city set to pick a role and city when
 * they are ready (`apps/mobile/src/app/(tabs)/index.tsx` showFinishSetup).
 * States: populated, error (field validation, email/phone taken),
 * submitting, confirmation pending (email confirmation on, with resend and
 * a log in shortcut).
 *
 * Visual: a glass form card over the shared AuthScene aurora, rows
 * staggering in on mount. All validation and auth logic is unchanged.
 */
export default function RegisterScreen() {
  const colors = useThemeColors();
  const auth = useAuth(supabase);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Please enter your name';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'That email does not look right, check it and try again';
    if (!/^\d{10}$/.test(normalizePhone(phone.trim()))) {
      errors.phone = 'Enter a 10 digit mobile number, +91 is optional';
    }
    if (password.length < 8) errors.password = 'Use at least 8 characters';
    if (password !== confirmPassword) errors.confirmPassword = 'Both passwords need to match';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await auth.register({
        name: name.trim(),
        email: email.trim(),
        phone: normalizePhone(phone.trim()),
        password,
      });

      if (result.needsEmailConfirmation) {
        setConfirmationPending(true);
        return;
      }

      router.replace('/(tabs)');
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.code === 'EMAIL_TAKEN') {
        setFieldErrors((current) => ({ ...current, email: 'This email is already registered, log in instead' }));
      } else if (apiError.code === 'PHONE_TAKEN') {
        setFieldErrors((current) => ({ ...current, phone: 'This phone number is already registered, log in instead' }));
      } else {
        setFormError(apiError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResendNotice(null);
    setResendError(null);
    setResending(true);
    try {
      await auth.resendSignupEmail(email.trim());
      setResendNotice('Confirmation email sent again, check your inbox.');
    } catch (err) {
      setResendError(friendlyAuthMessage(err));
    } finally {
      setResending(false);
    }
  }

  if (confirmationPending) {
    return (
      <AuthScene>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
            <AuthReveal index={0}>
              <AuthGlassCard style={{ gap: spacing.lg, alignItems: 'center' }}>
                <MailCheck size={48} color={colors.accent} strokeWidth={1.5} />
                <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}>Check your email</Text>
                <Text style={[textStyle('body'), { color: colors.textSecondary, textAlign: 'center' }]}>
                  {`We sent a confirmation link to ${email.trim()}. Open it to finish creating your account.`}
                </Text>
                {resendNotice ? (
                  <Text style={[textStyle('caption'), { color: colors.success, textAlign: 'center' }]}>
                    {resendNotice}
                  </Text>
                ) : null}
                {resendError ? (
                  <Text style={[textStyle('caption'), { color: colors.danger, textAlign: 'center' }]}>
                    {resendError}
                  </Text>
                ) : null}
                <View style={{ width: '100%', gap: spacing.sm }}>
                  <AuthCta label="I have confirmed, log in" onPress={() => router.replace('/(auth)/login')} />
                  <Button variant="secondary" loading={resending} onPress={() => void handleResend()}>
                    <Text style={[textStyle('label'), { color: colors.text }]}>Resend email</Text>
                  </Button>
                </View>
              </AuthGlassCard>
            </AuthReveal>
          </View>
        </SafeAreaView>
      </AuthScene>
    );
  }

  return (
    <AuthScene>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
            <AuthReveal index={0}>
              <View style={{ gap: spacing.xs }}>
                <Text style={[textStyle('overline'), { color: colors.accent }]}>Join the team</Text>
                <Text style={[textStyle('h1'), { color: colors.text }]}>Create your account</Text>
                <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
                  Set up training, bookings and orders in one place.
                </Text>
              </View>
            </AuthReveal>

            <AuthReveal index={1}>
              <AuthGlassCard style={{ gap: spacing.lg }}>
                <View style={{ gap: spacing.md }}>
                  <Input label="Full name" required value={name} onChangeText={setName} error={fieldErrors.name} editable={!submitting} />
                  <Input
                    label="Email"
                    required
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                    error={fieldErrors.email}
                    editable={!submitting}
                  />
                  <Input
                    type="phone"
                    label="Phone"
                    required
                    value={phone}
                    onChangeText={setPhone}
                    error={fieldErrors.phone}
                    editable={!submitting}
                  />
                  <Input
                    type="password"
                    label="Password"
                    required
                    value={password}
                    onChangeText={setPassword}
                    error={fieldErrors.password}
                    editable={!submitting}
                  />
                  <Input
                    type="password"
                    label="Confirm password"
                    required
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    error={fieldErrors.confirmPassword}
                    editable={!submitting}
                  />

                  {formError ? (
                    <Text style={[textStyle('caption'), { color: colors.danger }]}>{friendlyAuthMessage(formError)}</Text>
                  ) : null}
                </View>

                <AuthCta label="Create account" loading={submitting} onPress={() => void handleSubmit()} />
              </AuthGlassCard>
            </AuthReveal>

            <AuthReveal index={2}>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs }}>
                <Text style={[textStyle('body'), { color: colors.textSecondary }]}>Already have an account.</Text>
                <Link href="/(auth)/login" style={[textStyle('body'), { color: colors.accent }]}>
                  Log in
                </Link>
              </View>
            </AuthReveal>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AuthScene>
  );
}
