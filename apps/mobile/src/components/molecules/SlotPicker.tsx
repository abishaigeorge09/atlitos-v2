import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { TimeSlot } from '@atlitos/types';
import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

export interface SlotPickerProps {
  slots: TimeSlot[];
  value?: TimeSlot;
  onChange: (slot: TimeSlot) => void;
  disabledSlots?: TimeSlot[];
}

function slotKey(slot: TimeSlot): string {
  return `${slot.from}-${slot.to}`;
}

/** SPEC #29: time chip grid, respects availability windows via `disabledSlots`. */
export function SlotPicker({ slots, value, onChange, disabledSlots = [] }: SlotPickerProps) {
  const disabledKeys = new Set(disabledSlots.map(slotKey));

  const handlePress = (slot: TimeSlot) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(slot);
  };

  return (
    <View className="flex-row flex-wrap gap-sm">
      {slots.map((slot) => {
        const key = slotKey(slot);
        const isDisabled = disabledKeys.has(key);
        const isSelected = value ? slotKey(value) === key : false;

        return (
          <Pressable
            key={key}
            disabled={isDisabled}
            onPress={() => handlePress(slot)}
            role="button"
            aria-disabled={isDisabled}
            aria-selected={isSelected}
            className={cn(
              'min-h-11 items-center justify-center rounded-sm border px-md py-sm',
              isSelected ? 'border-accent bg-accent' : isDisabled ? 'border-border bg-surface-muted' : 'border-border-strong bg-surface',
            )}
          >
            <Text
              className={cn(
                'font-sans-semibold text-sm',
                isSelected ? 'text-ink-on-accent' : isDisabled ? 'text-text-tertiary' : 'text-text',
              )}
            >
              {slot.from} to {slot.to}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default SlotPicker;
