import type { GroupMembershipStatus } from '@atlitos/api';
import type { SessionFrequency, SessionStatus } from '@atlitos/types';
import type { Status as StatusPillStatus } from '@/components/ui/status-pill';

/** `sessions.status` (server enum, 0018_coaching.sql) -> `StatusPill`'s own
 * `Status` union. Mirrors `lib/court-booking-display.ts`'s
 * `COURT_BOOKING_STATUS_PILL` for the coaching domain. `in_progress` is the
 * 0077 group Start Session state; a 1:1 session never reaches it through the
 * client door (see `use-groups.ts` `completeGroupSession`'s doc comment). */
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

/** `group_memberships.status` (0076) -> `StatusPill`. `pending` reuses the
 * shared warning pill (payment not captured yet, same "awaiting" meaning as
 * every other domain's `pending`); only `active`/`lapsed` are groups
 * specific. */
export const GROUP_MEMBERSHIP_STATUS_PILL: Record<GroupMembershipStatus, StatusPillStatus> = {
  pending: 'pending',
  active: 'membershipActive',
  lapsed: 'membershipLapsed',
};

/** `sessions.frequency` (server enum, 0018_coaching.sql), used by the
 * booking flow's session type + frequency step and the session detail/list
 * screens. Copy avoids hyphens per the house style. */
export const SESSION_FREQUENCY_LABEL: Record<SessionFrequency, string> = {
  one_time: 'One time',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
