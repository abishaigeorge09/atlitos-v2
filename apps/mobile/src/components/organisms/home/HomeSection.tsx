import { spacing } from '@atlitos/theme';
import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * One titled Home rail: an h3 title with an optional one line subtitle and a
 * See all link, over a horizontal scroller that bleeds to the screen edges
 * (the Home ScrollView pads its content by `spacing.lg`, so the rail pulls
 * itself back out by the same amount and pads its own content instead). Every
 * Home rail shares this so the sections read as one system.
 */
export function HomeSection({
  title,
  subtitle,
  seeAllLabel,
  onSeeAll,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Accessibility label for the See all link, e.g. "See all courts". */
  seeAllLabel: string;
  onSeeAll: () => void;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.md }}>
      <View className="flex-row items-end justify-between gap-md">
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={[textStyle('h3'), { color: colors.text }]}>{title}</Text>
          {subtitle ? (
            <Text numberOfLines={1} style={[textStyle('caption'), { color: colors.textSecondary }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={seeAllLabel}
          onPress={onSeeAll}
          hitSlop={12}
          className="flex-row items-center gap-xs"
        >
          <Text className="font-sans-semibold text-sm" style={{ color: colors.accent }}>
            See all
          </Text>
          <ChevronRight size={16} color={colors.accent} strokeWidth={1.75} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -spacing.lg }}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** Loading placeholder with the same shape as a populated rail. */
export function HomeSectionSkeleton({ cardWidth, cardHeight }: { cardWidth: number; cardHeight: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Skeleton shape="line" width="45%" />
      <View style={{ flexDirection: 'row', gap: spacing.md, overflow: 'hidden' }}>
        <Skeleton shape="card" width={cardWidth} height={cardHeight} />
        <Skeleton shape="card" width={cardWidth} height={cardHeight} />
        <Skeleton shape="card" width={cardWidth} height={cardHeight} />
      </View>
    </View>
  );
}
