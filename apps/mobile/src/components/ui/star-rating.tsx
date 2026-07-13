import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';
import * as Haptics from 'expo-haptics';
import { Star } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

export type StarRatingMode = 'display' | 'input';

export interface StarRatingProps {
  mode?: StarRatingMode;
  value: number;
  count?: number;
  max?: number;
  onChange?: (value: number) => void;
  size?: number;
}

/**
 * StarRating. Locked API per SPEC Section 5.1 #6: `mode` display|input,
 * `value`, `count?`. Display mode shows "value/max" text alongside the stars
 * (per v1 designs, e.g. "4.2/5"), optionally with a review count in
 * parentheses. Input mode makes each star pressable, reporting the tapped
 * value via onChange with a selection haptic. Uses lucide Star with `fill`
 * for the filled state, per the task's icon rule.
 */
function StarRating({ mode = 'display', value, count, max = 5, onChange, size = 16 }: StarRatingProps) {
  const colors = useThemeColors();
  const stars = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <View className="flex-row items-center gap-xs">
      <View className="flex-row items-center gap-xs">
        {stars.map((starValue) => {
          const filled = starValue <= Math.round(value);
          const star = (
            <Star size={size} color={colors.accent} fill={filled ? colors.accent : 'transparent'} strokeWidth={1.75} />
          );

          if (mode === 'input') {
            return (
              <Pressable
                key={starValue}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Rate ${starValue} out of ${max}`}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {
                    // Haptics unavailable, not fatal.
                  });
                  onChange?.(starValue);
                }}
              >
                {star}
              </Pressable>
            );
          }

          return <View key={starValue}>{star}</View>;
        })}
      </View>
      {mode === 'display' ? (
        <Text className="font-mono text-sm text-text-secondary">
          {value.toFixed(1)}/{max}
          {count !== undefined ? ` (${count})` : ''}
        </Text>
      ) : null}
    </View>
  );
}

export { StarRating };
