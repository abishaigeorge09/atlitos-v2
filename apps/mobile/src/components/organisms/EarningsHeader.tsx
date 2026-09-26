import { Button, styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import { Landmark } from 'lucide-react-native';
import { Text, View } from 'react-native';

/**
 * SPEC.md organism #35. Balance + payout details + This Month + Pending
 * stats (coach only, `pending` is optional to support both roles).
 *
 * There is no Transfer button. Razorpay Route is closed to ELSHEPH, so
 * Atlitos pays verified payout details by NEFT or UPI (migration 0130) and
 * the coach never requests a transfer. The one action is keeping those
 * details right.
 */
export interface EarningsHeaderProps {
  balance: number;
  thisMonth: number;
  pending?: number;
  onPayoutDetails: () => void;
}

export function EarningsHeader({ balance, thisMonth, pending, onPayoutDetails }: EarningsHeaderProps) {
  const colors = useThemeColors();

  const handlePayoutDetails = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPayoutDetails();
  };

  return (
    <View
      style={{
        borderRadius: radii.xl,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.lg,
        gap: spacing.lg,
      }}
    >
      <View>
        {/* textSecondary, not tertiary: this whole header is a colors.card
            surface, textTertiary fails AA contrast against it in dark mode. */}
        <Text style={[textStyle('overline'), { color: colors.textSecondary }]}>Balance</Text>
        <Text style={[textStyle('numericDisplay'), { color: colors.text }]}>{formatINR(balance)}</Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button variant="secondary" onPress={handlePayoutDetails}>
          <Landmark size={20} color={colors.text} strokeWidth={1.75} />
          <Text style={[textStyle('label'), { color: colors.text }]}>Payout details</Text>
        </Button>
        <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
          Atlitos pays your available earnings to your bank. You do not need to request it.
        </Text>
      </View>

      <View style={[styles.row, { gap: spacing.xl }]}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>This month</Text>
          <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(thisMonth)}</Text>
        </View>
        {pending !== undefined ? (
          <View style={{ gap: spacing.xs }}>
            <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>Pending</Text>
            <Text style={[textStyle('numericBase'), { color: colors.warning }]}>{formatINR(pending)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
