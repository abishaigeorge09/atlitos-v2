import { cn } from '@/lib/utils';
import { elevation, navChrome, radii, spacing } from '@atlitos/theme';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { CircleUser, Dumbbell, Home, LandPlot, Play, type LucideIcon } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';

/**
 * Molecule 14: BottomNav, NAV-03 floating pill.
 *
 * A single glass capsule floating clear of the screen edges, icon only, with a
 * contrast capsule marking the active tab and a red dot for unread state. The
 * You tab renders the member's own avatar rather than a glyph, so the tab that
 * means "you" actually shows you.
 *
 * Three things here are deliberate and easy to undo by accident.
 *
 * 1. It is a real glass material. A `BlurView` samples whatever scrolls
 *    beneath it and `navChrome` (packages/theme) adds only a tint over that
 *    blur plus a hairline specular edge. This needs `ios.buildReactNativeFromSource`
 *    in app.json: against the PREBUILT React Native core, expo-blur (like any
 *    module with a Fabric component view) fails to link.
 * 2. The whole bar is ABSOLUTE, so page content runs full bleed to the bottom
 *    of the screen and scrolls under the pill. That is what stops a dead strip
 *    of background sitting below the bar. The cost is that a scroll view whose
 *    last row must stay tappable needs its own bottom padding; `NAV_BAR_INSET`
 *    below is exported for exactly that, so screens do not guess.
 * 3. `pointerEvents="box-none"` on the outer View, so the transparent gutter
 *    around the pill never swallows a touch meant for the content underneath.
 *
 * On the vertical rhythm: the container owns the bottom safe area so icons
 * never sit under the home indicator, and the tab buttons pad on the TOP only.
 * A `py-` on the button stacks with the inset and opens a visible hole under
 * the bar on tall devices (measured on iPhone 17 Pro Max: 46pt of dead space
 * against a 34pt inset). Keep the bottom spacing owned by the inset alone.
 */
export type BottomNavTab = 'home' | 'trainings' | 'clutch' | 'courts' | 'you';

const TABS: Array<{ key: BottomNavTab; label: string; icon: LucideIcon }> = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'trainings', label: 'Trainings', icon: Dumbbell },
  { key: 'clutch', label: 'Clutch', icon: Play },
  { key: 'courts', label: 'Courts', icon: LandPlot },
  // NAV-02. Was SlidersHorizontal, three sliders, the universal filters/settings
  // glyph, on a tab that opens a social profile with followers and a clip grid.
  // People read the icon before the label, so the profile sat behind an icon
  // promising adjustment controls. NAV-03 goes further: when the member has an
  // avatar we show it, and CircleUser is only the fallback.
  { key: 'you', label: 'You', icon: CircleUser },
];

/**
 * Geometry, measured off the founder's reference bar (a 1206px wide @3x
 * screenshot, so 402pt across, divide every pixel figure by 3).
 *
 *   tab pitch    206px -> 69pt      icon glyph   59px -> 20pt
 *   pill height  190px -> 63pt      label cap    22px -> 11pt font
 *   icon->label   22px ->  7pt      side margin  68px -> 22pt
 *
 * The pill is a capsule, so its radius is simply half its height.
 */
const ICON_SIZE = 22;
/** The avatar standing in for the You glyph. Slightly larger than ICON_SIZE so
 *  a circular photo carries the same optical weight as a line glyph. */
const AVATAR_SIZE = 24;
/** Label under each icon. 11pt in the reference. */
const LABEL_SIZE = 11;
/** Gap between glyph and label. */
const LABEL_GAP = 3;
/** Unread dot. Small enough to read as a status, not a count. */
const DOT_SIZE = 9;

/**
 * NAV-05, the resting size of the bar. It sits at this scale until you touch
 * it, then springs to 1. Instagram does the same thing: the bar gets out of
 * the way of the content and comes back when you reach for it.
 *
 * 0.88 is deliberate. Below about 0.85 the icons start to read as unreadable
 * rather than resting, and the 44pt touch target stops being honest, because
 * the target scales with the bar.
 */
const RESTING_SCALE = 0.88;

/** How long the bar stays expanded after your last touch. */
const COLLAPSE_DELAY_MS = 2200;

/**
 * Gentle, no overshoot on the way down and only a hint on the way up. A
 * bouncy tab bar reads as a toy; this should feel like the bar has weight.
 */
const SPRING = { damping: 18, stiffness: 220, mass: 0.7 } as const;

/**
 * Height of the pill plus its top gutter, EXCLUDING the bottom safe area.
 *
 * Measured from the layout, not the resting look: the pill is scaled to
 * RESTING_SCALE until touched, but its layout box (and the touch target) is
 * the full size, and it springs back to full size the moment a thumb lands on
 * it. Anything that has to stay clear of the bar must clear the full box.
 *
 *   top gutter (pt-sm)                          8
 *   BlurView paddingVertical xs, twice          8
 *   tab paddingVertical sm, twice              16
 *   icon 22 + label gap 3 + label line 14      39
 *                                             ----
 *                                              71, rounded up to 72
 *
 * The bar is absolute, so it covers whatever is beneath it. Screens do not
 * read this constant directly; they call `useNavBarInset()`, which adds the
 * bottom safe area the bar itself pads with and returns 0 outside the tabs.
 */
export const NAV_BAR_INSET = 72;

/**
 * The bottom clearance a screen inside the tabs needs so its content stops
 * above the floating bar. Provided by `(tabs)/_layout.tsx`; a shared organism
 * that is also rendered outside the tabs (a pushed profile, say) reads 0
 * there, so it can add the inset unconditionally.
 */
const NavBarInsetContext = createContext(0);

