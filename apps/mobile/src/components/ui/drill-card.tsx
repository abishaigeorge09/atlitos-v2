import type { Drill } from '@atlitos/api';
import { radii, spacing } from '@atlitos/theme';
import { CircleCheck, Zap } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { DIFFICULTY_LABEL } from '@/lib/learn-display';
import { SPORT_LABEL } from '@/lib/sport-display';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * DrillCard (AT-134). One row in the drill library. Whole card opens the drill
 * detail; the XP value renders in JetBrains Mono tabular figures (a numeric
 * readout, CLAUDE.md) and a completed drill shows a lucide check badge (never
 * an emoji).
 *
 * PRESSABLE-OVERLAY PATTERN (DESIGN-LANGUAGE.md): the container is a plain
 * View, the whole-card open tap is a single absolute-fill <Pressable> rendered
 * as the FIRST child with a button role, and every presentational subtree sits
 * in a `pointerEvents="none"` View above it so taps fall through to the
 * overlay. There is no nested Pressable in this card.
 */
export interface DrillCardProps {
  drill: Drill;
  completed?: boolean;
  onPress: () => void;
}

export function DrillCard({ drill, completed = false, onPress }: DrillCardProps) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${drill.title}`}
        onPress={onPress}
        style={({ pressed }) => [StyleSheet.absoluteFill, { opacity: pressed ? 0.9 : 1 }]}
      />

      <View style={{ pointerEvents: 'none', padding: spacing.lg, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={[textStyle('h3'), { color: colors.text }]} numberOfLines={2}>
              {drill.title}
            </Text>
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
              {SPORT_LABEL[drill.sport]}. {drill.skillCategory}.
            </Text>
          </View>

          {completed ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <CircleCheck size={18} strokeWidth={2} color={colors.success} />
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
              borderRadius: radii.pill,
              backgroundColor: colors.surfaceMuted,
            }}
          >
            <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
              {DIFFICULTY_LABEL[drill.difficulty]}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Zap size={14} strokeWidth={2} color={colors.accent} />
            <Text style={[textStyle('numericSm'), { color: colors.accent }]}>{drill.xpValue}</Text>
            <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>XP</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
