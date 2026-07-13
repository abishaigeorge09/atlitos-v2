import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Image, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

export interface AdBanner {
  id: string;
  imageUrl: string;
  onPress?: () => void;
}

/**
 * SPEC #30: swipeable promo banners. `productGallery` is the flagged
 * extension noted in SPEC (square images for a PDP image gallery, instead
 * of the wide promo banner aspect ratio).
 */
export type AdBannerCarouselVariant = 'promo' | 'productGallery';

export interface AdBannerCarouselProps {
  banners: AdBanner[];
  variant?: AdBannerCarouselVariant;
}

export function AdBannerCarousel({ banners, variant = 'promo' }: AdBannerCarouselProps) {
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const itemWidth = width - 32; // spacing.lg (16) screen padding on both sides

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / itemWidth);
    if (index !== activeIndex) setActiveIndex(index);
  };

  if (banners.length === 0) return null;

  return (
    <View className="gap-sm">
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={itemWidth}
      >
        {banners.map((banner) => (
          <Pressable
            key={banner.id}
            onPress={banner.onPress}
            role={banner.onPress ? 'button' : undefined}
            style={{ width: itemWidth }}
          >
            <Image
              source={{ uri: banner.imageUrl }}
              className="w-full rounded-md bg-surface-muted"
              style={{ aspectRatio: variant === 'promo' ? 16 / 7 : 1 }}
              resizeMode="cover"
            />
          </Pressable>
        ))}
      </ScrollView>

      {banners.length > 1 ? (
        <View className="flex-row justify-center gap-xs">
          {banners.map((banner, index) => (
            <View
              key={banner.id}
              className={cn('h-1.5 w-1.5 rounded-pill', index === activeIndex ? 'bg-accent' : 'bg-border-strong')}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default AdBannerCarousel;
