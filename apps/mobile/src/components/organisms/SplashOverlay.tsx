import { darkColors } from '@atlitos/theme';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import splashMark from '../../../assets/images/splash-icon.png';

/**
 * A pixel match of the native splash (app.json, `expo-splash-screen`: the
 * dark background and splash-icon.png at 220 points wide, centred), drawn in
 * JS so the hand off out of the splash can be animated instead of cut.
 *
 * The sequence:
 *   1. This mounts on the very first JS render. Its first layout hides the
 *      NATIVE splash, which is invisible because this view is identical.
 *   2. While the app is not ready (fonts, see _layout.tsx), it simply holds.
 *   3. Once ready, the logo drifts up in scale a few percent while the whole
 *      layer fades, revealing the first screen underneath, then unmounts.
 *
 * The background is the dark theme's `bg`, which is the same value app.json
 * gives the native splash, so the two cannot drift apart silently.
 * Reduce Motion skips the scale and shortens the fade.
 */
const LOGO_WIDTH = 220;
/** splash-icon.png is 1024 x 606. */
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 606) / 1024);
const HOLD_MS = 120;
const FADE_MS = 420;
const REDUCED_FADE_MS = 160;

export function SplashOverlay({ ready }: { ready: boolean }) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(true);
  const nativeHidden = useRef(false);
  const opacity = useSharedValue(1);
  const logoScale = useSharedValue(1);

  useEffect(() => {
    if (!ready) return;
    const fade = reduceMotion ? REDUCED_FADE_MS : FADE_MS;
    const easing = Easing.out(Easing.cubic);
    if (!reduceMotion) {
      logoScale.value = withDelay(HOLD_MS, withTiming(1.08, { duration: fade, easing }));
    }
    opacity.value = withDelay(HOLD_MS, withTiming(0, { duration: fade, easing }));
    // Unmount on a timer rather than a worklet callback, so nothing here
    // depends on a JS thread hop from the UI thread.
    const timer = setTimeout(() => setMounted(false), HOLD_MS + fade + 50);
    return () => clearTimeout(timer);
  }, [ready, reduceMotion, opacity, logoScale]);

  const layerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: logoScale.value }] }));

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={ready ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.layer, layerStyle]}
      onLayout={() => {
        if (nativeHidden.current) return;
        nativeHidden.current = true;
        SplashScreen.hideAsync().catch(() => {
          // Not fatal.
        });
      }}
    >
      <Animated.View style={logoStyle}>
        <Image
          source={splashMark}
          style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: darkColors.bg,
  },
});
