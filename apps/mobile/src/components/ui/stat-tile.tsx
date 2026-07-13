import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 17: StatTile. label + big numeric value, used in 2-col grids
 * ("Total Sessions / 100"). `progress` variant adds a track bar underneath,
 * clamped 0 to 1, filled in accent.
 */
export interface StatTileProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  variant?: 'default' | 'progress';
  progress?: number;
  className?: string;
}

function StatTile({ label, value, icon: Icon, variant = 'default', progress = 0, className }: StatTileProps) {
  const colors = useThemeColors();
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View className={cn('flex-1 gap-xs rounded-lg border border-border bg-card p-lg', className)}>
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-medium text-sm text-text-secondary">{label}</Text>
        {Icon ? <Icon size={20} strokeWidth={1.75} color={colors.textTertiary} /> : null}
      </View>

      <Text className="font-mono-semibold text-3xl text-text">{value}</Text>

      {variant === 'progress' ? (
        <View className="mt-xs h-1.5 w-full overflow-hidden rounded-pill bg-surface-muted">
          <View
            className="h-full rounded-pill bg-accent"
            style={{ width: `${clamped * 100}%` }}
          />
        </View>
      ) : null}
    </View>
  );
}

export { StatTile };
