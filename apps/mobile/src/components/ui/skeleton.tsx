import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import type { ViewProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

export type SkeletonShape = 'line' | 'card' | 'circle' | 'tile';

export interface SkeletonProps extends ViewProps {
  shape?: SkeletonShape;
  width?: number | `${number}%`;
  height?: number;
}

const SHAPE_CLASS: Record<SkeletonShape, string> = {
  line: 'h-3 w-full rounded-xs',
  card: 'h-32 w-full rounded-xl',
  circle: 'h-10 w-10 rounded-pill',
  tile: 'h-24 w-24 rounded-md',
};

/**
 * Skeleton. Locked API per SPEC Section 5.1 #12: `shape`
 * line|card|circle|tile. Used by every loading state (SPEC Section 9,
 * "every screen ships 4 states: loading skeleton, never spinner only").
 * Reanimated opacity pulse (0.4 to 1, looping) instead of a static block, so
 * loading states read as active rather than frozen.
 */
function Skeleton({ shape = 'line', width, height, className, style, ...props }: SkeletonProps) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityLabel="Loading"
      className={cn('bg-surface-muted', SHAPE_CLASS[shape], className)}
      style={[
        animatedStyle,
        width !== undefined ? { width } : null,
        height !== undefined ? { height } : null,
        style,
      ]}
      {...props}
    />
  );
}

export { Skeleton };
