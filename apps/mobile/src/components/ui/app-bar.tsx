import { cn } from '@/lib/utils';
import * as Haptics from 'expo-haptics';
import { Bell, ChevronLeft, ShoppingCart } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Image, PixelRatio, Pressable, View } from 'react-native';
import { sizedImageUrl } from '@atlitos/api';

import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Molecule 13: AppBar. The brand wordmark image (assets/brand/wordmark.png,
 * the lettering cropped from the splash logo, 2026-10-01; it replaced a typed
 * "ATLITOS" in the heading face), plus a notifications bell and profile
 * avatar. `back`/`backTitle` variants
 * swap the wordmark for a back chevron. Every touch target is 44pt (h-11).
 *
 * Icon color is read from useThemeColors() and passed as a `color` prop
 * (not a className) because lucide-react-native icons render react-native-svg
 * primitives, which are not registered with nativewind's cssInterop in this
 * app; className would silently no-op on stroke color.
 */
/** Header wordmark size in points (the asset is 254 x 84 pixels at 3x). */
const WORDMARK_HEIGHT = 28;
const WORDMARK_WIDTH = Math.round((WORDMARK_HEIGHT * 254) / 84);

export type AppBarVariant = 'brand' | 'brandLife' | 'back' | 'backTitle';

export interface AppBarProps {
  variant: AppBarVariant;
  title?: string;
  avatarUri?: string;
  /**
   * BUG-05/BUG-08. The signed-in member's display name, used only for the
   * initials fallback when they have no avatar image, which is most members.
   * Before this the fallback was the hardcoded letter "A", so every user wore
   * the same wrong initial and a signed-in member was indistinguishable from
   * a guest in the header. Omit it for a guest and the fallback stays "A".
   */
  avatarName?: string;
  /**
   * NAV-01. Cart affordance for the brand header. Shop is not one of the five
   * bottom tabs, so before this the cart was reachable only by scrolling Home
   * to the Shop rail and tapping through: a member with items in their cart had
   * no persistent way back to it from anywhere else in the app. Passing
   * `onPressCart` renders a cart button here with a count badge.
   */
  onPressCart?: () => void;
  cartCount?: number;
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
  accessibilityLabel,
}: {
  onPress?: () => void;
  children: ReactNode;
  className?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
  avatarName,
  onPressCart,
  cartCount = 0,
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
          <IconButton onPress={handleBack} accessibilityLabel="Back" className="-ml-2">
            <ChevronLeft size={24} strokeWidth={1.75} color={colors.text} />
          </IconButton>
        ) : null}

        {showWordmark ? (
          <View className="flex-row items-baseline gap-xs">
            {/* The brand lettering cropped from the splash logo (assets/brand/
                wordmark.png, 254 x 84 at 3x), in place of a typed "ATLITOS".
                Orange letters with a white keyline read on both themes. */}
            <Image
              source={require('../../../assets/brand/wordmark.png')}
              style={{ width: WORDMARK_WIDTH, height: WORDMARK_HEIGHT }}
              resizeMode="contain"
              accessibilityRole="image"
              accessibilityLabel="Atlitos"
            />
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
          {onPressCart ? (
            <IconButton
              onPress={onPressCart}
              accessibilityLabel={cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : 'Cart'}
            >
              <View>
                <ShoppingCart size={24} strokeWidth={1.75} color={colors.text} />
                {cartCount > 0 ? (
                  <View className="absolute -right-1 -top-1 h-4 min-w-4 items-center justify-center rounded-pill bg-accent px-1">
                    <Text className="font-mono text-xs leading-4 text-ink-on-accent">
                      {cartCount > 9 ? '9+' : cartCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </IconButton>
          ) : null}
          <IconButton
            onPress={onPressNotifications}
            accessibilityLabel={hasUnreadNotifications ? 'Notifications, unread' : 'Notifications'}
          >
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
            accessibilityLabel="Profile"
            className="h-11 w-11 items-center justify-center rounded-pill active:opacity-80"
          >
            {avatarUri ? (
              // SCALE-MEDIA M-6. This circle is 36 points and does NOT route
              // through `Avatar`, whose docblock claims sizing "cannot be
              // forgotten by the next one added" because every site goes
              // through it. Three sites never did: this one, `coach-card` and
              // `CoachProfileSheet`. Sized in place rather than swapped for
              // `Avatar`, because `AvatarSize` has no 36 and changing it to 32
              // or 40 is a layout change this pass cannot prove on a device.
              <Image
                source={{ uri: sizedImageUrl(avatarUri, { width: 36 * Math.min(3, PixelRatio.get()) }) }}
                className="h-9 w-9 rounded-pill"
              />
            ) : (
              <View className="h-9 w-9 items-center justify-center rounded-pill bg-surface-muted">
                <Text className="font-sans-semibold text-sm text-text-secondary">
                  {initialsFor(avatarName)}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * At most two initials from a display name. Falls back to "A" for a guest or an
 * unnamed account, which is what the header showed for everyone before BUG-08.
 */
function initialsFor(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A';
  return parts.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export { AppBar };
