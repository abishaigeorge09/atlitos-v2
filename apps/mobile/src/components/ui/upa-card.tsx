import { cn } from '@/lib/utils';
import { formatINR } from '@atlitos/theme';
import { Image, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

/**
 * Molecule 22: UPACard. photo, story headline, Donate + View Profile
 * actions. `hub` variant adds a funding progress bar (raised of goal).
 */
export type UPACardVariant = 'home' | 'hub';

export interface UPACardProps {
  photoUri: string;
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

  return (
    <View className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      <Image source={{ uri: photoUri }} className="h-40 w-full rounded-t-xl" resizeMode="cover" />

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
            <Text>Donate</Text>
          </Button>
          <Button variant="ghost" className="flex-1 border border-border-strong" onPress={onViewProfilePress}>
            <Text>View profile</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}

export { UPACard };
