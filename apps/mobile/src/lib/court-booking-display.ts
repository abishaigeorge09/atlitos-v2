import type { CourtBookingStatus } from '@atlitos/types';
import type { Status as StatusPillStatus } from '@/components/ui/status-pill';

/** `court_bookings.status` (server enum, 0009/0011_courts*.sql) ->
 * `StatusPill`'s own `Status` union. `pending_payment` maps to the pill's
 * existing `pending` value (same "awaiting" meaning the verification/order
 * flows already use it for), not a separate pill value. */
export const COURT_BOOKING_STATUS_PILL: Record<CourtBookingStatus, StatusPillStatus> = {
  pending_payment: 'pending',
  confirmed: 'confirmed',
  completed: 'completed',
  cancelled: 'cancelled',
  rescheduled: 'rescheduled',
  no_show: 'noShow',
  expired: 'expired',
};
