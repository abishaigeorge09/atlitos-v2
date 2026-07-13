import { cn } from '@/lib/utils';
import { View } from 'react-native';

export type DividerOrientation = 'horizontal' | 'vertical';

export interface DividerProps {
  orientation?: DividerOrientation;
  className?: string;
}

/**
 * Divider. Locked per SPEC Section 5.1 #11 (name only, no props/variants
 * listed). `orientation` is a minimal, obvious extension since list rows,
 * wizards, and BillSummary layouts need both. `border-{side}-hairline` uses
 * the `hairlineWidth()` borderWidth token from tailwind.config.js for a true
 * 1px device line, and the `border` color token, never a raw hex.
 */
function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <View
      accessibilityRole="none"
      className={cn(
        orientation === 'horizontal'
          ? 'w-full border-t-hairline border-border'
          : 'h-full border-l-hairline border-border',
        className,
      )}
    />
  );
}

export { Divider };
