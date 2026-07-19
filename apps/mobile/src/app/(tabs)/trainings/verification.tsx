import { useCoachVerification } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachVerificationStatus, type CoachVerificationTone } from '@/components/organisms/CoachVerificationStatus';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

/**
 * AT-45, PRD-02 3.2. Dedicated route for the Account, Profile entry point
 * ("reachable ... from Account > Profile after"); the Trainings tab root
 * shows the same states inline before verification completes. No coach
 * profile at all (never started the wizard) routes back to the wizard
 * rather than rendering a fourth, meaningless status. States: loading,
 * populated (one of the three coach statuses), error (fetch failed, retry).
 */
export default function CoachVerificationScreen() {
  const colors = useThemeColors();
  const verification = useCoachVerification(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [status, setStatus] = useState<CoachVerificationTone | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await verification.getStatus();
      setStatus(result.coachStatus);
      setRejectionReason(result.rejectionReason);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Coach verification" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}>
        {state === 'loading' ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton shape="circle" width={80} height={80} />
            <Skeleton shape="line" width="70%" />
            <Skeleton shape="line" />
          </View>
        ) : state === 'error' ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
              Could not load your verification status
            </Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {error?.message ?? 'Something went wrong. Please try again.'}
            </Text>
            <Button variant="secondary" onPress={() => void load()}>
              <Text style={{ color: colors.text }}>Retry</Text>
            </Button>
          </View>
        ) : status ? (
          <CoachVerificationStatus status={status} rejectionReason={rejectionReason} />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
              You have not started coach setup yet
            </Text>
            <Button
              onPress={() => router.push({ pathname: '/(onboarding)/coach-setup/[step]', params: { step: '0' } })}
            >
              <Text style={{ color: colors.inkOnAccent }}>Start coach setup</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
