import { Button, Stepper, styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { spacing } from '@atlitos/theme';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

/**
 * SPEC.md organism #36. Shell for multi-step setups (profile setup,
 * checkout, booking): Stepper + step content + Next/Back, steps as config.
 */
export interface ProfileWizardStep {
  id: string;
  label: string;
  content: ReactNode;
}

export interface ProfileWizardProps {
  steps: ProfileWizardStep[];
  currentIndex: number;
  onNext: () => void;
  onBack: () => void;
  onFinish: () => void;
  canGoNext?: boolean;
}

export function ProfileWizard({ steps, currentIndex, onNext, onBack, onFinish, canGoNext = true }: ProfileWizardProps) {
  const colors = useThemeColors();
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === steps.length - 1;
  const step = steps[currentIndex];

  const handleAdvance = isLast ? onFinish : onNext;

  return (
    <View style={{ flex: 1, gap: spacing.xl, padding: spacing.lg }}>
      <Stepper steps={steps.map((s) => s.label)} current={currentIndex} />

      <View style={{ flex: 1 }}>{step?.content}</View>

      <View style={[styles.row, { gap: spacing.sm }]}>
        {!isFirst ? (
          <Button variant="secondary" onPress={onBack} style={{ flex: 1 }}>
            <Text style={[textStyle('label'), { color: colors.text }]}>Back</Text>
          </Button>
        ) : null}
        <Button disabled={!canGoNext} onPress={handleAdvance} style={{ flex: 1 }}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>{isLast ? 'Finish' : 'Next'}</Text>
        </Button>
      </View>
    </View>
  );
}
