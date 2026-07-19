import { useCoachEarnings, type PayoutAccountState } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CircleCheck, Clock, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

const STATUS_COPY: Record<PayoutAccountState['status'], { title: string; body: string }> = {
  not_started: {
    title: 'Set up your payout account',
    body: 'Add your bank details to receive coaching earnings directly to your account.',
  },
  pending: {
    title: 'Verification in progress',
    body: 'We are verifying your bank details. This usually takes a short while.',
  },
  active: {
    title: 'Payout account active',
    body: 'You can transfer your earnings to your bank account any time.',
  },
  needs_attention: {
    title: 'Action needed',
    body: 'Some details could not be verified. Continue the setup to fix them.',
  },
  failed: {
    title: 'Setup failed',
    body: 'Your payout account could not be created. Try again.',
  },
};

/**
 * AT-50, PRD-02 3.7, FR-27. Razorpay Route linked account onboarding hand
 * off. `razorpay-route-onboard` is idempotent on the caller's identity, so
 * this screen re-invokes it both to start setup and to poll for a status
 * change on return from the hosted flow. `503 ROUTE_UNAVAILABLE` is a real,
 * currently expected outcome (PHASE-3-STATUS.md: Route is not yet enabled
 * on the test merchant account) and renders as an honest blocked state,
 * never a fake success. States mirror the four Route account statuses plus
 * a submission error state.
 */
export default function CoachPayoutSetupScreen() {
  const colors = useThemeColors();
  const coachEarnings = useCoachEarnings(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [account, setAccount] = useState<PayoutAccountState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [routeUnavailable, setRouteUnavailable] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const result = await coachEarnings.getPayoutAccountStatus();
      setAccount(result);
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSetup() {
    setSubmitting(true);
    setRouteUnavailable(null);
    try {
      const result = await coachEarnings.setupPayoutAccount();
      setOnboardingUrl(result.onboardingUrl);
      setAccount((prev) => ({ status: result.status, payoutAccountId: prev?.payoutAccountId ?? null }));
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.code === 'ROUTE_UNAVAILABLE') {
        setRouteUnavailable(apiError.message);
      } else {
        setError(apiError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Payout account" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1 }}>
        {state === 'loading' ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton shape="circle" width={80} height={80} />
            <Skeleton shape="line" width="70%" />
          </View>
        ) : state === 'error' ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
              Could not load your payout account
            </Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {error?.message ?? 'Something went wrong. Please try again.'}
            </Text>
            <Button variant="secondary" onPress={() => void load()}>
              <Text style={{ color: colors.text }}>Retry</Text>
            </Button>
          </View>
        ) : account ? (
          <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing['3xl'] }}>
            <View
              style={{
                height: 80,
                width: 80,
                borderRadius: radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: account.status === 'active' ? colors.successTint : colors.warningTint,
              }}
            >
              {account.status === 'active' ? (
                <CircleCheck size={48} color={colors.success} strokeWidth={1.75} />
              ) : (
                <Clock size={48} color={colors.warning} strokeWidth={1.75} />
              )}
            </View>
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
              {STATUS_COPY[account.status].title}
            </Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {STATUS_COPY[account.status].body}
            </Text>

            {routeUnavailable ? (
              <View
                style={{
                  borderRadius: radii.md,
                  backgroundColor: colors.dangerTint,
                  padding: spacing.md,
                  gap: spacing.xs,
                }}
              >
                <Text style={[textStyle('label'), { color: colors.danger }]}>Payouts are not enabled yet</Text>
                <Text style={[textStyle('caption'), { color: colors.danger }]}>{routeUnavailable}</Text>
              </View>
            ) : null}

            {account.status !== 'active' ? (
              <Button loading={submitting} onPress={() => void handleSetup()}>
                <Text style={{ color: colors.inkOnAccent }}>
                  {account.status === 'not_started' ? 'Start setup' : 'Continue setup'}
                </Text>
              </Button>
            ) : null}

            {onboardingUrl ? (
              <Button variant="secondary" onPress={() => void Linking.openURL(onboardingUrl)}>
                <Text style={{ color: colors.text }}>Open verification link</Text>
              </Button>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
