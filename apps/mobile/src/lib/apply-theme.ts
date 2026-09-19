import { Appearance, Platform } from 'react-native';
import { colorScheme } from 'nativewind';

export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Live OS appearance subscription. WEB ONLY, and only active while the
 * resolved preference is 'system'. Module level (not component state) so it
 * survives across applyTheme() calls from both _layout.tsx's mount effect and
 * the Settings surface, and gets torn down the moment the user picks an
 * explicit light/dark preference.
 *
 * Native deliberately has no equivalent here: NativeWind's native runtime
 * already owns an Appearance listener plus an AppState listener of its own
 * (react-native-css-interop runtime/native/appearance-observables.ts), and
 * duplicating them is what broke live appearance changes. See below.
 */
let systemSubscription: { remove(): void } | null = null;

/**
 * Applies a persisted appearance preference to nativewind's resolved color
 * scheme, the single source useThemeColors() and the `dark` class both read
 * (see theme/use-theme-colors.ts). Kept as a plain function (not a hook) so
 * it can run from an effect on app start and from the Settings surface on
 * change with no extra dependency.
 *
 * The two platforms need OPPOSITE handling of 'system', which is the whole
 * reason this function is branched. Getting that wrong has now caused a bug
 * in each direction.
 *
 * WEB. NativeWind's web runtime (react-native-css-interop
 * runtime/web/color-scheme.ts) handles `set('system')` by unlocking its
 * internal observable to fall back to the live OS scheme, which is what
 * useThemeColors() reads and correctly tracks dark. But the same call's DOM
 * side effect only adds the `dark` class when the literal value passed in is
 * `'dark'`; for `'system'` it takes the `else` branch and removes the class
 * unconditionally, with nothing ever re-adding it when the OS is actually
 * dark. That leaves the `dark` class, and every Tailwind-class-driven color
 * (bg-surface, the secondary Button variant's fill, ...), stuck rendering
 * light while useThemeColors() colors correctly resolve dark, producing
 * illegible dark-mode text and icons on a still-light chrome (QA
 * J54/J57/J58, K59/K60/K63/K65/K66). So on web we resolve 'system' to a
 * concrete 'light'/'dark' ourselves via Appearance (react-native-web backs
 * this with the same `prefers-color-scheme` matchMedia query nativewind's own
 * fallback uses) and always call `colorScheme.set()` with that concrete
 * value, keeping the class-add branch and the observable update in lockstep.
 * A live Appearance listener re-resolves on OS changes while the preference
 * stays 'system'.
 *
 * NATIVE. The same resolve-to-concrete is actively HARMFUL, because on native
 * `colorScheme.set(value)` does not merely update a JS observable, it calls
 * through to `Appearance.setColorScheme(value)`, which is a hard OS level
 * override:
 *
 *   iOS     RCTAppearance.mm setColorScheme: sets
 *           `window.overrideUserInterfaceStyle` on every window. The view
 *           hierarchy's trait collection is then pinned, so a later system
 *           appearance change posts no RCTUserInterfaceStyleDidChange
 *           notification, `appearanceChanged:` never runs, and no
 *           `appearanceChanged` event ever reaches JS. RN's JS side compounds
 *           it: Appearance.setColorScheme() caches the concrete value in
 *           `state.appearance`, and getColorScheme() returns that cache until
 *           an event it will never receive arrives.
 *   Android AppearanceModule.kt maps it to
 *           `AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_NO/YES)`, the
 *           same hard pin.
 *
 * So passing a concrete value for a 'system' preference pins the app to
 * whatever the OS happened to be at mount. A cold launch looks correct
 * (nothing is overridden yet when RCTAppearance reads the key window's trait
 * collection in init), and every later live change is silently ignored: the
 * captured screen stays light with the OS in dark. The manual Appearance
 * listener above cannot rescue it either, since it is subscribed to the same
 * event that is no longer emitted, and reads the same poisoned cache.
 *
 * Native therefore forwards 'system' straight through. NativeWind maps that
 * to `Appearance.setColorScheme('unspecified')`, which clears the iOS window
 * override and sets Android to MODE_NIGHT_FOLLOW_SYSTEM, and leaves
 * NativeWind's `colorSchemeObservable` undefined so `colorScheme.get()` falls
 * back to its `systemColorScheme` observable, which its own Appearance and
 * AppState listeners keep live. That is exactly the reactive behavior wanted,
 * and it is the behavior this file had before 025d77a.
 *
 * An explicit 'light'/'dark' preference pins on purpose on both platforms,
 * which is what the user asked for.
 */
export function applyTheme(pref: ThemePref): void {
  systemSubscription?.remove();
  systemSubscription = null;

  if (Platform.OS === 'web' && pref === 'system') {
    const resolve = () => colorScheme.set(Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
    resolve();
    systemSubscription = Appearance.addChangeListener(resolve);
    return;
  }

  colorScheme.set(pref);
}
