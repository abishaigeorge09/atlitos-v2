import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { View } from 'react-native';

export type Status =
  | 'underReview'
  | 'verified'
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'delivered'
  | 'shipped'
  | 'inTransit'
  | 'placed'
  | 'noShow'
  | 'expired'
  | 'requested'
  | 'accepted'
  | 'declined'
  | 'rated';

interface StatusConfig {
  label: string;
  bgClass: string;
  textClass: string;
}

/**
 * Status -> semantic token mapping. Every color routes through the tint/base
 * pair generated from @atlitos/theme, never a raw hex, per DESIGN-LANGUAGE.
 * Copy strings avoid hyphens per the house style (voice and copy rules).
 * `confirmed`/`noShow`/`expired` are Phase 2 courts-slice additions
 * (`court_booking_status`, 0009/0011_courts*.sql): `pending` already covers
 * `pending_payment` (same "awaiting" meaning as the verification/order
 * `pending` this pill already renders, no separate mapped value needed).
 */
const STATUS_CONFIG: Record<Status, StatusConfig> = {
  underReview: { label: 'Under review', bgClass: 'bg-info-tint', textClass: 'text-info' },
  verified: { label: 'Verified', bgClass: 'bg-success-tint', textClass: 'text-success' },
  pending: { label: 'Pending', bgClass: 'bg-warning-tint', textClass: 'text-warning' },
  confirmed: { label: 'Confirmed', bgClass: 'bg-success-tint', textClass: 'text-success' },
  completed: { label: 'Completed', bgClass: 'bg-success-tint', textClass: 'text-success' },
  cancelled: { label: 'Cancelled', bgClass: 'bg-danger-tint', textClass: 'text-danger' },
  rescheduled: { label: 'Rescheduled', bgClass: 'bg-warning-tint', textClass: 'text-warning' },
  delivered: { label: 'Delivered', bgClass: 'bg-success-tint', textClass: 'text-success' },
  shipped: { label: 'Shipped', bgClass: 'bg-info-tint', textClass: 'text-info' },
  // Commerce order lifecycle (order_status, 0031_commerce.sql). `placed` and
  // `in_transit` are the two values with no court/session equivalent above:
  // `pending` would read as "awaiting payment" on an order that is already
  // paid, and folding `in_transit` into `shipped` would tell a shopper their
  // parcel had not moved since dispatch.
  placed: { label: 'Placed', bgClass: 'bg-accent-tint', textClass: 'text-accent' },
  inTransit: { label: 'In transit', bgClass: 'bg-info-tint', textClass: 'text-info' },
  noShow: { label: 'No show', bgClass: 'bg-danger-tint', textClass: 'text-danger' },
  expired: { label: 'Expired', bgClass: 'bg-danger-tint', textClass: 'text-danger' },
  // Sessions (session_status, 0018_coaching.sql): requested/accepted/
  // declined/rated are the coaching-specific machine values that have no
  // court_booking_status equivalent above.
  requested: { label: 'Requested', bgClass: 'bg-warning-tint', textClass: 'text-warning' },
  accepted: { label: 'Accepted', bgClass: 'bg-success-tint', textClass: 'text-success' },
  declined: { label: 'Declined', bgClass: 'bg-danger-tint', textClass: 'text-danger' },
  rated: { label: 'Rated', bgClass: 'bg-success-tint', textClass: 'text-success' },
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
