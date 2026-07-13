import { Button } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { radii, spacing } from '@atlitos/theme';
import type { LucideIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';

/**
 * SPEC.md organism #42. Icon + title + body + optional CTA. `icon` is always
 * a lucide component reference, never an emoji, per DESIGN-LANGUAGE.md.
 */
export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
}

export function EmptyState({ icon: Icon, title, body, ctaLabel, onCtaPress }: EmptyStateProps) {
  const colors = useThemeColors();

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing['3xl'] }}>
      <View
        style={{
          height: 80,
          width: 80,
          borderRadius: radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceMuted,
        }}
      >
        <Icon size={48} color={colors.textTertiary} strokeWidth={1.75} />
      </View>
      <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>{body}</Text>
      {ctaLabel && onCtaPress ? (
        <Button onPress={onCtaPress} style={{ marginTop: spacing.sm }}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>{ctaLabel}</Text>
        </Button>
      ) : null}
    </View>
  );
}
