import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';
import { cn } from '@/lib/utils';
import {
  Award,
  CheckCircle2,
  Flame,
  Lock,
  Medal,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { View } from 'react-native';

/**
 * SPEC #24, PRD-01 FR-51: earned vs locked, lucide icon per milestone, never
 * an emoji. `iconName` matches `@atlitos/types` `Milestone.iconName`, a
 * lucide component name (PascalCase). Unknown names fall back to `Award`.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Trophy,
  Flame,
  Target,
  Award,
  Star,
  Medal,
  Zap,
  TrendingUp,
  Users,
  CheckCircle2,
};

export interface MilestoneChipProps {
  iconName: string;
  label: string;
  earned?: boolean;
}

export function MilestoneChip({ iconName, label, earned = true }: MilestoneChipProps) {
  const colors = useThemeColors();
  const Icon = ICON_MAP[iconName] ?? Award;
  const tone = earned ? colors.accent : colors.textTertiary;

  return (
    <View
      className={cn(
        'flex-row items-center self-start gap-xs rounded-pill px-md py-sm',
        earned ? 'bg-accent-tint' : 'bg-surface-muted',
      )}
    >
      {earned ? <Icon size={16} strokeWidth={2} color={tone} /> : <Lock size={16} strokeWidth={2} color={tone} />}
      <Text
        className={cn('font-sans-semibold text-xs', earned ? 'text-accent' : 'text-text-tertiary')}
      >
        {label}
      </Text>
    </View>
  );
}

export default MilestoneChip;
