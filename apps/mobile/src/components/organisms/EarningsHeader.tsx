import { Button, styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import { ArrowDownToLine, Send } from 'lucide-react-native';
import { Text, View } from 'react-native';

/**
 * SPEC.md organism #35. Balance + Send/Transfer buttons + This Month +
 * Pending stats (coach only, `pending` is optional to support both roles).
 */
export interface EarningsHeaderProps {
  balance: number;
  thisMonth: number;
  pending?: number;
  onSend: () => void;
  onTransfer: () => void;
}

export function EarningsHeader({ balance, thisMonth, pending, onSend, onTransfer }: EarningsHeaderProps) {
  const colors = useThemeColors();

  const handleSend = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend();
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

      <View style={[styles.row, { gap: spacing.sm }]}>
        <Button variant="secondary" onPress={handleSend} style={{ flex: 1 }}>
          <Send size={20} color={colors.text} strokeWidth={1.75} />
          <Text style={[textStyle('label'), { color: colors.text }]}>Send</Text>
        </Button>
        <Button onPress={onTransfer} style={{ flex: 1 }}>
          <ArrowDownToLine size={20} color={colors.inkOnAccent} strokeWidth={1.75} />
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Transfer</Text>
        </Button>
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
