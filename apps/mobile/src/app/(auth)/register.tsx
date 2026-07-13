import { useAuth } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { Link, router } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/organisms/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

/**
 * Register. PRD-01 FR-6/FR-7: name, email, phone, DOB, password (twice, must
 * match); a duplicate email/phone surfaces a field-level error; success
 * proceeds to Role select. States: populated, error (field validation,
 * email/phone taken), submitting.
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

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Name is required';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a valid email';
    if (!/^\d{10}$/.test(phone.trim())) errors.phone = 'Enter a 10 digit phone number';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) errors.dob = 'Use format YYYY-MM-DD';
    if (password.length < 8) errors.password = 'At least 8 characters';
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
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
        phone: phone.trim(),
        dob: dob.trim(),
        password,
      });

      if (result.needsEmailConfirmation) {
        setConfirmationPending(true);
        return;
      }

      router.replace('/(onboarding)/role-select');
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.code === 'EMAIL_TAKEN') {
        setFieldErrors((current) => ({ ...current, email: 'This email is already registered' }));
      } else if (apiError.code === 'PHONE_TAKEN') {
        setFieldErrors((current) => ({ ...current, phone: 'This phone number is already registered' }));
      } else {
        setFormError(apiError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmationPending) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <EmptyState
          icon={MailCheck}
          title="Check your email"
          body={`We sent a confirmation link to ${email.trim()}. Open it to finish creating your account.`}
          ctaLabel="Back to log in"
          onCtaPress={() => router.replace('/(auth)/login')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
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
            label="Date of birth"
            required
            placeholder="YYYY-MM-DD"
            value={dob}
            onChangeText={setDob}
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

          {formError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{formError.message}</Text> : null}
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
    </SafeAreaView>
  );
}
