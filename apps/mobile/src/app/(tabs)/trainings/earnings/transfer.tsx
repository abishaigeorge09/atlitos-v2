import { useCoachEarnings } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CheckCircle2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TextField } from '@/components/organisms/_shared';
import { BillSummary } from '@/components/molecules/BillSummary';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';

/**
 * AT-50, PRD-02 3.7, FR-27 to FR-29. Amount entry up to the derived balance,
 * `BillSummary` confirmation (this is the one screen in PRD-02 where
 * `BillSummary` is mandatory per house rule), confirm, success, failure
 * with reason. No transfer fee row: PHASE-3-STATUS.md records the P3
 * assumption of a zero Route transfer fee pending founder confirmation
 * (PRD-02 open question 5), so net equals the amount requested. The server
 * re-checks the amount against `get_coach_wallet_balance()` itself
 * (FR-28), this screen's max is a client side nicety, not the real guard.
 * Disabled with an inline explanation and a link to Payout Account Setup
 * when the Route account is not `active` (FR-27).
 */
export default function CoachTransferScreen() {
  const colors = useThemeColors();
  const coachEarnings = useCoachEarnings(supabase);

  const [state, setState] = useState<ScreenState>('loading');
  const [balance, setBalance] = useState(0);
  const [accountActive, setAccountActive] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const [amountInput, setAmountInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [wallet, account] = await Promise.all([
        coachEarnings.getWalletBalance(),
        coachEarnings.getPayoutAccountStatus(),
      ]);
      setBalance(wallet.balance);
      setAccountActive(account.status === 'active');
      setState('populated');
    } catch (err) {
      setError(err as ApiError);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const amount = Number(amountInput);
  const isValidAmount = amountInput.trim().length > 0 && Number.isFinite(amount) && amount > 0 && amount <= balance;

  function handleReview() {
    setFormError(null);
    if (!amountInput.trim() || !Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter an amount greater than zero.');
      return;
    }
    if (amount > balance) {
      setFormError('This is more than your available balance.');
      return;
    }
    setConfirming(true);
  }

  async function handleConfirm() {
    setSubmitting(true);
    setResult(null);
    try {
      const transfer = await coachEarnings.initiateTransfer(amount);
      setResult('success');
      setResultMessage(`${formatINR(transfer.amount)} is on its way to your bank account.`);
    } catch (err) {
      setResult('failure');
      setResultMessage((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Transfer" onPressBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1 }}>
        {state === 'loading' ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton shape="line" width="50%" />
            <Skeleton shape="card" height={80} />
          </View>
        ) : state === 'error' ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
              Could not load your balance
            </Text>
            <Button variant="secondary" onPress={() => void load()}>
              <Text style={{ color: colors.text }}>Retry</Text>
            </Button>
          </View>
        ) : result === 'success' ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <CheckCircle2 size={48} color={colors.success} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Transfer started</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {resultMessage}
            </Text>
            <Button onPress={() => router.replace('/(tabs)/trainings/earnings')}>
              <Text style={{ color: colors.inkOnAccent }}>Back to earnings</Text>
            </Button>
          </View>
        ) : result === 'failure' ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Transfer failed</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {resultMessage}
            </Text>
            <Button
              variant="secondary"
              onPress={() => {
                setResult(null);
                setConfirming(false);
              }}
            >
              <Text style={{ color: colors.text }}>Try again</Text>
            </Button>
          </View>
        ) : !accountActive ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <TriangleAlert size={40} color={colors.warning} strokeWidth={1.75} />
            <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
              Set up your payout account first
            </Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              Transfers are enabled once your payout account is verified and active.
            </Text>
            <Button onPress={() => router.push('/(tabs)/trainings/earnings/payout-setup')}>
              <Text style={{ color: colors.inkOnAccent }}>Go to payout account setup</Text>
            </Button>
          </View>
        ) : confirming ? (
          <View style={{ gap: spacing.lg }}>
            <View
              style={{
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
              }}
            >
              <BillSummary rows={[{ label: 'Amount requested', amount }]} total={amount} />
            </View>
            <Button loading={submitting} onPress={() => void handleConfirm()}>
              <Text style={{ color: colors.inkOnAccent }}>Confirm transfer</Text>
            </Button>
            <Button variant="secondary" onPress={() => setConfirming(false)}>
              <Text style={{ color: colors.text }}>Edit amount</Text>
            </Button>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Text style={[textStyle('label'), { color: colors.textSecondary }]}>Available balance</Text>
            <Text style={[textStyle('numericDisplay'), { color: colors.text }]}>{formatINR(balance)}</Text>

            <TextField
              label="Amount to transfer"
              keyboardType="numeric"
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder="0"
            />
            {formError ? <Text style={[textStyle('caption'), { color: colors.danger }]}>{formError}</Text> : null}

            <Button disabled={!isValidAmount} onPress={handleReview}>
              <Text style={{ color: colors.inkOnAccent }}>Review transfer</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
