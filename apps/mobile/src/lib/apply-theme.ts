import { Appearance } from 'react-native';
import { colorScheme } from 'nativewind';

export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Live OS appearance subscription, only active while the resolved
 * preference is 'system'. Module level (not component state) so it survives
 * across applyTheme() calls from both _layout.tsx's mount effect and the
 * Settings surface, and gets torn down the moment the user picks an
 * explicit light/dark preference.
 */
let systemSubscription: { remove(): void } | null = null;

/**
 * Applies a persisted appearance preference to nativewind's resolved color
 * scheme, the single source useThemeColors() and the `dark` class both read
 * (see theme/use-theme-colors.ts). Kept as a plain function (not a hook) so
 * it can run from an effect on app start and from the Settings surface on
 * change with no extra dependency.
 *
 * Never forwards 'system' straight to `colorScheme.set()`. NativeWind's web
 * runtime (react-native-css-interop's runtime/web/color-scheme.js) handles
 * `set('system')` by unlocking its *internal* observable to fall back to the
 * live OS scheme, which is what useThemeColors() reads and correctly tracks
 * dark. But the same call's DOM side effect only adds the `dark` class when
 * the literal value passed in is `'dark'`; for `'system'` it takes the
 * `else` branch and removes the class unconditionally, with nothing ever
 * re-adding it when the OS is actually dark. That leaves the `dark` class,
 * and every Tailwind-class-driven color (bg-surface, the secondary Button
 * variant's fill, ...), stuck rendering light while useThemeColors() colors
 * correctly resolve dark, producing illegible dark-mode text/icons on a
 * still-light chrome (QA J54/J57/J58, K59/K60/K63/K65/K66).
 *
 * The fix resolves 'system' to a concrete 'light'/'dark' ourselves via
 * Appearance (react-native-web backs this with the same
 * `prefers-color-scheme` matchMedia query nativewind's own fallback uses)
 * and always calls `colorScheme.set()` with that concrete value. `set()`
 * only ever toggles the DOM class in the branch that also updates the
 * internal observable, so the two stay in lockstep by construction. A live
 * Appearance listener keeps re-resolving on OS changes for as long as the
 * preference stays 'system'.
 */
export function applyTheme(pref: ThemePref): void {
  systemSubscription?.remove();
  systemSubscription = null;

  if (pref === 'system') {
    const resolve = () => colorScheme.set(Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
    resolve();
    systemSubscription = Appearance.addChangeListener(resolve);
    return;
  }

  colorScheme.set(pref);
}
