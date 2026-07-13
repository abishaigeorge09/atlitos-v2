import { cn } from '@/lib/utils';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { formatINR } from '@atlitos/theme';
import { Text } from 'react-native';

export type PriceTextSize = 'sm' | 'base' | 'lg';

export interface PriceTextProps {
  amount: number;
  size?: PriceTextSize;
  strike?: boolean;
  className?: string;
}

const SIZE_VARIANT = {
  sm: 'numericSm',
  base: 'numericBase',
  lg: 'numericLg',
} as const;

/**
 * PriceText. Locked API per SPEC Section 5.1 #9: `amount`, `size`, `strike?`.
 * Renders `formatINR` (Indian digit grouping, e.g. ₹2,31,000) in JetBrains
 * Mono with tabular figures via `textStyle`, the house numerics rule, never
 * plain Inter and never a bare ungrouped number. `strike` renders the price
 * crossed out in textTertiary, for the discount pair pattern (a struck
 * original PriceText next to the active discounted PriceText).
 */
function PriceText({ amount, size = 'base', strike, className }: PriceTextProps) {
  const colors = useThemeColors();

  return (
    <Text
      className={cn(className)}
      style={[
        textStyle(SIZE_VARIANT[size]),
        { color: strike ? colors.textTertiary : colors.text },
        strike ? { textDecorationLine: 'line-through' as const } : null,
      ]}
    >
      {formatINR(amount)}
    </Text>
  );
}

export { PriceText };
