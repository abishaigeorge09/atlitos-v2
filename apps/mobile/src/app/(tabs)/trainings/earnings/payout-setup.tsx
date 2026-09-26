import { usePayoutMethod, validatePayoutMethod, type MyPayoutState, type PayoutMethodType, type SavePayoutMethodInput } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { CircleCheck, Clock, Landmark, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/ui/app-bar';
import { useNavBarInset } from '@/components/ui/bottom-nav';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type ScreenState = 'loading' | 'populated' | 'error';
type FieldErrors = Partial<Record<keyof SavePayoutMethodInput | 'confirmAccountNumber', string>>;

/**
 * Payout details for a coach (migration 0130, docs/PLAN-PAYOUTS-CLICKS-SEARCH.md
 * Track 1). Replaces the Razorpay Route hand off, which is closed to ELSHEPH.
 *
 * The coach no longer requests transfers. Atlitos pays verified details by
 * NEFT or UPI, so this screen has one job: collect correct details and say
 * honestly where they stand. Only the last four digits ever come back from
 * the server. Any change sends the details back to review, and the screen
 * says so before the coach saves, because the alternative is a coach who
 * edits a typo and then wonders why a payout paused.
 */
export default function CoachPayoutSetupScreen() {
  const colors = useThemeColors();
  const navInset = useNavBarInset();
  const payout = usePayoutMethod(supabase, 'coach');

  const [state, setState] = useState<ScreenState>('loading');
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [current, setCurrent] = useState<MyPayoutState | null>(null);
  const [editing, setEditing] = useState(false);

  const [methodType, setMethodType] = useState<PayoutMethodType>('bank_account');
  const [holder, setHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [vpa, setVpa] = useState('');
  const [pan, setPan] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError(null);
    try {
      const result = await payout.get();
      setCurrent(result);
      setEditing(result.method === null);
      if (result.method) {
        setMethodType(result.method.methodType);
        setHolder(result.method.accountHolderName);
      }
      setState('populated');
    } catch (err) {
      setLoadError(err as ApiError);
      setState('error');
    }
  }, [payout]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit() {
    setAccountNumber('');
    setConfirmAccountNumber('');
    setIfsc(current?.method?.ifsc ?? '');
    setVpa(current?.method?.vpa ?? '');
    setPan('');
    setErrors({});
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    const input: SavePayoutMethodInput = {
      methodType,
      accountHolderName: holder,
      accountNumber: methodType === 'bank_account' ? accountNumber : undefined,
      ifsc: methodType === 'bank_account' ? ifsc : undefined,
      vpa: methodType === 'upi' ? vpa : undefined,
      pan,
    };
    const found: FieldErrors = validatePayoutMethod(input);
    if (methodType === 'bank_account' && accountNumber.replace(/\s/g, '') !== confirmAccountNumber.replace(/\s/g, '')) {
      found.confirmAccountNumber = 'The two account numbers do not match.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      await payout.save(input);
      setEditing(false);
      await load();
    } catch (err) {
      setSaveError((err as ApiError).message ?? 'Could not save your details. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const method = current?.method ?? null;
  const verification = method?.verificationStatus;
  const statusTone =
    verification === 'verified'
      ? { bg: colors.successTint, fg: colors.successInk, Icon: CircleCheck, title: 'Verified', body: 'Atlitos pays your available earnings to this account.' }
      : verification === 'rejected'
        ? { bg: colors.dangerTint, fg: colors.dangerInk, Icon: TriangleAlert, title: 'Needs fixing', body: method?.verificationNote ?? 'These details could not be verified. Update them below.' }
        : { bg: colors.warningTint, fg: colors.warningInk, Icon: Clock, title: 'In review', body: 'We check new details with a Rs 1 test deposit before the first payout.' };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Payout details" onPressBack={() => router.back()} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1, paddingBottom: navInset + spacing.xl }}
        >
          {state === 'loading' ? (
            <View style={{ gap: spacing.md }}>
              <Skeleton shape="card" height={120} />
              <Skeleton shape="line" width="70%" />
            </View>
          ) : state === 'error' ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
              <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
              <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Could not load your payout details</Text>
              <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                {loadError?.message ?? 'Something went wrong. Please try again.'}
              </Text>
              <Button variant="secondary" onPress={() => void load()}>
                <Text style={{ color: colors.text }}>Retry</Text>
              </Button>
            </View>
          ) : current ? (
            <>
              <View
                style={{
                  borderRadius: radii.xl,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.lg,
                  flexDirection: 'row',
                  gap: spacing.xl,
                }}
              >
                <View style={{ gap: spacing.xs, flex: 1 }}>
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>Available for payout</Text>
                  <Text style={[textStyle('numericLg'), { color: colors.text }]}>{formatINR(current.eligibleBalance)}</Text>
                </View>
                <View style={{ gap: spacing.xs, flex: 1 }}>
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>On hold for 24 hours</Text>
                  <Text style={[textStyle('numericLg'), { color: colors.text }]}>
                    {formatINR(Math.max(0, current.balance - current.eligibleBalance))}
                  </Text>
                </View>
              </View>

              {!editing && method ? (
                <View style={{ gap: spacing.md }}>
                  <View style={{ borderRadius: radii.md, backgroundColor: statusTone.bg, padding: spacing.md, flexDirection: 'row', gap: spacing.sm }}>
                    <statusTone.Icon size={20} color={statusTone.fg} strokeWidth={1.75} />
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Text style={[textStyle('label'), { color: statusTone.fg }]}>{statusTone.title}</Text>
                      <Text style={[textStyle('caption'), { color: statusTone.fg }]}>{statusTone.body}</Text>
                    </View>
                  </View>

                  <View style={{ borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: spacing.lg, gap: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Landmark size={20} color={colors.textSecondary} strokeWidth={1.75} />
                      <Text style={[textStyle('label'), { color: colors.text }]}>
                        {method.methodType === 'bank_account' ? `Bank account ending ${method.accountNumberLast4 ?? ''}` : 'UPI'}
                      </Text>
                    </View>
                    <DetailRow label="Name" value={method.accountHolderName} />
                    {method.methodType === 'bank_account' ? <DetailRow label="IFSC" value={method.ifsc ?? ''} mono /> : <DetailRow label="UPI ID" value={method.vpa ?? ''} mono />}
                    <DetailRow label="PAN" value={method.hasPan ? `Ending ${method.panLast4 ?? ''}` : 'Not added'} />
                  </View>

                  <Button variant="secondary" onPress={startEdit}>
                    <Text style={{ color: colors.text }}>Change details</Text>
                  </Button>
                </View>
              ) : (
                <View style={{ gap: spacing.md }}>
                  <Text style={[textStyle('h3'), { color: colors.text }]}>Where should we pay you?</Text>
                  <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
                    Atlitos sends your available earnings to this account. You do not need a registered business.
                  </Text>

                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Chip label="Bank account" variant="filter" selected={methodType === 'bank_account'} onPress={() => setMethodType('bank_account')} />
                    <Chip label="UPI" variant="filter" selected={methodType === 'upi'} onPress={() => setMethodType('upi')} />
                  </View>

                  <Input
                    label="Name on the account"
                    required
                    value={holder}
                    onChangeText={setHolder}
                    autoCapitalize="words"
                    autoComplete="name"
                    error={errors.accountHolderName}
                  />

                  {methodType === 'bank_account' ? (
                    <>
                      <Input
                        type="number"
                        label="Account number"
                        required
                        value={accountNumber}
                        onChangeText={setAccountNumber}
                        maxLength={18}
                        error={errors.accountNumber}
                      />
                      <Input
                        type="number"
                        label="Account number again"
                        required
                        value={confirmAccountNumber}
                        onChangeText={setConfirmAccountNumber}
                        maxLength={18}
                        error={errors.confirmAccountNumber}
                      />
                      <Input
                        label="IFSC"
                        required
                        value={ifsc}
                        onChangeText={(v) => setIfsc(v.toUpperCase())}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={11}
                        placeholder="HDFC0001234"
                        error={errors.ifsc}
                      />
                    </>
                  ) : (
                    <Input
                      label="UPI ID"
                      required
                      value={vpa}
                      onChangeText={(v) => setVpa(v.toLowerCase())}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="name@okaxis"
                      error={errors.vpa}
                    />
                  )}

                  <Input
                    label="PAN, for tax records"
                    value={pan}
                    onChangeText={(v) => setPan(v.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={10}
                    placeholder="ABCDE1234F"
                    error={errors.pan}
                  />

                  {method ? (
                    <View style={{ borderRadius: radii.md, backgroundColor: colors.warningTint, padding: spacing.md }}>
                      <Text style={[textStyle('caption'), { color: colors.warningInk }]}>
                        Saving new details pauses payouts until we verify them again. This protects you if someone else gets into your account.
                      </Text>
                    </View>
                  ) : null}

                  {saveError ? <Text style={[textStyle('caption'), { color: colors.dangerInk }]}>{saveError}</Text> : null}

                  <Button loading={saving} onPress={() => void save()}>
                    <Text style={{ color: colors.inkOnAccent }}>Save details</Text>
                  </Button>
                  {method ? (
                    <Button variant="secondary" onPress={() => setEditing(false)}>
                      <Text style={{ color: colors.text }}>Cancel</Text>
                    </Button>
                  ) : null}
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[textStyle(mono ? 'numericSm' : 'caption'), { color: colors.text, flexShrink: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}
