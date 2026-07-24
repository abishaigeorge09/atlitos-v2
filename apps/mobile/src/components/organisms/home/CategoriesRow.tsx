import { SPORTS, type Sport } from '@atlitos/types';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SPORT_ICON, SPORT_LABEL } from '@/lib/sport-display';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Home's categories row (PRD-01 3.2): one circular tappable icon per
 * `SPORTS` enum value, each routing to that sport's category browse
 * (`/shop/category/[sport]`). Horizontal scroll so the row survives a sport
 * list longer than one screen width without wrapping.
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
            <View className="h-14 w-14 items-center justify-center rounded-pill border border-border bg-card active:bg-surface-muted">
              <Icon size={24} color={colors.accent} strokeWidth={1.75} />
            </View>
            <Text className="font-sans-medium text-xs text-text-secondary">{SPORT_LABEL[sport]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
