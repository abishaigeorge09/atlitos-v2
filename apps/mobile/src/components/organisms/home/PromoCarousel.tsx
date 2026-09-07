import { useHome, type PromoBanner } from '@atlitos/api';
import { spacing } from '@atlitos/theme';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, FlatList, Image, Pressable, View, type ViewToken } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/theme/use-theme-colors';

const CARD_GAP = spacing.lg;
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH - spacing.lg * 2;

export interface PromoCarouselHandle {
  reload: () => Promise<void>;
}

/**
 * Home's promo carousel (PRD-01 3.2). Horizontally paged banners read from
 * `promo_banners` (0071) via `useHome().listPromoBanners`. Hides itself
 * entirely on an empty read or an error, this section is decoration, never
 * worth a Home level error state.
 */
export function PromoCarousel({ reloadKey }: { reloadKey: number }) {
  const colors = useThemeColors();
  const home = useHome(supabase);

  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const load = useCallback(async () => {
    try {
      const rows = await home.listPromoBanners();
      setBanners(rows);
    } catch {
      setBanners([]);
    } finally {
      setState('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const onViewableItemsChanged = useRef((info: { viewableItems: ViewToken[] }) => {
    const first = info.viewableItems[0];
    if (first?.index !== null && first?.index !== undefined) setActiveIndex(first.index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  if (state === 'loading') {
    return <Skeleton shape="card" height={160} />;
  }

  if (banners.length === 0) return null;

  return (
    <View className="gap-sm">
      <FlatList
        data={banners}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={{ gap: CARD_GAP }}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => {
              if (item.ctaRoute) router.push(item.ctaRoute as Href);
            }}
            className="overflow-hidden rounded-xl"
            style={{ width: CARD_WIDTH, height: 160, backgroundColor: colors.surfaceMuted }}
          >
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
            ) : null}
            {/* Bottom scrim only, not a full-card tint: keeps the branded
                banner art visible while guaranteeing contrast for the
                overlaid title/body/CTA against any image (contrast
                insurance called for by the promo banner fix).

                BUG-06: rendered ONLY when there is an image behind it. The
                scrim exists to guarantee contrast against arbitrary photo
                content; with no image it was tinting the card's own branded
                background instead, which read on screen as a grey slab dropped
                across the headline and body copy, lowering the contrast it was
                meant to protect. The card's own background is already a known
                quantity chosen for legible inverse text, so it needs no scrim. */}
            {item.imageUrl ? (
              <View
                className="absolute inset-x-0 bottom-0"
                style={{ pointerEvents: 'none', height: '60%', backgroundColor: colors.overlay }}
              />
            ) : null}
            <View className="absolute inset-0 justify-end gap-sm p-lg" style={{ pointerEvents: 'none' }}>
              <Text className="font-sans-semibold text-lg text-text-inverse">{item.title}</Text>
              {item.body ? (
                <Text className="text-sm text-text-inverse opacity-90" numberOfLines={2}>
                  {item.body}
                </Text>
              ) : null}
              {item.ctaLabel ? (
                <View className="self-start rounded-pill bg-accent px-md py-xs">
                  <Text className="font-sans-semibold text-xs" style={{ color: colors.inkOnAccent }}>
                    {item.ctaLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        )}
      />

      {banners.length > 1 ? (
        <View className="flex-row items-center justify-center gap-xs">
          {banners.map((banner, index) => (
            <View
              key={banner.id}
              className="h-1.5 w-1.5 rounded-pill"
              style={{ backgroundColor: index === activeIndex ? colors.accent : colors.border }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