export function NavBarInsetProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  // Same bottom padding the bar's own container uses, so the two agree to the
  // point on every device, home indicator or not.
  const value = NAV_BAR_INSET + Math.max(insets.bottom, spacing.sm);
  return <NavBarInsetContext.Provider value={value}>{children}</NavBarInsetContext.Provider>;
}

/**
 * How far content must keep clear of the bottom of the screen for the floating
 * bar. Use it two ways:
 *
 *   - A scrollable pads its content by it (`paddingBottom: navInset + spacing.xl`),
 *     so the page still runs under the glass and the last row can be scrolled
 *     out from beneath the pill.
 *   - Anything pinned that cannot scroll away (a sticky CTA, a composer, a
 *     caption block on a full bleed clip) pads or offsets by it, so the bar
 *     stays at the bottom and the pinned control sits above it, never under it.
 *
 * Returns 0 outside the tabs, where there is no bar.
 */
export function useNavBarInset(): number {
  return useContext(NavBarInsetContext);
}

export interface BottomNavProps {
  activeTab: BottomNavTab;
  onTabPress: (tab: BottomNavTab) => void;
  /** Tabs showing an unread dot. Omit for none. */
  badgedTabs?: readonly BottomNavTab[];
  /** The member's avatar, rendered in place of the You glyph when present. */
  avatarUri?: string;
  className?: string;
}

function BottomNav({ activeTab, onTabPress, badgedTabs, avatarUri, className }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const chrome = colorScheme === 'dark' ? navChrome.dark : navChrome.light;
  const shadow = elevation.lg;

  // NAV-05: shrink when unused, zoom on touch.
  const scale = useSharedValue(RESTING_SCALE);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleCollapse = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      scale.value = withSpring(RESTING_SCALE, SPRING);
    }, COLLAPSE_DELAY_MS);
  }, [scale]);

  const wake = useCallback(() => {
    scale.value = withSpring(1, SPRING);
    scheduleCollapse();
  }, [scale, scheduleCollapse]);

  // Clear the pending timer on unmount so it never fires into a dead component.
  useEffect(() => () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
  }, []);

  const barStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View
      className={cn('absolute inset-x-0 bottom-0 flex-row justify-center px-xl pt-sm', className)}
      style={{ paddingBottom: Math.max(insets.bottom, spacing.sm) }}
      pointerEvents="box-none"
    >
      {/* The shadow lives on this wrapper, not on the pill itself. iOS drops a
          shadow on any view that also clips its children, and the pill needs
          `overflow: hidden` to hold its corners, so the two jobs are split
          across two views. */}
      <Animated.View
        style={[
          barStyle,
          {
          flex: 1,
          // Scale from the bottom edge so the bar shrinks toward the home
          // indicator instead of drifting up away from your thumb.
          transformOrigin: 'bottom',
          borderRadius: radii.pill,
          shadowColor: shadow.color,
          shadowOffset: { width: shadow.x, height: shadow.y },
          shadowRadius: shadow.blur,
          shadowOpacity: shadow.opacity,
          elevation: shadow.androidElevation,
          },
        ]}
      >
        <BlurView
          accessibilityRole="tablist"
          tint={chrome.blurTint}
          intensity={chrome.blurIntensity}
          // Layout is a plain style object, NOT a className. NativeWind's
          // interop does not reliably reach a third party component like
          // BlurView, and when `flex-row` is dropped the tabs stack vertically
          // and the pill balloons down the screen. Same class of bug the
          // SocialAuthButtons plate comments call out.
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: radii.pill,
            overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: chrome.border,
            backgroundColor: chrome.surface,
          }}
        >
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          const badged = badgedTabs?.includes(tab.key) ?? false;
          const Icon = tab.icon;
          const showAvatar = tab.key === 'you' && Boolean(avatarUri);

          return (
            <Pressable
              key={tab.key}
              onPressIn={wake}
              onPress={() => {
                wake();
                if (!active)
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
                    // Haptics unavailable, not fatal.
                  });
                onTabPress(tab.key);
              }}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              // No labels render, so the icon alone has to be reachable. The
              // 44pt minimum is the iOS touch target, not a visual size.
              className="min-h-11 flex-1 items-center justify-center active:opacity-70"
            >
              <View
                style={{
                  alignSelf: 'stretch',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: spacing.sm,
                  borderRadius: radii.pill,
                  backgroundColor: active ? chrome.surfaceActive : 'transparent',
                }}
              >
                {showAvatar ? (
                  <Image
                    source={{ uri: avatarUri }}
                    style={{
                      width: AVATAR_SIZE,
                      height: AVATAR_SIZE,
                      borderRadius: AVATAR_SIZE / 2,
                    }}
                  />
                ) : (
                  <Icon
                    size={ICON_SIZE}
                    strokeWidth={active ? 2.2 : 1.75}
                    color={active ? chrome.inkActive : chrome.ink}
                  />
                )}

                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: LABEL_GAP,
                    fontSize: LABEL_SIZE,
                    lineHeight: LABEL_SIZE + 3,
                    color: active ? chrome.inkActive : chrome.ink,
                  }}
                  className={active ? 'font-sans-semibold' : 'font-sans-medium'}
                >
                  {tab.label}
                </Text>

                {badged ? (
                  <View
                    // Sits on the glyph's top right corner, the same place the
                    // reference puts it. `pointerEvents none` so the dot can
                    // never eat the tab's own press.
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: spacing.md,
                      width: DOT_SIZE,
                      height: DOT_SIZE,
                      borderRadius: DOT_SIZE / 2,
                      backgroundColor: chrome.badge,
                    }}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
        </BlurView>
      </Animated.View>
    </View>
  );
}

export { BottomNav };
