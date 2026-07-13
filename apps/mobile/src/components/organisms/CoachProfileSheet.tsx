import { Button, StarRating, StatusPill, styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR, radii, spacing } from '@atlitos/theme';
import { Calendar, MessageCircle } from 'lucide-react-native';
import { Image, ScrollView, Text, View } from 'react-native';

export interface CoachSessionOffered {
  label: string;
  duration: string;
  price: number;
}

export interface CoachPricingTier {
  label: string;
  price: number;
  description?: string;
}

/**
 * SPEC.md organism #32. Full coach detail: rating, experience,
 * specialization, sessions offered, availability, tiered pricing,
 * Book Session + Message Coach.
 */
export interface CoachProfileSheetProps {
  name: string;
  sport: string;
  avatarUrl?: string;
  rating: number;
  ratingCount: number;
  experienceYears: number;
  specializations: string[];
  sessionsOffered: CoachSessionOffered[];
  availability: string[];
  pricingTiers: CoachPricingTier[];
  onBookSession: () => void;
  onMessageCoach: () => void;
}

export function CoachProfileSheet({
  name,
  sport,
  avatarUrl,
  rating,
  ratingCount,
  experienceYears,
  specializations,
  sessionsOffered,
  availability,
  pricingTiers,
  onBookSession,
  onMessageCoach,
}: CoachProfileSheetProps) {
  const colors = useThemeColors();

  // This whole sheet is a colors.surface fill, so every muted label below
  // uses textSecondary, not textTertiary, which fails AA contrast against
  // the surface in dark mode.
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'] }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}>
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={{ height: 80, width: 80, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
            {avatarUrl ? <Image source={{ uri: avatarUrl }} style={{ flex: 1 }} /> : null}
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={[textStyle('h2'), { color: colors.text }]}>{name}</Text>
            <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>
              {sport}, {experienceYears} years experience
            </Text>
            <StarRating mode="display" value={rating} count={ratingCount} />
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textSecondary }]}>Specialization</Text>
          <View style={[styles.row, { flexWrap: 'wrap', gap: spacing.sm }]}>
            {specializations.map((item) => (
              <StatusPill key={item} label={item} tone="info" />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textSecondary }]}>Sessions offered</Text>
          {sessionsOffered.map((session) => (
            <View
              key={session.label}
              style={[
                styles.between,
                { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
            >
              <View>
                <Text style={[textStyle('body'), { color: colors.text }]}>{session.label}</Text>
                <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{session.duration}</Text>
              </View>
              <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(session.price)}</Text>
            </View>
          ))}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textSecondary }]}>Availability</Text>
          <View style={[styles.row, { flexWrap: 'wrap', gap: spacing.sm }]}>
            {availability.map((slot) => (
              <StatusPill key={slot} label={slot} tone="success" />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[textStyle('overline'), { color: colors.textSecondary }]}>Pricing</Text>
          {pricingTiers.map((tier) => (
            <View
              key={tier.label}
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
                <Text style={[textStyle('label'), { color: colors.text }]}>{tier.label}</Text>
                <Text style={[textStyle('numericBase'), { color: colors.text }]}>{formatINR(tier.price)}</Text>
              </View>
              {tier.description ? (
                <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{tier.description}</Text>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.row,
          {
            gap: spacing.sm,
            padding: spacing.lg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          },
        ]}
      >
        <Button variant="secondary" onPress={onMessageCoach} style={{ flex: 1 }}>
          <MessageCircle size={20} color={colors.text} strokeWidth={1.75} />
          <Text style={[textStyle('label'), { color: colors.text }]}>Message coach</Text>
        </Button>
        <Button onPress={onBookSession} style={{ flex: 1 }}>
          <Calendar size={20} color={colors.inkOnAccent} strokeWidth={1.75} />
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Book session</Text>
        </Button>
      </View>
    </View>
  );
}
