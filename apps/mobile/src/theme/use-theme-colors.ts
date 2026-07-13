import { type ColorPalette, getTheme } from '@atlitos/theme';
import { useColorScheme } from 'nativewind';

/**
 * Resolves the active `@atlitos/theme` color palette from nativewind's
 * resolved color scheme (`colorScheme.set()` / `useColorScheme()` from
 * 'nativewind', not React Native's own `useColorScheme`). This is the only
 * place mobile screens should read colors from, never a raw hex value.
 *
 * Sourcing from nativewind (rather than RN's `useColorScheme`, which this
 * used to read directly) keeps this StyleSheet based token system and the
 * className/Tailwind based system (tailwind.config.js's `dark` class,
 * global.css's `.dark:root`) in lockstep on every platform: on native,
 * nativewind's resolved scheme delegates to the real `Appearance` API same
 * as before, so this is a no-op behavior change there. On web, RN's own
 * `Appearance.setColorScheme` throws (react-native-web does not implement
 * manual overrides), so nativewind's web runtime tracks color scheme itself
 * (toggling the `dark` class on `<html>`) independently of `Appearance`;
 * reading RN's `useColorScheme` here meant this hook and the `dark` class
 * could disagree on web, producing wrong-theme colors (e.g. light-mode ink
 * on a dark-mode surface) on any StyleSheet-driven text or icon. Follows
 * system light/dark by default, per the design language (dark is first
 * class, not an inverted afterthought); see ThemeToggle in
 * src/app/dev/gallery.tsx for the manual override control.
 */
export function useThemeColors(): ColorPalette {
  const { colorScheme } = useColorScheme();
  return getTheme(colorScheme === 'dark' ? 'dark' : 'light').colors;
}
