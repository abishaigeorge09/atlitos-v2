import { auroraStops, pressScale, radii, spacing } from '@atlitos/theme';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * AuthScene, the shared premium backdrop for every auth and onboarding screen
 * (splash, login, register, role select, wizard steps). It renders a slow,
 * warm aurora, a mesh of drifting radial glows in the Atlitos ember/orange
 * family over a cream (light) or espresso (dark) wash, plus a few floating
 * sport motif line accents, behind whatever content the screen passes as
 * children.
 *
 * All motion is react-native-reanimated driving react-native-svg gradients,
 * so it hot reloads with no native rebuild. Nothing here needs
 * expo-linear-gradient, blur, or skia. `useReducedMotion` freezes the
 * composition into a static, still pleasant arrangement when the OS asks for
 * reduced motion, so the same scene serves both preferences.
 *
 * Glass surfaces (`AuthGlassCard`) are translucent token derived rgba fills,
 * not a native blur, so a form card reads as floating over the aurora while
 * staying legible in light and dark.
 */

/**
 * Brand derived aurora gradient stops. Sourced from the single token set in
 * packages/theme (`auroraStops`), never hardcoded here, so the auth backdrop
 * stays on the shared palette like every other surface.
 */
const AURORA_STOPS = auroraStops;

/** hex (#rrggbb) plus 0..1 alpha to an rgba() string. */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface BlobSpec {
  key: string;
  color: string;
  /** center alpha of the radial glow */
  alpha: number;
  /** diameter as a fraction of the larger screen edge */
  sizeFactor: number;
  /** rest position as a fraction of screen width / height */
  x: number;
  y: number;
  /** drift amplitude in px */
  dx: number;
  dy: number;
  /** scale delta added at the far end of the drift */
  ds: number;
  /** full round trip duration (ms) */
  duration: number;
  /** phase offset delay (ms) so blobs are not synchronized */
  delay: number;
}

