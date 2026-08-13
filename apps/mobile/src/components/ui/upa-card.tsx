import { cn } from '@/lib/utils';
import { formatINR } from '@atlitos/theme';
import { HeartHandshake } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 22: UPACard. photo, story headline, Donate + View Profile
 * actions. `hub` variant adds a funding progress bar (raised of goal).
 * An empty/missing `photoUri` (a UPA with no seeded photo) renders a solid
 * surface-muted block with a HeartHandshake glyph instead of a blank white
 * gap, so a card never reads as broken.
 */
export type UPACardVariant = 'home' | 'hub';

export interface UPACardProps {
  photoUri?: string;
  name: string;
  headline: string;
  variant?: UPACardVariant;
  raisedAmount?: number;
  goalAmount?: number;
  onDonatePress?: () => void;
  onViewProfilePress?: () => void;
  className?: string;
}

function UPACard({
  photoUri,
  name,
  headline,
  variant = 'home',
  raisedAmount = 0,
  goalAmount = 1,
  onDonatePress,
  onViewProfilePress,
  className,
}: UPACardProps) {
  const clampedProgress = Math.min(1, Math.max(0, raisedAmount / Math.max(1, goalAmount)));
  const colors = useThemeColors();
  // F5 (P5 fix pass): `photoUri` being present only means the row HAD a
  // photo_url; it says nothing about whether that URL still resolves (a
  // public storage path with a deleted object, or a dead external hotlink
  // in fixture data, both 404). Without this, a failed load rendered as a
  // blank hole instead of falling into the existing "no photo" placeholder
  // below, even though both cases mean the same thing to the viewer: there
  // is no usable photo to show. Reset the failure whenever the URL itself
  // changes (e.g. this card gets reused for a different UPA).
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => setLoadFailed(false), [photoUri]);
  const showPlaceholder = !photoUri || loadFailed;

  return (
    <View className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      {showPlaceholder ? (
        <View className="h-40 w-full items-center justify-center rounded-t-xl bg-surface-muted">
          <HeartHandshake size={32} color={colors.textTertiary} strokeWidth={1.75} />
        </View>
      ) : (
        <Image
          key={photoUri}
          source={{ uri: photoUri }}
          className="h-40 w-full rounded-t-xl"
          resizeMode="cover"
          onError={() => setLoadFailed(true)}
        />
      )}

      <View className="gap-md p-lg">
        <View className="gap-xs">
          <Text className="font-sans-semibold text-base text-text">{name}</Text>
          <Text className="font-sans text-sm text-text-secondary" numberOfLines={2}>
            {headline}
          </Text>
        </View>

        {variant === 'hub' ? (
          <View className="gap-xs">
            <View className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-muted">
              <View className="h-full rounded-pill bg-accent" style={{ width: `${clampedProgress * 100}%` }} />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="font-mono-semibold text-xs text-text">
                {formatINR(raisedAmount)} raised
              </Text>
              {/* text-secondary, not tertiary: this sits directly on bg-card,
                  and textTertiary fails AA contrast against the card surface
                  in dark mode. */}
              <Text className="font-mono text-xs text-text-secondary">
                of {formatINR(goalAmount)}
              </Text>
            </View>
          </View>
        ) : null}

        <View className="flex-row gap-sm">
          <Button variant="primary" className="flex-1" onPress={onDonatePress}>
            <Text numberOfLines={1}>Donate</Text>
          </Button>
          <Button variant="ghost" className="flex-1 border border-border-strong" onPress={onViewProfilePress}>
            <Text numberOfLines={1}>View profile</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}

export { UPACard };
