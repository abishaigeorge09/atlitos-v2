import type { NotificationType } from '@atlitos/types';
import {
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  CalendarCheck,
  Clapperboard,
  HeartHandshake,
  type LucideIcon,
  MessageCircle,
  Package,
  LifeBuoy,
} from 'lucide-react-native';

/**
 * Per notification_type presentation (AT-147). One lucide icon and one short
 * section label per type, for the notifications list and the preferences
 * screen. lucide icons only, copy strings carry no emoji, no hyphens, no em
 * dashes, per CLAUDE.md house style.
 */
export interface NotificationTypeDisplay {
  icon: LucideIcon;
  label: string;
}

const DISPLAY: Record<NotificationType, NotificationTypeDisplay> = {
  booking: { icon: CalendarCheck, label: 'Bookings' },
  order: { icon: Package, label: 'Orders' },
  chat: { icon: MessageCircle, label: 'Messages' },
  clip_moderation: { icon: Clapperboard, label: 'Clutch' },
  donation: { icon: HeartHandshake, label: 'Empower' },
  verification: { icon: BadgeCheck, label: 'Verification' },
  transfer: { icon: ArrowLeftRight, label: 'Payouts' },
  support: { icon: LifeBuoy, label: 'Support' },
};

export function notificationDisplay(type: NotificationType): NotificationTypeDisplay {
  return DISPLAY[type] ?? { icon: Bell, label: 'Updates' };
}
