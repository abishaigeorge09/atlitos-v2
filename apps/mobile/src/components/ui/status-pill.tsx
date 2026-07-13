import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { View } from 'react-native';

export type Status =
  | 'underReview'
  | 'verified'
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'delivered'
  | 'shipped';

interface StatusConfig {
  label: string;
  bgClass: string;
  textClass: string;
}

/**
 * Status -> semantic token mapping. Every color routes through the tint/base
 * pair generated from @atlitos/theme, never a raw hex, per DESIGN-LANGUAGE.
 * Copy strings avoid hyphens per the house style (voice and copy rules).
 */
const STATUS_CONFIG: Record<Status, StatusConfig> = {
  underReview: { label: 'Under review', bgClass: 'bg-info-tint', textClass: 'text-info' },
  verified: { label: 'Verified', bgClass: 'bg-success-tint', textClass: 'text-success' },
  pending: { label: 'Pending', bgClass: 'bg-warning-tint', textClass: 'text-warning' },
  completed: { label: 'Completed', bgClass: 'bg-success-tint', textClass: 'text-success' },
  cancelled: { label: 'Cancelled', bgClass: 'bg-danger-tint', textClass: 'text-danger' },
  rescheduled: { label: 'Rescheduled', bgClass: 'bg-warning-tint', textClass: 'text-warning' },
  delivered: { label: 'Delivered', bgClass: 'bg-success-tint', textClass: 'text-success' },
  shipped: { label: 'Shipped', bgClass: 'bg-info-tint', textClass: 'text-info' },
};

export interface StatusPillProps {
  status: Status;
  className?: string;
}

/**
 * StatusPill. Locked API per SPEC Section 5.1 #8: `status` enum
 * underReview|verified|pending|completed|cancelled|rescheduled|delivered|
 * shipped. Colors map to semantic tokens per STATUS_CONFIG above.
 */
function StatusPill({ status, className }: StatusPillProps) {
  const config = STATUS_CONFIG[status];
  return (
    <View className={cn('h-6 flex-row items-center self-start rounded-pill px-sm', config.bgClass, className)}>
      <Text className={cn('text-xs font-sans-semibold', config.textClass)}>{config.label}</Text>
    </View>
  );
}

export { StatusPill };
