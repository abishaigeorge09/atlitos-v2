import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import { Check } from 'lucide-react-native';
import { View } from 'react-native';

export interface StepperProps {
  steps: string[];
  current: number;
}

/**
 * Stepper. Locked API per SPEC Section 5.1 #10: `steps`, `current`. Drives
 * multi-step wizards (ProfileWizard, checkout, booking, per SPEC Section
 * 5.3). `current` is a 0-indexed active step index: steps before it render
 * completed (accent fill + check), the active step is accent-outlined,
 * later steps stay neutral.
 */
function Stepper({ steps, current }: StepperProps) {
  const colors = useThemeColors();

  return (
    <View className="flex-row items-center" accessibilityRole="progressbar">
      {steps.map((label, index) => {
        const isCompleted = index < current;
        const isActive = index === current;
        const isLast = index === steps.length - 1;

        return (
          <View key={label} className="flex-1 flex-row items-center">
            <View
              className={cn(
                'h-7 w-7 items-center justify-center rounded-pill border-2',
                isCompleted && 'border-accent bg-accent',
                isActive && !isCompleted && 'border-accent bg-transparent',
                !isCompleted && !isActive && 'border-border bg-transparent',
              )}
            >
              {isCompleted ? (
                <Check size={14} color={colors.inkOnAccent} strokeWidth={2.5} />
              ) : (
                <Text className={cn('font-mono text-xs', isActive ? 'text-accent' : 'text-text-tertiary')}>
                  {index + 1}
                </Text>
              )}
            </View>
            {!isLast ? (
              <View className={cn('mx-xs h-px flex-1', isCompleted ? 'bg-accent' : 'bg-border')} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export { Stepper };
