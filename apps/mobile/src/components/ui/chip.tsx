import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { Pressable } from 'react-native';

export type ChipVariant = 'category' | 'filter' | 'select';

export interface ChipProps {
  label: string;
  variant?: ChipVariant;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}

/**
 * Chip. Locked API per SPEC Section 5.1 #5: `variant`
 * category|filter|select, `selected`. radius.pill, label typography, per
 * DESIGN-LANGUAGE "Chips/tags/pills": accentTint fill + accent text when
 * selected, surfaceMuted fill + textSecondary otherwise. `select` variant
 * additionally shows a lucide Check when selected, the multi/single-select
 * affordance distinguishing it from category/filter chips.
 *
 * Height is 36 (h-9), below the 44pt minimum, compensated with hitSlop.
 */
function Chip({ label, variant = 'category', selected = false, onPress, disabled }: ChipProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        if (!onPress) return;
        Haptics.selectionAsync().catch(() => {
          // Haptics unavailable, not fatal.
        });
        onPress();
      }}
      className={cn(
        'h-9 flex-row items-center justify-center gap-xs rounded-pill border px-lg',
        selected ? 'border-accent bg-accent-tint' : 'border-border bg-surface-muted',
        disabled && 'opacity-50',
      )}
    >
      {selected && variant === 'select' ? <Check size={14} color={colors.accent} strokeWidth={2.5} /> : null}
      <Text className={cn('text-sm font-sans-semibold', selected ? 'text-accent' : 'text-text-secondary')}>
        {label}
      </Text>
    </Pressable>
  );
}

export { Chip };