function AuroraBlob({ spec, base }: { spec: BlobSpec; base: number }) {
  const size = base * spec.sizeFactor;
  const progress = useSharedValue(0.5);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      progress.value = 0.5;
      return;
    }
    progress.value = withDelay(
      spec.delay,
      withRepeat(withTiming(1, { duration: spec.duration, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
  }, [progress, reduced, spec.delay, spec.duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-spec.dx, spec.dx]) },
      { translateY: interpolate(progress.value, [0, 1], [-spec.dy, spec.dy]) },
      { scale: interpolate(progress.value, [0, 1], [1, 1 + spec.ds]) },
    ],
  }));

  const gradientId = `aurora-${spec.key}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          left: spec.x - size / 2,
          top: spec.y - size / 2,
        },
        animatedStyle,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={spec.color} stopOpacity={spec.alpha} />
            <Stop offset="0.6" stopColor={spec.color} stopOpacity={spec.alpha * 0.35} />
            <Stop offset="1" stopColor={spec.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={size / 2} cy={size / 2} rx={size / 2} ry={size / 2} fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
}

/** Slow floating line art (rings and a court arc) at low opacity. */
function FloatingMotifs({ width, height, stroke }: { width: number; height: number; stroke: string }) {
  const drift = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      drift.value = 0;
      return;
    }
    drift.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [drift, reduced]);

  const floatA = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(drift.value, [0, 1], [-10, 10]) }],
  }));
  const floatB = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(drift.value, [0, 1], [8, -8]) }],
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, floatA]}>
        <Svg width={width} height={height}>
          <Circle
            cx={width * 0.86}
            cy={height * 0.14}
            r={width * 0.22}
            stroke={stroke}
            strokeWidth={1.5}
            strokeOpacity={0.14}
            fill="none"
          />
          <Path
            d={`M ${width * -0.05} ${height * 0.34} Q ${width * 0.3} ${height * 0.24} ${width * 0.62} ${height * 0.36}`}
            stroke={stroke}
            strokeWidth={1.5}
            strokeOpacity={0.1}
            fill="none"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, floatB]}>
        <Svg width={width} height={height}>
          <Circle
            cx={width * 0.1}
            cy={height * 0.9}
            r={width * 0.16}
            stroke={stroke}
            strokeWidth={1.5}
            strokeOpacity={0.12}
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

export interface AuthSceneProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function AuthScene({ children, style }: AuthSceneProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { width, height } = useWindowDimensions();
  const base = Math.max(width, height);

  // Dark leans into glowing embers over espresso, light stays airier and
  // warmer over paper. Both compositions read as the same aurora, tuned.
  const blobs: BlobSpec[] = isDark
    ? [
        { key: 'a', color: AURORA_STOPS.orange, alpha: 0.5, sizeFactor: 1.15, x: width * 0.82, y: height * 0.16, dx: 26, dy: 34, ds: 0.12, duration: 7200, delay: 0 },
        { key: 'b', color: AURORA_STOPS.ember, alpha: 0.42, sizeFactor: 1.35, x: width * 0.16, y: height * 0.42, dx: 34, dy: 24, ds: 0.1, duration: 8600, delay: 900 },
        { key: 'c', color: AURORA_STOPS.gold, alpha: 0.26, sizeFactor: 1.0, x: width * 0.62, y: height * 0.88, dx: 22, dy: 30, ds: 0.14, duration: 9400, delay: 1800 },
      ]
    : [
        { key: 'a', color: AURORA_STOPS.ember, alpha: 0.34, sizeFactor: 1.15, x: width * 0.84, y: height * 0.14, dx: 24, dy: 32, ds: 0.12, duration: 7600, delay: 0 },
        { key: 'b', color: AURORA_STOPS.gold, alpha: 0.4, sizeFactor: 1.4, x: width * 0.14, y: height * 0.44, dx: 32, dy: 22, ds: 0.1, duration: 8800, delay: 900 },
        { key: 'c', color: AURORA_STOPS.cream, alpha: 0.55, sizeFactor: 1.05, x: width * 0.6, y: height * 0.9, dx: 20, dy: 28, ds: 0.14, duration: 9600, delay: 1800 },
      ];

  const washTop = isDark ? colors.bg : colors.bg;
  const washBottom = isDark ? colors.surfaceMuted : colors.accentTint;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }, style]}>
      {/* Static base wash: a subtle warm vertical gradient under the glows. */}
      <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
        <Defs>
          <LinearGradient id="auth-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={washTop} stopOpacity={1} />
            <Stop offset="1" stopColor={washBottom} stopOpacity={isDark ? 0.9 : 0.6} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#auth-wash)" />
      </Svg>

      {blobs.map((spec) => (
        <AuroraBlob key={spec.key} spec={spec} base={base} />
      ))}

      <FloatingMotifs width={width} height={height} stroke={colors.accent} />

      <View style={styles.content}>{children}</View>
    </View>
  );
}

export interface AuthGlassCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A translucent, token derived surface that floats over the aurora. Not a
 * native blur (which would need a rebuild); a high alpha rgba fill of the
 * theme surface with a soft hairline, warm shadow, and generous padding.
 */
export function AuthGlassCard({ children, style }: AuthGlassCardProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const fill = isDark ? rgba(colors.surface, 0.62) : rgba(colors.surface, 0.72);
  // Light surface token resolves to a bright white, giving a crisp glass rim;
  // dark uses the strong border token. Both stay on palette (no literals).
  const borderColor = isDark ? rgba(colors.borderStrong, 0.6) : rgba(colors.surface, 0.7);

  return (
    <View
      style={[
        styles.glass,
        {
          backgroundColor: fill,
          borderColor,
          shadowColor: colors.text,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface AuthRevealProps {
  children: ReactNode;
  /** stagger order; each step adds a small delay to the entrance. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Staggered entrance wrapper. Fades and lifts its children in on mount, with
 * a per index delay so a stack of these reveals top to bottom. Honors reduced
 * motion by snapping straight to the resting state.
 */
export function AuthReveal({ children, index = 0, style }: AuthRevealProps) {
  const progress = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(80 + index * 90, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [progress, reduced, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [16, 0]) }],
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

export interface AuthCtaProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The hero call to action on the auth surface. A taller, tactile take on the
 * accent primary button: light haptic on press, a reanimated press scale, and
 * the locked CTA radius. Same ink on accent token pairing as the shared
 * Button, so it stays on brand while feeling more alive than a flat tap.
 */
export function AuthCta({ label, onPress, loading, disabled, style }: AuthCtaProps) {
  const colors = useThemeColors();
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();
  const isDisabled = Boolean(disabled) || Boolean(loading);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      // Stable handle for the submit button. Every auth screen renders its CTA
      // label as BOTH the heading and the button ("Log in" appears twice on
      // login.tsx), so a text selector is ambiguous and index/relative
      // selectors proved unreliable: a peer QA session lost several runs to it
      // and had to fall back to raw screen coordinates. Coordinates then break
      // again whenever the keyboard shifts the card. One testID removes the
      // whole class.
      testID="auth-cta"
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPressIn={() => {
        if (!reduced) scale.value = withTiming(pressScale, { duration: 120 });
      }}
      onPressOut={() => {
        if (!reduced) scale.value = withTiming(1, { duration: 160 });
      }}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
          // Haptics unavailable (web, simulator without a haptic engine), not fatal.
        });
        onPress();
      }}
      style={[styles.cta, { backgroundColor: colors.accent }, isDisabled && styles.ctaDisabled, animatedStyle, style]}
    >
      {loading ? (
        <ActivityIndicator color={colors.inkOnAccent} />
      ) : (
        <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  cta: {
    height: 52,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  ctaDisabled: { opacity: 0.5 },
  content: { flex: 1 },
  glass: {
    borderRadius: radii['2xl'],
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: spacing.xl,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
});
