import { Button, StarRating, TextField, styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { spacing } from '@atlitos/theme';
import { CheckCircle2 } from 'lucide-react-native';
import * as React from 'react';
import { Text, View } from 'react-native';

/**
 * SPEC.md organism #34. Entity summary + booking ID + StarRating(input) +
 * remarks + submit, transitions to a review success state.
 */
export interface RateReviewFormProps {
  entityName: string;
  entitySubtitle: string;
  bookingId: string;
  onSubmit: (rating: number, remarks: string) => void;
  submitted?: boolean;
}

export function RateReviewForm({ entityName, entitySubtitle, bookingId, onSubmit, submitted }: RateReviewFormProps) {
  const colors = useThemeColors();
  const [rating, setRating] = React.useState(0);
  const [remarks, setRemarks] = React.useState('');

  if (submitted) {
    return (
      <View style={{ alignItems: 'center', gap: spacing.md, padding: spacing['3xl'] }}>
        <CheckCircle2 size={48} color={colors.success} strokeWidth={1.75} />
        <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
          Thanks for the review
        </Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
          Your feedback helps other athletes choose with confidence.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.lg, padding: spacing.lg }}>
      <View>
        <Text style={[textStyle('h3'), { color: colors.text }]}>{entityName}</Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{entitySubtitle}</Text>
        <Text style={[textStyle('caption'), { color: colors.textTertiary, marginTop: spacing.xs }]}>
          Booking ID {bookingId}
        </Text>
      </View>

      <View style={[styles.row, { justifyContent: 'center', paddingVertical: spacing.md }]}>
        <StarRating mode="input" value={rating} onChange={setRating} size={32} />
      </View>

      <TextField
        label="Remarks"
        placeholder="Tell others about your experience"
        multiline
        value={remarks}
        onChangeText={setRemarks}
      />

      <Button disabled={rating === 0} onPress={() => onSubmit(rating, remarks)}>
        <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Submit review</Text>
      </Button>
    </View>
  );
}
