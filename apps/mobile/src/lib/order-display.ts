import type { OrderStatus } from '@atlitos/types';

import type { Status } from '@/components/ui/status-pill';

/**
 * Commerce order lifecycle presentation, in one place so the order list, the
 * order detail and the timeline cannot describe the same status differently.
 * The shopper app only ever READS these values; transitions are driven by
 * admin actions through `order_transition`, a service role RPC (PRD-07 FR-24).
 */

export const ORDER_STATUS_PILL: Record<OrderStatus, Status> = {
  placed: 'placed',
  shipped: 'shipped',
  in_transit: 'inTransit',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

/** Timeline entry wording. No hyphens or em dashes, per the house style. */
export const ORDER_STATUS_EVENT: Record<OrderStatus, string> = {
  placed: 'Order placed',
  shipped: 'Order has been shipped',
  in_transit: 'Order is in transit',
  delivered: 'Order delivered',
  cancelled: 'Order cancelled',
};

/** "May 20" style short date for the timeline and the order cards. Uses the
 * platform Intl formatter rather than a date library, matching how the rest of
 * this app formats dates. */
export function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
