import type { Sport } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL } from '@/lib/sport-display';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Athlete Stats tab "My sports" card (Figma "player - training"
 * 1642:37833): the athlete's own `users.sports` as icon circles plus an
 * Add sport action into the profile editor. Icons are the shared
 * `SPORT_ICON` lucide picks (no custom glyphs, CLAUDE.md), tinted per the
 * design's circular chips using theme tokens only.
 */
export interface MySportsCardProps {
  sports: Sport[];
}

export function MySportsCard({ sports }: MySportsCardProps) {
  const colors = useThemeColors();

  return (
    <View
      style={{
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <Text style={[textStyle('h3'), { color: colors.text }]}>My sports</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg }}>
        {sports.map((sport) => {
          const Icon = SPORT_ICON[sport];
          return (
            <View key={sport} style={{ alignItems: 'center', gap: spacing.xs, width: 72 }}>
              <View
                style={{
                  height: 56,
                  width: 56,
                  borderRadius: radii.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.surfaceMuted,
                }}
              >
                <Icon size={26} strokeWidth={1.75} color={colors.accent} />
              </View>
              <Text style={[textStyle('caption'), { color: colors.text }]}>{SPORT_LABEL[sport]}</Text>
            </View>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add sport"
          onPress={() => router.push('/profile')}
          style={{ alignItems: 'center', gap: spacing.xs, width: 72 }}
        >
          <View
            style={{
              height: 56,
              width: 56,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accent,
            }}
          >
            <Plus size={26} strokeWidth={2} color={colors.inkOnAccent} />
          </View>
          <Text style={[textStyle('caption'), { color: colors.text }]}>Add sport</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
