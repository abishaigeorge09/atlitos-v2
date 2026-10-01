import type { Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL, SPORT_TINT } from '@/lib/sport-display';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

export interface SportTileGridProps {
  sports: Sport[];
  /** The picked sport, or null for every sport. */
  selected: Sport | null;
  /** Tapping the picked tile again clears it back to every sport. */
  onSelect: (sport: Sport | null) => void;
}

/**
 * Coach discovery sport picker (PRD-01 FR-20): one square tinted tile per
 * sport with its lucide glyph and label, in a single row. Replaces the
 * sport chip row on the Coaches surface. A tile is a toggle: tap to filter
 * to that sport, tap again to show every sport, so there is no separate
 * "All sports" tile. The picked tile carries an accent border; the others
 * keep their tint so the row still reads as a menu of sports.
 */
export function SportTileGrid({ sports, selected, onSelect }: SportTileGridProps) {
  const colors = useThemeColors();

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {sports.map((sport) => {
        const Icon = SPORT_ICON[sport];
        const tint = SPORT_TINT[sport];
        const isSelected = selected === sport;
        return (
          <Pressable
            key={sport}
            accessibilityRole="button"
            accessibilityLabel={`${SPORT_LABEL[sport]} coaches`}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(isSelected ? null : sport)}
            // Plain style object, not a function: NativeWind's Pressable
            // wrapper drops style functions, which lost `flex: 1` and let the
            // first tile take the whole row. Press feedback is the class.
            className="active:opacity-80"
            style={{ flex: 1, gap: spacing.xs, alignItems: 'center' }}
          >
            <View
              style={{
                width: '100%',
                aspectRatio: 1,
                borderRadius: radii.xl,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors[tint.bg],
                borderWidth: 2,
                borderColor: isSelected ? colors.accent : 'transparent',
              }}
            >
              <Icon size={32} strokeWidth={1.75} color={colors[tint.ink]} />
            </View>
            <Text
              numberOfLines={1}
              style={[textStyle('label'), { color: isSelected ? colors.text : colors.textSecondary }]}
            >
              {SPORT_LABEL[sport]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
