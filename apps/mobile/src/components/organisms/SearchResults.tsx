import { StatusPill, styles } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import { radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import { ChevronRight } from 'lucide-react-native';
import { FlatList, Image, Pressable, Text, View } from 'react-native';

export type SearchSegment = 'gear' | 'coaches' | 'courts' | 'athletes' | 'clips';

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  price?: string;
  rankReason?: string;
  onPress: () => void;
}

/**
 * SPEC.md organism #38. Segmented Gear/Coaches/Courts tabs when results are
 * mixed, ranked list with a `rankReason` tag on each card.
 */
export interface SearchResultsProps {
  query: string;
  segments?: SearchSegment[];
  activeSegment?: SearchSegment;
  onSegmentChange?: (segment: SearchSegment) => void;
  results: SearchResultItem[];
  emptyLabel?: string;
}

const SEGMENT_LABEL: Record<SearchSegment, string> = {
  gear: 'Gear',
  coaches: 'Coaches',
  courts: 'Courts',
  athletes: 'Athletes',
  clips: 'Clips',
};

export function SearchResults({
  query,
  segments,
  activeSegment,
  onSegmentChange,
  results,
  emptyLabel,
}: SearchResultsProps) {
  const colors = useThemeColors();

  const handleSegment = (segment: SearchSegment) => {
    Haptics.selectionAsync();
    onSegmentChange?.(segment);
  };

  return (
    <View style={{ flex: 1, gap: spacing.lg }}>
      <Text style={[textStyle('caption'), { color: colors.textTertiary, paddingHorizontal: spacing.lg }]}>
        Results for &quot;{query}&quot;
      </Text>

      {segments && segments.length > 1 ? (
        <View style={[styles.row, { gap: spacing.sm, paddingHorizontal: spacing.lg }]}>
          {segments.map((segment) => {
            const active = segment === activeSegment;
            return (
              <Pressable
                key={segment}
                accessibilityRole="button"
                onPress={() => handleSegment(segment)}
                style={{
                  minHeight: 44,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radii.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? colors.accent : colors.surfaceMuted,
                }}
              >
                <Text
                  style={[textStyle('label'), { color: active ? colors.inkOnAccent : colors.textSecondary }]}
                >
                  {SEGMENT_LABEL[segment]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
        ListEmptyComponent={
          emptyLabel ? (
            <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
              {emptyLabel}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              item.onPress();
            }}
            style={[
              styles.row,
              {
                gap: spacing.md,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.md,
                minHeight: 44,
              },
            ]}
          >
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={{ height: 56, width: 56, borderRadius: radii.md }} />
            ) : null}
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={[textStyle('body'), { color: colors.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[textStyle('caption'), { color: colors.textSecondary }]} numberOfLines={1}>
                {item.subtitle}
              </Text>
              {item.rankReason ? <StatusPill label={item.rankReason} tone="info" numeric /> : null}
            </View>
            {item.price ? (
              <Text style={[textStyle('numericBase'), { color: colors.text }]}>{item.price}</Text>
            ) : null}
            <ChevronRight size={20} color={colors.textTertiary} strokeWidth={1.75} />
          </Pressable>
        )}
      />
    </View>
  );
}
