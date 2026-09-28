import { Text } from 'react-native';

import { openSitePage } from '@/lib/site';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Consent line shown with every account creating action (register, and the
 * Apple and Google buttons on login, which create an account on first use).
 * Apple Guideline 5.1.1 and the DPDP notice: the person sees the terms, the
 * privacy policy and the 18+ rule before an account exists. "Terms" and
 * "Privacy policy" open the live pages in the in app browser.
 */
export function ConsentLine() {
  const colors = useThemeColors();
  const link = [textStyle('caption'), { color: colors.accent, textDecorationLine: 'underline' as const }];
  return (
    <Text style={[textStyle('caption'), { color: colors.textSecondary, textAlign: 'center' }]}>
      By continuing you agree to our{' '}
      <Text accessibilityRole="link" style={link} onPress={() => openSitePage('/terms')}>
        Terms
      </Text>{' '}
      and{' '}
      <Text accessibilityRole="link" style={link} onPress={() => openSitePage('/privacy')}>
        Privacy policy
      </Text>
      , and confirm you are 18 or older.
    </Text>
  );
}
