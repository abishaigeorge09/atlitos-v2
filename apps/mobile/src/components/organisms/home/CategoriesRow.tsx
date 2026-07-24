import { SPORTS, type Sport } from '@atlitos/types';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL } from '@/lib/sport-display';
import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's categories row (PRD-01 3.2): one circular tappable icon per
 * `SPORTS` enum value, each routing to that sport's category browse
 * (`/shop/category/[sport]`). Horizontal scroll so the row survives a sport
 * list longer than one screen width without wrapping.
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

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-lg px-xs">
      {SPORTS.map((sport: Sport) => {
        const Icon = SPORT_ICON[sport];
        return (
          <Pressable
            key={sport}
            accessibilityRole="button"
            accessibilityLabel={SPORT_LABEL[sport]}
            onPress={() => router.push({ pathname: '/shop/category/[sport]', params: { sport } })}
            className="items-center gap-xs"
          >
            {({ pressed }) => (
              <>
                <View
                  className={cn(
                    'h-14 w-14 items-center justify-center rounded-pill border border-border',
                    pressed ? 'bg-surface-muted' : 'bg-card',
                  )}
                >
                  <Icon size={24} color={colors.accent} strokeWidth={1.75} />
                </View>
                <Text className="font-sans-medium text-xs text-text-secondary">{SPORT_LABEL[sport]}</Text>
              </>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
