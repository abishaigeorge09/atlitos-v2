import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { Link, router } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  dob?: string;
  password?: string;
  confirmPassword?: string;
}

/** YYYY-MM-DD mask: keep digits only, auto-insert the dashes while typing.
 * Deleting works too: the dash is re-derived from the digits every change. */
function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** Accepts an optional +91 prefix plus spaces/dashes and normalizes down to
 * the bare 10 digits validation and the API expect. */
function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s-]/g, '');
  return stripped.startsWith('+91') ? stripped.slice(3) : stripped;
}

function isRealDate(iso: string): boolean {
  const time = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === iso;
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
 */
export default function RegisterScreen() {
  const colors = useThemeColors();
  const auth = useAuth(supabase);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
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
    const dobValue = dob.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobValue) || !isRealDate(dobValue)) {
      errors.dob = 'Enter your full date of birth, year first';
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
        dob: dob.trim(),
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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.lg, alignItems: 'center', justifyContent: 'center' }}>
          <MailCheck size={48} color={colors.accent} strokeWidth={1.5} />
          <Text style={[textStyle('h2'), { color: colors.text, textAlign: 'center' }]}>Check your email</Text>
          <Text style={[textStyle('body'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {`We sent a confirmation link to ${email.trim()}. Open it to finish creating your account.`}
          </Text>
          {resendNotice ? (
            <Text style={[textStyle('caption'), { color: colors.success, textAlign: 'center' }]}>{resendNotice}</Text>
          ) : null}
          {resendError ? (
            <Text style={[textStyle('caption'), { color: colors.danger, textAlign: 'center' }]}>{resendError}</Text>
          ) : null}
          <View style={{ width: '100%', maxWidth: 320, gap: spacing.sm }}>
            <Button onPress={() => router.replace('/(auth)/login')}>
              <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>I have confirmed, log in</Text>
            </Button>
            <Button variant="secondary" loading={resending} onPress={() => void handleResend()}>
              <Text style={[textStyle('label'), { color: colors.text }]}>Resend email</Text>
            </Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: spacing.xs }}>
            <Text style={[textStyle('h1'), { color: colors.text }]}>Create your account</Text>
            <Text style={[textStyle('body'), { color: colors.textSecondary }]}>
              Set up training, bookings and orders in one place.
            </Text>
          </View>

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
              type="pincode"
              label="Date of birth"
              required
              placeholder="YYYY-MM-DD"
              maxLength={10}
              value={dob}
              onChangeText={(value) => setDob(formatDob(value))}
              error={fieldErrors.dob}
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

          <Button loading={submitting} onPress={() => void handleSubmit()}>
            <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Create account</Text>
          </Button>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs }}>
            <Text style={[textStyle('body'), { color: colors.textSecondary }]}>Already have an account.</Text>
            <Link href="/(auth)/login" style={[textStyle('body'), { color: colors.accent }]}>
              Log in
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
