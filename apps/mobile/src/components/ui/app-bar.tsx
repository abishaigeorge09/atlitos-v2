import { cn } from '@/lib/utils';
import * as Haptics from 'expo-haptics';
import { Bell, ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 13: AppBar. "ATLITOS" wordmark in the display type family with
 * brand letterspacing (font-sans-bold + tracking-tighter, matching the
 * negative letter spacing DESIGN-LANGUAGE.md locks for heading variants),
 * plus a notifications bell and profile avatar. `back`/`backTitle` variants
 * swap the wordmark for a back chevron. Every touch target is 44pt (h-11).
 *
 * Icon color is read from useThemeColors() and passed as a `color` prop
 * (not a className) because lucide-react-native icons render react-native-svg
 * primitives, which are not registered with nativewind's cssInterop in this
 * app; className would silently no-op on stroke color.
 */
export type AppBarVariant = 'brand' | 'brandLife' | 'back' | 'backTitle';

export interface AppBarProps {
  variant: AppBarVariant;
  title?: string;
  avatarUri?: string;
  hasUnreadNotifications?: boolean;
  onPressBack?: () => void;
  onPressNotifications?: () => void;
  onPressProfile?: () => void;
  className?: string;
}

function IconButton({
  onPress,
  children,
  className,
}: {
  onPress?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={cn('h-11 w-11 items-center justify-center rounded-pill active:bg-surface-muted', className)}
    >
      {children}
    </Pressable>
  );
}

function AppBar({
  variant,
  title,
  avatarUri,
  hasUnreadNotifications,
  onPressBack,
  onPressNotifications,
  onPressProfile,
  className,
}: AppBarProps) {
  const colors = useThemeColors();
  const showWordmark = variant === 'brand' || variant === 'brandLife';
  const showBack = variant === 'back' || variant === 'backTitle';

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics unavailable, not fatal.
    });
    onPressBack?.();
  };

  return (
    <View className={cn('h-14 flex-row items-center justify-between bg-bg px-lg', className)}>
      <View className="flex-row items-center gap-sm">
        {showBack ? (
          <IconButton onPress={handleBack} className="-ml-2">
            <ChevronLeft size={24} strokeWidth={1.75} color={colors.text} />
          </IconButton>
        ) : null}

        {showWordmark ? (
          <View className="flex-row items-baseline gap-xs">
            <Text className="font-sans-bold text-2xl tracking-tighter text-text">ATLITOS</Text>
            {variant === 'brandLife' ? (
              <View className="rounded-pill bg-accent-tint px-sm">
                <Text className="font-mono-semibold text-xs uppercase tracking-widest text-accent">
                  Life
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {variant === 'backTitle' && title ? (
          <Text className="font-sans-semibold text-xl text-text">{title}</Text>
        ) : null}
      </View>

      {!showBack ? (
        <View className="flex-row items-center gap-xs">
          <IconButton onPress={onPressNotifications}>
            <View>
              <Bell size={24} strokeWidth={1.75} color={colors.text} />
              {hasUnreadNotifications ? (
                <View className="absolute right-0 top-0 h-2 w-2 rounded-pill bg-accent" />
              ) : null}
            </View>
          </IconButton>
          <Pressable
            onPress={onPressProfile}
            accessibilityRole="button"
            className="h-11 w-11 items-center justify-center rounded-pill active:opacity-80"
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} className="h-9 w-9 rounded-pill" />
            ) : (
              <View className="h-9 w-9 items-center justify-center rounded-pill bg-surface-muted">
                <Text className="font-sans-semibold text-sm text-text-secondary">A</Text>
              </View>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export { AppBar };
