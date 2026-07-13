import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { View } from 'react-native';

export interface OrderTimelineEvent {
  date: string;
  event: string;
  location: string;
}

export interface OrderTimelineProps {
  events: OrderTimelineEvent[];
}

/**
 * SPEC #26: vertical timeline, "May 20 · Order has been shipped · Delhi, UP".
 * Events are chronological, the last entry is the current/latest status and
 * gets the accent dot, the rest render muted.
 */
export function OrderTimeline({ events }: OrderTimelineProps) {
  return (
    <View>
      {events.map((item, index) => {
        const isLast = index === events.length - 1;
        return (
          <View key={`${item.date}-${item.event}`} className="flex-row">
            <View className="w-5 items-center">
              <View className={cn('mt-xs h-2.5 w-2.5 rounded-pill', isLast ? 'bg-accent' : 'bg-border-strong')} />
              {!isLast ? <View className="w-px flex-1 bg-border" style={{ minHeight: 20 }} /> : null}
            </View>
            <View className="flex-1 gap-xs pb-lg pl-sm">
              <Text className="font-sans-semibold text-sm text-text">
                {item.date} · {item.event}
              </Text>
              <Text className="text-xs text-text-tertiary">{item.location}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default OrderTimeline;
