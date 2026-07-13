import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';
import { cn } from '@/lib/utils';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

export interface CalendarPickerProps {
  value?: string; // ISO date "YYYY-MM-DD"
  onChange: (dateISO: string) => void;
  /** ISO date; dates before this are disabled/muted. Defaults to today. */
  minDate?: string;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toISODate(y: number, m: number, d: number): string {
  const mm = String(m + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function parseISODate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

/** SPEC #28: month grid, disabled past dates, selected day as an accent circle. */
export function CalendarPicker({ value, onChange, minDate }: CalendarPickerProps) {
  const colors = useThemeColors();
  const today = useMemo(() => new Date(), []);
  const minISO = minDate ?? toISODate(today.getFullYear(), today.getMonth(), today.getDate());

  const initialAnchor = value ? parseISODate(value) : parseISODate(minISO);
  const [viewYear, setViewYear] = useState(initialAnchor.y);
  const [viewMonth, setViewMonth] = useState(initialAnchor.m);

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const goPrevMonth = () => {
    const prev = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(prev.getFullYear());
    setViewMonth(prev.getMonth());
  };
  const goNextMonth = () => {
    const next = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const handleSelect = (iso: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(iso);
  };

  return (
    <View className="gap-md">
      <View className="flex-row items-center justify-between">
        <Pressable onPress={goPrevMonth} role="button" className="h-11 w-11 items-center justify-center">
          <ChevronLeft size={20} strokeWidth={1.75} color={colors.text} />
        </Pressable>
        <Text className="font-sans-semibold text-lg text-text">
          {MONTH_LABELS[viewMonth]} {viewYear}
        </Text>
        <Pressable onPress={goNextMonth} role="button" className="h-11 w-11 items-center justify-center">
          <ChevronRight size={20} strokeWidth={1.75} color={colors.text} />
        </Pressable>
      </View>

      <View className="flex-row">
        {WEEKDAY_LABELS.map((w, i) => (
          <Text key={`${w}-${i}`} className="text-center text-xs text-text-tertiary" style={{ width: 44 }}>
            {w}
          </Text>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {cells.map((day, index) => {
          if (day === null) return <View key={`empty-${index}`} style={{ width: 44, height: 44 }} />;
          const iso = toISODate(viewYear, viewMonth, day);
          const isPast = iso < minISO;
          const isSelected = value === iso;

          return (
            <Pressable
              key={iso}
              disabled={isPast}
              onPress={() => handleSelect(iso)}
              role="button"
              aria-disabled={isPast}
              aria-selected={isSelected}
              className="items-center justify-center"
              style={{ width: 44, height: 44 }}
            >
              <View
                className={cn('items-center justify-center rounded-pill', isSelected ? 'bg-accent' : '')}
                style={{ width: 38, height: 38 }}
              >
                <Text
                  className={cn(
                    'text-sm',
                    isSelected ? 'text-ink-on-accent' : isPast ? 'text-text-tertiary' : 'text-text',
                  )}
                >
                  {day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default CalendarPicker;
