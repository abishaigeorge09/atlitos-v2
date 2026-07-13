import { BillSummary, Button, type BillSummaryLine } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { radii, spacing } from '@atlitos/theme';
import { CheckCircle2 } from 'lucide-react-native';
import { Text, View } from 'react-native';

/**
 * SPEC.md organism #33. Success check in a success tint circle, booking
 * summary via the shared BillSummary pattern, primary CTA (View Booking or
 * Explore More, caller decides which via `primaryLabel`).
 */
export interface BookingConfirmationProps {
  title: string;
  message: string;
  bookingId?: string;
  lines: BillSummaryLine[];
  total: string;
  primaryLabel: string;
  onPrimaryPress: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
}

export function BookingConfirmation({
  title,
  message,
  bookingId,
  lines,
  total,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
}: BookingConfirmationProps) {
  const colors = useThemeColors();

  return (
    <View style={{ gap: spacing.xl, padding: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            height: 72,
            width: 72,
            borderRadius: radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.successTint,
          }}
        >
          <CheckCircle2 size={40} color={colors.success} strokeWidth={1.75} />
        </View>
        <Text style={[textStyle('h1'), { color: colors.text, textAlign: 'center' }]}>{title}</Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>{message}</Text>
        {bookingId ? (
          <Text style={[textStyle('numericSm'), { color: colors.textTertiary }]}>Booking ID {bookingId}</Text>
        ) : null}
      </View>

      <View
        style={{
          borderRadius: radii.xl,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          padding: spacing.lg,
        }}
      >
        <BillSummary lines={lines} total={total} />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button onPress={onPrimaryPress}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>{primaryLabel}</Text>
        </Button>
        {secondaryLabel && onSecondaryPress ? (
          <Button variant="secondary" onPress={onSecondaryPress}>
            <Text style={[textStyle('label'), { color: colors.text }]}>{secondaryLabel}</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}
