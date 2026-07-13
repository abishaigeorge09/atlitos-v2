import { type ColorPalette, getTheme } from '@atlitos/theme';
import { useColorScheme } from 'react-native';

/**
 * Resolves the active `@atlitos/theme` color palette from the device color
 * scheme. This is the only place mobile screens should read colors from,
 * never a raw hex value. Follows system light/dark, per the design language
 * (dark is first class, not an inverted afterthought).
 */
export function useThemeColors(): ColorPalette {
  const scheme = useColorScheme();
  return getTheme(scheme === 'dark' ? 'dark' : 'light').colors;
}
