import { BillSummary, Button, TextField, styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * SPEC.md organism #39. Preset amounts + fund specific item + custom amount,
 * resolves to the shared BillSummary before the pay action.
 */
export interface DonationFundItem {
  label: string;
  cost: number;
}

export interface DonationSheetProps {
  causeTitle: string;
  presetAmounts: number[];
  fundItem?: DonationFundItem;
  platformFee?: number;
  onDonate: (amount: number) => void;
}

export function DonationSheet({ causeTitle, presetAmounts, fundItem, platformFee = 0, onDonate }: DonationSheetProps) {
  const colors = useThemeColors();
  const [selected, setSelected] = React.useState<number | undefined>(presetAmounts[0]);
  const [customAmount, setCustomAmount] = React.useState('');

  const amount = customAmount ? Number(customAmount) || 0 : selected ?? 0;
  const total = amount + platformFee;

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
          style={[
            styles.between,
            {
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              padding: spacing.md,
            },
          ]}
        >
          <Text style={[textStyle('body'), { color: colors.text }]}>{fundItem.label}</Text>
          <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(fundItem.cost)}</Text>
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

      <BillSummary
        lines={[
          { label: 'Donation', amount: formatINR(amount) },
          { label: 'Platform fee', amount: formatINR(platformFee) },
        ]}
        total={formatINR(total)}
      />

      <Button disabled={total <= 0} onPress={() => onDonate(amount)}>
        <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>
          Donate <Text style={[textStyle('numericSm'), { color: colors.inkOnAccent }]}>{formatINR(total)}</Text>
        </Text>
      </Button>
    </View>
  );
}
