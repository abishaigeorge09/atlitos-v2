import { colorScheme } from 'nativewind';

export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Applies a persisted appearance preference to nativewind's resolved color
 * scheme, the single source useThemeColors() and the `dark` class both read
 * (see theme/use-theme-colors.ts). 'system' hands control back to the OS.
 * Kept as a plain function (not a hook) so it can run from an effect on app
 * start and from the Settings surface on change with no extra dependency.
 */
export function applyTheme(pref: ThemePref): void {
  colorScheme.set(pref);
}
