import type { SearchHit } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { CalendarCheck, MapPin } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { PriceText } from '@/components/ui/price-text';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * One court search result (migration 0134). Leads with WHEN, because a court
 * search is a question about time: "Free today at 7:00 PM", then the venue,
 * then the slot's real price. Every row is bookable at that time and price,
 * since it comes from the same availability the booking screen uses.
 */
export function CourtSlotResult({
  hit,
  showDistance,
  showSlotCount,
  onPress,
}: {
  hit: SearchHit;
  showDistance: boolean;
  /** Only for a search with a time ("3 slots free tonight"); over a whole week the count is noise. */
  showSlotCount: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const slot = hit.slot;
  const more = slot?.otherCourtsFree ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${hit.title}, free ${slot?.label ?? ''}, ${slot ? `${slot.price} rupees` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: spacing.lg,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceMuted : colors.card,
        padding: spacing.lg,
        gap: spacing.sm,
      })}
    >
      {slot ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <CalendarCheck size={16} color={colors.successInk} strokeWidth={1.75} />
          <Text style={[textStyle('label'), { color: colors.successInk }]}>Free {slot.label}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={[textStyle('h3'), { color: colors.text }]} numberOfLines={1}>
            {hit.title}
          </Text>
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]} numberOfLines={1}>
            {hit.subtitle}
          </Text>
        </View>
        {slot ? <PriceText amount={slot.price} size="base" /> : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {showDistance && typeof hit.distanceKm === 'number' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <MapPin size={14} color={colors.textSecondary} strokeWidth={1.75} />
            <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{hit.distanceKm.toFixed(1)} km</Text>
          </View>
        ) : null}
        {showSlotCount && slot && slot.freeSlots > 1 ? (
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>{slot.freeSlots} slots free</Text>
        ) : null}
        {more > 0 ? (
          <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
            {more} more {more === 1 ? 'court' : 'courts'} free here
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
