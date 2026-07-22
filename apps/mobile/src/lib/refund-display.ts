import type { RefundStatus } from '@atlitos/types';

/**
 * AT-148 (AT-88, PRD-02 FR-35). Copy for surfacing a refund the user is owed
 * on a cancelled session or order. Keyed off the refund's own status, never
 * off the mere existence of a row: a `pending` refund is money that has not
 * moved yet and must never read as "Refunded".
 */
export const REFUND_STATUS_HEADING: Record<RefundStatus, string> = {
  processed: 'Refunded',
  pending: 'Refund on its way',
  failed: 'Refund pending',
};

export const REFUND_STATUS_CAPTION: Record<RefundStatus, string> = {
  processed: 'The full amount has been returned to your original payment method.',
  pending: 'Your refund is on its way. It can take a few days to reach your account.',
  failed: 'We could not complete this refund yet. Our team is on it and will retry.',
};
