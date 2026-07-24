import { spacing } from '@atlitos/theme';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's closing brand block (PRD-01 3.2): the centered tagline at the end
 * of the scroll. "Athletes", "Tech" and "Purpose" pick up the accent color as
 * inline Text spans rather than the whole line, per the mockup.
 */
export function BrandFooter() {
  const colors = useThemeColors();

  return (
    <View
      className="items-center"
      style={{ paddingVertical: spacing['4xl'], paddingHorizontal: spacing.xl }}
    >
      <Text
        style={[textStyle('h3'), { color: colors.textSecondary, textAlign: 'center' }]}
      >
        Built for <Text style={[textStyle('h3'), { color: colors.accent }]}>Athletes</Text>. Backed by{' '}
        <Text style={[textStyle('h3'), { color: colors.accent }]}>Tech</Text>. Powered by{' '}
        <Text style={[textStyle('h3'), { color: colors.accent }]}>Purpose</Text>.
      </Text>
    </View>
  );
}
