import { Button, TextField, styles } from '@/components/organisms/_shared';
import { BillSummary } from '@/components/molecules/BillSummary';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * SPEC organism #39, AT-121. Preset amounts (configurable, FR-19) plus a
 * custom amount, optionally preselecting a wishlist item (FR-6). Resolves to
 * the SHARED `BillSummary` before the pay action: a standalone donation shows
 * a single Donation row and a bold Total, NO platform fee or GST row (PRD-06
 * FR-6, FR-17). The client never determines the final charge; `minAmount`
 * only gates the button and shows a hint, the `donate` edge function re-prices
 * and enforces MIN_AMOUNT server side (FR-7).
 */
export interface DonationFundItem {
  label: string;
  cost: number;
  /** Per item progress (funded_amount), so the sheet can show what remains.
   * A display figure only, not a fund money total. */
  fundedAmount: number;
}

export interface DonationSheetProps {
  causeTitle: string;
  presetAmounts: number[];
  fundItem?: DonationFundItem;
  /** Platform minimum (fee_config donations.min_amount), for the button gate
   * and hint. The server is the authority. */
  minAmount: number;
  submitting?: boolean;
  onDonate: (amount: number) => void;
}

export function DonationSheet({
  causeTitle,
  presetAmounts,
  fundItem,
  minAmount,
  submitting = false,
  onDonate,
}: DonationSheetProps) {
  const colors = useThemeColors();
  const [selected, setSelected] = React.useState<number | undefined>(presetAmounts[0]);
  const [customAmount, setCustomAmount] = React.useState('');

  const remaining = fundItem ? Math.max(0, fundItem.cost - fundItem.fundedAmount) : undefined;
  const amount = customAmount ? Number(customAmount) || 0 : selected ?? 0;
  const belowMin = amount > 0 && amount < minAmount;
  const canDonate = amount >= minAmount && !submitting;

  const handlePreset = (value: number) => {
    Haptics.selectionAsync();
    setSelected(value);
    setCustomAmount('');
  };

  return (
    <View style={{ gap: spacing.xl, padding: spacing.lg }}>
      <View>
        <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Donate</Text>
        <Text style={[textStyle('h2'), { color: colors.text }]}>{causeTitle}</Text>
      </View>

      {fundItem ? (
        <View
          style={{
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: spacing.md,
            gap: spacing.xs,
          }}
        >
          <View style={styles.between}>
            <Text style={[textStyle('body'), { color: colors.text }]}>{fundItem.label}</Text>
            <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(fundItem.cost)}</Text>
          </View>
          <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>
            {formatINR(remaining ?? 0)} left to reach this goal
          </Text>
        </View>
      ) : null}

      <View style={[styles.row, { flexWrap: 'wrap', gap: spacing.sm }]}>
        {presetAmounts.map((value) => {
          const active = selected === value && !customAmount;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              onPress={() => handlePreset(value)}
              style={{
                minHeight: 44,
                minWidth: 44,
                paddingHorizontal: spacing.lg,
                borderRadius: radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.accent : colors.surfaceMuted,
              }}
            >
              <Text style={[textStyle('numericBase'), { color: active ? colors.inkOnAccent : colors.text }]}>
                {formatINR(value)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label="Custom amount"
        placeholder="Enter amount"
        keyboardType="number-pad"
        value={customAmount}
        onChangeText={(value) => {
          setCustomAmount(value);
          setSelected(undefined);
        }}
      />

      {belowMin ? (
        <Text style={[textStyle('caption'), { color: colors.danger }]}>
          The minimum donation is {formatINR(minAmount)}.
        </Text>
      ) : null}

      {/* FR-6/FR-17: the shared BillSummary, a single Donation row and Total. */}
      <BillSummary rows={[{ label: 'Donation', amount }]} total={amount} />

      <Button disabled={!canDonate} loading={submitting} onPress={() => onDonate(amount)}>
        <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>
          Donate <Text style={[textStyle('numericSm'), { color: colors.inkOnAccent }]}>{formatINR(amount)}</Text>
        </Text>
      </Button>
    </View>
  );
}
