import type { SessionFrequency, SessionStatus } from '@atlitos/types';
import type { Status as StatusPillStatus } from '@/components/ui/status-pill';

/** `sessions.status` (server enum, 0018_coaching.sql) -> `StatusPill`'s own
 * `Status` union. Mirrors `lib/court-booking-display.ts`'s
 * `COURT_BOOKING_STATUS_PILL` for the coaching domain. */
export const SESSION_STATUS_PILL: Record<SessionStatus, StatusPillStatus> = {
  requested: 'requested',
  accepted: 'accepted',
  in_progress: 'inProgress',
  declined: 'declined',
  completed: 'completed',
  cancelled: 'cancelled',
  rescheduled: 'rescheduled',
  rated: 'rated',
};

/** `sessions.frequency` (server enum, 0018_coaching.sql), used by the
 * booking flow's session type + frequency step and the session detail/list
 * screens. Copy avoids hyphens per the house style. */
export const SESSION_FREQUENCY_LABEL: Record<SessionFrequency, string> = {
  one_time: 'One time',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
