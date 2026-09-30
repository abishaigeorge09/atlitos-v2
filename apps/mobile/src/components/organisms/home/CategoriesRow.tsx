import { radii, spacing } from '@atlitos/theme';
import { SPORTS, type Sport } from '@atlitos/types';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL } from '@/lib/sport-display';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** Sport tile edge. */
const TILE = 76;

/**
 * Home's categories row (PRD-01 3.2): one circular tappable icon per
 * `SPORTS` enum value, each routing to `/shop` with that sport pre-selected
 * (Phase S3, PHASE-S3-STATUS.md hard decision 1: `/shop` is the shop now,
 * `/shop/category/[sport]` only redirects there). Horizontal scroll so the
 * row survives a sport list longer than one screen width without wrapping.
 *
 * The pressed state feedback lives on the Pressable's render function, NOT
 * as an `active:` class on the circle View. nativewind implements `active:`
 * by attaching its own interaction handlers to whatever element carries the
 * class; on a plain View inside a Pressable that child claimed the touch and
 * the Pressable's onPress never fired, which made every sport circle a
 * silent dead tap (Maestro suite finding, verified on the iOS sim: onPress
 * logged nothing with the class present and fired reliably without it).
 * Keep `active:` variants on the Pressable itself, never on its children.
 */
export function CategoriesRow() {
  const colors = useThemeColors();

  // Home, 2026-09-30: a titled white card on the canvas, Playo's "GAMES BY
  // SPORTS" block, with large tinted tiles instead of small outlined circles.
  return (
    <View style={{ gap: spacing.md, paddingVertical: spacing.lg, borderRadius: radii['2xl'], backgroundColor: colors.card }}>
      <Text style={[textStyle('displaySection'), { color: colors.text, paddingHorizontal: spacing.lg }]}>
        Play by sport
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.lg, paddingHorizontal: spacing.lg }}
      >
        {SPORTS.map((sport: Sport) => {
          const Icon = SPORT_ICON[sport];
          return (
            <Pressable
              key={sport}
              accessibilityRole="button"
              accessibilityLabel={SPORT_LABEL[sport]}
              onPress={() => router.push({ pathname: '/shop', params: { sport } })}
              className="items-center gap-sm"
            >
              {({ pressed }) => (
                <>
                  <View
                    style={{
                      width: TILE,
                      height: TILE,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radii.xl,
                      backgroundColor: pressed ? colors.surfaceMuted : colors.accentTint,
                    }}
                  >
                    <Icon size={34} color={colors.accent} strokeWidth={1.75} />
                  </View>
                  <Text style={[textStyle('label'), { color: colors.text }]}>{SPORT_LABEL[sport]}</Text>
                </>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
