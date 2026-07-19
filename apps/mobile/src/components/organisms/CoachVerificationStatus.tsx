import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { BadgeCheck, Clock, TriangleAlert } from 'lucide-react-native';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

export type CoachVerificationTone = 'pending_review' | 'verified' | 'rejected';

export interface CoachVerificationStatusProps {
  status: CoachVerificationTone;
  rejectionReason: string | null;
}

/**
 * PRD-02 3.2, FR-7 to FR-10. Reachable from Trainings before verification
 * completes (embedded in `trainings/index.tsx`) and from `trainings/
 * verification.tsx` afterwards for the Account, Profile entry point. Three
 * states, no loading/empty variants of its own (the caller supplies those).
 * `verified` renders informationally, since a verified coach lands on the
 * Stats dashboard instead in the tab root; the dedicated route still shows
 * it for the Account entry point PRD-02 3.2 asks for.
 */
export function CoachVerificationStatus({ status, rejectionReason }: CoachVerificationStatusProps) {
  const colors = useThemeColors();

  if (status === 'verified') {
    return (
      <View style={{ alignItems: 'center', gap: spacing.md, padding: spacing['3xl'] }}>
        <View
          style={{
            height: 80,
            width: 80,
            borderRadius: radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.successTint,
          }}
        >
          <BadgeCheck size={48} color={colors.success} strokeWidth={1.75} />
        </View>
        <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>You are a verified coach</Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
          Athletes can find and book you now.
        </Text>
      </View>
    );
  }

  if (status === 'rejected') {
    return (
      <View style={{ alignItems: 'center', gap: spacing.md, padding: spacing['3xl'] }}>
        <View
          style={{
            height: 80,
            width: 80,
            borderRadius: radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.dangerTint,
          }}
        >
          <TriangleAlert size={48} color={colors.danger} strokeWidth={1.75} />
        </View>
        <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
          Your coach application was not approved
        </Text>
        {rejectionReason ? (
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {rejectionReason}
          </Text>
        ) : null}
        <Button onPress={() => router.push({ pathname: '/(onboarding)/coach-setup/[step]', params: { step: '0' } })}>
          <Text style={{ color: colors.inkOnAccent }}>Edit and resubmit</Text>
        </Button>
      </View>
    );
  }

  return (
    <View style={{ alignItems: 'center', gap: spacing.md, padding: spacing['3xl'] }}>
      <View
        style={{
          height: 80,
          width: 80,
          borderRadius: radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.warningTint,
        }}
      >
        <Clock size={48} color={colors.warning} strokeWidth={1.75} />
      </View>
      <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>Submitted for review</Text>
      <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
        We are reviewing your certificates and profile. You will be able to receive session requests once approved.
      </Text>
    </View>
  );
}
