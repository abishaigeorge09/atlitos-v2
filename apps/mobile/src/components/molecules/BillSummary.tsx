import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';
import { cn } from '@/lib/utils';
import { formatINR } from '@atlitos/theme';
import type { BillSummaryLine } from '@atlitos/types';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

export interface BillSummaryDonationRow {
  label: string;
  amount: number;
  checked: boolean;
  onToggle: () => void;
}

export interface BillSummaryProps {
  rows: BillSummaryLine[];
  donationRow?: BillSummaryDonationRow;
  total: number;
}

/**
 * SPEC #25. THE shared money pattern, DESIGN-LANGUAGE "Money surfaces" rule:
 * every screen touching money renders this, never a hand rolled price
 * breakdown. Line items in callout/mono, Total bold in numericLg mono.
 * Rows never accept a client supplied final price as authoritative, this is
 * a display component only; the caller is responsible for server verified
 * amounts (PRICE_MISMATCH invariant, see CLAUDE.md).
 */
export function BillSummary({ rows, donationRow, total }: BillSummaryProps) {
  const colors = useThemeColors();

  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    donationRow?.onToggle();
  };

  return (
    <View className="gap-sm">
      {rows.map((row) => (
        <View key={row.label} className="flex-row items-center justify-between">
          <Text
            className={cn(
              'text-sm',
              row.emphasis === 'muted' ? 'text-text-tertiary' : 'text-text-secondary',
            )}
          >
            {row.label}
          </Text>
          <Text className="font-mono text-sm text-text">{formatINR(row.amount)}</Text>
        </View>
      ))}

      {donationRow ? (
        <Pressable
          onPress={handleToggle}
          role="checkbox"
          aria-checked={donationRow.checked}
          className="min-h-11 flex-row items-center justify-between gap-md"
        >
          <View className="flex-shrink flex-row items-center gap-sm">
            <View
              className={cn(
                'h-5 w-5 items-center justify-center rounded-xs border',
                donationRow.checked ? 'border-accent bg-accent' : 'border-border-strong bg-transparent',
              )}
            >
              {donationRow.checked ? <Check size={14} strokeWidth={2.5} color={colors.inkOnAccent} /> : null}
            </View>
            <Text className="flex-shrink text-sm text-text-secondary">{donationRow.label}</Text>
          </View>
          <Text className="font-mono text-sm text-text">{formatINR(donationRow.amount)}</Text>
        </Pressable>
      ) : null}

      <View className="my-xs h-px bg-border" />

      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-xl text-text">Total</Text>
        <Text className="font-mono-semibold text-2xl text-text">{formatINR(total)}</Text>
      </View>
    </View>
  );
}

export default BillSummary;
